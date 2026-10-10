"""Шаблоны на Python: «что выведет программа?»."""
from random import Random

from .base import Built, Op, Skin, Template, ints


# ---------- Скользящее окно ----------
def _window(r: Random, ops, s: Skin, mis):
    k = r.randint(2, 4)
    neg = "max_only" in ops
    data = ints(r, r.randint(6, 8), -9 if neg else 1, 9)
    end = "len(data) - k" if ("short_range" in ops) != (mis == "range_off") else "len(data) - k + 1"
    step = f", {k}" if "stride" in ops else ""
    start = "0, " if step else ""
    slice_end = "i + k + 1" if mis == "inclusive" else "i + k"
    out = "print(max(result))" if neg else "print(result)"
    code = f"""data = {data}  # {s.unit}
k = {k}
result = []
for i in range({start}{end}{step}):
    result.append(sum(data[i:{slice_end}]))
{out}"""
    return Built(code, f"{s.where[0].upper() + s.where[1:]} считают суммы по окну из k элементов. Что выведет программа?")


WINDOW = Template(
    "py_window", "Скользящее окно", ["backend", "data"], "python", "output",
    ["code_reading", "edge_cases"], -0.9,
    [Op("short_range", "Граница цикла без +1", "edge_cases", 0.45),
     Op("stride", "Непересекающиеся окна (шаг k)", "code_reading", 0.35),
     Op("max_only", "Отрицательные значения и max", "edge_cases", 0.25)],
    _window, ["inclusive", "range_off"],
)


# ---------- Изменяемый аргумент по умолчанию ----------
def _default(r: Random, ops, s: Skin, mis):
    fresh = mis == "fresh_default"
    if "none_default" in ops:
        sig, init = "bucket=None", "    if bucket is None:\n        bucket = []\n"
        if fresh:
            sig, init = "bucket=[]", "    bucket = list(bucket)\n"
    else:
        sig, init = "bucket=[]", ("    bucket = list(bucket)\n" if fresh else "")
    calls = [r.randint(1, 9) for _ in range(4)]
    explicit = r.randint(1, 2)
    args = [f"add({c})" if i != explicit else f"add({c}, [])" for i, c in enumerate(calls)]
    extra = ""
    if "shared_ref" in ops:
        extra = "\nshared = []\nadd(0, shared)\nadd(0, shared)\nprint(len(shared))"
    code = f"""def add({s.item}, {sig}):
{init}    bucket.append({s.item})
    return len(bucket)

print({', '.join(args)}){extra}"""
    return Built(code, f"Функция копит {s.unit} в списке. Что выведет программа?")


DEFAULT = Template(
    "py_mutable_default", "Изменяемый аргумент по умолчанию", ["backend"], "python", "output",
    ["state_mutability", "code_reading"], 0.3,
    [Op("none_default", "Безопасный шаблон с None", "state_mutability", -0.5),
     Op("shared_ref", "Явно переданный общий список", "state_mutability", 0.3)],
    _default, ["fresh_default"],
)


# ---------- Группировка в словаре ----------
def _groupby(r: Random, ops, s: Skin, mis):
    keys = r.sample(["alpha", "beta", "gamma", "delta", "omega"], 3)
    rows = [(r.choice(keys), r.randint(1, 9)) for _ in range(r.randint(6, 8))]
    if "ties" in ops:  # гарантируем равенство сумм у двух ключей
        rows = [(keys[0], 4), (keys[1], 3), (keys[2], 2), (keys[1], 1), (keys[2], 2), (keys[0], 1), (keys[2], 1)]
        r.shuffle(rows)
    agg = "totals[key] = v" if mis == "overwrite" else "totals[key] = totals.get(key, 0) + v"
    order = "kv[1]" if mis == "ascending" else "-kv[1]"
    top = 2
    tail = f"print(sorted(totals.items(), key=lambda kv: {order})[:{top}])"
    if "count_only" in ops:
        agg = "totals[key] = totals.get(key, 0) + 1" if mis != "overwrite" else "totals[key] = 1"
    code = f"""rows = {rows}  # ({s.item}_type, amount)
totals = {{}}
for key, v in rows:
    {agg}
{tail}"""
    return Built(code, f"{s.where[0].upper() + s.where[1:]} агрегируют {s.unit} по типу. Что выведет программа?")


GROUPBY = Template(
    "py_groupby", "Агрегация в словаре", ["backend", "data"], "python", "output",
    ["sql_aggregation", "code_reading"], -0.5,
    [Op("ties", "Равные суммы и стабильная сортировка", "edge_cases", 0.6),
     Op("count_only", "Подсчёт вместо суммы", "code_reading", 0.1)],
    _groupby, ["overwrite", "ascending"], conflicts=[("ties", "count_only")],
)


# ---------- Рекурсия и число вызовов ----------
def _calls(r: Random, ops, s: Skin, mis):
    n = r.randint(5, 8)
    memo = "memo" in ops
    deco = "from functools import lru_cache\n\n@lru_cache(maxsize=None)\n" if memo else ""
    base = "n < 2" if mis != "base_le" else "n <= 2"
    third = " + f(n - 3)" if "tribonacci" in ops else ""
    guard = "n < 3" if third else base
    code = f"""{deco}calls = 0
def f(n):
    global calls
    calls += 1
    if {guard}:
        return n
    return f(n - 1) + f(n - 2){third}

f({n})
print(calls)"""
    if memo:  # lru_cache должен стоять над def f — перестраиваем
        code = f"""from functools import lru_cache

calls = 0
@lru_cache(maxsize=None)
def f(n):
    global calls
    calls += 1
    if {guard}:
        return n
    return f(n - 1) + f(n - 2){third}

f({n})
print(calls)"""
    return Built(code, f"Расчёт рейтинга {s.domain}: сколько раз будет вызвана функция f?")


CALLS = Template(
    "py_recursion_calls", "Рекурсия: число вызовов", ["backend", "data"], "python", "output",
    ["complexity"], 0.6,
    [Op("memo", "Мемоизация lru_cache", "complexity", -0.4),
     Op("tribonacci", "Три рекурсивные ветки", "complexity", 0.5)],
    _calls, ["base_le"],
)


# ---------- Бинарный поиск (lower_bound) ----------
def _lower_bound(r: Random, ops, s: Skin, mis):
    a = sorted(set(ints(r, 9, 1, 40)))
    if "duplicates" in ops:
        v = r.choice(a)
        a = sorted(a + [v, v])
        x = v
    elif "absent_high" in ops:
        x = max(a) + r.randint(1, 5)
    else:
        x = r.choice(a) + r.choice([0, 1])
    cmp = "a[mid] <= x" if ("upper" in ops) != (mis == "flip") else "a[mid] < x"
    code = f"""def search(a, x):
    lo, hi = 0, len(a)
    while lo < hi:
        mid = (lo + hi) // 2
        if {cmp}:
            lo = mid + 1
        else:
            hi = mid
    return lo

{s.items} = {a}
print(search({s.items}, {x}))"""
    return Built(code, "Какой индекс вернёт функция поиска?")


LOWER_BOUND = Template(
    "py_binary_search", "Бинарный поиск: границы", ["backend", "data"], "python", "output",
    ["edge_cases", "complexity"], 0.2,
    [Op("duplicates", "Повторяющиеся значения", "edge_cases", 0.4),
     Op("absent_high", "Искомое больше всех", "edge_cases", 0.2),
     Op("upper", "Строгое/нестрогое сравнение", "code_reading", 0.35)],
    _lower_bound, ["flip"], conflicts=[("duplicates", "absent_high")],
)


# ---------- Идемпотентность обработки событий ----------
def _idem(r: Random, ops, s: Skin, mis):
    n = r.randint(3, 4)
    evs = [(f"e{i+1}", r.choice([100, 200, 50, 70, 30])) for i in range(n)]
    dup = r.choice(evs)
    evs.insert(r.randint(1, len(evs)), dup)
    if "retry_new_id" in ops:
        evs.append((dup[0] + "-retry", dup[1]))
    fail_block = ""
    if "fail_after_mark" in ops:
        bad = evs[r.randint(0, len(evs) - 1)][0]
        fail_block = f"""    if eid == "{bad}" and not retried:
        retried = True
        continue  # обработчик упал, событие будет доставлено повторно
"""
        evs.append((bad, dict(evs)[bad]))
    dedup = "" if mis == "no_dedup" else "    if eid in seen:\n        continue\n"
    mark = "    seen.add(eid)\n"
    body = (dedup + mark + fail_block) if "fail_after_mark" in ops else (dedup + mark)
    code = f"""{s.items} = {evs}
seen = set()
retried = False
balance = 0
for eid, amount in {s.items}:
{body}    balance += amount
print(balance)"""
    return Built(code, f"Брокер доставляет {s.unit} «как минимум один раз». Какой баланс выведет программа?")


IDEMPOTENCY = Template(
    "py_idempotency", "Идемпотентная обработка событий", ["backend"], "python", "output",
    ["idempotency"], 0.1,
    [Op("retry_new_id", "Повтор с новым идентификатором", "idempotency", 0.4),
     Op("fail_after_mark", "Сбой после отметки «обработано»", "idempotency", 0.8)],
    _idem, ["no_dedup"],
)


# ---------- asyncio: порядок выполнения ----------
def _asyncio(r: Random, ops, s: Skin, mis):
    names = ["A", "B", "C"] if "three" in ops else ["A", "B"]
    yields = {n: r.randint(1, 3) for n in names}
    if "sequential" in ops or mis == "sequential":
        run = "\n".join(f"    await worker(\"{n}\", {yields[n]})" for n in names)
    else:
        run = "    await asyncio.gather(" + ", ".join(f"worker(\"{n}\", {yields[n]})" for n in names) + ")"
    code = f"""import asyncio

log = []

async def worker(name, steps):
    log.append(name + "+")
    for _ in range(steps):
        await asyncio.sleep(0)
    log.append(name + "-")

async def main():
{run}

asyncio.run(main())
print(" ".join(log))"""
    return Built(code, f"Воркеры {s.domain} обрабатывают {s.unit} конкурентно. Что выведет программа?")


ASYNCIO = Template(
    "py_asyncio_order", "asyncio: порядок выполнения", ["backend"], "python", "output",
    ["concurrency"], 0.7,
    [Op("three", "Три конкурентные задачи", "concurrency", 0.4),
     Op("sequential", "Последовательный await", "concurrency", -0.6)],
    _asyncio, ["sequential"],
)


# ---------- Метрики качества ----------
def _metrics(r: Random, ops, s: Skin, mis):
    n = 10
    y_true = ints(r, n, 0, 1)
    y_pred = ints(r, n, 0, 1)
    if "all_negative" in ops:
        y_pred = [0] * n
    metric = "recall" if "recall" in ops else "precision"
    if mis == "swap":
        metric = "precision" if metric == "recall" else "recall"
    den = "tp + fp" if metric == "precision" else "tp + fn"
    if mis == "accuracy":
        expr = "(tp + tn) / len(y_true)"
    else:
        expr = f"tp / ({den}) if ({den}) else 0.0"
    code = f"""y_true = {y_true}  # 1 = мошеннический {s.item}
y_pred = {y_pred}
tp = sum(t == 1 and p == 1 for t, p in zip(y_true, y_pred))
fp = sum(t == 0 and p == 1 for t, p in zip(y_true, y_pred))
fn = sum(t == 1 and p == 0 for t, p in zip(y_true, y_pred))
tn = sum(t == 0 and p == 0 for t, p in zip(y_true, y_pred))
score = {expr}
print(round(score, 2))"""
    return Built(code, f"Модель {s.domain} ищет мошеннические {s.unit}. Что выведет программа?")


METRICS = Template(
    "py_ml_metrics", "Метрики классификации", ["data"], "python", "output",
    ["ml_metrics"], -0.2,
    [Op("recall", "Полнота вместо точности", "ml_metrics", 0.1),
     Op("all_negative", "Модель не предсказывает класс 1", "edge_cases", 0.5)],
    _metrics, ["swap", "accuracy"],
)


# ---------- Нормализация и утечка ----------
def _leak(r: Random, ops, s: Skin, mis):
    train = ints(r, 4, 10, 30)
    test = ints(r, 2, 10, 60)
    leak = ("leak" in ops) != (mis == "flip_leak")
    src = "train + test" if leak else "train"
    scale = "max_scale" in ops
    stat = f"max({src})" if scale else f"sum({src}) / len({src})"
    expr = "test[0] / stat" if scale else "test[0] - stat"
    code = f"""train = {train}  # {s.unit} за прошлый месяц
test = {test}
stat = {stat}
print(round({expr}, 2))"""
    return Built(code, "Признак нормируют перед обучением модели. Что выведет программа?")


LEAK = Template(
    "py_data_leak", "Нормализация и утечка данных", ["data"], "python", "output",
    ["data_prep"], -0.6,
    [Op("leak", "Статистика по train+test (утечка)", "data_prep", 0.4),
     Op("max_scale", "Масштабирование по максимуму", "data_prep", 0.2)],
    _leak, ["flip_leak"],
)

PYTHON_TEMPLATES = [WINDOW, DEFAULT, GROUPBY, CALLS, LOWER_BOUND, IDEMPOTENCY, ASYNCIO, METRICS, LEAK]
