"""А — антислив: «фирменный соус».

1) Канарейки: ответ к ЧУЖОМУ варианту того же шаблона — доказательство списывания
   и указание на источник утечки (вариант, чей ответ «утёк»).
2) Person-fit (индекс lz): трудные задания решены, лёгкие провалены — аномалия.
3) Аномальная скорость ответа.
"""
import math

from .cat import p_correct


def canary_check(answer_label: str, own: dict, others: list[dict]) -> dict | None:
    """own/others: {"variant_id", "template_id", "correct_label", "candidate_id"?}."""
    if answer_label == own["correct_label"]:
        return None
    for o in others:
        if o["template_id"] == own["template_id"] and o["variant_id"] != own["variant_id"] \
                and answer_label == o["correct_label"]:
            return {"type": "canary", "source_variant": o["variant_id"],
                    "source_candidate": o.get("candidate_id"),
                    "message": "Ответ совпал с правильным ответом чужого варианта"}
    return None


def person_fit_lz(theta: float, items: list[dict]) -> float:
    """Стандартизованный индекс lz (Drasgow). Сильно отрицательный (< −2) — подозрительный профиль ответов."""
    l0 = e = v = 0.0
    for it in items:
        p = p_correct(theta, it["b"], 1 / it.get("n_options", 4))
        p = min(max(p, 1e-6), 1 - 1e-6)
        u = 1 if it["correct"] else 0
        l0 += u * math.log(p) + (1 - u) * math.log(1 - p)
        e += p * math.log(p) + (1 - p) * math.log(1 - p)
        v += p * (1 - p) * math.log(p / (1 - p)) ** 2
    return (l0 - e) / math.sqrt(v) if v > 0 else 0.0


def speed_flags(items: list[dict], min_seconds: float = 6.0) -> list[int]:
    """Индексы правильных ответов на трудные задания быстрее min_seconds."""
    return [i for i, it in enumerate(items)
            if it["correct"] and it.get("seconds") is not None and it["seconds"] < min_seconds and it["b"] > 0.5]


def session_report(theta: float, items: list[dict]) -> dict:
    lz = person_fit_lz(theta, items)
    fast = speed_flags(items)
    canaries = [it["canary"] for it in items if it.get("canary")]
    suspicious = bool(canaries) or lz < -2.0 or len(fast) >= 3
    return {"lz": round(lz, 2), "fast_answers": fast, "canaries": canaries, "suspicious": suspicious,
            "action": "Уточняющие вопросы по решению (ИИ-интервью)" if suspicious else None}
