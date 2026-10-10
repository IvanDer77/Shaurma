"""А — «заказ»: описание потребности работодателя → рецепт (специализация, грейд, веса ингредиентов).

Три уровня, все работают без внешних сервисов:
  1. словарь предметной области (правила) — всегда, он же даёт «доказательства» из текста;
  2. собственная языковая модель шаурматч_ («Маринад заказа», learn/textmodel.py) — если обучена;
     дообучается на правках рецептов, которые работодатели делают ползунками;
  3. GigaChat / YandexGPT — необязательное уточнение при наличии ключей (main.py).
Стек, формат и вилка извлекаются правилами (это сущности, а не смысл).
"""
import re

from .ingredients import INGREDIENTS, SPECIALIZATIONS

# ключевое слово (нижний регистр, фрагмент) -> (ингредиент, вес)
KEYWORDS: list[tuple[str, str, float]] = [
    ("highload", "concurrency", 1.0), ("высоконагруж", "concurrency", 1.0), ("нагрузк", "concurrency", 0.6),
    ("асинхрон", "concurrency", 0.8), ("async", "concurrency", 0.8), ("многопоточ", "concurrency", 1.0),
    ("goroutine", "concurrency", 1.0), ("горутин", "concurrency", 1.0),
    ("kafka", "idempotency", 1.0), ("rabbit", "idempotency", 0.8), ("очеред", "idempotency", 0.8),
    ("платеж", "idempotency", 1.0), ("платёж", "idempotency", 1.0), ("биллинг", "idempotency", 0.9),
    ("микросервис", "api_contracts", 0.8), ("rest", "api_contracts", 0.8), ("api", "api_contracts", 0.7),
    ("grpc", "api_contracts", 0.6), ("интеграц", "api_contracts", 0.6),
    ("postgres", "sql_aggregation", 0.7), ("sql", "sql_aggregation", 0.8), ("clickhouse", "sql_aggregation", 0.9),
    ("отчёт", "sql_aggregation", 0.7), ("отчет", "sql_aggregation", 0.7), ("аналит", "sql_aggregation", 0.8),
    ("join", "sql_joins", 0.8), ("хранилищ", "sql_joins", 0.6), ("dwh", "sql_joins", 0.8),
    ("оконн", "sql_window", 1.0), ("window", "sql_window", 0.8), ("витрин", "sql_window", 0.6),
    ("качество данных", "sql_nulls", 0.8), ("null", "sql_nulls", 0.6),
    ("ml", "ml_metrics", 0.8), ("машинн", "ml_metrics", 1.0), ("модел", "ml_metrics", 0.6),
    ("антифрод", "ml_metrics", 1.0), ("скоринг", "ml_metrics", 0.9), ("рекоменд", "ml_metrics", 0.7),
    ("признак", "data_prep", 0.8), ("feature", "data_prep", 0.8), ("etl", "data_prep", 0.8), ("pandas", "data_prep", 0.7),
    ("алгоритм", "complexity", 1.0), ("оптимизац", "complexity", 0.8), ("производительн", "complexity", 0.7),
    ("legacy", "code_reading", 0.9), ("легаси", "code_reading", 0.9), ("рефактор", "code_reading", 0.8),
    ("код-ревью", "code_reading", 0.6), ("code review", "code_reading", 0.6),
    ("отладк", "debugging", 0.8), ("поддержк", "debugging", 0.6), ("инцидент", "debugging", 0.8), ("баг", "debugging", 0.6),
    ("тестир", "edge_cases", 0.7), ("надёжн", "edge_cases", 0.7), ("надежн", "edge_cases", 0.7),
    ("react", "state_immutability", 0.8), ("redux", "state_immutability", 1.0), ("состояни", "state_immutability", 0.7),
    ("vue", "state_immutability", 0.6), ("spa", "js_async", 0.6), ("промис", "js_async", 0.8),
    ("websocket", "js_async", 0.8), ("реалтайм", "js_async", 0.8), ("real-time", "js_async", 0.8),
    ("typescript", "js_types", 0.8), ("javascript", "js_types", 0.6), ("формы", "js_types", 0.5),
    ("компонент", "closures_scope", 0.6), ("хук", "closures_scope", 0.8), ("hooks", "closures_scope", 0.8),
    ("таблиц", "array_methods", 0.6), ("дашборд", "array_methods", 0.7), ("фильтрац", "array_methods", 0.6),
]

SPEC_HINTS = {
    "backend": ["backend", "бэкенд", "бекенд", "серверн", "go ", "golang", "java", "python-разработ", "php", "kotlin", "c#", ".net", "node.js", "микросервис"],
    "frontend": ["frontend", "фронтенд", "фронт", "react", "vue", "angular", "верстк", "интерфейс", "typescript"],
    "data": ["data", "дата", "аналитик", "ml", "машинн", "dwh", "etl", "data scientist", "data engineer", "sql-разработ"],
}
GRADE_HINTS = [
    ("senior", ["senior", "сеньор", "ведущ", "старш", "lead", "лид", "5+ лет", "от 5 лет", "от 4 лет"]),
    ("middle", ["middle", "мидл", "от 2 лет", "от 3 лет", "2+ лет", "3+ лет", "опытом"]),
    ("junior", ["junior", "джун", "младш", "до года", "без опыта", "от 1 года", "начинающ"]),
    ("intern", ["intern", "стаж", "студент", "практикант"]),
]
STACKS = ["Python", "Go", "Java", "Kotlin", "PHP", "C#", "Node.js", "TypeScript", "React", "Vue", "Angular",
          "Svelte", "PostgreSQL", "ClickHouse", "Kafka", "Redis", "Docker", "Kubernetes", "pandas", "PyTorch", "Spark", "SQL"]
FORMATS = [("remote", ["удалён", "удален", "remote"]), ("hybrid", ["гибрид", "hybrid"]), ("office", ["офис", "office"])]


def _salary(text: str):
    t = text.lower().replace(" ", " ")
    m = re.search(r"(\d[\d\s]{1,9})\s*(?:k|к|тыс\.?|000)?\s*(?:-|–|—|до)\s*(\d[\d\s]{1,9})\s*(k|к|тыс|000|₽|руб)?", t)
    if not m:
        m2 = re.search(r"от\s*(\d[\d\s]{1,9})\s*(k|к|тыс)?", t)
        if not m2:
            return None, None
        v = int(m2.group(1).replace(" ", ""))
        mult = 1000 if (m2.group(2) or v < 1000) else 1
        return v * mult, None

    def num(s):
        return int(s.replace(" ", ""))

    a, b = num(m.group(1)), num(m.group(2))
    mult = 1000 if (m.group(3) in ("k", "к", "тыс") or b < 1000) else 1
    return a * mult, b * mult


def parse_need(text: str, model=None) -> dict:
    """model: None — активная модель из хранилища (если есть), False — только правила, dict — эта модель."""
    base = parse_rules(text)
    if model is None:
        from .learn import store
        model = store.load("textmodel")
    if not model:
        return base
    return _with_model(text, base, model)


def _with_model(text: str, base: dict, model: dict) -> dict:
    from .learn import textmodel
    pr = textmodel.predict(model, text)
    low = " " + text.lower() + " "
    # специализация и грейд: вероятности модели + небольшой голос правил (явные слова «senior», «стажёр»)
    ps = dict(pr["specialization"])
    if any(low.count(h) for hints in SPEC_HINTS.values() for h in hints):
        ps[base["specialization"]] += 0.15
    spec = max(ps, key=ps.get)
    pg = dict(pr["grade"])
    if any(h in low for _, hints in GRADE_HINTS for h in hints):
        pg[base["grade"]] += 0.3
    grade = max(pg, key=pg.get)
    # ингредиенты: модель + доказательства словаря
    evid = {}
    for kw, ing, w in KEYWORDS:
        if kw in low:
            evid[ing] = max(evid.get(ing, 0), w)
    own = SPECIALIZATIONS[spec]["ingredients"]
    score = {i: max(p, 0.5 * evid.get(i, 0)) for i, p in pr["ingredients"].items()}
    weights = {}
    for i, sc in score.items():
        if sc >= 0.3 and (i in own or sc >= 0.5):
            weights[i] = sc
        elif i in own:
            weights[i] = 0.2
    total = sum(weights.values()) or 1
    norm = {i: round(w / total, 3) for i, w in sorted(weights.items(), key=lambda kv: -kv[1])}
    evidence = {}
    for i in norm:
        if score[i] >= 0.3:
            words = base["evidence"].get(i) or textmodel.evidence(model, text, i)
            if words:
                evidence[i] = words
    return {**base, "specialization": spec, "grade": grade, "ingredients": norm,
            "ingredient_titles": {i: INGREDIENTS[i]["title"] for i in norm}, "evidence": evidence,
            "confidence": {"specialization": round(pr["specialization"][spec], 3), "grade": round(pr["grade"][grade], 3)},
            "source": "proof-model", "model_version": model.get("version")}


def parse_rules(text: str) -> dict:
    low = " " + text.lower() + " "
    spec_scores = {s: sum(low.count(h) for h in hints) for s, hints in SPEC_HINTS.items()}
    spec = max(spec_scores, key=spec_scores.get) if any(spec_scores.values()) else "backend"
    grade = next((g for g, hints in GRADE_HINTS if any(h in low for h in hints)), "middle")

    weights: dict[str, float] = {}
    matched: dict[str, list[str]] = {}
    for kw, ing, w in KEYWORDS:
        if kw in low:
            weights[ing] = max(weights.get(ing, 0), w)
            matched.setdefault(ing, []).append(kw)
    # Базовые ингредиенты специализации с небольшим весом — «лаваш» любого заказа
    for ing in SPECIALIZATIONS[spec]["ingredients"]:
        weights.setdefault(ing, 0.25)
    # Ингредиенты чужой группы без явного упоминания не нужны
    weights = {i: w for i, w in weights.items() if i in SPECIALIZATIONS[spec]["ingredients"] or w >= 0.6}
    total = sum(weights.values())
    norm = {i: round(w / total, 3) for i, w in sorted(weights.items(), key=lambda kv: -kv[1])}

    stacks = [s for s in STACKS if re.search(r"(?<![a-zа-я])" + re.escape(s.lower()) + r"(?![a-zа-я])", low)]
    formats = [f for f, hints in FORMATS if any(h in low for h in hints)] or ["remote", "hybrid", "office"]
    s_from, s_to = _salary(text)
    return {
        "specialization": spec,
        "grade": grade,
        "ingredients": norm,
        "ingredient_titles": {i: INGREDIENTS[i]["title"] for i in norm},
        "evidence": matched,
        "stacks": stacks,
        "formats": formats,
        "salary_from": s_from,
        "salary_to": s_to,
        "source": "rules",
    }
