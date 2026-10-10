"""Детектор «чёрствого лаваша»: задание, которое внезапно стало легче, чем было.

Банк шаблонов ШАУРМЫ открыт — ответы не утекают (варианты уникальны), но может «утечь приём»:
разбор трюка начинки завирусился в Telegram, и начинка перестаёт быть ловушкой.

Для каждого ответа считается остаток относительно текущей модели теста
    z = (u − P(θ_кандидата, b)) / √(P(1 − P)).
У любой начинки есть постоянное небольшое несоответствие модели (навыки многомерны, оценка θ
сжимается к априорному среднему), поэтому сравнивать остатки с нулём нельзя — за год накопится
ложная тревога. Детектор ищет ИЗМЕНЕНИЕ: после разогрева (WARMUP ответов) он копит
одностороннюю CUSUM-статистику по отклонению от собственного прошлого среднего остатка начинки
    S = max(0, S + (z − z̄_прошлое) / sd − k).
S > h — тревога: «лаваш почерствел». Величина изменения оценивается как разница сдвигов
сложности (MLE) в свежем окне и в предыдущей истории. k и h подобраны в симуляции «года»
(engine/training/marinate.py): на честных начинках за год тревог нет, вирусный разбор ловится
примерно за 100 ответов на эту начинку.
"""
from __future__ import annotations

import math
from collections import defaultdict, deque

K = 0.3        # допуск (≈ половина ожидаемого сдвига остатка при «утёкшем приёме», ~0,6σ)
H = 15.0       # порог тревоги: 0 ложных тревог за год симуляции на ~100 начинках
WARMUP = 150   # ответов на ключ до начала слежения (оценка «нормы»)
WINDOW = 80    # свежее окно для оценки величины изменения
HISTORY = 400  # предыдущая история для сравнения


def _p(theta: float, b: float, c: float, a: float) -> float:
    return c + (1 - c) / (1 + math.exp(-a * (theta - b)))


def _shift_mle(rows) -> float:
    """Δ, на который нужно уменьшить сложность, чтобы объяснить ответы (Ньютон по одному параметру)."""
    d = 0.0
    for _ in range(12):
        g = h = 0.0
        for theta, b, c, a, u in rows:
            s = 1 / (1 + math.exp(-a * (theta - (b - d))))
            p = c + (1 - c) * s
            dp = (1 - c) * s * (1 - s) * a
            g += (u - p) / max(p * (1 - p), 1e-6) * dp
            h += dp * dp / max(p * (1 - p), 1e-6)
        if h <= 0:
            break
        step = g / (h + 0.05)                   # слабая регуляризация: у лёгких заданий информация мала, сильная прижала бы оценку к нулю
        d += max(-0.5, min(0.5, step))
        if abs(step) < 1e-3:
            break
    return d


class _Key:
    __slots__ = ("n", "mean", "m2", "S", "max_S", "alarm_at", "alarm_ts", "rows", "alarm_shift")

    def __init__(self):
        self.n, self.mean, self.m2, self.S, self.max_S = 0, 0.0, 0.0, 0.0, 0.0
        self.alarm_at = self.alarm_ts = self.alarm_shift = None
        self.rows = deque(maxlen=HISTORY + WINDOW)

    def push(self, z: float, row, ts) -> float:
        if self.n >= WARMUP:
            sd = math.sqrt(self.m2 / (self.n - 1)) or 1.0
            self.S = max(0.0, self.S + (z - self.mean) / sd - K)
            self.max_S = max(self.max_S, self.S)
            if self.S > H and self.alarm_at is None:
                self.alarm_at, self.alarm_ts = self.n + 1, ts
                self.rows.append(row)
                self.alarm_shift = self.easier_by()   # величина изменения — в момент тревоги: свежее окно против истории до него
                self.rows.pop()
        # прошлое среднее и разброс (Велфорд) — обновляем ПОСЛЕ сравнения
        self.n += 1
        delta = z - self.mean
        self.mean += delta / self.n
        self.m2 += delta * (z - self.mean)
        self.rows.append(row)
        return self.S

    def easier_by(self) -> float | None:
        rows = list(self.rows)
        if len(rows) < WINDOW + 50:
            return None
        return round(_shift_mle(rows[-WINDOW:]) - _shift_mle(rows[:-WINDOW]), 2)


def _residual(it, a_of, b_of):
    c = 1 / it.get("n_options", 4)
    a = a_of(it["template_id"])
    b = b_of(it["template_id"], it.get("ops") or []) if b_of else it["b"]
    p = min(max(_p(it["theta"], b, c, a), 1e-4), 1 - 1e-4)
    u = 1.0 if it["correct"] else 0.0
    return (u - p) / math.sqrt(p * (1 - p)), (it["theta"], b, c, a, u)


def _keys(it):
    return [it["template_id"]] + [f"{it['template_id']}:{o}" for o in it.get("ops") or []]


def scan(items: list[dict], a_of=None, b_of=None, reset: dict | None = None) -> dict:
    """items: по времени, [{"template_id", "ops", "b", "correct", "theta", "n_options"?, "ts"?}].

    a_of(template_id) -> дискриминация; b_of(template_id, ops) -> сложность по текущей модели;
    reset — {ключ: ts}: после тревоги и перекалибровки история ключа начинается заново.
    """
    a_of = a_of or (lambda _t: 1.7)
    reset = reset or {}
    state: dict[str, _Key] = defaultdict(_Key)
    for i, it in enumerate(items):
        if it.get("theta") is None or it.get("correct") is None:
            continue
        z, row = _residual(it, a_of, b_of)
        ts = it.get("ts", i)
        for k in _keys(it):
            if k in reset and ts <= reset[k]:
                continue
            state[k].push(z, row, ts)
    out = []
    for k, s in state.items():
        status = "alarm" if s.alarm_at is not None else ("watch" if s.S > H / 2 else ("warmup" if s.n < WARMUP else "ok"))
        out.append({"key": k, "kind": "op" if ":" in k else "template", "n": s.n, "mean_residual": round(s.mean, 3),
                    "cusum": round(s.S, 2), "cusum_max": round(s.max_S, 2), "status": status,
                    "alarm_after_n": s.alarm_at, "alarm_ts": s.alarm_ts,
                    "easier_by": s.alarm_shift if status == "alarm" else (s.easier_by() if status == "watch" else None)})
    out.sort(key=lambda r: -r["cusum_max"])
    return {"k": K, "h": H, "warmup": WARMUP, "n_items": len(items),
            "alarms": [r for r in out if r["status"] == "alarm"], "watch": [r for r in out if r["status"] == "watch"], "keys": out}


def cusum_trace(items: list[dict], key: str, a_of=None, b_of=None) -> tuple[list[float], list]:
    """Траектория S по одному ключу и моменты ответов — для графика."""
    a_of = a_of or (lambda _t: 1.7)
    s, trace, ts = _Key(), [], []
    for i, it in enumerate(items):
        if key not in _keys(it) or it.get("theta") is None:
            continue
        z, row = _residual(it, a_of, b_of)
        trace.append(round(s.push(z, row, it.get("ts", i)), 3))
        ts.append(it.get("ts", i))
    return trace, ts
