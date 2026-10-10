"""«Маринад»: год жизни платформы шаурматч_ в ускоренной перемотке.

Каждый месяц на платформу приходят новые кандидаты и работодатели. Три модели дообучаются
на том, что люди и так делают в продукте:
  1. ответы на тест → калибровка сложностей начинок, шаблонов и их дискриминации (MML-EM);
  2. ответы кандидатов на приглашения и итоги собеседований → двусторонний ранжировщик;
  3. правки рецептов работодателями → языковая модель «текст → рецепт» (отдельный эксперимент
     на написанных вручную потребностях — см. recipe_learning_curve).
В 7-м месяце приём одной из начинок становится общеизвестным («вирусный разбор») —
детектор «чёрствого лаваша» должен это заметить, а калибровка — исправить.

Запуск:  python -m training.marinate [--months 12] [--per-month 300] [--seed 7] [--bake]
Результат: docs/training/report.md, metrics.json, графики; с --bake — модели в app/models/.
"""
from __future__ import annotations

import argparse
import json
import os
import math
import random
import time
from pathlib import Path

import numpy as np

from app import matching, recipe
from app.ingredients import GRADE_IDS
from app.learn import calibration, drift, params, ranker, textmodel
from app.learn import store
from validation.simulate import cohen_kappa_quadratic
from . import vacancy_gen as gen
from .world import World

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "training"
EVAL = Path(__file__).with_name("needs_eval.json")
VIRAL_MONTH = 7


def log(*a):
    print(*a, flush=True)


# ------------------------------------------------------------------ метрики калибровки
def param_rmse(est: dict | None, truth: dict, exclude: str | None = None) -> dict:
    """RMSE оценок против истины. exclude — начинка с вирусным разбором: её истинная сложность
    изменилась, она оценивается отдельно (см. drift.viral_eta)."""
    exp = calibration.expert_params()
    est = est or exp
    out = {}
    for kind in ("b0", "eta"):
        keys = [k for k in truth[kind] if k != exclude]
        out[kind] = round(float(np.sqrt(np.mean([(est[kind][k] - truth[kind][k]) ** 2 for k in keys]))), 3)
    keys = list(truth["a"])
    out["a"] = round(float(np.sqrt(np.mean([(math.log(est["a"][k]) - math.log(truth["a"][k])) ** 2 for k in keys]))), 3)
    return out


def grade_metrics(people: list[dict]) -> dict:
    a = [GRADE_IDS.index(p["grade"]) for p in people]
    t = [GRADE_IDS.index(p["true_grade"]) for p in people]
    a_, t_ = np.array(a), np.array(t)
    return {"exact": round(float((a_ == t_).mean()), 3), "within_one": round(float((abs(a_ - t_) <= 1).mean()), 3),
            "kappa": round(cohen_kappa_quadratic(a, t, 4), 3), "overestimated": round(float((a_ > t_).mean()), 3)}


# ------------------------------------------------------------------ подбор
def profile(p: dict) -> dict:
    return {"id": p["id"], "specialization": p["spec"], "grade": p["grade"], "ratings": p["ratings"],
            "stacks": p["stacks"], "formats": p["formats"], "salary_expect": p["salary"],
            "fsp": {"count": int(p["fsp"]), "relevant": int(p["fsp"]), "prizes": 0}, "last_active_days": p["stale_days"]}


def parse_recipe(text: str, model: dict | None) -> dict:
    return recipe.parse_need(text, model=model) if model else recipe.parse_need(text, model=False)


def rank_pool(pool: list[dict], rcp: dict, offer: dict, rk: dict | None) -> list[tuple[float, dict, list, list]]:
    rcp = {**rcp, "salary_from": offer["salary_from"], "salary_to": offer["salary_to"], "formats": offer["formats"]}
    out = []
    for p in pool:
        if p["spec"] != rcp["specialization"]:
            continue
        prof = profile(p)
        fx, ax = ranker.features(prof, rcp, offer)
        if rk:
            s = ranker.head_predict(rk["fit"], fx) * ranker.head_predict(rk["accept"], ax)
        else:
            s = matching.score_candidate(prof, rcp)["score"]
        out.append((s, p, fx, ax))
    out.sort(key=lambda x: -x[0])
    return out


def train_ranker(inv_log: list[dict], prior: dict | None = None, l2: float = 1.0) -> dict | None:
    acc = [r for r in inv_log]
    hired = [r for r in inv_log if r["accepted"]]
    if len(acc) < 40 or len(hired) < 20:
        return prior
    pa = np.array(prior["accept"]["w"]) if prior else None
    pf = np.array(prior["fit"]["w"]) if prior else None
    return {"accept": ranker.train_head(np.array([r["ax"] for r in acc]), np.array([r["accepted"] for r in acc], float), pa, l2),
            "fit": ranker.train_head(np.array([r["fx"] for r in hired]), np.array([r["hired"] for r in hired], float), pf, l2)}


def expected_hires(world: World, ranked, v, k: int = 5) -> tuple[float, float]:
    top = ranked[:k]
    if not top:
        return 0.0, 0.0
    acc = [world.p_accept(p, v) for _, p, _, _ in top]
    hire = [a * world.p_hire(p, v) for a, (_, p, _, _) in zip(acc, top)]
    return float(np.sum(hire)) / len(top) * 10, float(np.mean(acc))


# ------------------------------------------------------------------ язык: обучение на правках
def recipe_scores(texts: list[dict], fn) -> dict:
    sp = gr = hit = 0.0
    for e in texts:
        r = fn(e["text"])
        top = list(r["ingredients"])[:3]
        sp += r["specialization"] == e["specialization"]
        gr += r["grade"] == e["grade"]
        hit += len(set(top) & set(e["ingredients"])) / len(e["ingredients"])
    n = len(texts)
    return {"specialization": round(sp / n, 3), "grade": round(gr / n, 3), "ingredients_hit3": round(hit / n, 3)}


def recipe_learning_curve(corpus: list[dict], ev: list[dict], seed: int) -> dict:
    """Перекрёстная проверка на вручную написанных потребностях: модель видит k «правок работодателей»
    (размеченных вручную текстов из других фолдов) и проверяется на оставшихся."""
    rng = random.Random(seed)
    idx = list(range(len(ev)))
    rng.shuffle(idx)
    folds = [idx[i::4] for i in range(4)]
    curve = {}
    for k in (0, 10, 20, 30):
        res = []
        for f in folds:
            test = [ev[i] for i in f]
            pool = [ev[i] for i in idx if i not in f]
            extra = [{**e, "weight": 4.0} for e in pool[:k]]
            m = textmodel.train(corpus + extra, epochs=5, seed=seed)
            res.append(recipe_scores(test, lambda t: recipe.parse_need(t, model=m)))
        curve[k] = {key: round(float(np.mean([r[key] for r in res])), 3) for key in res[0]}
        log(f"  правок работодателей: {k:>2} → {curve[k]}")
    return curve


# ------------------------------------------------------------------ главный сценарий
def main(months: int = 12, per_month: int = 300, vac_per_month: int = 30, seed: int = 7, bake: bool = False):
    t0 = time.time()
    OUT.mkdir(parents=True, exist_ok=True)
    world = World(seed)
    truth = world.truth()
    np.random.seed(seed)
    rng = random.Random(seed + 1)

    # --- 0. Языковая модель: корпус + честная проверка на ручных текстах
    log("Язык: обучаю модель «текст → рецепт» на сгенерированном корпусе…")
    corpus = gen.corpus(8000, seed)
    ev = json.loads(EVAL.read_text(encoding="utf-8"))
    tm = textmodel.train(corpus, epochs=6, seed=seed, log=log)
    lang = {
        "corpus_size": len(corpus), "eval_size": len(ev),
        "rules": recipe_scores(ev, lambda t: recipe.parse_need(t, model=False)),
        "model": recipe_scores(ev, lambda t: recipe.parse_need(t, model=tm)),
    }
    log(f"  правила: {lang['rules']}\n  модель:  {lang['model']}")
    lang["learning_curve"] = recipe_learning_curve(corpus, ev, seed)

    # --- 1. Год жизни платформы
    cal = None                       # месяц 1 — экспертные параметры
    rk = None                        # месяц 1 — ручная формула ШАУРМЫ
    responses, inv_log, people_all, pool = [], [], [], []
    ts = [0]
    monthly = []
    reset_keys: dict[str, int] = {}
    viral_start_ts = None
    detected = None
    trace_v = ts_v = trace_c = ts_c = []
    control_key = None
    viral_eta = []
    cal_hist = []
    for month in range(1, months + 1):
        if month == VIRAL_MONTH:
            # вирусный разбор: выбираем начинку, которую тест показывает чаще всего
            cnt = {}
            for r in responses:
                for o in r["ops"]:
                    cnt[f"{r['template_id']}:{o}"] = cnt.get(f"{r['template_id']}:{o}", 0) + 1
            world.viral = max(cnt, key=cnt.get)
            world.viral_share = 0.7
            viral_start_ts = ts[0]
            log(f"Месяц {month}: завирусился разбор начинки {world.viral}")
        params.set_override(cal)
        cohort = world.people(per_month, len(people_all))
        month_resp = []
        for p in cohort:
            world.categorize(p, month_resp, ts)
        responses += month_resp
        people_all += cohort
        pool += cohort
        g = grade_metrics(cohort)

        # --- рынок: вакансии месяца, приглашения, ответы, наймы
        hires_m, acc_m = [], []
        for vi in range(vac_per_month):
            v = world.vacancy(gen, month * 100 + vi)
            rcp = parse_recipe(v["text"], tm)
            rcp["stacks"] = v["stacks"]
            ranked = rank_pool(pool, rcp, v["offer"], rk)
            if not ranked:
                continue
            h, a = expected_hires(world, ranked, v)
            hires_m.append(h)
            acc_m.append(a)
            # 4 приглашения из топа + 1 «тёмная лошадка» из топ-30 (исследование, чтобы модель училась не только на топе)
            picks = ranked[:4] + ([rng.choice(ranked[4:30])] if len(ranked) > 4 else [])
            for _, p, fx, ax in picks:
                accepted = rng.random() < world.p_accept(p, v)
                hired = accepted and rng.random() < world.p_hire(p, v)
                inv_log.append({"fx": fx, "ax": ax, "accepted": accepted, "hired": hired, "month": month})
                if hired and p in pool:
                    pool.remove(p)

        # --- детектор «чёрствого лаваша» по ответам с начала года
        scan = drift.scan(responses, cat_a, cat_b, reset_keys)
        alarms = [r for r in scan["alarms"] if r["kind"] == "op"]
        honest_max = max((r["cusum_max"] for r in scan["keys"] if r["kind"] == "op" and r["key"] != world.viral), default=0.0)
        if world.viral and detected is None:
            hit = next((r for r in alarms if r["key"] == world.viral), None)
            if hit:
                detected = {"month": month, "key": hit["key"], "after_responses": hit["alarm_after_n"],
                            "responses_since_viral": sum(1 for r in responses if r["ts"] > viral_start_ts and world.viral.split(":")[1] in r["ops"] and r["template_id"] == world.viral.split(":")[0] and r["ts"] <= hit["alarm_ts"]),
                            "easier_by": hit["easier_by"]}
                reset_keys[world.viral] = hit["alarm_ts"]
                # траектория — такой, какой её видел детектор в момент тревоги (параметры до перекалибровки)
                trace_v, ts_v = drift.cusum_trace(responses, world.viral, cat_a, cat_b)
                control_key = max((k for k in (cal or calibration.expert_params())["eta"] if k != world.viral),
                                  key=lambda k: sum(1 for r in responses if r["template_id"] == k.split(":")[0] and k.split(":")[1] in r["ops"]))
                trace_c, ts_c = drift.cusum_trace(responses, control_key, cat_a, cat_b)
                log(f"  ДЕТЕКТОР: {hit['key']} почерствел (−{hit['easier_by']} логита), тревога через "
                    f"{detected['responses_since_viral']} ответов после разбора")

        if month == months and os.environ.get("MARINATE_DUMP"):
            Path(os.environ["MARINATE_DUMP"]).write_text(json.dumps({"responses": responses, "viral": world.viral,
                "viral_start_ts": viral_start_ts, "cal_by_month": cal_hist}), encoding="utf-8")
        # --- конец месяца: дообучение
        train_set = calibration_set(responses, reset_keys)
        cal_hist.append({"month": month, "end_ts": ts[0], "cal": cal})   # параметры, которые действовали в этом месяце
        cal = calibration.fit(train_set, start=cal)
        rk = train_ranker(inv_log)
        rm_exp, rm_cal = param_rmse(None, truth, world.viral), param_rmse(cal, truth, world.viral)
        if world.viral:
            viral_eta.append({"month": month, "learned": cal["eta"][world.viral]})
        row = {"month": month, "candidates": len(people_all), "responses": len(responses), "invitations": len(inv_log),
               "grade": g, "rmse_expert": rm_exp, "rmse_learned": rm_cal,
               "hires_per_10": round(float(np.mean(hires_m)), 3), "acceptance": round(float(np.mean(acc_m)), 3),
               "ranker": "learned" if rk else "hand", "calibration_used": month > 1, "honest_cusum_max": round(honest_max, 2),
               "false_alarms": [r["key"] for r in alarms if r["key"] != world.viral]}
        monthly.append(row)
        log(f"Месяц {month:>2}: грейд точно {g['exact']:.0%} (κ {g['kappa']}), RMSE η {rm_exp['eta']}→{rm_cal['eta']}, "
            f"наймов на 10 приглашений {row['hires_per_10']:.2f}, принимают {row['acceptance']:.0%} · {time.time() - t0:.0f} с")

    # --- 2. Контрфакт: те же люди и вакансии, «эксперт/формула» против «маринада»
    log("Контрфакт: свежая когорта (2000) и 150 вакансий, сравнение до/после…")
    world.viral_share = 0.7
    test_people = world.people(2000, 10 ** 6)
    snapshot = random.getstate(), world.rng.getstate()
    res_grade = {}
    for name, c in (("expert", None), ("learned", cal)):
        world.rng.setstate(snapshot[1])
        params.set_override(c)
        ppl = [dict(p) for p in test_people]
        for p in ppl:
            world.categorize(p, [], [0])
        res_grade[name] = grade_metrics(ppl)
    params.set_override(cal)
    res_match = {"hand": [], "learned": []}
    res_acc = {"hand": [], "learned": []}
    market = [p for p in pool]
    for vi in range(150):
        v = world.vacancy(gen, 10 ** 5 + vi)
        rcp = parse_recipe(v["text"], tm)
        rcp["stacks"] = v["stacks"]
        for name, model in (("hand", None), ("learned", rk)):
            ranked = rank_pool(market, rcp, v["offer"], model)
            h, a = expected_hires(world, ranked, v)
            res_match[name].append(h)
            res_acc[name].append(a)
    counterfactual = {
        "grade": res_grade,
        "matching": {n: {"hires_per_10": round(float(np.mean(res_match[n])), 3), "acceptance": round(float(np.mean(res_acc[n])), 3)} for n in res_match},
    }
    log(f"  грейд: эксперт {res_grade['expert']} → маринад {res_grade['learned']}")
    log(f"  подбор: формула {counterfactual['matching']['hand']} → маринад {counterfactual['matching']['learned']}")

    # --- 3. Траектория детектора для графика
    eta_points = [{"key": k, "expert": calibration.expert_params()["eta"][k], "learned": cal["eta"][k], "truth": round(truth["eta"][k], 3),
                   "n": cal["n"]["eta"][k]} for k in truth["eta"]]

    metrics = {
        "seed": seed, "months": months, "per_month": per_month, "vacancies_per_month": vac_per_month,
        "monthly": monthly, "counterfactual": counterfactual, "language": lang,
        "drift": {"viral_key": world.viral, "viral_month": VIRAL_MONTH, "detected": detected, "h": drift.H, "k": drift.K,
                  "viral_eta": {"expert": calibration.expert_params()["eta"][world.viral], "truth_before": round(truth["eta"][world.viral], 3),
                                "truth_after": round(truth["eta"][world.viral] - 1.3 * world.viral_share, 3), "by_month": viral_eta} if world.viral else None,
                  "trace": trace_v, "trace_ts": ts_v, "viral_start_ts": viral_start_ts, "alarm_ts": reset_keys.get(world.viral),
                  "control_key": control_key, "control_trace": trace_c, "control_ts": ts_c},
        "calibration": {"population": cal["population"], "n_responses": cal["n_responses"], "rmse_expert": param_rmse(None, truth, world.viral),
                        "rmse_learned": param_rmse(cal, truth, world.viral), "eta_points": [e for e in eta_points if e["key"] != world.viral],
                        "a_points": [{"key": k, "learned": cal["a"][k], "truth": round(truth["a"][k], 3)} for k in truth["a"]]},
        "ranker": ranker.model_card(rk) if rk else None,
        "seconds": round(time.time() - t0, 1),
    }
    (OUT / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=1), encoding="utf-8")
    from .report import charts, report
    charts(metrics)
    report(metrics)
    if bake:
        bake_models(corpus, ev, rk, seed)
    params.set_override(None, enabled=False)
    log(f"Готово за {time.time() - t0:.0f} с → {OUT}")


def cat_a(tid: str) -> float:
    return params.a(tid)


def cat_b(tid: str, ops) -> float:
    from app.templates import CATALOG, difficulty
    return difficulty(CATALOG[tid], ops)


def calibration_set(responses: list[dict], reset_keys: dict[str, int]) -> list[dict]:
    """Тревога детектора «обнуляет историю» затронутой начинки: старые ответы на неё больше не учат модель."""
    if not reset_keys:
        return responses
    out = []
    for r in responses:
        keys = [f"{r['template_id']}:{o}" for o in r["ops"]]
        if any(k in reset_keys and r["ts"] <= reset_keys[k] for k in keys):
            continue
        out.append(r)
    return out


def bake_models(corpus, ev, rk, seed):
    """Запекаем стартовые модели в образ: язык — корпус + все ручные тексты; подбор — тёплый старт из симуляции.
    Калибровка теста НЕ запекается: в продакшене она учится только на живых ответах (иначе мы бы
    «научили» тест сложностям вымышленного мира)."""
    m = textmodel.train(corpus + [{**e, "weight": 4.0} for e in ev], epochs=6, seed=seed)
    m.update({"version": f"text-{time.strftime('%Y%m%d')}", "trained_on": {"synthetic": len(corpus), "manual": len(ev)}})
    store.save("textmodel", m, baked=True)
    if rk:
        store.save("ranker", {**rk, "version": f"ranker-{time.strftime('%Y%m%d')}", "trained_on": {"simulated_invitations": True},
                              "warm_start": True}, baked=True)
    log("Модели запечены в app/models/")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--months", type=int, default=12)
    ap.add_argument("--per-month", type=int, default=300)
    ap.add_argument("--vacancies", type=int, default=30)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--bake", action="store_true")
    ap.add_argument("--report-only", action="store_true", help="перерисовать графики и отчёт из metrics.json")
    a = ap.parse_args()
    if a.report_only:
        from .report import charts, report
        m = json.loads((OUT / "metrics.json").read_text(encoding="utf-8"))
        charts(m)
        report(m)
    else:
        main(a.months, a.per_month, a.vacancies, a.seed, a.bake)
