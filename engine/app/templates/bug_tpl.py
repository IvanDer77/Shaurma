"""Шаблоны «найди дефект»: в коде ровно одна ошибка, указанная оператором мутации.

Эталон проверяется исполнением: вывод кода с дефектом обязан отличаться от
вывода исправленного кода, иначе вариант отбрасывается.
"""
from random import Random

from .base import Built, Op, Skin, Template


def _make(lines_fn, bugs: dict, harness_fn, prompt_fn):
    """lines_fn(r, s) -> (lines, ctx); bugs: op_id -> fn(lines, ctx) -> (idx, new_line)."""

    def build(r: Random, ops, s: Skin, mis):
        lines, ctx = lines_fn(r, s)
        fixed = list(lines)
        bug_op = next(iter(ops))
        idx, new_line = bugs[bug_op](lines, ctx)
        buggy = list(lines)
        buggy[idx] = new_line
        harness = harness_fn(r, s, ctx)
        return Built(code="\n".join(buggy + harness), prompt=prompt_fn(s, ctx),
                     bug_line=idx + 1, fixed_code="\n".join(fixed + harness),
                     lines_range=(1, len(lines)))

    return build


# ---------- Пагинация (страницы с 1) ----------
def _pag_lines(r, s):
    return ([f"def paginate({s.items}, page, size):",
             "    # page нумеруется с 1",
             "    start = (page - 1) * size",
             "    end = start + size",
             f"    return {s.items}[start:end]"], {})


PAGINATION = Template(
    "bug_pagination", "Дефект в пагинации API", ["backend", "frontend"], "python", "bug",
    ["api_contracts", "debugging"], -0.5,
    [Op("zero_based", "Нумерация страниц с нуля", "api_contracts", 0.2),
     Op("end_minus", "Потеря последнего элемента", "edge_cases", 0.3),
     Op("swap_args", "Перепутаны page и size", "debugging", 0.1)],
    _make(_pag_lines,
          {"zero_based": lambda L, c: (2, "    start = page * size"),
           "end_minus": lambda L, c: (3, "    end = start + size - 1"),
           "swap_args": lambda L, c: (2, "    start = (size - 1) * page")},
          lambda r, s, c: ["", f"print(paginate(list(range(1, {r.randint(15, 30)})), {r.randint(2, 3)}, {r.randint(4, 6)}))"],
          lambda s, c: f"API {s.domain} отдаёт {s.unit} постранично (страницы с 1). В какой строке дефект?"),
    max_ops=1,
)


# ---------- Удаление дублей с сохранением порядка ----------
def _uniq_lines(r, s):
    return ([f"def unique({s.items}):",
             "    seen = set()",
             "    out = []",
             f"    for x in {s.items}:",
             "        if x not in seen:",
             "            seen.add(x)",
             "            out.append(x)",
             "    return out"], {})


UNIQUE = Template(
    "bug_unique", "Дефект в удалении дублей", ["backend", "data"], "python", "bug",
    ["debugging", "code_reading"], -0.8,
    [Op("append_outside", "Добавление вне условия", "debugging", 0.1),
     Op("reset_seen", "Сброс множества в цикле", "state_mutability", 0.4),
     Op("wrong_check", "Проверка не того контейнера", "debugging", 0.3)],
    _make(_uniq_lines,
          {"append_outside": lambda L, c: (6, "        out.append(x)"),
           "reset_seen": lambda L, c: (5, "            seen = {x}"),
           "wrong_check": lambda L, c: (4, "        if x not in out[1:]:")},
          lambda r, s, c: ["", f"print(unique({[r.randint(1, 4) for _ in range(8)]}))"],
          lambda s, c: f"Функция должна убирать повторные {s.unit}, сохраняя порядок. В какой строке дефект?"),
    max_ops=1,
)


# ---------- Идемпотентный платёж ----------
def _charge_lines(r, s):
    return (["charged = []",
             "",
             "def charge(store, key, amount):",
             "    if key in store:",
             "        return store[key]",
             "    charged.append(amount)",
             "    result = {'status': 'ok', 'amount': amount}",
             "    store[key] = result",
             "    return result",
             "",
             "def pay_with_retry(store, order_id, amount, attempts):",
             "    for attempt in range(attempts):",
             "        charge(store, order_id, amount)",
             "    return sum(charged)"], {})


CHARGE = Template(
    "bug_idempotent_charge", "Дефект в повторах платежа", ["backend"], "python", "bug",
    ["idempotency", "debugging"], 0.4,
    [Op("attempt_key", "Ключ идемпотентности зависит от попытки", "idempotency", 0.3),
     Op("store_skip", "Результат не сохраняется", "idempotency", 0.2)],
    _make(_charge_lines,
          {"attempt_key": lambda L, c: (12, "        charge(store, f'{order_id}-{attempt}', amount)"),
           "store_skip": lambda L, c: (7, "    result['key'] = key")},
          lambda r, s, c: ["", f"print(pay_with_retry({{}}, 'o{r.randint(10, 99)}', {r.randint(1, 9) * 100}, 3))"],
          lambda s, c: "При сбое сети платёж повторяется. Деньги должны списаться один раз. В какой строке дефект?"),
    max_ops=1,
)


# ---------- async + forEach ----------
def _save_lines(r, s):
    return ([f"async function saveAll({s.items}, save) {{",
             "  let saved = 0;",
             f"  for (const it of {s.items}) {{ await save(it); saved++; }}",
             "  return saved;",
             "}"], {"items": s.items})


SAVE_ALL = Template(
    "bug_async_foreach", "Дефект в асинхронном цикле", ["frontend"], "javascript", "bug",
    ["js_async", "debugging"], 0.5,
    [Op("foreach", "async внутри forEach", "js_async", 0.3),
     Op("no_await", "Пропущен await", "js_async", 0.1)],
    _make(_save_lines,
          {"foreach": lambda L, c: (2, f"  {c['items']}.forEach(async it => {{ await save(it); saved++; }});"),
           "no_await": lambda L, c: (2, f"  for (const it of {c['items']}) {{ save(it).then(() => saved++); }}")},
          lambda r, s, c: ["", f"const delay = () => new Promise(r => setTimeout(r, 1));",
                           f"saveAll([{', '.join(str(r.randint(1, 9)) for _ in range(r.randint(3, 5)))}], delay).then(n => console.log(n));"],
          lambda s, c: f"Функция сохраняет {s.unit} по одному и возвращает их число. В какой строке дефект?"),
    max_ops=1,
)


# ---------- Мутация состояния в редьюсере ----------
def _reducer_lines(r, s):
    return (["function reducer(state, action) {",
             "  switch (action.type) {",
             "    case 'add':",
             f"      return {{ ...state, {s.items}: [...state.{s.items}, action.item] }};",
             "    case 'clear':",
             f"      return {{ ...state, {s.items}: [] }};",
             "    default:",
             "      return state;",
             "  }",
             "}"], {"items": s.items})


REDUCER = Template(
    "bug_reducer_mutation", "Дефект в редьюсере", ["frontend"], "javascript", "bug",
    ["state_immutability", "debugging"], 0.1,
    [Op("push", "Мутация массива push", "state_immutability", 0.2),
     Op("clear_mutate", "Очистка через length = 0", "state_immutability", 0.4)],
    _make(_reducer_lines,
          {"push": lambda L, c: (3, f"      state.{c['items']}.push(action.item); return state;"),
           "clear_mutate": lambda L, c: (5, f"      state.{c['items']}.length = 0; return {{ ...state }};")},
          lambda r, s, c: ["", f"const s0 = {{ {c['items']}: [{r.randint(1, 9)}] }};",
                           f"const s1 = reducer(s0, {{ type: 'add', item: {r.randint(10, 20)} }});",
                           "const s2 = reducer(s1, { type: 'clear' });",
                           f"console.log(s0.{c['items']}.length, s1.{c['items']}.length, s0 === s1);"],
          lambda s, c: "React перерисовывает компонент, только если состояние — новый объект. В какой строке дефект?"),
    max_ops=1,
)


# ---------- Сравнение с NULL ----------
def _null_lines(r, s):
    return ([f"SELECT COUNT(*) AS n",
             f"FROM {s.items}",
             "WHERE manager_id IS NULL",
             "  AND amount >= 100;"], {})


def _null_harness_prefix(r, s):
    # Гарантируем строки, на которых дефект проявляется
    base = [("NULL", r.choice([100, 200, 300])), ("NULL", 50), (str(r.randint(1, 3)), 200)]
    base += [(r.choice(["NULL", "1", "2"]), r.choice([50, 100, 200])) for _ in range(3)]
    r.shuffle(base)
    rows = [f"({i + 1}, {m}, {a})" for i, (m, a) in enumerate(base)]
    return [f"CREATE TABLE {s.items} (id INTEGER, manager_id INTEGER, amount INTEGER);",
            f"INSERT INTO {s.items} VALUES {', '.join(rows)};"]


def _null_build(r: Random, ops, s: Skin, mis):
    prefix = _null_harness_prefix(r, s)
    lines, _ = _null_lines(r, s)
    bug_op = next(iter(ops))
    idx, new = {"eq_null": (2, "WHERE manager_id = NULL"),
                "count_col": (0, "SELECT COUNT(manager_id) AS n")}[bug_op]
    buggy = list(lines)
    buggy[idx] = new
    # Строки запроса нумеруются после двух строк подготовки данных
    return Built(code="\n".join(prefix + buggy),
                 prompt=f"Нужно посчитать {s.unit} без менеджера на сумму от 100. В какой строке дефект?",
                 bug_line=len(prefix) + idx + 1, fixed_code="\n".join(prefix + lines),
                 lines_range=(len(prefix) + 1, len(prefix) + len(lines)))


NULL_CMP = Template(
    "bug_sql_null", "Дефект в работе с NULL", ["data", "backend"], "sql", "bug",
    ["sql_nulls", "debugging"], 0.0,
    [Op("eq_null", "Сравнение = NULL", "sql_nulls", 0.1),
     Op("count_col", "COUNT по столбцу с NULL", "sql_nulls", 0.4)],
    _null_build, max_ops=1,
)

BUG_TEMPLATES = [PAGINATION, UNIQUE, CHARGE, SAVE_ALL, REDUCER, NULL_CMP]
