"""Синтетические кандидаты для демо-базы: проходят ту же механику (CAT → грейд, Glicko-2 по ингредиентам)."""
import random

from .ingredients import SPECIALIZATIONS
from .templates import CATALOG

LANG_STACK = {"python": "Python", "javascript": "JavaScript", "sql": "SQL"}

FIRST_M = ["Алексей", "Иван", "Дмитрий", "Сергей", "Никита", "Артём", "Максим", "Егор", "Павел", "Кирилл", "Роман", "Глеб", "Тимур", "Олег", "Илья"]
FIRST_F = ["Мария", "Анна", "Екатерина", "Ольга", "Полина", "Дарья", "Софья", "Алина", "Вера", "Ксения", "Юлия", "Диана"]
LAST = ["Смирнов", "Иванов", "Кузнецов", "Попов", "Васильев", "Петров", "Соколов", "Михайлов", "Новиков", "Фёдоров",
        "Морозов", "Волков", "Алексеев", "Лебедев", "Семёнов", "Егоров", "Павлов", "Козлов", "Степанов", "Николаев"]
CITIES = ["Москва"] * 6 + ["Санкт-Петербург", "Казань", "Новосибирск", "Екатеринбург", "Нижний Новгород", "Зеленоград"]
SOFT = ["Работа в команде", "Коммуникабельность", "Самостоятельность", "Наставничество", "Аналитическое мышление",
        "Ответственность", "Инициативность", "Обучаемость"]
ABOUT = {
    "backend": ["Проектирую сервисы под нагрузку, люблю чистые API.", "Пишу бэкенд для финтеха, интересуюсь распределёнными системами.",
                "Бэкенд, интеграции, очереди. Ищу команду с сильной инженерной культурой."],
    "frontend": ["Делаю интерфейсы, которыми приятно пользоваться.", "React, дизайн-системы, доступность.",
                 "Фронтенд для сложных B2B-продуктов, люблю типизацию."],
    "data": ["Аналитика и ML в продакшене.", "Строю витрины данных и модели скоринга.", "Data engineering и метрики продукта."],
}


def population(n: int, seed: int = 2026) -> list[dict]:
    from validation import simulate as S
    from . import glicko

    rng = random.Random(seed)
    pop = S.make_population(n, rng)
    out = []
    related = {"backend": "data", "data": "backend", "frontend": "backend"}
    for i, p in enumerate(pop):
        grade, theta, log, attempts, _ = S.full_flow(p, rng)
        # ~15% добавили вторую категорию в смежной специализации — тоже через адаптивный тест
        # (отдельный генератор, чтобы основная популяция не менялась)
        secondary = []
        r2 = random.Random(seed * 7919 + i)
        if grade != "intern" and r2.random() < 0.15:
            spec2 = related[p["spec"]]
            q = dict(p, spec=spec2, skills=dict(p["skills"]))
            for ing in SPECIALIZATIONS[spec2]["ingredients"]:
                q["skills"].setdefault(ing, p["theta"] - 0.5 + r2.gauss(0, 0.45))   # в смежной области обычно слабее
            q["declared"] = ["intern", "junior", "middle", "senior"][max(0, ["intern", "junior", "middle", "senior"].index(grade) - 1)]
            g2, th2, log2, _, _ = S.full_flow(q, r2)
            log = log + log2
            if g2 != "intern":
                secondary.append({"specialization": spec2, "grade": g2, "theta": round(th2, 3)})
        ratings = glicko.apply_session({}, log, "2026-09-15T10:00:00+00:00")
        # Подтверждённый стек — по тому же правилу, что в backend (computeVerifiedStacks):
        # решено ≥ 2 заданий на языке со сложностью не ниже уровня грейда
        floor = {"intern": -2.5, "junior": -1.0, "middle": 0.0, "senior": 1.0}[grade] - 0.5
        solved = {}
        for it in log:
            lang = CATALOG[it["template_id"]].language
            if it["correct"] and it["b"] >= floor:
                solved[lang] = solved.get(lang, 0) + 1
        verified = [LANG_STACK[lang] for lang, k in solved.items() if k >= 2]
        # Часть профилей «остывших» — давно не решали задачи
        days_ago = rng.choice([1, 3, 7, 14, 30, 60, 120, 200])
        for e in ratings.values():
            e["updated_at"] = f"2026-{9 if days_ago < 20 else 6 if days_ago < 150 else 3:02d}-{rng.randint(1, 27):02d}T10:00:00+00:00"
        female = rng.random() < 0.35
        last = rng.choice(LAST)
        name = f"{rng.choice(FIRST_F if female else FIRST_M)} {last + 'а' if female else last}"
        gi = ["intern", "junior", "middle", "senior"].index(grade)
        out.append({
            "full_name": name,
            "specialization": p["spec"],
            "grade": grade,
            "declared_grade": p["declared"],
            "theta": round(theta, 3),
            "ratings": ratings,
            "stacks": p["stacks"],
            "formats": rng.sample(["remote", "hybrid", "office"], rng.randint(1, 3)),
            "salary_expect": max(60000, p["salary"]),
            "experience_years": round(max(0, [0.3, 1.2, 3.5, 6.5][gi] + rng.gauss(0, 0.8)), 1),
            "city": rng.choice(CITIES),
            "soft_skills": rng.sample(SOFT, 3),
            "about": rng.choice(ABOUT[p["spec"]]),
            "fsp_id": f"FSP-{rng.randint(1, 5000):06d}" if p["fsp"] else None,
            "days_since_active": days_ago,
            "attempts": attempts,
            "secondary": secondary,
            "verified_stacks": verified,
        })
    return out


def specs() -> list[str]:
    return list(SPECIALIZATIONS)
