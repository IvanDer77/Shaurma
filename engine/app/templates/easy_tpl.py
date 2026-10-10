"""Лёгкие шаблоны (b0 ≈ −1.6…−1.1): точно измеряют уровень Intern/Junior.

Без них адаптивный тест для слабого кандидата вынужден был повторять средние шаблоны с другой
начинкой, и оценка θ ниже порога Junior (−1) получалась грубой. Устроены так же, как остальные:
правильный ответ и дистракторы — результат исполнения кода (основного и «ошибочных ментальных моделей»).
"""
from random import Random

from .base import Built, Op, Skin, Template, ints


# ---------- Python: срезы и индексы списка ----------
def _py_slice(r: Random, ops, s: Skin, mis):
    data = ints(r, 6, 1, 9)
    a = r.randint(1, 2)
    b = a + r.randint(2, 3)
    if "negative" in ops:
        start, end = (f"-{b - a}", "") if mis != "neg_from_start" else ("", f"{b - a}")
    else:
        start, end = str(a), str(b + 1 if mis == "inclusive" else b)
    step = ":2" if "step" in ops else ""
    expr = f"{s.items}[{start}:{end}{step}]"
    code = f"""{s.items} = {data}
part = {expr}
print(part)"""
    return Built(code, f"{s.where[0].upper() + s.where[1:]} берут часть списка «{s.unit}». Что выведет программа?")


PY_SLICE = Template(
    "py_slice_basics", "Срезы списка", ["backend", "data"], "python", "output",
    ["code_reading", "edge_cases"], -1.6,
    [Op("negative", "Отрицательный индекс", "edge_cases", 0.35),
     Op("step", "Шаг среза", "code_reading", 0.3)],
    _py_slice, ["inclusive", "neg_from_start"],
)


# ---------- Python: подсчёт в словаре ----------
def _py_count(r: Random, ops, s: Skin, mis):
    keys = r.sample(["new", "paid", "sent", "done"], 3)
    seq = [r.choice(keys) for _ in range(r.randint(5, 7))]
    inc = "counts[k] = 1" if mis == "overwrite" else "counts[k] = counts.get(k, 0) + 1"
    out = "print(counts)"
    if "top" in ops:
        out = "print(max(counts, key=counts.get))" if mis != "max_key" else "print(max(counts))"
    if "missing" in ops:
        out += f"\nprint(counts.get('lost', 0))"
    code = f"""statuses = {seq}  # статусы: {s.unit}
counts = {{}}
for k in statuses:
    {inc}
{out}"""
    return Built(code, f"Считаем статусы {s.domain}. Что выведет программа?")


PY_COUNT = Template(
    "py_count_dict", "Подсчёт в словаре", ["backend", "data"], "python", "output",
    ["code_reading", "sql_aggregation"], -1.4,
    [Op("top", "Самый частый ключ", "code_reading", 0.3),
     Op("missing", "Отсутствующий ключ и get", "edge_cases", 0.25)],
    _py_count, ["overwrite", "max_key"], max_ops=2,
)


# ---------- JavaScript: filter / map ----------
def _js_filter(r: Random, ops, s: Skin, mis):
    data = ints(r, 6, 1, 9)
    thr = r.randint(3, 6)
    cmp = ">=" if mis == "strict" else ">"
    chain = f"{s.items}.filter(x => x {cmp} {thr})"
    if "index" in ops:
        chain = f"{s.items}.filter((x, i) => i % 2 === 0 && x {cmp} {thr})" if mis != "index_from_one" else f"{s.items}.filter((x, i) => i % 2 === 1 && x {cmp} {thr})"
    chain += ".map(x => x * 2)"
    if "length" in ops:
        chain = f"({chain}).length"
    code = f"""const {s.items} = [{', '.join(map(str, data))}];
const result = {chain};
console.log(JSON.stringify(result));"""
    return Built(code, f"{s.where[0].upper() + s.where[1:]} фильтруют {s.unit}. Что выведет программа?")


JS_FILTER = Template(
    "js_filter_map", "filter и map", ["frontend"], "javascript", "output",
    ["array_methods", "code_reading"], -1.5,
    [Op("index", "Индекс во втором аргументе", "array_methods", 0.4),
     Op("length", "Длина результата", "code_reading", 0.15)],
    _js_filter, ["strict", "index_from_one"],
)


# ---------- JavaScript: строки и шаблоны ----------
def _js_strings(r: Random, ops, s: Skin, mis):
    word = r.choice(["delivery", "payment", "ticket", "event", "report"])
    n = r.randint(2, 4)
    expr = f"name.slice(0, {n})" if mis != "slice_inclusive" else f"name.slice(0, {n + 1})"
    if "upper" in ops:
        expr += ".toUpperCase()"
    out = f"`${{{expr}}}-${{name.length}}`"
    if "concat_num" in ops:
        out = f"{out} + {n} + 1" if mis != "sum_first" else f"{out} + ({n} + 1)"
    code = f"""const name = "{word}";
console.log({out});"""
    return Built(code, f"Формируем код {s.domain}. Что выведет программа?")


JS_STRINGS = Template(
    "js_string_basics", "Строки и шаблонные литералы", ["frontend"], "javascript", "output",
    ["js_types", "code_reading"], -1.3,
    [Op("upper", "Цепочка методов строки", "code_reading", 0.15),
     Op("concat_num", "Строка + число", "js_types", 0.55)],
    _js_strings, ["slice_inclusive", "sum_first"],
)


# ---------- SQL: WHERE, ORDER BY, LIMIT ----------
NAMES = ["Анна", "Борис", "Вера", "Глеб", "Дина", "Егор"]


def _sql_where(r: Random, ops, s: Skin, mis):
    rows = [(i + 1, n, r.randint(1, 9) * 100) for i, n in enumerate(r.sample(NAMES, 5))]
    lo = r.choice([300, 400])
    hi = lo + 300
    cond = f"amount > {lo}" if mis != "ge" else f"amount >= {lo}"
    if "between" in ops:
        cond = f"amount BETWEEN {lo} AND {hi}" if mis != "between_exclusive" else f"amount > {lo} AND amount < {hi}"
    order = "ORDER BY amount DESC, name" if mis != "asc" else "ORDER BY amount, name"
    limit = "\nLIMIT 2" if "limit" in ops else ""
    values = ", ".join(f"({i}, '{n}', {a})" for i, n, a in rows)
    code = f"""CREATE TABLE {s.items} (id INTEGER, name TEXT, amount INTEGER);
INSERT INTO {s.items} VALUES {values};
SELECT name, amount
FROM {s.items}
WHERE {cond}
{order}{limit};"""
    return Built(code, f"Выборка {s.domain}: что вернёт запрос?")


SQL_WHERE = Template(
    "sql_where_basics", "WHERE, ORDER BY, LIMIT", ["data", "backend"], "sql", "output",
    ["sql_aggregation", "code_reading"], -1.5,
    [Op("between", "BETWEEN включает границы", "edge_cases", 0.35),
     Op("limit", "LIMIT после сортировки", "code_reading", 0.2)],
    _sql_where, ["ge", "asc", "between_exclusive"],
)


# ---------- Python: найди дефект (простой) ----------
def _bug_average(r: Random, ops, s: Skin, mis):
    data = ints(r, 5, 1, 9)
    empty = "empty" in ops
    lines_bug = [
        f"def average({s.items}):",
        f"    total = 0",
        f"    for x in {s.items}:",
        f"        total += x",
        f"    return total / (len({s.items}) - 1)",
        "",
        f"print(average({data}))",
    ]
    lines_fix = list(lines_bug)
    lines_fix[4] = f"    return total / len({s.items})"
    bug_line = 5
    if empty:
        lines_bug[1] = "    total = 0"
        lines_bug.insert(1, f"    if not {s.items}:\n        return 0")
        lines_fix.insert(1, f"    if not {s.items}:\n        return 0")
        bug_line = 7
    code = "\n".join(lines_bug)
    fixed = "\n".join(lines_fix)
    n = len(code.split("\n"))
    return Built(code, f"Функция считает среднее для {s.domain}, но результат неверный. В какой строке дефект?",
                 bug_line=bug_line, fixed_code=fixed, lines_range=(1, n - 2))


BUG_AVG = Template(
    "bug_average", "Дефект: среднее значение", ["backend", "data"], "python", "bug",
    ["debugging", "edge_cases"], -1.2,
    [Op("plain", "Ошибка в знаменателе", "debugging", 0.0),
     Op("empty", "С защитой от пустого списка", "edge_cases", 0.25)],
    _bug_average,
)

EASY_TEMPLATES = [PY_SLICE, PY_COUNT, JS_FILTER, JS_STRINGS, SQL_WHERE, BUG_AVG]
