"""М — матчинг по заказу: ранжирование кандидатов в пространстве ингредиентов с объяснением.

Score = Skill × Fit × (1 + бонус ФСП)
  Skill — насколько подтверждены ингредиенты заказа (консервативно: μ − 2·RD с остыванием);
  Fit   — грейд категории, стек, формат, ожидания по зарплате;
  ФСП   — небольшой бонус за подтверждённые достижения (нет истории ФСП — нет штрафа).
Выдача строится только из кандидатов с категорией, присвоенной тестом (требование ТЗ).

Если обучен ранжировщик «Маринада» (learn/ranker.py), порядок выдачи — по P(найм) =
P(подойдёт) × P(примет приглашение): найм — двусторонний, и сильный кандидат, которому
не подходит вилка, — пустой талон. Ручная оценка остаётся в ответе для объяснения.
"""
import math
from datetime import datetime, timezone

from .glicko import DEFAULT_R, SCALE, conservative
from .ingredients import GRADES, INGREDIENTS, grade_index

GRADE_CENTER = {"intern": -1.6, "junior": -0.5, "middle": 0.5, "senior": 1.5}
GRADE_FLOOR = {"intern": -1.8, "junior": -1.0, "middle": 0.0, "senior": 1.0}


def required_rating(grade_id: str) -> float:
    """Требуемый уровень ингредиента — нижняя граница грейда заказа."""
    return DEFAULT_R + SCALE * GRADE_FLOOR[grade_id]


def confident(entry, now) -> float:
    """μ − RD с учётом остывания: умеренно консервативная оценка для матчинга."""
    from .glicko import cooled_rd
    if not entry:
        return DEFAULT_R - 2 * 350
    return entry["r"] - cooled_rd(entry["rd"], entry["vol"], entry.get("updated_at"), now)


def mastery(cr: float, req: float) -> float:
    """Вероятность, что ингредиент освоен на требуемом уровне (логистика по разности рейтингов)."""
    return 1 / (1 + math.exp(-(cr - req) / 150))


def _grade_fit(cand: str | None, need: str) -> float:
    if cand is None:
        return 0.0
    d = grade_index(cand) - grade_index(need)
    return 1.0 if d == 0 else (0.85 if d > 0 else (0.55 if d == -1 else 0.15))


def _salary_fit(expect: int | None, s_from: int | None, s_to: int | None) -> float:
    if not expect or not (s_to or s_from):
        return 1.0
    top = s_to or s_from * 1.25
    if expect <= top:
        return 1.0
    return max(0.2, 1 - (expect - top) / top * 2.5)


def score_candidate(c: dict, recipe: dict, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    # Ранжирование — консервативно (μ − 2·RD против центра грейда): так выше точность топа (валидация).
    # Показ — интерпретируемо (μ − RD против нижней границы грейда): «вероятность, что дотягивает».
    req_rank = DEFAULT_R + SCALE * GRADE_CENTER[recipe["grade"]]
    req_show = required_rating(recipe["grade"])
    ings = recipe["ingredients"]
    per = []
    skill = 0.0
    skill_show = 0.0
    for ing, w in ings.items():
        entry = c.get("ratings", {}).get(ing)
        m_rank = 1 / (1 + math.exp(-(conservative(entry, now) - req_rank) / 120))
        m = mastery(confident(entry, now), req_show)
        skill += w * m_rank
        skill_show += w * m
        per.append({"ingredient": ing, "title": INGREDIENTS[ing]["title"], "weight": w,
                    "mastery": round(m, 3), "confirmed": entry is not None and m >= 0.5,
                    "rating": round(entry["r"]) if entry else None})
    skill /= sum(ings.values()) or 1
    skill_show /= sum(ings.values()) or 1

    g_fit = _grade_fit(c.get("grade"), recipe["grade"])
    need_stacks = {s.lower() for s in recipe.get("stacks", [])}
    have = {s.lower() for s in c.get("stacks", [])}
    st_fit = 1.0 if not need_stacks else 0.6 + 0.4 * len(need_stacks & have) / len(need_stacks)
    f_ok = not c.get("formats") or bool(set(c["formats"]) & set(recipe.get("formats") or c["formats"]))
    fmt_fit = 1.0 if f_ok else 0.5
    sal_fit = _salary_fit(c.get("salary_expect"), recipe.get("salary_from"), recipe.get("salary_to"))
    fit = g_fit * st_fit * fmt_fit * sal_fit

    fsp = c.get("fsp", {})
    fsp_bonus = min(0.15, 0.05 * fsp.get("relevant", 0) + 0.03 * fsp.get("prizes", 0))
    score = skill * fit * (1 + fsp_bonus)

    # Объяснимость: 2–4 факта, почему кандидат здесь
    confirmed = [p for p in per if p["confirmed"]]
    top = sorted(per, key=lambda p: -p["weight"] * p["mastery"])
    weak = [p for p in sorted(per, key=lambda p: p["mastery"]) if p["weight"] >= 0.1 and not p["confirmed"]]
    why = [f"Подтверждено {len(confirmed)} из {len(per)} ингредиентов заказа"]
    if top and top[0]["confirmed"]:
        why.append(f"Сильнее всего: {top[0]['title'].lower()}")
    if weak:
        why.append(f"Не подтверждено: {weak[0]['title'].lower()}")
    if c.get("grade"):
        g = next(x for x in GRADES if x["id"] == c["grade"])
        why.append(f"Грейд {g['title']} подтверждён тестом" + (f" ({c['grade_confirmed_days']} дн. назад)" if c.get("grade_confirmed_days") is not None else ""))
    if need_stacks:
        hit = sorted(need_stacks & have)
        why.append(f"Стек: {len(hit)}/{len(need_stacks)}" + (f" ({', '.join(hit)})" if hit else ""))
    if fsp.get("count"):
        why.append(f"Достижения ФСП: {fsp['count']}" + (f", призовых {fsp['prizes']}" if fsp.get("prizes") else ""))
    if sal_fit < 1:
        why.append("Ожидания по зарплате выше вилки")
    return {
        "candidate_id": c["id"],
        "score": round(score, 4),
        "skill": round(skill, 3),
        "fit": round(fit, 3),
        "fsp_bonus": round(fsp_bonus, 3),
        "match_percent": round(100 * min(1.0, skill_show * fit * (1 + fsp_bonus)), 1),
        "ingredients": per,
        "why": why,
    }


def with_ranker(scored: dict, c: dict, recipe: dict, model: dict, offer: dict | None = None) -> dict:
    from .learn import ranker
    fx, ax = ranker.features(c, recipe, offer)
    p_fit = ranker.head_predict(model["fit"], fx)
    p_acc = ranker.head_predict(model["accept"], ax)
    reasons = [r for r in ranker.contributions(model["accept"], ax, ranker.ACCEPT_FEATURES) if r["contribution"] < -0.25]
    why = list(scored["why"])
    why.append(f"Вероятно примет приглашение: {round(p_acc * 100)}%" + (f" (мешает: {reasons[0]['title'].lower()})" if reasons else ""))
    # Кольцо «совпадение» = P(подойдёт) той же модели, что задаёт порядок: место в выдаче и процент не спорят.
    # Порядок = P(подойдёт) × P(примет); вторая часть показана отдельно («примет ≈N%»).
    return {**scored, "hand_score": scored["score"], "skill_match_percent": scored["match_percent"],
            "match_percent": round(100 * p_fit, 1), "score": round(p_fit * p_acc, 4), "p_fit": round(p_fit, 3),
            "p_accept": round(p_acc, 3), "p_hire": round(p_fit * p_acc, 3), "why": why, "ranker": model.get("version", "learned")}


def rank(candidates: list[dict], recipe: dict, limit: int = 50, filters: dict | None = None,
         offer: dict | None = None, use_ranker: bool = True) -> list[dict]:
    """Фильтры — слой поверх заказа: подборка не теряется при уточнении (требование ТЗ)."""
    f = filters or {}
    pool = [c for c in candidates if c.get("grade")]  # только кандидаты с категорией по тесту
    if f.get("specialization"):
        pool = [c for c in pool if c.get("specialization") == f["specialization"]]
    else:
        pool = [c for c in pool if c.get("specialization") == recipe["specialization"]]
    if f.get("grades"):
        pool = [c for c in pool if c["grade"] in f["grades"]]
    if f.get("fsp_only"):
        pool = [c for c in pool if c.get("fsp", {}).get("count")]
    if f.get("stacks"):
        need = {s.lower() for s in f["stacks"]}
        pool = [c for c in pool if need & {s.lower() for s in c.get("stacks", [])}]
    if f.get("formats"):
        pool = [c for c in pool if set(c.get("formats") or []) & set(f["formats"])]
    if f.get("salary_max"):
        pool = [c for c in pool if not c.get("salary_expect") or c["salary_expect"] <= f["salary_max"]]
    scored = [score_candidate(c, recipe) for c in pool]
    model = None
    if use_ranker:
        from .learn import store
        model = store.load("ranker")
    if model:
        by_id = {c["id"]: c for c in pool}
        scored = [with_ranker(s, by_id[s["candidate_id"]], recipe, model, offer) for s in scored]
    scored.sort(key=lambda s: -s["score"])
    return scored[:limit]


def category_strength(c: dict, spec_ingredients: list[str], now=None) -> float:
    """Сила внутри категории: средняя консервативная оценка по ингредиентам специализации + ФСП."""
    vals = [conservative(c.get("ratings", {}).get(i), now) for i in spec_ingredients]
    base = sum(vals) / len(vals)
    return base + 25 * min(4, c.get("fsp", {}).get("prizes", 0))
