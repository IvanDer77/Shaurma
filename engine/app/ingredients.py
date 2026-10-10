"""«Меню ингредиентов» — единое пространство навыков ШАУРМЫ.

Один и тот же ингредиент одновременно:
  1) входит в сложность задачи (LLTM: b = b_template + Σ η(оператор)),
  2) измеряется у кандидата (Glicko-2 по каждому ингредиенту),
  3) заказывается работодателем (рецепт вакансии = веса ингредиентов).
"""

INGREDIENTS: dict[str, dict] = {
    # Общие
    "code_reading": {"title": "Чтение чужого кода", "group": "common"},
    "edge_cases": {"title": "Граничные случаи", "group": "common"},
    "complexity": {"title": "Сложность алгоритмов", "group": "common"},
    "debugging": {"title": "Поиск дефектов", "group": "common"},
    # Backend
    "idempotency": {"title": "Идемпотентность и повторы", "group": "backend"},
    "concurrency": {"title": "Конкурентность и асинхронность", "group": "backend"},
    "state_mutability": {"title": "Изменяемое состояние", "group": "backend"},
    "api_contracts": {"title": "REST-контракты и пагинация", "group": "backend"},
    # SQL / данные
    "sql_aggregation": {"title": "SQL-агрегации", "group": "data"},
    "sql_joins": {"title": "SQL JOIN", "group": "data"},
    "sql_window": {"title": "Оконные функции", "group": "data"},
    "sql_nulls": {"title": "Работа с NULL", "group": "data"},
    "ml_metrics": {"title": "Метрики качества моделей", "group": "data"},
    "data_prep": {"title": "Подготовка данных и утечки", "group": "data"},
    # Frontend
    "js_async": {"title": "Event loop и промисы", "group": "frontend"},
    "closures_scope": {"title": "Замыкания и области видимости", "group": "frontend"},
    "state_immutability": {"title": "Иммутабельность состояния", "group": "frontend"},
    "js_types": {"title": "Типы и приведение в JS", "group": "frontend"},
    "array_methods": {"title": "Методы массивов", "group": "frontend"},
}

SPECIALIZATIONS: dict[str, dict] = {
    "backend": {
        "title": "Backend-разработка",
        "code": "BE",
        "ingredients": ["code_reading", "edge_cases", "complexity", "debugging", "idempotency",
                        "concurrency", "state_mutability", "api_contracts", "sql_aggregation", "sql_joins"],
        "stacks": ["Python", "Go", "Java", "Node.js", "PHP", "C#", "Kotlin"],
    },
    "frontend": {
        "title": "Frontend-разработка",
        "code": "FE",
        "ingredients": ["code_reading", "edge_cases", "debugging", "js_async", "closures_scope",
                        "state_immutability", "js_types", "array_methods", "api_contracts"],
        "stacks": ["React", "Vue", "Angular", "TypeScript", "Svelte"],
    },
    "data": {
        "title": "Data / ML",
        "code": "DS",
        "ingredients": ["code_reading", "edge_cases", "complexity", "sql_aggregation", "sql_joins",
                        "sql_window", "sql_nulls", "ml_metrics", "data_prep"],
        "stacks": ["Python", "SQL", "pandas", "PyTorch", "Spark", "ClickHouse"],
    },
}

# Шкала способности θ (логиты Раша). Порог = минимальный θ грейда.
GRADES: list[dict] = [
    {"id": "intern", "title": "Intern", "code": "INT", "threshold": float("-inf")},
    {"id": "junior", "title": "Junior", "code": "JUN", "threshold": -1.0},
    {"id": "middle", "title": "Middle", "code": "MID", "threshold": 0.0},
    {"id": "senior", "title": "Senior", "code": "SEN", "threshold": 1.0},
]
GRADE_IDS = [g["id"] for g in GRADES]


def grade(gid: str) -> dict:
    return next(g for g in GRADES if g["id"] == gid)


def grade_index(gid: str) -> int:
    return GRADE_IDS.index(gid)


def category_code(spec: str, gid: str) -> str:
    return f"{SPECIALIZATIONS[spec]['code']}·{grade(gid)['code']}"
