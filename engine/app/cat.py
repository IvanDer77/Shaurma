"""А — адаптивная сборка: компьютерное адаптивное тестирование (CAT) на заявленный грейд.

Модель ответа — Раш с поправкой на угадывание (варианты ответа):
    P(верно | θ, b) = c + (1 − c) / (1 + exp(−a·(θ − b))),  c = 1 / число вариантов, a = 1.7.
Дискриминация a: экспертная 1.7 для всех шаблонов, после калибровки по ответам — своя у каждого
шаблона («Маринад», app/learn/calibration.py).
Оценка θ — EAP по сетке с нормальным априорным распределением вокруг заявленного грейда.
Сложность b любого варианта известна заранее по LLTM (b = b_шаблона + Σ η операторов).
"""
import math
import random

import numpy as np
from dataclasses import dataclass

from .ingredients import GRADE_IDS, GRADES, SPECIALIZATIONS, grade, grade_index
from .templates import ALL_TEMPLATES, difficulty, ingredients_of, op_combos

GRID = [i / 20 for i in range(-90, 91)]  # θ от −4.5 до 4.5
GRID_NP = np.array(GRID)
PRIOR_CENTER = {"intern": -1.6, "junior": -0.5, "middle": 0.5, "senior": 1.5}
PRIOR_SD = 1.2
MIN_ITEMS = 8
MAX_ITEMS = 18
TARGET_SE = 0.40
A = 1.7
CONFIRM_P = 0.55     # P(θ ≥ порог) для подтверждения грейда (подобрано валидацией: max κ при завышении < 6%)
UPGRADE_P = 0.8      # P(θ ≥ порог следующего) для предложения теста на повышение
RANDOMESQUE = 5      # выбор случайно из 5 самых информативных вариантов (контроль экспозиции)
GRADE_COOLDOWN_DAYS = 90


@dataclass
class Response:
    template_id: str
    ops: tuple
    b: float
    correct: bool
    n_options: int = 4


def p_correct(theta: float, b: float, c: float, a: float = A) -> float:
    return c + (1 - c) / (1 + math.exp(-a * (theta - b)))


def item_a(template_id: str | None) -> float:
    from .learn import params
    return params.a(template_id)


def posterior(responses: list[Response], declared: str) -> np.ndarray:
    mu = PRIOR_CENTER[declared]
    lp = -0.5 * ((GRID_NP - mu) / PRIOR_SD) ** 2
    for r in responses:
        c = 1 / r.n_options
        p = c + (1 - c) / (1 + np.exp(-item_a(r.template_id) * (GRID_NP - r.b)))
        lp += np.log(p if r.correct else 1 - p)
    w = np.exp(lp - lp.max())
    return w / w.sum()


def estimate(responses: list[Response], declared: str) -> tuple[float, float, np.ndarray]:
    post = posterior(responses, declared)
    mean = float((GRID_NP * post).sum())
    var = float((((GRID_NP - mean) ** 2) * post).sum())
    return mean, math.sqrt(var), post


def prob_at_least(post, threshold: float) -> float:
    return float(post[GRID_NP >= threshold].sum())


def item_information(theta: float, b: float, c: float, a: float = A) -> float:
    """Информация Фишера для 3PL."""
    p = p_correct(theta, b, c, a)
    q = 1 - p
    return a ** 2 * (q / p) * ((p - c) / (1 - c)) ** 2


def candidate_items(spec: str, used: set):
    """used — множество пар (шаблон, набор операторов), уже показанных в сессии."""
    for t in ALL_TEMPLATES:
        if spec not in t.specs:
            continue
        for combo in op_combos(t):
            if (t.id, tuple(sorted(combo))) not in used:
                yield t, combo


def select_next(spec: str, theta: float, used: set, tested_ingredients: set[str],
                exposure: dict[str, int] | None = None, rng: random.Random | None = None):
    """Следующий вариант: максимум информации + покрытие ингредиентов специализации + контроль экспозиции."""
    rng = rng or random.Random()
    exposure = exposure or {}
    total_exp = sum(exposure.values()) or 1
    spec_ings = set(SPECIALIZATIONS[spec]["ingredients"])
    scored = []
    used_templates = {u[0] for u in used}
    for t, combo in candidate_items(spec, used):
        b = difficulty(t, combo)
        info = item_information(theta, b, 0.25, item_a(t.id))
        new_ings = (set(ingredients_of(t, combo)) & spec_ings) - tested_ingredients
        coverage = 1 + 0.25 * len(new_ings)
        # Sympson–Hetter-подобное ограничение: часто показываемые шаблоны штрафуются
        share = exposure.get(t.id, 0) / total_exp
        penalty = 1 / (1 + 4 * share)
        if t.id in used_templates:  # тот же лаваш с другой начинкой — только когда свежие шаблоны кончились
            penalty *= 0.3
        scored.append((info * coverage * penalty, t.id, combo, b))
    if not scored:
        return None
    scored.sort(reverse=True)
    pick = rng.choice(scored[:RANDOMESQUE])
    return {"template_id": pick[1], "ops": list(pick[2]), "b": round(pick[3], 3)}


def decide(responses: list[Response], declared: str) -> dict:
    """Итог по ТЗ: грейд подтверждается тестом; принудительного понижения нет."""
    theta, se, post = estimate(responses, declared)
    gi = grade_index(declared)
    thr = grade(declared)["threshold"]
    p_declared = 1.0 if thr == float("-inf") else prob_at_least(post, thr)
    result = {
        "theta": round(theta, 3),
        "se": round(se, 3),
        "declared_grade": declared,
        "p_declared": round(p_declared, 3),
        "n_items": len(responses),
    }
    if p_declared >= CONFIRM_P:
        result["status"] = "confirmed"
        result["grade"] = declared
        if gi + 1 < len(GRADE_IDS):
            nxt = GRADES[gi + 1]
            p_next = prob_at_least(post, nxt["threshold"])
            result["p_next"] = round(p_next, 3)
            result["upgrade_offer"] = nxt["id"] if p_next >= UPGRADE_P else None
    else:
        result["status"] = "not_confirmed"
        result["grade"] = None
        # Кандидат может сразу пройти тест на уровень ниже (без принудительного понижения)
        result["retake_lower"] = GRADE_IDS[gi - 1] if gi > 0 else None
    return result


def step(spec: str, declared: str, responses: list[Response], used: set,
         tested_ingredients: set[str], exposure: dict | None = None, rng=None) -> dict:
    """Один шаг сессии: либо следующий вариант, либо итог."""
    theta, se, _ = estimate(responses, declared)
    n = len(responses)
    done = n >= MAX_ITEMS or (n >= MIN_ITEMS and se <= TARGET_SE)
    nxt = None if done else select_next(spec, theta, used, tested_ingredients, exposure, rng)
    if nxt is None:
        return {"done": True, "theta": round(theta, 3), "se": round(se, 3), "decision": decide(responses, declared)}
    return {"done": False, "theta": round(theta, 3), "se": round(se, 3), "next": nxt,
            "progress": {"answered": n, "min": MIN_ITEMS, "max": MAX_ITEMS}}
