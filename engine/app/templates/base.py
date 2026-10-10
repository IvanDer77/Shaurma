"""Каркас шаблонов («лаваш») и операторов мутации («начинка»)."""
from dataclasses import dataclass, field
from random import Random
from typing import Callable, Optional


@dataclass(frozen=True)
class Op:
    """Оператор мутации. Добавляет ингредиент и известную долю сложности η (LLTM)."""
    id: str
    title: str
    ingredient: str
    eta: float


@dataclass(frozen=True)
class Skin:
    """Обёртка («шаурма / шаверма»): тот же алгоритм — другой сюжет и имена."""
    id: str
    domain: str      # родительный падеж: «сервиса доставки»
    where: str       # предложный с предлогом: «в сервисе доставки»
    items: str       # имя коллекции в коде: orders
    item: str        # имя элемента в коде: order
    unit: str        # «заказы»


SKINS = [
    Skin("logistics", "сервиса доставки", "в сервисе доставки", "orders", "order", "заказы"),
    Skin("bank", "платёжного сервиса банка", "в платёжном сервисе банка", "payments", "payment", "платежи"),
    Skin("fsp", "системы турниров ФСП", "в системе турниров ФСП", "submissions", "submission", "посылки решений"),
    Skin("support", "службы поддержки", "в службе поддержки", "tickets", "ticket", "обращения"),
    Skin("analytics", "сервиса аналитики событий", "в сервисе аналитики событий", "events", "event", "события"),
]


@dataclass
class Built:
    code: str
    prompt: str
    bug_line: Optional[int] = None       # для kind="bug": номер строки (1-based)
    fixed_code: Optional[str] = None     # для kind="bug": исправленный код
    lines_range: Optional[tuple[int, int]] = None  # для kind="bug": строки, из которых строятся варианты ответа (1-based, включительно)


# build(rng, ops, skin, misconception) -> Built
BuildFn = Callable[[Random, frozenset, Skin, Optional[str]], Built]


@dataclass
class Template:
    id: str
    title: str
    specs: list[str]
    language: str            # python | javascript | sql
    kind: str                # output | bug
    ingredients: list[str]   # базовые ингредиенты шаблона
    b0: float                # базовая сложность (логиты)
    ops: list[Op]
    build: BuildFn
    misconceptions: list[str] = field(default_factory=list)  # для output: альтернативные «ментальные модели»
    max_ops: int = 2
    conflicts: list[tuple[str, str]] = field(default_factory=list)

    def op(self, oid: str) -> Op:
        return next(o for o in self.ops if o.id == oid)


def ints(r: Random, n: int, lo: int, hi: int) -> list[int]:
    return [r.randint(lo, hi) for _ in range(n)]
