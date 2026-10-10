"""Маринад подбора: двусторонний ранжировщик, обучаемый на исходах приглашений.

Ручная формула ШАУРМЫ (Skill × Fit × ФСП) отвечает на вопрос «насколько кандидат подходит».
Но найм — это двусторонний рынок: сильный кандидат, которому не интересна вилка, — пустой талон.
Поэтому две головы логистической регрессии:

  «Подойдёт»  P(fit)    — учится на исходе принятых приглашений (работодатель отметил «наняли» / «не подошёл»);
  «Примет»    P(accept) — учится на ответах кандидатов (принял / отклонил).

Итоговый порядок выдачи — по P(найм) = P(fit) · P(accept): ожидаемое число успешных наймов
на один «талон» приглашения. Модель — открытые веса в JSON (признаки названы по-русски),
поэтому объяснение «почему кандидат здесь» сохраняется. Старт — «тёплый»: веса, выученные
на симуляции; дообучение на живых данных идёт с L2-притяжением к стартовым весам.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone

import numpy as np

from ..glicko import DEFAULT_R, SCALE, conservative, cooled_rd
from ..ingredients import grade_index

GRADE_CENTER = {"intern": -1.6, "junior": -0.5, "middle": 0.5, "senior": 1.5}
GRADE_FLOOR = {"intern": -1.8, "junior": -1.0, "middle": 0.0, "senior": 1.0}

FIT_FEATURES = [
    ("skill", "Подтверждённое владение ингредиентами заказа"),
    ("skill_top", "Владение главным ингредиентом заказа"),
    ("uncertainty", "Неопределённость рейтинга (мало данных)"),
    ("grade_above", "Грейд выше заказанного"),
    ("grade_below", "Грейд ниже заказанного"),
    ("stack", "Совпадение стека"),
    ("fsp", "Достижения ФСП по профилю"),
    ("stale", "Давно не подтверждал навыки"),
]
ACCEPT_FEATURES = [
    ("salary_gap", "Вилка ниже ожиданий кандидата"),
    ("salary_over", "Вилка выше ожиданий"),
    ("format_miss", "Формат работы не совпадает"),
    ("stack", "Совпадение стека"),
    ("grade_above", "Кандидат сильнее заказа (переквалификация)"),
    ("trust", "Репутация компании («Честный ценник»)"),
    ("fsp", "Достижения ФСП (востребованный кандидат)"),
    ("stale", "Давно не заходил на платформу"),
]


def _sig(x):
    return 1 / (1 + np.exp(-x))


def features(c: dict, recipe: dict, offer: dict | None = None, now: datetime | None = None) -> tuple[list[float], list[float]]:
    """Признаки пары «кандидат × заказ». offer — {salary_from, salary_to, trust, formats}, если приглашение уже есть."""
    now = now or datetime.now(timezone.utc)
    ings = recipe.get("ingredients") or {}
    req = DEFAULT_R + SCALE * GRADE_FLOOR[recipe.get("grade", "middle")]
    tot = sum(ings.values()) or 1
    skill, rd_sum, top_w, top_m = 0.0, 0.0, -1.0, 0.0
    for ing, w in ings.items():
        e = (c.get("ratings") or {}).get(ing)
        m = 1 / (1 + math.exp(-(conservative(e, now) - req) / 150))
        skill += w * m
        rd_sum += w * ((cooled_rd(e["rd"], e["vol"], e.get("updated_at"), now) if e else 350) / 350)
        if w > top_w:
            top_w, top_m = w, m
    skill /= tot
    unc = rd_sum / tot
    gd = grade_index(c["grade"]) - grade_index(recipe.get("grade", "middle")) if c.get("grade") else -2
    need_st = {s.lower() for s in recipe.get("stacks") or []}
    have = {s.lower() for s in c.get("stacks") or []}
    stack = len(need_st & have) / len(need_st) if need_st else 0.5
    fsp = min(3, (c.get("fsp") or {}).get("relevant", 0) + (c.get("fsp") or {}).get("prizes", 0)) / 3
    days = c.get("last_active_days")
    if days is None:
        days = c.get("grade_confirmed_days") or 30
    stale = min(1.0, days / 180)
    fit_x = [skill, top_m, unc, max(0, gd), max(0, -gd), stack, fsp, stale]

    o = offer or {}
    top = o.get("salary_to") or recipe.get("salary_to") or (o.get("salary_from") or recipe.get("salary_from") or 0) * 1.2
    exp = c.get("salary_expect")
    if exp and top:
        r = math.log(top / exp)
        sal_gap, sal_over = max(0.0, -r), max(0.0, r)
    else:
        sal_gap, sal_over = 0.0, 0.0
    fmts = o.get("formats") or recipe.get("formats") or []
    fmt_miss = 0.0 if not fmts or not c.get("formats") or set(fmts) & set(c["formats"]) else 1.0
    trust = (o.get("trust", 100) - 100) / 50
    acc_x = [sal_gap, sal_over, fmt_miss, stack, max(0, gd), trust, fsp, stale]
    return fit_x, acc_x


def train_head(X: np.ndarray, y: np.ndarray, w_prior: np.ndarray | None = None, l2: float = 1.0,
               sample_weight: np.ndarray | None = None, iters: int = 300) -> dict:
    """Логистическая регрессия (Ньютон/IRLS) с L2 к стартовым весам. Признаки стандартизуются."""
    mean, std = X.mean(0), X.std(0)
    std[std < 1e-4] = 1.0          # признак-константа в данных: не масштабируем (иначе деление на ~0)
    Z = np.hstack([np.ones((len(X), 1)), (X - mean) / std])
    d = Z.shape[1]
    prior = np.zeros(d) if w_prior is None else w_prior
    w = prior.copy()
    sw = np.ones(len(y)) if sample_weight is None else sample_weight
    reg = np.full(d, l2)
    reg[0] = 1e-3
    for _ in range(iters):
        p = _sig(Z @ w)
        g = Z.T @ (sw * (y - p)) - reg * (w - prior)
        H = (Z * (sw * p * (1 - p))[:, None]).T @ Z + np.diag(reg)
        step = np.linalg.solve(H, g)
        w += step
        if np.abs(step).max() < 1e-6:
            break
    p = _sig(Z @ w)
    return {"w": w.round(4).tolist(), "mean": mean.round(6).tolist(), "std": std.round(6).tolist(),
            "n": int(len(y)), "positive_rate": round(float(y.mean()), 3) if len(y) else None,
            "log_loss": round(float(-np.mean(y * np.log(p + 1e-9) + (1 - y) * np.log(1 - p + 1e-9))), 4) if len(y) else None}


def head_predict(head: dict, x: list[float]) -> float:
    w, mean, std = np.array(head["w"]), np.array(head["mean"]), np.array(head["std"])
    z = np.concatenate([[1.0], (np.array(x) - mean) / std])
    return float(_sig(z @ w))


def contributions(head: dict, x: list[float], names: list[tuple[str, str]]) -> list[dict]:
    """Вклад каждого признака в логит (для объяснения выдачи)."""
    w, mean, std = np.array(head["w"]), np.array(head["mean"]), np.array(head["std"])
    z = (np.array(x) - mean) / std
    out = [{"feature": k, "title": t, "contribution": round(float(w[i + 1] * z[i]), 3)} for i, (k, t) in enumerate(names)]
    return sorted(out, key=lambda r: -abs(r["contribution"]))


def model_card(model: dict) -> dict:
    """Чему научился подбор: веса признаков на исходной шкале (знак и сила)."""
    def head(h, names):
        w, std = np.array(h["w"]), np.array(h["std"])
        return [{"feature": k, "title": t, "weight": round(float(w[i + 1]), 3), "weight_raw": round(float(w[i + 1] / std[i]), 3)}
                for i, (k, t) in enumerate(names)]
    return {"fit": head(model["fit"], FIT_FEATURES), "accept": head(model["accept"], ACCEPT_FEATURES),
            "trained_on": model.get("trained_on"), "version": model.get("version")}
