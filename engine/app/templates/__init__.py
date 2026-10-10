from itertools import combinations

from .base import SKINS, Op, Skin, Template
from .bug_tpl import BUG_TEMPLATES
from .easy_tpl import EASY_TEMPLATES
from .js_tpl import JS_TEMPLATES
from .python_tpl import PYTHON_TEMPLATES
from .sql_tpl import SQL_TEMPLATES

ALL_TEMPLATES: list[Template] = PYTHON_TEMPLATES + JS_TEMPLATES + SQL_TEMPLATES + BUG_TEMPLATES + EASY_TEMPLATES
CATALOG: dict[str, Template] = {t.id: t for t in ALL_TEMPLATES}


def op_combos(t: Template) -> list[tuple[str, ...]]:
    """Допустимые наборы операторов мутации («начинки») для шаблона."""
    ids = [o.id for o in t.ops]
    sizes = [1] if t.kind == "bug" else range(0, t.max_ops + 1)
    out = []
    for k in sizes:
        for combo in combinations(ids, k):
            if any(a in combo and b in combo for a, b in t.conflicts):
                continue
            out.append(combo)
    return out


def difficulty(t: Template, ops) -> float:
    """LLTM: сложность варианта = база шаблона + Σ η операторов.

    Значения — откалиброванные по ответам кандидатов («Маринад», app/learn), если калибровка есть,
    иначе экспертные из описания шаблона.
    """
    from ..learn import params
    return params.b0(t) + sum(params.eta(t, o) for o in ops)


def expert_difficulty(t: Template, ops) -> float:
    return t.b0 + sum(t.op(o).eta for o in ops)


def ingredients_of(t: Template, ops) -> list[str]:
    ing = list(t.ingredients)
    for o in ops:
        i = t.op(o).ingredient
        if i not in ing:
            ing.append(i)
    return ing


__all__ = ["ALL_TEMPLATES", "CATALOG", "SKINS", "Op", "Skin", "Template", "op_combos", "difficulty", "ingredients_of"]
