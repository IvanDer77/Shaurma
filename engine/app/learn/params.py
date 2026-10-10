"""Активные параметры теста: обученные «Маринадом», если калибровка есть, иначе экспертные."""
from . import store

A_EXPERT = 1.7
_override: dict | None = None
_use_override = False


def set_override(cal: dict | None, enabled: bool = True) -> None:
    """Для симуляции «года платформы»: параметры в памяти вместо файла (None = экспертные)."""
    global _override, _use_override
    _override, _use_override = cal, enabled


def calibration() -> dict | None:
    if _use_override:
        return _override
    cal = store.load("calibration")
    return cal if cal and cal.get("active", True) else None


def b0(template) -> float:
    cal = calibration()
    return cal["b0"].get(template.id, template.b0) if cal else template.b0


def eta(template, op_id: str) -> float:
    cal = calibration()
    if cal:
        v = cal["eta"].get(f"{template.id}:{op_id}")
        if v is not None:
            return v
    return template.op(op_id).eta


def a(template_id: str | None) -> float:
    cal = calibration()
    if cal and template_id:
        return cal["a"].get(template_id, A_EXPERT)
    return A_EXPERT
