"""Сборка уникального варианта: лаваш (шаблон) + начинка (мутации) + обёртка (сюжет) + соус (канарейка).

Правильный ответ и дистракторы получаются ИСПОЛНЕНИЕМ кода:
  * ответ — вывод самого варианта;
  * дистракторы — выводы «ошибочных ментальных моделей» шаблона и вариантов,
    где кандидат «не заметил» одну из мутаций.
"""
import hashlib
import re
from random import Random

from .runner import execute
from .templates import CATALOG, SKINS, Template, difficulty, ingredients_of, op_combos


class InvalidVariant(Exception):
    pass


def variant_id(template_id: str, seed: int, ops) -> str:
    """Фирменный «соус»: отпечаток варианта, по нему находится источник утечки."""
    h = hashlib.sha1(f"{template_id}|{seed}|{','.join(sorted(ops))}".encode()).hexdigest()
    return h[:12]


def _numeric_neighbours(answer: str, r: Random) -> list[str]:
    m = re.fullmatch(r"-?\d+(\.\d+)?", answer)
    if not m:
        return []
    v = float(answer)
    is_int = m.group(1) is None
    deltas = [1, -1, 2, -2, 10] if is_int else [0.05, -0.05, 0.1, -0.1]
    r.shuffle(deltas)
    out = []
    for d in deltas:
        x = v + d
        out.append(str(int(x)) if is_int else str(round(x, 2)))
    return out


def _structural_neighbours(answer: str, r: Random) -> list[str]:
    """Для табличных и списочных ответов: потерянная строка, переставленные элементы."""
    out = []
    nl = chr(10)
    rows = answer.split(nl)
    if len(rows) > 1:
        out.append(nl.join(rows[:-1]))
        out.append(nl.join(rows[1:]))
        out.append(nl.join(reversed(rows)))
    for sep in (", ", " ", ","):
        parts = answer.split(sep)
        if len(parts) > 2 and nl not in answer:
            sw = parts[:]
            sw[0], sw[1] = sw[1], sw[0]
            out.append(sep.join(sw))
            out.append(sep.join(reversed(parts)))
            break
    r.shuffle(out)
    return out


def _valid_combo(t: Template, combo) -> bool:
    return not any(a in combo and b in combo for a, b in t.conflicts) and len(combo) <= t.max_ops


def build_variant(template_id: str, seed: int, ops: list[str] | tuple = ()) -> dict:
    t = CATALOG[template_id]
    ops = tuple(sorted(ops))
    if ops not in [tuple(sorted(c)) for c in op_combos(t)]:
        raise InvalidVariant(f"недопустимый набор операторов {ops} для {template_id}")
    skin = SKINS[seed % len(SKINS)]
    built = t.build(Random(seed), frozenset(ops), skin, None)
    rng = Random(seed * 7919 + 1)

    if t.kind == "output":
        answer = execute(t.language, built.code)
        if answer.startswith("Ошибка") and t.language != "javascript":
            raise InvalidVariant(f"вариант не исполняется: {answer}")
        distractors: list[str] = []

        def add(x: str):
            if x and x != answer and x not in distractors and len(distractors) < 3:
                distractors.append(x)

        for m in t.misconceptions:
            add(execute(t.language, t.build(Random(seed), frozenset(ops), skin, m).code))
        # «Не заметил мутацию»: тот же сюжет без одного из операторов
        for o in ops:
            alt = tuple(x for x in ops if x != o)
            add(execute(t.language, t.build(Random(seed), frozenset(alt), skin, None).code))
        # «Додумал мутацию»: добавлен оператор, которого нет
        for o in t.ops:
            alt = tuple(sorted(ops + (o.id,)))
            if o.id not in ops and _valid_combo(t, alt):
                add(execute(t.language, t.build(Random(seed), frozenset(alt), skin, None).code))
        for x in _numeric_neighbours(answer, rng) + _structural_neighbours(answer, rng):
            add(x)
        if len(distractors) < 2:
            raise InvalidVariant("недостаточно правдоподобных дистракторов")
        labels = [answer] + distractors
        rng.shuffle(labels)
        options = [{"id": chr(65 + i), "label": lab} for i, lab in enumerate(labels)]
        correct = options[labels.index(answer)]["id"]
    else:
        out_bug = execute(t.language, built.code)
        out_fix = execute(t.language, built.fixed_code)
        if out_bug == out_fix:
            raise InvalidVariant("дефект не проявляется на тестовых данных")
        code_lines = built.code.split("\n")
        lo, hi = built.lines_range
        pool = [i for i in range(lo, hi + 1)
                if i != built.bug_line and code_lines[i - 1].strip() not in ("", "}", "{", "default:")]
        others = rng.sample(pool, min(3, len(pool)))
        nums = sorted(others + [built.bug_line])
        options = [{"id": chr(65 + i), "label": f"Строка {n}: {code_lines[n - 1].strip()}"} for i, n in enumerate(nums)]
        correct = options[nums.index(built.bug_line)]["id"]
        answer = options[nums.index(built.bug_line)]["label"]

    return {
        "variant_id": variant_id(template_id, seed, ops),
        "template_id": template_id,
        "template_title": t.title,
        "seed": seed,
        "ops": list(ops),
        "ops_titles": [t.op(o).title for o in ops],
        "skin": skin.id,
        "language": t.language,
        "kind": t.kind,
        "prompt": built.prompt,
        "code": built.code,
        "options": options,
        "correct_option": correct,
        "correct_label": answer,
        "b": round(difficulty(t, ops), 3),
        "ingredients": ingredients_of(t, ops),
    }


def build_variant_safe(template_id: str, seed: int, ops, attempts: int = 6) -> dict:
    """Если вариант с данным seed невалиден — пробуем соседние seed (та же начинка)."""
    last = None
    for k in range(attempts):
        try:
            return build_variant(template_id, seed + k * 104729, ops)
        except InvalidVariant as e:
            last = e
    raise InvalidVariant(str(last))
