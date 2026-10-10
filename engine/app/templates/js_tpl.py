"""Шаблоны на JavaScript (frontend): «что выведет программа?»."""
from random import Random

from .base import Built, Op, Skin, Template, ints


# ---------- Event loop ----------
def _event_loop(r: Random, ops, s: Skin, mis):
    a, b = r.sample(["A", "B", "C", "D"], 2)
    # Событие: (тип, метка). Тип: sync | timeout | micro | nested | await
    events = [("timeout", "T"), ("micro", "P")]
    if "nested" in ops:
        events.append(("nested", "P1"))
    if "await" in ops:
        events.append(("await", "S"))
    r.shuffle(events)
    events = [("sync", a)] + events + [("sync", b)]

    def render(kind, label):
        if mis == "in_order":  # ошибочная модель «всё выполняется по порядку строк»
            if kind == "nested":
                return "log.push('P1'); log.push('P2');"
            if kind == "await":
                return "log.push('S'); log.push('W');"
            return f"log.push('{label}');"
        if kind == "sync":
            return f"log.push('{label}');"
        if kind == "timeout":
            return f"log.push('{label}');" if mis == "timeout_first" else f"setTimeout(() => log.push('{label}'), 0);"
        if kind == "micro":
            return f"Promise.resolve().then(() => log.push('{label}'));"
        if kind == "nested":
            return "Promise.resolve().then(() => { log.push('P1'); Promise.resolve().then(() => log.push('P2')); });"
        return "(async () => { log.push('S'); await null; log.push('W'); })();"

    code = ("const log = [];\n" + "\n".join(render(k, l) for k, l in events)
            + "\nsetTimeout(() => console.log(log.join(' ')), 10);")
    return Built(code, f"Интерфейс {s.domain} пишет лог действий. Что выведет программа?")


EVENT_LOOP = Template(
    "js_event_loop", "Event loop: микро- и макрозадачи", ["frontend"], "javascript", "output",
    ["js_async"], 0.3,
    [Op("nested", "Вложенные микрозадачи", "js_async", 0.5),
     Op("await", "async/await", "js_async", 0.4)],
    _event_loop, ["timeout_first", "in_order"],
)


# ---------- Замыкания в цикле ----------
def _closures(r: Random, ops, s: Skin, mis):
    n = r.randint(3, 5)
    decl = "let" if ("let" in ops) != (mis == "flip_decl") else "var"
    mult = r.randint(2, 4)
    body = f"() => i * {mult}" if "mult" in ops else "() => i"
    code = f"""const handlers = [];
for ({decl} i = 0; i < {n}; i++) {{
  handlers.push({body});
}}
console.log(handlers.map(h => h()).join(','));"""
    return Built(code, f"В интерфейсе {s.domain} создают обработчики кликов. Что выведет программа?")


CLOSURES = Template(
    "js_closures_loop", "Замыкания в цикле", ["frontend"], "javascript", "output",
    ["closures_scope"], 0.0,
    [Op("let", "Блочная область let", "closures_scope", -0.4),
     Op("mult", "Вычисление внутри замыкания", "code_reading", 0.15)],
    _closures, ["flip_decl"],
)


# ---------- Иммутабельность состояния ----------
def _immut(r: Random, ops, s: Skin, mis):
    items = ints(r, r.randint(2, 3), 1, 9)
    add = r.randint(10, 20)
    if "spread_array" in ops:
        copy = f"const next = {{ ...state, {s.items}: [...state.{s.items}] }};"
    elif "structured" in ops:
        copy = "const next = structuredClone(state);"
    else:
        copy = "const next = { ...state };"
    if mis == "deep":
        copy = "const next = JSON.parse(JSON.stringify(state));"
    if mis == "no_copy":
        copy = "const next = state;"
    code = f"""const state = {{ {s.items}: {items}, page: 1 }};
{copy}
next.{s.items}.push({add});
next.page = 2;
console.log(state.{s.items}.length, state.page, next.{s.items} === state.{s.items});"""
    return Built(code, f"Редьюсер обновляет список «{s.unit}». Что выведет программа?")


IMMUTABILITY = Template(
    "js_immutability", "Поверхностная копия состояния", ["frontend"], "javascript", "output",
    ["state_immutability"], 0.2,
    [Op("spread_array", "Копия вложенного массива", "state_immutability", 0.1),
     Op("structured", "structuredClone", "state_immutability", 0.2)],
    _immut, ["deep", "no_copy"], conflicts=[("spread_array", "structured")],
)


# ---------- Приведение типов ----------
def _coercion(r: Random, ops, s: Skin, mis):
    pool = ["0", "'0'", "''", "null", "undefined", "false", "[]", "' '", "NaN", "1", "'1'"]
    vals = r.sample(pool, 6)
    op = "===" if ("strict" in ops) != (mis == "flip_eq") else "=="
    target = "null" if "null_target" in ops else "0"
    code = f"""const values = [{', '.join(vals)}];
console.log(values.filter(v => v {op} {target}).length);"""
    return Built(code, "Валидатор формы сравнивает значения. Что выведет программа?")


COERCION = Template(
    "js_coercion", "Приведение типов", ["frontend"], "javascript", "output",
    ["js_types"], 0.5,
    [Op("strict", "Строгое сравнение", "js_types", -0.5),
     Op("null_target", "Сравнение с null", "js_types", 0.3)],
    _coercion, ["flip_eq"],
)


# ---------- Цепочка методов массивов ----------
def _array_chain(r: Random, ops, s: Skin, mis):
    rows = [{"sum": r.randint(1, 9) * 100, "paid": r.choice([True, False])} for _ in range(r.randint(4, 6))]
    if "empty" in ops:
        for row in rows:
            row["paid"] = False
    js_rows = ", ".join(f"{{ sum: {x['sum']}, paid: {str(x['paid']).lower()} }}" for x in rows)
    init = "" if ("no_initial" in ops) != (mis == "has_initial") else ", 0"
    flt = "o => o.paid" if mis != "no_filter" else "o => true"
    sort = ".sort()" if "sort_strings" in ops else ""
    tail = f".map(o => o.sum){sort}.reduce((a, b) => a + b{init})"
    if "sort_strings" in ops:
        tail = f".map(o => o.sum){sort}.slice(0, 2).join(',')"
    code = f"""const {s.items} = [{js_rows}];
const total = {s.items}.filter({flt}){tail};
console.log(total);"""
    return Built(code, f"Корзина {s.domain} считает оплаченные {s.unit}. Что выведет программа?")


ARRAY_CHAIN = Template(
    "js_array_chain", "filter / map / reduce", ["frontend"], "javascript", "output",
    ["array_methods"], -0.6,
    [Op("empty", "Пустой результат фильтра", "edge_cases", 0.3),
     Op("no_initial", "reduce без начального значения", "array_methods", 0.4),
     Op("sort_strings", "sort() без компаратора", "js_types", 0.6)],
    _array_chain, ["has_initial", "no_filter"], conflicts=[("no_initial", "sort_strings")],
)

# ---------- Потеря this ----------
def _this(r: Random, ops, s: Skin, mis):
    n = r.randint(2, 9)
    arrow = (("arrow" in ops) != (mis == "flip_arrow")) and mis != "bound"
    method = f"count: () => this.{s.items}?.length ?? 'нет'" if arrow else f"count() {{ return this.{s.items}?.length ?? 'нет'; }}"
    bind = ".bind(store)" if "bind" in ops else ""
    if mis in ("keeps_this", "bound"):
        call = "store.count()"
    else:
        call = "fn()"
    code = f"""const store = {{
  {s.items}: Array.from({{ length: {n} }}, (_, i) => i),
  {method},
}};
const fn = store.count{bind};
console.log(store.count(), {call});"""
    return Built(code, f"Метод хранилища {s.domain} передали как колбэк. Что выведет программа?")


THIS_BINDING = Template(
    "js_this_binding", "Потеря контекста this", ["frontend"], "javascript", "output",
    ["closures_scope"], 0.6,
    [Op("bind", "Привязка через bind", "closures_scope", -0.3),
     Op("arrow", "Стрелочная функция как метод", "closures_scope", 0.4)],
    _this, ["keeps_this", "flip_arrow", "bound"], conflicts=[("bind", "arrow")],
)


# ---------- Promise.all / allSettled ----------
def _promise_all(r: Random, ops, s: Skin, mis):
    n = r.randint(3, 5)
    bad = r.randint(1, n)
    settled = ("settled" in ops) != (mis == "flip_settled")
    racer = "race" in ops
    fn = "Promise.race" if racer else ("Promise.allSettled" if settled else "Promise.all")
    then = ("r => console.log(r.filter(x => x.status === 'fulfilled').length)" if settled and not racer
            else "r => console.log(Array.isArray(r) ? r.length : r)")
    code = f"""const load = id => new Promise((ok, fail) =>
  setTimeout(() => id === {bad} ? fail('ошибка ' + id) : ok(id), id * 10));
{fn}([{', '.join(str(i) for i in range(1, n + 1))}].map(load))
  .then({then})
  .catch(e => console.log(e));"""
    return Built(code, f"Страница {s.domain} грузит {s.unit} параллельно. Что выведет программа?")


PROMISE_ALL = Template(
    "js_promise_all", "Promise.all и отказ", ["frontend"], "javascript", "output",
    ["js_async", "edge_cases"], 0.4,
    [Op("settled", "allSettled вместо all", "js_async", 0.1),
     Op("race", "Promise.race", "js_async", 0.3)],
    _promise_all, ["flip_settled"], conflicts=[("settled", "race")],
)


# ---------- ?? против || ----------
def _nullish(r: Random, ops, s: Skin, mis):
    vals = r.sample(["0", "''", "null", "undefined", "false", "5", "'x'", "NaN"], 5)
    default = r.choice(["10", "'def'"])
    op = "??" if ("nullish" in ops) != (mis == "flip_op") else "||"
    chain = "opt" in ops
    if chain:
        code = f"""const cfg = {{ {s.item}: {{ limit: {vals[0]} }} }};
const empty = {{}};
console.log(cfg.{s.item}?.limit {op} {default}, empty.{s.item}?.limit {op} {default});"""
    else:
        code = f"""const values = [{', '.join(vals)}];
console.log(values.map(v => v {op} {default}).join('|'));"""
    return Built(code, f"Форма настроек {s.domain} подставляет значения по умолчанию. Что выведет программа?")


NULLISH = Template(
    "js_nullish", "?? против ||", ["frontend"], "javascript", "output",
    ["js_types"], 0.1,
    [Op("nullish", "Оператор ??", "js_types", 0.2),
     Op("opt", "Опциональная цепочка ?.", "js_types", 0.2)],
    _nullish, ["flip_op"],
)


# ---------- Порядок ключей объекта ----------
def _keys_order(r: Random, ops, s: Skin, mis):
    keys = r.sample(["b", "a", "10", "2", "z", "1"], 5)
    obj = ", ".join(f"'{k}': {i}" for i, k in enumerate(keys))
    if "map" in ops:
        code = f"""const m = new Map([{', '.join(f"['{k}', {i}]" for i, k in enumerate(keys))}]);
console.log([...m.keys()].join(','));"""
    else:
        code = f"""const o = {{ {obj} }};
console.log(Object.keys(o).join(','));"""
    if mis == "insertion":
        code = f"console.log({[k for k in keys]!r}.join(','));".replace("[", "[").replace("'", "'")
    if mis == "sorted":
        code = f"console.log({sorted(keys)!r}.join(','));"
    return Built(code, f"Справочник {s.domain} хранит записи по ключам. Что выведет программа?")


KEYS_ORDER = Template(
    "js_keys_order", "Порядок ключей объекта", ["frontend"], "javascript", "output",
    ["js_types", "edge_cases"], 0.9,
    [Op("map", "Map вместо объекта", "js_types", -0.5)],
    _keys_order, ["insertion", "sorted"], max_ops=1,
)

JS_TEMPLATES = [EVENT_LOOP, CLOSURES, IMMUTABILITY, COERCION, ARRAY_CHAIN,
                THIS_BINDING, PROMISE_ALL, NULLISH, KEYS_ORDER]
