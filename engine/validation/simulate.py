"""Валидация метода ШАУРМА на синтетическом мире с известной «истиной».

Готовых датасетов в рамках хакатона нет (ТЗ, п. 2), поэтому мы генерируем популяцию,
у которой ИСТИННЫЕ навыки известны, прогоняем через неё механику и сравниваем
результат с истиной. Отчёт: docs/validation/report.md + графики + metrics.json.

Запуск:  python -m validation.simulate  [--n 2000] [--seed 42]
"""
import argparse
import json
import math
import random
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

from app import cat, glicko, matching
from app.ingredients import GRADE_IDS, GRADES, SPECIALIZATIONS
from app.templates import CATALOG, ingredients_of

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "validation"
SPECS = list(SPECIALIZATIONS)


def true_grade(theta: float) -> str:
    g = "intern"
    for gr in GRADES:
        if theta >= gr["threshold"]:
            g = gr["id"]
    return g


# ---------------------------------------------------------------- популяция
def make_population(n: int, rng: random.Random) -> list[dict]:
    pop = []
    for i in range(n):
        spec = rng.choice(SPECS)
        theta = rng.gauss(0.2, 1.0)
        skills = {ing: theta + rng.gauss(0, 0.45) for ing in SPECIALIZATIONS[spec]["ingredients"]}
        tg = true_grade(theta)
        gi = GRADE_IDS.index(tg)
        # Самооценка: люди ошибаются, чаще в сторону завышения
        shift = rng.choices([-1, 0, 1], weights=[0.15, 0.55, 0.30])[0]
        declared = GRADE_IDS[min(max(gi + shift, 0), len(GRADE_IDS) - 1)]
        stacks = rng.sample(SPECIALIZATIONS[spec]["stacks"], rng.randint(2, 4))
        pop.append({"id": f"c{i}", "spec": spec, "theta": theta, "skills": skills, "true_grade": tg,
                    "declared": declared, "stacks": stacks, "exaggerator": rng.random() < 0.3,
                    "salary": int(round((140 + 90 * gi + rng.gauss(0, 25)) * 1000, -4)),
                    "fsp": rng.random() < 0.4})
    return pop


def item_theta(person: dict, ings: list[str]) -> float:
    vals = [person["skills"][i] for i in ings if i in person["skills"]]
    return sum(vals) / len(vals) if vals else person["theta"]


# ---------------------------------------------------------------- прохождение теста
def run_cat(person: dict, declared: str, rng: random.Random, cheat: str | None = None, exposure=None):
    """cheat=None — честно; 'shaurma' — у кандидата слитые ответы ЧУЖИХ вариантов."""
    resps, used, tested, log = [], set(), set(), []
    canary_hits = 0
    while True:
        st = cat.step(person["spec"], declared, resps, used, tested, exposure, rng)
        if st["done"]:
            return st["decision"], resps, log, canary_hits
        nxt = st["next"]
        t = CATALOG[nxt["template_id"]]
        ings = ingredients_of(t, nxt["ops"])
        p = cat.p_correct(item_theta(person, ings), nxt["b"], 0.25)
        correct = rng.random() < p
        if not correct and cheat == "shaurma" and rng.random() < 0.7:
            # Вписывает ответ из слитого чужого варианта: свой вариант уникален,
            # совпадение с правильным ответом — только случайное (~5%)
            if rng.random() < 0.05:
                correct = True
            else:
                canary_hits += 1
        elif not correct and cheat is None and rng.random() < 0.02:
            canary_hits += 1  # честная ошибка случайно совпала с ответом чужого варианта
        resps.append(cat.Response(nxt["template_id"], tuple(nxt["ops"]), nxt["b"], correct, 4))
        used.add((nxt["template_id"], tuple(sorted(nxt["ops"]))))
        tested |= set(ings)
        log.append({"b": nxt["b"], "ingredients": ings, "correct": correct, "template_id": nxt["template_id"]})
        if exposure is not None:
            exposure[nxt["template_id"]] = exposure.get(nxt["template_id"], 0) + 1


def full_flow(person: dict, rng: random.Random, cheat=None, exposure=None):
    """Путь по ТЗ: тест на заявленный грейд; не подтвердил — тест на уровень ниже (без принуждения)."""
    declared = person["declared"]
    attempts = 0
    all_log = []
    hits = 0
    while True:
        d, resps, log, h = run_cat(person, declared, rng, cheat, exposure)
        attempts += 1
        all_log += log
        hits += h
        if d["status"] == "confirmed":
            grade = declared
            if d.get("upgrade_offer"):
                d2, _, log2, h2 = run_cat(person, d["upgrade_offer"], rng, cheat, exposure)
                all_log += log2
                hits += h2
                if d2["status"] == "confirmed":
                    grade = d["upgrade_offer"]
            return grade, d["theta"], all_log, attempts, hits
        if not d.get("retake_lower"):
            return "intern", d["theta"], all_log, attempts, hits
        declared = d["retake_lower"]


def run_fixed(person: dict, fixed_items: list[dict], rng: random.Random, cheat: bool) -> str:
    """Классический тест: одинаковые задания всем. Слив = знание всех ответов."""
    correct = 0
    for it in fixed_items:
        p = cat.p_correct(item_theta(person, it["ingredients"]), it["b"], 0.25)
        ok = rng.random() < p
        if cheat and not ok and rng.random() < 0.95:
            ok = True
        correct += ok
    share = correct / len(fixed_items)
    # Пороги процента верных, откалиброванные на честной популяции (см. calibrate_fixed)
    return share


# ---------------------------------------------------------------- метрики
def cohen_kappa_quadratic(a: list[int], b: list[int], k: int) -> float:
    O = np.zeros((k, k))
    for x, y in zip(a, b):
        O[x, y] += 1
    W = np.array([[(i - j) ** 2 / (k - 1) ** 2 for j in range(k)] for i in range(k)])
    ha, hb = O.sum(1), O.sum(0)
    E = np.outer(ha, hb) / O.sum()
    return 1 - (W * O).sum() / (W * E).sum()


def spearman(x, y) -> float:
    rx = np.argsort(np.argsort(x))
    ry = np.argsort(np.argsort(y))
    return float(np.corrcoef(rx, ry)[0, 1])


def ndcg(rels: list[int], k: int = 10) -> float:
    dcg = sum((2 ** r - 1) / math.log2(i + 2) for i, r in enumerate(rels[:k]))
    ideal = sorted(rels, reverse=True)
    idcg = sum((2 ** r - 1) / math.log2(i + 2) for i, r in enumerate(ideal[:k]))
    return dcg / idcg if idcg else 0.0


# ---------------------------------------------------------------- подбор
def make_vacancies(n: int, rng: random.Random) -> list[dict]:
    vac = []
    for i in range(n):
        spec = rng.choice(SPECS)
        ings = SPECIALIZATIONS[spec]["ingredients"]
        key = rng.sample(ings, 3)
        w = {ing: (1.0 if ing in key else 0.2) for ing in ings}
        tot = sum(w.values())
        grade = rng.choice(["junior", "middle", "middle", "senior"])
        gi = GRADE_IDS.index(grade)
        vac.append({"id": f"v{i}", "specialization": spec, "grade": grade,
                    "ingredients": {k: v / tot for k, v in w.items()},
                    "stacks": rng.sample(SPECIALIZATIONS[spec]["stacks"], 2),
                    "formats": ["remote", "hybrid", "office"],
                    "salary_from": (140 + 90 * gi) * 1000 - 30000, "salary_to": (140 + 90 * gi) * 1000 + 60000})
    return vac


def true_relevance(p: dict, v: dict) -> int:
    if p["spec"] != v["specialization"]:
        return 0
    req = matching.GRADE_CENTER[v["grade"]]
    skill = sum(w * (1 / (1 + math.exp(-1.7 * (p["skills"][i] - req)))) for i, w in v["ingredients"].items())
    stack = len(set(p["stacks"]) & set(v["stacks"])) / len(v["stacks"])
    val = skill * (0.75 + 0.25 * stack)
    return 3 if val > 0.7 else 2 if val > 0.5 else 1 if val > 0.3 else 0


def resume_text(p: dict, rng: random.Random) -> list[str]:
    """Резюме: стек + ключевые слова навыков. «Приукрашивающие» пишут всё подряд."""
    words = [s.lower() for s in p["stacks"]]
    for ing, val in p["skills"].items():
        if p["exaggerator"] or val > -0.3 + rng.gauss(0, 0.4):
            words += [ing] * (1 + (p["exaggerator"] or val > 1))
    words += [p["spec"], p["declared"]]
    return words


def bm25_scores(docs: dict[str, list[str]], query: list[str]) -> dict[str, float]:
    N = len(docs)
    avgdl = sum(len(d) for d in docs.values()) / N
    df = Counter()
    for d in docs.values():
        for t in set(d):
            df[t] += 1
    out = {}
    for cid, d in docs.items():
        tf = Counter(d)
        s = 0.0
        for q in query:
            if q not in tf:
                continue
            idf = math.log(1 + (N - df[q] + 0.5) / (df[q] + 0.5))
            s += idf * tf[q] * 2.2 / (tf[q] + 1.2 * (0.25 + 0.75 * len(d) / avgdl))
        out[cid] = s
    return out


# ---------------------------------------------------------------- главный сценарий
def main(n: int = 2000, seed: int = 42):
    rng = random.Random(seed)
    np.random.seed(seed)
    OUT.mkdir(parents=True, exist_ok=True)
    pop = make_population(n, rng)
    k = len(GRADE_IDS)
    metrics: dict = {"n_candidates": n, "seed": seed}

    # 1) Категоризация: восстановление грейда + профиль ингредиентов
    assigned, truth, attempts_list, exposure = [], [], [], {}
    item_rows = []
    rating_pairs = defaultdict(list)
    for p in pop:
        g, th, log, att, _ = full_flow(p, rng, None, exposure)
        p["assigned"] = g
        p["theta_hat"] = th
        assigned.append(GRADE_IDS.index(g))
        truth.append(GRADE_IDS.index(p["true_grade"]))
        attempts_list.append(att)
        ratings = glicko.apply_session({}, log, "2026-10-01T00:00:00+00:00")
        p["ratings"] = ratings
        for ing, e in ratings.items():
            if ing in p["skills"]:
                rating_pairs[ing].append((e["r"], p["skills"][ing]))
        for it in log:
            item_rows.append((it["template_id"], it["correct"], p["theta"]))
    assigned_a, truth_a = np.array(assigned), np.array(truth)
    metrics["grade_exact_accuracy"] = round(float((assigned_a == truth_a).mean()), 3)
    metrics["grade_within_one"] = round(float((abs(assigned_a - truth_a) <= 1).mean()), 3)
    metrics["grade_kappa_quadratic"] = round(cohen_kappa_quadratic(assigned, truth, k), 3)
    metrics["grade_overestimated_share"] = round(float((assigned_a > truth_a).mean()), 3)
    metrics["avg_attempts"] = round(float(np.mean(attempts_list)), 2)
    conf = np.zeros((k, k), int)
    for a, t in zip(assigned, truth):
        conf[t, a] += 1
    metrics["confusion_true_rows_assigned_cols"] = conf.tolist()
    rec = {ing: round(spearman([x for x, _ in v], [y for _, y in v]), 3) for ing, v in rating_pairs.items() if len(v) > 30}
    metrics["ingredient_profile_spearman"] = rec
    metrics["ingredient_profile_spearman_mean"] = round(float(np.mean(list(rec.values()))), 3)

    # 2) Тест-ретест на разных уникальных вариантах
    sub = pop  # ретест на всей популяции: на 500 кандидатах разброс между прогонами ±2–3 п. п.
    g1 = [GRADE_IDS.index(p["assigned"]) for p in sub]
    g2 = [GRADE_IDS.index(full_flow(p, rng)[0]) for p in sub]
    metrics["retest_agreement"] = round(float(np.mean(np.array(g1) == np.array(g2))), 3)
    metrics["retest_kappa_quadratic"] = round(cohen_kappa_quadratic(g1, g2, k), 3)

    # 3) Дискриминативность шаблонов: точечно-бисериальная корреляция «верно ↔ истинный θ»
    by_t = defaultdict(list)
    for tid, ok, th in item_rows:
        by_t[tid].append((ok, th))
    disc = {}
    for tid, rows in by_t.items():
        if len(rows) > 50:
            oks = np.array([r[0] for r in rows], float)
            ths = np.array([r[1] for r in rows])
            if oks.std() > 0:
                disc[tid] = round(float(np.corrcoef(oks, ths)[0, 1]), 3)
    metrics["template_discrimination_rpb"] = dict(sorted(disc.items(), key=lambda kv: -kv[1]))
    metrics["template_discrimination_mean"] = round(float(np.mean(list(disc.values()))), 3)
    metrics["exposure_max_share"] = round(max(exposure.values()) / sum(exposure.values()), 3)

    # 4) Симуляция слива: 30% кандидатов знают весь банк и ответы чужих вариантов
    leak_n = min(600, n)
    leak_pop = pop[:leak_n]
    honest_idx = [GRADE_IDS.index(p["assigned"]) for p in leak_pop]
    # 4a. Фиксированный тест (одинаковые 15 заданий всем) — калибруем пороги по честным
    fixed_items = []
    for spec in SPECS:
        cands = [(t, combo) for t in CATALOG.values() if spec in t.specs for combo in [()] if t.kind == "output"] + \
                [(t, (t.ops[0].id,)) for t in CATALOG.values() if spec in t.specs and t.kind == "bug"]
        for t, combo in cands[:15]:
            from app.templates import difficulty
            fixed_items.append({"spec": spec, "b": difficulty(t, combo), "ingredients": ingredients_of(t, combo)})
    shares_honest = defaultdict(list)
    for p in pop:
        items = [it for it in fixed_items if it["spec"] == p["spec"]]
        shares_honest[p["spec"]].append((run_fixed(p, items, rng, False), GRADE_IDS.index(p["true_grade"])))
    # пороги: процент верных, лучше всего разделяющий грейды на честной популяции (квантили)
    cuts = {}
    for spec, rows in shares_honest.items():
        dist = Counter(g for _, g in rows)
        s_sorted = sorted(x for x, _ in rows)
        acc, cuts[spec] = 0, []
        for gi in range(k - 1):
            acc += dist.get(gi, 0)
            cuts[spec].append(s_sorted[min(len(s_sorted) - 1, acc)])

    def fixed_grade(share, spec):
        return sum(share >= c for c in cuts[spec])

    infl_fixed_honest, infl_fixed_cheat, infl_sh_cheat = [], [], []
    caught, false_pos = 0, 0
    for i, p in enumerate(leak_pop):
        items = [it for it in fixed_items if it["spec"] == p["spec"]]
        tg = GRADE_IDS.index(p["true_grade"])
        infl_fixed_honest.append(fixed_grade(run_fixed(p, items, rng, False), p["spec"]) - tg)
        infl_fixed_cheat.append(fixed_grade(run_fixed(p, items, rng, True), p["spec"]) - tg)
        g, _, _, _, hits = full_flow(p, rng, "shaurma")
        infl_sh_cheat.append(GRADE_IDS.index(g) - tg)
        caught += hits >= 2
        _, _, _, _, hits_h = full_flow(p, rng, None)
        false_pos += hits_h >= 2
    infl_sh_honest = [h - GRADE_IDS.index(p["true_grade"]) for h, p in zip(honest_idx, leak_pop)]
    metrics["leak"] = {
        "fixed_test_inflation_honest": round(float(np.mean(infl_fixed_honest)), 3),
        "fixed_test_inflation_cheaters": round(float(np.mean(infl_fixed_cheat)), 3),
        "shaurma_inflation_honest": round(float(np.mean(infl_sh_honest)), 3),
        "shaurma_inflation_cheaters": round(float(np.mean(infl_sh_cheat)), 3),
        "shaurma_cheaters_caught_by_canary": round(caught / leak_n, 3),
        "shaurma_false_positive_honest": round(false_pos / leak_n, 3),
    }

    # 5) Подбор: ШАУРМА против поиска по ключевым словам в резюме (BM25)
    vacancies = make_vacancies(60, rng)
    docs = {p["id"]: resume_text(p, rng) for p in pop}
    p_by_id = {p["id"]: p for p in pop}
    cand_profiles = []
    for p in pop:
        cand_profiles.append({"id": p["id"], "specialization": p["spec"], "grade": p["assigned"],
                              "ratings": p["ratings"], "stacks": p["stacks"], "formats": ["remote"],
                              "salary_expect": p["salary"],
                              "fsp": {"count": int(p["fsp"]), "relevant": int(p["fsp"]), "prizes": 0}})
    res = {"shaurma": {"p10": [], "ndcg10": []}, "bm25": {"p10": [], "ndcg10": []}, "random": {"p10": [], "ndcg10": []}}
    for v in vacancies:
        ranked = matching.rank(cand_profiles, v, limit=10, use_ranker=False)  # валидация ручного метода (без «Маринада»)
        rels = [true_relevance(p_by_id[r["candidate_id"]], v) for r in ranked]
        all_rels = sorted((true_relevance(p, v) for p in pop), reverse=True)
        def push(name, rels_top):
            res[name]["p10"].append(sum(r >= 2 for r in rels_top[:10]) / 10)
            dcg = sum((2 ** r - 1) / math.log2(i + 2) for i, r in enumerate(rels_top[:10]))
            idcg = sum((2 ** r - 1) / math.log2(i + 2) for i, r in enumerate(all_rels[:10]))
            res[name]["ndcg10"].append(dcg / idcg if idcg else 0)
        push("shaurma", rels)
        q = [i for i, w in v["ingredients"].items() if w > 0.1] + [s.lower() for s in v["stacks"]] + [v["specialization"], v["grade"]]
        bm = bm25_scores(docs, q)
        top_bm = sorted(bm, key=lambda c: -bm[c])[:10]
        push("bm25", [true_relevance(p_by_id[c], v) for c in top_bm])
        same = [p for p in pop if p["spec"] == v["specialization"]]
        push("random", [true_relevance(p, v) for p in rng.sample(same, 10)])
    metrics["matching"] = {name: {"precision_at_10": round(float(np.mean(d["p10"])), 3),
                                  "ndcg_at_10": round(float(np.mean(d["ndcg10"])), 3)} for name, d in res.items()}

    (OUT / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    charts(metrics, conf)
    report(metrics)
    print(json.dumps({k: v for k, v in metrics.items() if k not in ("template_discrimination_rpb",)}, ensure_ascii=False, indent=1))


def charts(m: dict, conf):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import LinearSegmentedColormap
    # Палитра бренда «шаурматч_»: чернила, синий, серый, соус; плоский стиль без рамок
    INK, ACC, LIL, VIO = "#1B1C21", "#402FFF", "#B9B4FF", "#FF8A1F"
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11, "text.color": INK, "axes.labelcolor": INK,
                         "axes.edgecolor": INK, "xtick.color": INK, "ytick.color": INK, "axes.spines.top": False,
                         "axes.spines.right": False, "axes.titleweight": "bold", "axes.titlelocation": "left"})

    L = m["leak"]
    fig, ax = plt.subplots(figsize=(9.5, 4.6))
    labels = ["Фиксированный тест\n(честные)", "Фиксированный тест\n(слили банк)", "ШАУРМА\n(честные)", "ШАУРМА\n(слили банк)"]
    vals = [L["fixed_test_inflation_honest"], L["fixed_test_inflation_cheaters"], L["shaurma_inflation_honest"], L["shaurma_inflation_cheaters"]]
    ax.bar(labels, vals, color=["#9B9C9E", VIO, LIL, ACC])
    ax.axhline(0, color=INK, lw=1.2)
    ax.set_ylabel("Завышение грейда, уровней")
    ax.set_title("Слили весь банк задач: кто получает незаслуженный грейд")
    for i, v in enumerate(vals):
        ax.text(i, v + (0.03 if v >= 0 else -0.03), f"{v:+.2f}", ha="center", va="bottom" if v >= 0 else "top")
    ax.set_ylim(min(0, min(vals)) - 0.25, max(vals) + 0.2)
    fig.tight_layout()
    fig.savefig(OUT / "leak.png", dpi=150)
    plt.close(fig)

    M = m["matching"]
    fig, ax = plt.subplots(figsize=(7, 4))
    names = ["random", "bm25", "shaurma"]
    titles = ["Случайно\n(в специализации)", "Ключевые слова\nрезюме (BM25)", "ШАУРМА"]
    x = np.arange(3)
    ax.bar(x - 0.2, [M[n]["precision_at_10"] for n in names], 0.4, label="Precision@10", color=ACC)
    ax.bar(x + 0.2, [M[n]["ndcg_at_10"] for n in names], 0.4, label="nDCG@10", color=VIO)
    ax.set_xticks(x, titles)
    ax.set_ylim(0, 1)
    ax.legend(frameon=False)
    ax.set_title("Качество подборки на 60 вакансиях")
    fig.tight_layout()
    fig.savefig(OUT / "matching.png", dpi=150)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(5, 4.3))
    ax.imshow(conf, cmap=LinearSegmentedColormap.from_list("brand", ["#FFFFFF", ACC]))
    names = [g["title"] for g in GRADES]
    ax.set_xticks(range(len(names)), names)
    ax.set_yticks(range(len(names)), names)
    ax.set_xlabel("Присвоенный грейд")
    ax.set_ylabel("Истинный грейд")
    for i in range(len(names)):
        for j in range(len(names)):
            ax.text(j, i, conf[i][j], ha="center", va="center", color="white" if conf[i][j] > conf.max() / 2 else INK)
    ax.set_title("Категоризация: истина и тест")
    fig.tight_layout()
    fig.savefig(OUT / "confusion.png", dpi=150)
    plt.close(fig)


def report(m: dict):
    L, M = m["leak"], m["matching"]
    md = f"""# Отчёт валидации метода ШАУРМА

Синтетическая популяция: **{m['n_candidates']} кандидатов** (seed {m['seed']}) с известными истинными навыками
по каждому ингредиенту; самооценка грейда с типичным завышением (30% завышают на уровень). Ответы
моделируются по 3PL-модели от истинных навыков ингредиентов задания (многомерная истина при одномерном тесте —
проверка устойчивости). Скрипт: `engine/validation/simulate.py`, сырые цифры: `metrics.json`.

## 1. Категоризация
| Метрика | Значение |
|---|---|
| Точное совпадение грейда с истиной | **{m['grade_exact_accuracy']:.0%}** |
| Совпадение ±1 уровень | **{m['grade_within_one']:.0%}** |
| Квадратично-взвешенная κ Коэна | **{m['grade_kappa_quadratic']}** |
| Доля завышенных грейдов | {m['grade_overestimated_share']:.0%} |
| Среднее число попыток (включая тест на уровень ниже) | {m['avg_attempts']} |
| Восстановление профиля ингредиентов (ρ Спирмена, среднее) | **{m['ingredient_profile_spearman_mean']}** |

![confusion](confusion.png)

## 2. Стабильность (тест-ретест на разных уникальных вариантах)
| Метрика | Значение |
|---|---|
| Совпадение грейда при повторном прохождении | **{m['retest_agreement']:.0%}** |
| κ (квадратичная) тест-ретест | **{m['retest_kappa_quadratic']}** |

## 3. Дискриминативность заданий
Средняя точечно-бисериальная корреляция «верно ↔ истинный уровень»: **{m['template_discrimination_mean']}**
(ориентир психометрики: > 0.2 — приемлемо, > 0.3 — хорошо). Максимальная доля показов одного шаблона: {m['exposure_max_share']:.1%}.

## 4. Устойчивость к сливу
Сценарий: кандидаты знают **весь** банк задач и ответы на чужие варианты.

| | Завышение грейда |
|---|---|
| Фиксированный тест, честные | {L['fixed_test_inflation_honest']:+.2f} |
| Фиксированный тест, слили банк | **{L['fixed_test_inflation_cheaters']:+.2f}** |
| ШАУРМА, честные | {L['shaurma_inflation_honest']:+.2f} |
| ШАУРМА, слили банк | **{L['shaurma_inflation_cheaters']:+.2f}** |

Канарейки поймали **{L['shaurma_cheaters_caught_by_canary']:.0%}** списывающих при ложных срабатываниях на честных **{L['shaurma_false_positive_honest']:.1%}**
(порог — 2 совпадения с ответами чужих вариантов; подозрение ведёт не к бану, а к уточняющим вопросам).

![leak](leak.png)

## 5. Подбор (60 вакансий, истинная релевантность известна)
| Подход | Precision@10 | nDCG@10 |
|---|---|---|
| Случайно внутри специализации | {M['random']['precision_at_10']} | {M['random']['ndcg_at_10']} |
| Ключевые слова резюме (BM25) | {M['bm25']['precision_at_10']} | {M['bm25']['ndcg_at_10']} |
| **ШАУРМА** (категория + ингредиенты + рейтинг) | **{M['shaurma']['precision_at_10']}** | **{M['shaurma']['ndcg_at_10']}** |

![matching](matching.png)

## Ограничения
* Мир синтетический: абсолютные значения зависят от допущений модели ответов. На реальных данных
  сложности η операторов и дискриминации заданий калибруются заново (LLTM-регрессия по накопленным ответам).
* «Приукрашивание» резюме (30% кандидатов) — допущение; именно от него страдает BM25.
"""
    (OUT / "report.md").write_text(md, encoding="utf-8")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=2000)
    ap.add_argument("--seed", type=int, default=42)
    a = ap.parse_args()
    main(a.n, a.seed)
