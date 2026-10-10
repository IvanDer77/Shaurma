"""Маринад сложности: калибровка теста по ответам кандидатов.

Эксперт задал сложность каждого шаблона (b0) и каждой начинки (η) на глаз, а дискриминацию
взял общую (a = 1.7). Здесь эти параметры ВЫВОДЯТСЯ из накопленных ответов.

Модель (LLTM + 3PL с дискриминацией шаблона):
    b_варианта = b0[шаблон] + Σ η[шаблон:оператор]
    P(верно | θ) = c + (1 − c) · σ(a[шаблон] · (θ − b)),  c = 1 / число вариантов ответа

Оценка — маргинальное максимальное правдоподобие (MML-EM, Бок–Эйткин) с байесовскими
априорными распределениями вокруг экспертных значений (MAP). Это даёт главное свойство
для продакшена: пока ответов мало, параметр остаётся экспертным; чем больше данных,
тем сильнее он сдвигается к тому, что показали люди. «Маринуется» постепенно.

Шкала привязана к экспертной (mean-mean linking): средний сдвиг b0 и средний log a
относительно эксперта равны нулю — пороги грейдов остаются на прежней шкале θ.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from ..templates import ALL_TEMPLATES

A_EXPERT = 1.7
GRID = np.linspace(-4.5, 4.5, 61)


@dataclass
class Priors:
    sd_b0: float = 0.5     # насколько эксперт может ошибиться в базовой сложности шаблона
    sd_eta: float = 0.4    # … в сложности начинки
    sd_loga: float = 0.3   # … в дискриминации (лог-шкала)


def expert_params() -> dict:
    return {
        "b0": {t.id: t.b0 for t in ALL_TEMPLATES},
        "eta": {f"{t.id}:{o.id}": o.eta for t in ALL_TEMPLATES for o in t.ops},
        "a": {t.id: A_EXPERT for t in ALL_TEMPLATES},
    }


def _index():
    t_ids = [t.id for t in ALL_TEMPLATES]
    o_ids = [f"{t.id}:{o.id}" for t in ALL_TEMPLATES for o in t.ops]
    return t_ids, {k: i for i, k in enumerate(t_ids)}, o_ids, {k: i for i, k in enumerate(o_ids)}


def fit(responses: list[dict], priors: Priors | None = None, start: dict | None = None,
        iters: int = 40, tol: float = 1e-4) -> dict:
    """responses: [{"person", "template_id", "ops", "correct", "n_options"?}] — в любом порядке.

    start — параметры, от которых стартует оптимизация (обычно текущие); априорные
    распределения всегда центрированы на ЭКСПЕРТНЫХ значениях.
    """
    pr = priors or Priors()
    t_ids, t_ix, o_ids, o_ix = _index()
    T, O = len(t_ids), len(o_ids)
    exp = expert_params()
    b0_e = np.array([exp["b0"][k] for k in t_ids])
    eta_e = np.array([exp["eta"][k] for k in o_ids])
    loga_e = np.full(T, math.log(A_EXPERT))
    st = start or exp
    b0 = np.array([st["b0"].get(k, exp["b0"][k]) for k in t_ids], float)
    eta = np.array([st["eta"].get(k, exp["eta"][k]) for k in o_ids], float)
    loga = np.log(np.array([st["a"].get(k, A_EXPERT) for k in t_ids], float))

    rows = [r for r in responses if r["template_id"] in t_ix]
    R = len(rows)
    if R == 0:
        return {**exp, "n_responses": 0, "n_persons": 0, "converged": True, "iterations": 0,
                "se": {"b0": {}, "eta": {}, "a": {}}, "n": {"b0": {}, "eta": {}}, "population": {"mu": 0.0, "sigma": 1.0}}
    persons = {}
    p_idx = np.array([persons.setdefault(r["person"], len(persons)) for r in rows])
    P = len(persons)
    t_r = np.array([t_ix[r["template_id"]] for r in rows])
    u = np.array([1.0 if r["correct"] else 0.0 for r in rows])
    c = np.array([1.0 / r.get("n_options", 4) for r in rows])
    # Разреженная матрица «ответ → операторы»
    op_rows, op_cols = [], []
    for i, r in enumerate(rows):
        for o in r.get("ops") or []:
            k = f"{r['template_id']}:{o}"
            if k in o_ix:
                op_rows.append(i)
                op_cols.append(o_ix[k])
    op_rows, op_cols = np.array(op_rows, int), np.array(op_cols, int)

    def item_b():
        b = b0[t_r].copy()
        if len(op_rows):
            np.add.at(b, op_rows, eta[op_cols])
        return b

    mu, sigma = 0.0, 1.0
    Q = GRID[None, :]
    prev_ll = -np.inf
    it = 0
    for it in range(1, iters + 1):
        a = np.exp(loga)[t_r][:, None]
        b = item_b()[:, None]
        sig = 1 / (1 + np.exp(-a * (Q - b)))
        p = np.clip(c[:, None] + (1 - c[:, None]) * sig, 1e-6, 1 - 1e-6)
        L = u[:, None] * np.log(p) + (1 - u[:, None]) * np.log(1 - p)          # R×Q
        # E-шаг: апостериорное распределение θ каждого кандидата на сетке
        logpost = np.zeros((P, GRID.size))
        np.add.at(logpost, p_idx, L)
        logpost += -0.5 * ((GRID - mu) / sigma) ** 2
        m = logpost.max(1, keepdims=True)
        w = np.exp(logpost - m)
        norm = w.sum(1, keepdims=True)
        ll = float((m[:, 0] + np.log(norm[:, 0])).sum())
        w /= norm
        # Популяция
        th_mean = (w * GRID).sum(1)
        mu = float(th_mean.mean())
        sigma = float(math.sqrt(max(1e-3, (w * (GRID - mu) ** 2).sum(1).mean())))
        # M-шаг: шаг Фишера по параметрам заданий (диагональ), априорные — вокруг эксперта
        wr = w[p_idx]                                                            # R×Q
        dLdp = u[:, None] / p - (1 - u[:, None]) / (1 - p)
        dpdz = (1 - c[:, None]) * sig * (1 - sig)
        info_z = dpdz ** 2 / (p * (1 - p))
        g_b_r = (wr * dLdp * dpdz * (-a)).sum(1)
        h_b_r = (wr * info_z * a ** 2).sum(1)
        g_la_r = (wr * dLdp * dpdz * a * (Q - b)).sum(1)
        h_la_r = (wr * info_z * (a * (Q - b)) ** 2).sum(1)

        g_b0 = np.bincount(t_r, g_b_r, T) - (b0 - b0_e) / pr.sd_b0 ** 2
        h_b0 = np.bincount(t_r, h_b_r, T) + 1 / pr.sd_b0 ** 2
        g_eta = (np.bincount(op_cols, g_b_r[op_rows], O) if len(op_rows) else np.zeros(O)) - (eta - eta_e) / pr.sd_eta ** 2
        h_eta = (np.bincount(op_cols, h_b_r[op_rows], O) if len(op_rows) else np.zeros(O)) + 1 / pr.sd_eta ** 2
        g_la = np.bincount(t_r, g_la_r, T) - (loga - loga_e) / pr.sd_loga ** 2
        h_la = np.bincount(t_r, h_la_r, T) + 1 / pr.sd_loga ** 2
        # b0 и η связаны (оба входят в b) — шаг с затуханием, чтобы не перескакивать
        b0 += np.clip(0.7 * g_b0 / h_b0, -0.5, 0.5)
        eta += np.clip(0.7 * g_eta / h_eta, -0.5, 0.5)
        loga += np.clip(0.7 * g_la / h_la, -0.3, 0.3)
        # Привязка шкалы к экспертной (mean-mean linking)
        s = math.exp(float(np.mean(loga - loga_e)))
        loga -= math.log(s)
        b0, eta, mu, sigma = b0 * s, eta * s, mu * s, sigma * s
        shift = float(np.mean(b0 - b0_e))
        b0 -= shift
        mu -= shift
        if abs(ll - prev_ll) < tol * max(1.0, abs(ll)) and it > 5:
            break
        prev_ll = ll

    n_t = np.bincount(t_r, minlength=T)
    n_o = np.bincount(op_cols, minlength=O) if len(op_rows) else np.zeros(O, int)
    r3 = lambda x: round(float(x), 3)  # noqa: E731
    return {
        "b0": {k: r3(b0[i]) for i, k in enumerate(t_ids)},
        "eta": {k: r3(eta[i]) for i, k in enumerate(o_ids)},
        "a": {k: r3(math.exp(loga[i])) for i, k in enumerate(t_ids)},
        "se": {"b0": {k: r3(1 / math.sqrt(h_b0[i])) for i, k in enumerate(t_ids)},
               "eta": {k: r3(1 / math.sqrt(h_eta[i])) for i, k in enumerate(o_ids)},
               "a": {k: r3(math.exp(loga[i]) / math.sqrt(h_la[i])) for i, k in enumerate(t_ids)}},
        "n": {"b0": {k: int(n_t[i]) for i, k in enumerate(t_ids)}, "eta": {k: int(n_o[i]) for i, k in enumerate(o_ids)}},
        "population": {"mu": r3(mu), "sigma": r3(sigma)},
        "n_responses": R, "n_persons": P, "iterations": it, "log_likelihood": round(prev_ll, 2),
        "priors": pr.__dict__,
    }


def marginal_loglik(responses: list[dict], params: dict | None) -> float:
    """Средний маргинальный логарифм правдоподобия ответов на кандидата при данных параметрах
    (θ интегрируется по популяционному распределению). Чем выше — тем лучше модель объясняет ответы."""
    p = params or expert_params()
    pop = (params or {}).get("population", {"mu": 0.0, "sigma": 1.0})
    by_person: dict[str, list[dict]] = {}
    for r in responses:
        if r["template_id"] in p["b0"]:
            by_person.setdefault(r["person"], []).append(r)
    if not by_person:
        return 0.0
    lp0 = -0.5 * ((GRID - pop["mu"]) / pop["sigma"]) ** 2
    lp0 -= np.log(np.exp(lp0).sum())
    total = 0.0
    for rs in by_person.values():
        lp = lp0.copy()
        for r in rs:
            b = p["b0"][r["template_id"]] + sum(p["eta"].get(f"{r['template_id']}:{o}", 0.0) for o in r.get("ops") or [])
            a = p["a"].get(r["template_id"], A_EXPERT)
            c = 1 / r.get("n_options", 4)
            pr = np.clip(c + (1 - c) / (1 + np.exp(-a * (GRID - b))), 1e-6, 1 - 1e-6)
            lp += np.log(pr if r["correct"] else 1 - pr)
        m = lp.max()
        total += m + math.log(np.exp(lp - m).sum())
    return total / len(by_person)


def gated_fit(responses: list[dict], current: dict | None, holdout_share: float = 0.2, seed: int = 0) -> dict:
    """Калибровка со страховкой: обучаемся на 80% кандидатов, сравниваем с текущей моделью на 20% отложенных.
    Новая версия рекомендуется к включению, только если объясняет отложенные ответы лучше."""
    persons = sorted({r["person"] for r in responses})
    rng = np.random.default_rng(seed)
    hold = set(rng.choice(persons, size=max(1, int(len(persons) * holdout_share)), replace=False).tolist()) if len(persons) >= 10 else set()
    train = [r for r in responses if r["person"] not in hold]
    test = [r for r in responses if r["person"] in hold]
    cand = fit(train, start=current)
    ll_new = marginal_loglik(test, cand) if test else None
    ll_cur = marginal_loglik(test, current) if test else None
    ll_exp = marginal_loglik(test, None) if test else None
    better = test and ll_new is not None and ll_new >= max(ll_cur, ll_exp) - 1e-9
    final = fit(responses, start=cand) if better else cand
    return {"params": final, "accept": bool(better), "holdout": {"persons": len(hold), "responses": len(test),
            "loglik_new": None if ll_new is None else round(ll_new, 4), "loglik_current": None if ll_cur is None else round(ll_cur, 4),
            "loglik_expert": None if ll_exp is None else round(ll_exp, 4)}}


def shift_report(params: dict) -> dict:
    """Насколько обученные параметры отошли от экспертных — для «паспорта модели»."""
    exp = expert_params()
    rows = []
    for k, v in params["eta"].items():
        n = params.get("n", {}).get("eta", {}).get(k, 0)
        rows.append({"param": k, "kind": "eta", "expert": exp["eta"][k], "learned": v, "delta": round(v - exp["eta"][k], 3), "n": n})
    for k, v in params["b0"].items():
        n = params.get("n", {}).get("b0", {}).get(k, 0)
        rows.append({"param": k, "kind": "b0", "expert": exp["b0"][k], "learned": v, "delta": round(v - exp["b0"][k], 3), "n": n})
    for k, v in params["a"].items():
        rows.append({"param": k, "kind": "a", "expert": A_EXPERT, "learned": v, "delta": round(v - A_EXPERT, 3),
                     "n": params.get("n", {}).get("b0", {}).get(k, 0)})
    rows.sort(key=lambda r: -abs(r["delta"]))
    return {"largest_shifts": rows[:12],
            "mean_abs_shift": {kind: round(float(np.mean([abs(r["delta"]) for r in rows if r["kind"] == kind])), 3) for kind in ("b0", "eta", "a")}}
