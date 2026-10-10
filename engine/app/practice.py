"""«Свежая начинка» — регулярная задача, которую система сама адресно предлагает кандидату (ТЗ, п. 2).

Какой ингредиент: тот, по которому профиль больше всего нуждается в подтверждении —
рейтинг «остыл» (давно не было практики, RD вырос), ингредиент ещё не проверялся
или это самое слабое место относительно грейда.
Какая задача: шаблон + начинка, покрывающие этот ингредиент, со сложностью чуть ниже
уровня кандидата (≈65% успеха) — так ответ максимально информативен и не демотивирует.
"""
import random
from datetime import datetime, timezone

from .glicko import DEFAULT_R, DEFAULT_RD, SCALE, conservative, cooled_rd
from .ingredients import INGREDIENTS, SPECIALIZATIONS
from .templates import ALL_TEMPLATES, difficulty, ingredients_of, op_combos

GRADE_CENTER = {"intern": -1.6, "junior": -0.5, "middle": 0.5, "senior": 1.5}
GRADE_FLOOR = {"intern": -1.8, "junior": -1.0, "middle": 0.0, "senior": 1.0}


def _days_since(iso: str | None, now: datetime) -> int | None:
    if not iso:
        return None
    t = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return max(0, int((now - t).total_seconds() // 86400))


def pick(specialization: str, grade: str, theta: float | None, ratings: dict, exclude_templates: list[str] | None = None,
         seed: int | None = None, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    rng = random.Random(seed)
    req = DEFAULT_R + SCALE * GRADE_FLOOR[grade]
    scored = []
    for ing in SPECIALIZATIONS[specialization]["ingredients"]:
        e = ratings.get(ing)
        rd = cooled_rd(e["rd"], e["vol"], e.get("updated_at"), now) if e else DEFAULT_RD
        cons = conservative(e, now)
        weak = 1 / (1 + 2.718 ** ((cons - req) / 150))           # вероятность, что ингредиент НЕ дотягивает до грейда
        priority = rd / DEFAULT_RD + 0.6 * weak + rng.random() * 0.05
        scored.append((priority, ing, e, rd, weak))
    scored.sort(reverse=True)
    _, ing, e, rd, weak = scored[0]
    title = INGREDIENTS[ing]["title"]
    days = _days_since(e.get("updated_at"), now) if e else None
    if not e:
        reason, kind = f"«{title}» ещё не подтверждён ни одним заданием — добавим его в профиль", "new"
    elif rd - e["rd"] > 25 and days is not None and days >= 14:
        reason, kind = f"Рейтинг «{title}» остыл: {days} дн. без практики — работодатели видят его ниже", "cooled"
    else:
        reason, kind = f"«{title}» — самое слабое место профиля относительно грейда", "weak"

    target = (theta if theta is not None else GRADE_CENTER[grade]) - 0.4   # ≈65% успеха
    options = []
    for t in ALL_TEMPLATES:
        if specialization not in t.specs or t.id in (exclude_templates or []):
            continue
        for combo in op_combos(t):
            ings = ingredients_of(t, combo)
            if ing not in ings:
                continue
            options.append((abs(difficulty(t, combo) - target), t, combo))
    if not options:  # все шаблоны с этим ингредиентом уже были — разрешаем повтор
        return pick(specialization, grade, theta, ratings, None, seed, now) if exclude_templates else {"error": "no_template"}
    options.sort(key=lambda x: x[0])
    _, t, combo = rng.choice(options[:3])
    return {"template_id": t.id, "template_title": t.title, "ops": list(combo), "b": round(difficulty(t, combo), 3),
            "ingredients": ingredients_of(t, combo), "ingredient": ing, "ingredient_title": title,
            "reason": reason, "reason_kind": kind, "rd": round(rd), "p_weak": round(weak, 2)}
