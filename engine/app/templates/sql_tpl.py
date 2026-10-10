"""Шаблоны на SQL (исполняются в SQLite): «какой результат вернёт запрос?»."""
from random import Random

from .base import Built, Op, Skin, Template

NAMES = ["Анна", "Борис", "Вера", "Глеб", "Дина", "Егор", "Жанна", "Иван"]


def _rows(r: Random, n_clients: int, n_rows: int, allow_null: bool):
    clients = r.sample(NAMES, n_clients)
    rows = []
    for i in range(n_rows):
        amt = "NULL" if allow_null and r.random() < 0.3 else str(r.randint(1, 9) * 100)
        rows.append(f"({i + 1}, '{r.choice(clients)}', {amt})")
    return clients, rows


# ---------- GROUP BY / HAVING ----------
def _group(r: Random, ops, s: Skin, mis):
    nulls = "nulls" in ops
    clients, rows = _rows(r, 3, 7, nulls)
    thr = r.choice([300, 500, 700])
    agg = "COUNT(*)" if mis == "count_star" else ("COUNT(amount)" if "count" in ops else "SUM(amount)")
    if "count" in ops and mis != "count_star":
        thr = 1
    cond = f"HAVING {agg} > {thr}" if mis != "where_all" else ""
    code = f"""CREATE TABLE {s.items} (id INTEGER, client TEXT, amount INTEGER);
INSERT INTO {s.items} VALUES {', '.join(rows)};
SELECT client, {agg} AS v
FROM {s.items}
GROUP BY client
{cond}
ORDER BY v DESC, client;"""
    return Built(code, f"Отчёт {s.domain}: что вернёт запрос?")


GROUP = Template(
    "sql_group_having", "GROUP BY и HAVING", ["data", "backend"], "sql", "output",
    ["sql_aggregation"], -0.4,
    [Op("nulls", "NULL в агрегируемом столбце", "sql_nulls", 0.5),
     Op("count", "COUNT(столбец) вместо SUM", "sql_nulls", 0.3)],
    _group, ["count_star", "where_all"],
)


# ---------- LEFT JOIN и подсчёт ----------
def _left_join(r: Random, ops, s: Skin, mis):
    clients = r.sample(NAMES, 4)
    orders = []
    for i in range(r.randint(3, 6)):
        orders.append(f"({i + 1}, '{r.choice(clients[:3])}')")  # последний клиент без заказов
    count = "COUNT(*)" if mis == "count_star" or "count_star" in ops else "COUNT(o.id)"
    join = "JOIN" if mis == "inner" else "LEFT JOIN"
    where = ""
    if "where_on_right" in ops:
        where = "WHERE o.id > 1\n"
    code = f"""CREATE TABLE clients (name TEXT);
CREATE TABLE {s.items} (id INTEGER, client TEXT);
INSERT INTO clients VALUES {', '.join(f"('{c}')" for c in clients)};
INSERT INTO {s.items} VALUES {', '.join(orders)};
SELECT c.name, {count} AS n
FROM clients c
{join} {s.items} o ON o.client = c.name
{where}GROUP BY c.name
ORDER BY c.name;"""
    return Built(code, f"Сколько записей «{s.unit}» у каждого клиента? Что вернёт запрос?")


LEFT_JOIN = Template(
    "sql_left_join", "LEFT JOIN и COUNT", ["data", "backend"], "sql", "output",
    ["sql_joins", "sql_nulls"], 0.2,
    [Op("count_star", "COUNT(*) по внешнему соединению", "sql_nulls", 0.3),
     Op("where_on_right", "Фильтр по правой таблице в WHERE", "sql_joins", 0.6)],
    _left_join, ["count_star", "inner"],
)


# ---------- Оконные функции ----------
def _window(r: Random, ops, s: Skin, mis):
    clients = r.sample(NAMES, 2)
    rows = []
    for i in range(6):
        rows.append(f"({i + 1}, '{clients[i % 2]}', {r.choice([100, 200, 300])})")
    fn = "RANK()" if "rank_ties" in ops else "ROW_NUMBER()"
    if mis == "flip_fn":
        fn = "ROW_NUMBER()" if fn == "RANK()" else "RANK()"
    order = "amount DESC, id" if fn == "ROW_NUMBER()" else "amount DESC"
    part = "" if mis == "no_partition" else "PARTITION BY client "
    agg = "running" in ops
    if agg:
        select = f"SELECT id, SUM(amount) OVER ({part}ORDER BY id) AS v FROM {s.items} ORDER BY id;"
    else:
        select = f"""SELECT client, id FROM (
  SELECT client, id, {fn} OVER ({part}ORDER BY {order}) AS rn FROM {s.items}
) WHERE rn = 1 ORDER BY client, id;"""
    code = f"""CREATE TABLE {s.items} (id INTEGER, client TEXT, amount INTEGER);
INSERT INTO {s.items} VALUES {', '.join(rows)};
{select}"""
    return Built(code, f"Аналитик {s.domain} ищет крупнейшие записи «{s.unit}». Что вернёт запрос?")


WINDOW_FN = Template(
    "sql_window", "Оконные функции", ["data"], "sql", "output",
    ["sql_window"], 0.6,
    [Op("rank_ties", "RANK и равные значения", "sql_window", 0.4),
     Op("running", "Нарастающий итог", "sql_window", 0.2)],
    _window, ["flip_fn", "no_partition"], conflicts=[("rank_ties", "running")],
)


# ---------- Размножение строк при JOIN ----------
def _fanout(r: Random, ops, s: Skin, mis):
    clients = r.sample(NAMES, 2)
    orders = [f"({i + 1}, '{r.choice(clients)}', {r.randint(1, 5) * 100})" for i in range(4)]
    tags = [f"('{r.choice(clients)}', 'tag{i}')" for i in range(3)]
    if mis == "no_fanout" or "subquery" in ops:
        body = f"""SELECT c.name, (SELECT SUM(amount) FROM {s.items} o WHERE o.client = c.name) AS total
FROM clients c ORDER BY c.name;"""
    else:
        dist = "DISTINCT " if "distinct" in ops else ""
        body = f"""SELECT c.name, SUM({dist}o.amount) AS total
FROM clients c
JOIN {s.items} o ON o.client = c.name
JOIN tags t ON t.client = c.name
GROUP BY c.name ORDER BY c.name;"""
    code = f"""CREATE TABLE clients (name TEXT);
CREATE TABLE {s.items} (id INTEGER, client TEXT, amount INTEGER);
CREATE TABLE tags (client TEXT, tag TEXT);
INSERT INTO clients VALUES {', '.join(f"('{c}')" for c in clients)};
INSERT INTO {s.items} VALUES {', '.join(orders)};
INSERT INTO tags VALUES {', '.join(tags)};
{body}"""
    return Built(code, "Сумма по клиентам после соединения таблиц. Что вернёт запрос?")


FANOUT = Template(
    "sql_join_fanout", "Размножение строк при JOIN", ["data", "backend"], "sql", "output",
    ["sql_joins", "sql_aggregation"], 0.9,
    [Op("distinct", "SUM(DISTINCT …)", "sql_aggregation", 0.3),
     Op("subquery", "Коррелированный подзапрос", "sql_joins", -0.5)],
    _fanout, ["no_fanout"], conflicts=[("distinct", "subquery")],
)

SQL_TEMPLATES = [GROUP, LEFT_JOIN, WINDOW_FN, FANOUT]
