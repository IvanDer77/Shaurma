"""Р — рейтинг на вертеле: Glicko-2 по каждому ингредиенту.

Кандидат «играет матчи» против задач. Рейтинг задачи выводится из её сложности b
(шкала Glicko: r = 1500 + 173.7178·b). Без активности RD растёт — «мясо остывает»,
и кандидат опускается в выдаче; регулярные задачи снова делают профиль «горячим».
"""
import math
from datetime import datetime, timezone

SCALE = 173.7178
DEFAULT_R = 1500.0
DEFAULT_RD = 350.0
DEFAULT_VOL = 0.06
TAU = 0.5
ITEM_RD = 60.0          # задачи откалиброваны: небольшая неопределённость
PERIOD_DAYS = 30        # «рейтинговый период» для остывания


def item_rating(b: float) -> float:
    return DEFAULT_R + SCALE * b


def _g(phi):
    return 1 / math.sqrt(1 + 3 * phi ** 2 / math.pi ** 2)


def _E(mu, mu_j, phi_j):
    return 1 / (1 + math.exp(-_g(phi_j) * (mu - mu_j)))


def update(r: float, rd: float, vol: float, games: list[tuple[float, float, float]]) -> tuple[float, float, float]:
    """Стандартный шаг Glicko-2. games: [(рейтинг соперника, RD соперника, результат 0..1)]."""
    mu, phi = (r - DEFAULT_R) / SCALE, rd / SCALE
    if not games:
        phi_star = math.sqrt(phi ** 2 + vol ** 2)
        return r, min(phi_star * SCALE, DEFAULT_RD), vol
    v_inv = 0.0
    delta_sum = 0.0
    for rj, rdj, s in games:
        mu_j, phi_j = (rj - DEFAULT_R) / SCALE, rdj / SCALE
        e = _E(mu, mu_j, phi_j)
        g = _g(phi_j)
        v_inv += g ** 2 * e * (1 - e)
        delta_sum += g * (s - e)
    v = 1 / v_inv
    delta = v * delta_sum

    # Новая волатильность (алгоритм Иллинойса из статьи Гликмана)
    a = math.log(vol ** 2)

    def f(x):
        ex = math.exp(x)
        return ex * (delta ** 2 - phi ** 2 - v - ex) / (2 * (phi ** 2 + v + ex) ** 2) - (x - a) / TAU ** 2

    A = a
    if delta ** 2 > phi ** 2 + v:
        B = math.log(delta ** 2 - phi ** 2 - v)
    else:
        k = 1
        while f(a - k * TAU) < 0:
            k += 1
        B = a - k * TAU
    fA, fB = f(A), f(B)
    for _ in range(100):
        if abs(B - A) < 1e-6:
            break
        C = A + (A - B) * fA / (fB - fA)
        fC = f(C)
        if fC * fB <= 0:
            A, fA = B, fB
        else:
            fA /= 2
        B, fB = C, fC
    new_vol = math.exp(A / 2)

    phi_star = math.sqrt(phi ** 2 + new_vol ** 2)
    new_phi = 1 / math.sqrt(1 / phi_star ** 2 + 1 / v)
    new_mu = mu + new_phi ** 2 * delta_sum
    return new_mu * SCALE + DEFAULT_R, min(new_phi * SCALE, DEFAULT_RD), new_vol


def cooled_rd(rd: float, vol: float, last_update_iso: str | None, now: datetime | None = None) -> float:
    """«Мясо остывает»: RD растёт с каждым периодом без активности."""
    if not last_update_iso:
        return rd
    now = now or datetime.now(timezone.utc)
    last = datetime.fromisoformat(last_update_iso.replace("Z", "+00:00"))
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    periods = max(0.0, (now - last).total_seconds() / 86400 / PERIOD_DAYS)
    phi = rd / SCALE
    return min(math.sqrt(phi ** 2 + vol ** 2 * periods * 25) * SCALE, DEFAULT_RD)


def apply_session(ratings: dict, results: list[dict], now_iso: str) -> dict:
    """Пакетное обновление по итогам сессии (тест или регулярная задача).

    ratings: {ingredient: {"r", "rd", "vol", "updated_at"}}
    results: [{"b", "ingredients": [...], "correct": bool}]
    """
    games: dict[str, list] = {}
    for res in results:
        for ing in res["ingredients"]:
            games.setdefault(ing, []).append((item_rating(res["b"]), ITEM_RD, 1.0 if res["correct"] else 0.0))
    out = dict(ratings)
    for ing, gs in games.items():
        cur = ratings.get(ing) or {"r": DEFAULT_R, "rd": DEFAULT_RD, "vol": DEFAULT_VOL, "updated_at": None}
        rd0 = cooled_rd(cur["rd"], cur["vol"], cur.get("updated_at"))
        r, rd, vol = update(cur["r"], rd0, cur["vol"], gs)
        out[ing] = {"r": round(r, 1), "rd": round(rd, 1), "vol": round(vol, 5), "updated_at": now_iso}
    return out


# ---------- Достижения ФСП как внешние подтверждённые матчи ----------
LEVEL_RATING = {"city": 1450, "regional": 1550, "federal_district": 1620, "national": 1720, "international": 1850}
DISCIPLINE_INGREDIENTS = {
    "algorithmic": ["complexity", "edge_cases", "code_reading"],
    "product": ["api_contracts", "debugging", "state_mutability", "sql_aggregation"],
    "security": ["debugging", "edge_cases", "api_contracts"],
    "robotics": ["concurrency", "debugging", "edge_cases"],
    "uav": ["concurrency", "complexity", "debugging"],
}


def fsp_games(achievements: list[dict]) -> list[dict]:
    """Перевод результатов соревнований ФСП в «матчи» по ингредиентам дисциплины.

    Место в верхней части протокола — победа над «соперником» уровня соревнования,
    участие без призового места — ничья с соперником уровнем ниже.
    """
    results = []
    for a in achievements:
        base = LEVEL_RATING.get(a.get("level", "city"), 1450)
        place = a.get("place") or 999
        total = max(a.get("participants") or 50, 1)
        pct = place / total
        if place <= 3:
            score, opp = 1.0, base + 60
        elif pct <= 0.2:
            score, opp = 1.0, base
        elif pct <= 0.5:
            score, opp = 0.5, base
        else:
            score, opp = 0.5, base - 120
        for ing in DISCIPLINE_INGREDIENTS.get(a.get("discipline", "algorithmic"), ["code_reading"]):
            results.append({"opp": opp, "score": score, "ingredient": ing})
    return results


def apply_fsp(ratings: dict, achievements: list[dict], now_iso: str) -> dict:
    games: dict[str, list] = {}
    for g in fsp_games(achievements):
        games.setdefault(g["ingredient"], []).append((g["opp"], 80.0, g["score"]))
    out = dict(ratings)
    for ing, gs in games.items():
        cur = ratings.get(ing) or {"r": DEFAULT_R, "rd": DEFAULT_RD, "vol": DEFAULT_VOL, "updated_at": None}
        r, rd, vol = update(cur["r"], cur["rd"], cur["vol"], gs)
        out[ing] = {"r": round(r, 1), "rd": round(rd, 1), "vol": round(vol, 5), "updated_at": now_iso}
    return out


def conservative(entry: dict | None, now: datetime | None = None) -> float:
    """μ − 2·RD с учётом остывания: «мы уверены, что кандидат не слабее этого»."""
    if not entry:
        return DEFAULT_R - 2 * DEFAULT_RD
    rd = cooled_rd(entry["rd"], entry["vol"], entry.get("updated_at"), now)
    return entry["r"] - 2 * rd
