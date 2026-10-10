"""Маринад заказа: собственная языковая модель «описание потребности → рецепт».

Без внешних API и без GPU: хешированные признаки (слова, пары слов, символьные 3–5-граммы —
они ловят русскую морфологию: «идемпотентн-ость/-ый/-о», «асинхронщин-а») и три линейные головы:
  * специализация — softmax (backend / frontend / data);
  * грейд — softmax (intern / junior / middle / senior);
  * ингредиенты — 19 независимых сигмоид: «этот навык работодатель явно заказывает».
Обучение — Adam по мини-батчам. Корпус — сгенерированные описания (training/vacancy_gen.py)
плюс правки рецептов, которые работодатели делают ползунками в интерфейсе: каждая правка —
размеченный пример «текст → правильный рецепт».

Веса хранятся в открытом JSON (float16 → base64), модель весит ~0,6 МБ и работает за миллисекунды.
"""
from __future__ import annotations

import base64
import re
import zlib

import numpy as np

from ..ingredients import INGREDIENTS, SPECIALIZATIONS

DIM = 1 << 13
SPECS = list(SPECIALIZATIONS)
GRADES = ["intern", "junior", "middle", "senior"]
INGS = list(INGREDIENTS)
WORD = re.compile(r"[a-zа-я0-9+#]+(?:[.\-][a-zа-я0-9]+)*")


def tokens(text: str) -> list[str]:
    t = text.lower().replace("ё", "е")
    return WORD.findall(t)


def _h(s: str) -> int:
    return zlib.crc32(s.encode("utf-8")) & (DIM - 1)


def featurize(text: str) -> np.ndarray:
    """Индексы хешированных признаков (с повторами — они складываются как частоты)."""
    toks = tokens(text)
    idx = []
    for i, w in enumerate(toks):
        idx.append(_h("w:" + w))
        if i + 1 < len(toks):
            idx.append(_h("b:" + w + " " + toks[i + 1]))
        ww = f"<{w}>"
        for n in (3, 4, 5):
            for j in range(len(ww) - n + 1):
                idx.append(_h(f"c{n}:" + ww[j:j + n]))
    return np.array(idx, dtype=np.int64)


def _dense(batch: list[np.ndarray]) -> np.ndarray:
    X = np.zeros((len(batch), DIM), dtype=np.float32)
    for i, ix in enumerate(batch):
        if len(ix):
            np.add.at(X[i], ix, 1.0)
            X[i] /= np.sqrt(len(ix))   # нормировка на длину текста
    return X


def _softmax(z):
    z = z - z.max(1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(1, keepdims=True)


def train(examples: list[dict], epochs: int = 6, lr: float = 0.02, l2: float = 1e-6, batch: int = 64,
          seed: int = 0, log=None) -> dict:
    """examples: [{"text", "specialization", "grade", "ingredients": [список ключевых], "weight"?}]."""
    rng = np.random.default_rng(seed)
    feats = [featurize(e["text"]) for e in examples]
    ys = np.array([SPECS.index(e["specialization"]) for e in examples])
    yg = np.array([GRADES.index(e["grade"]) if e.get("grade") in GRADES else -1 for e in examples])
    yi = np.zeros((len(examples), len(INGS)), dtype=np.float32)
    for k, e in enumerate(examples):
        for ing in e["ingredients"]:
            if ing in INGS:
                yi[k, INGS.index(ing)] = 1
    sw = np.array([e.get("weight", 1.0) for e in examples], dtype=np.float32)
    heads = {"spec": len(SPECS), "grade": len(GRADES), "ing": len(INGS)}
    W = {h: np.zeros((DIM, k), dtype=np.float32) for h, k in heads.items()}
    B = {h: np.zeros(k, dtype=np.float32) for h, k in heads.items()}
    # априорная частота ингредиентов — в смещение (ускоряет сходимость)
    B["ing"] = np.log((yi.mean(0) + 1e-3) / (1 - yi.mean(0) + 1e-3)).astype(np.float32)
    m = {h: np.zeros_like(W[h]) for h in W}
    v = {h: np.zeros_like(W[h]) for h in W}
    t = 0
    n = len(examples)
    for ep in range(epochs):
        order = rng.permutation(n)
        tot_loss = 0.0
        for s in range(0, n, batch):
            ids = order[s:s + batch]
            X = _dense([feats[i] for i in ids])
            wts = sw[ids][:, None]
            t += 1
            grads = {}
            # специализация
            P = _softmax(X @ W["spec"] + B["spec"])
            Y = np.eye(len(SPECS), dtype=np.float32)[ys[ids]]
            G = (P - Y) * wts
            grads["spec"] = (X.T @ G, G.sum(0))
            tot_loss += float(-(np.log(P[np.arange(len(ids)), ys[ids]] + 1e-9) * wts[:, 0]).sum())
            # грейд (примеры без грейда не учат эту голову)
            P = _softmax(X @ W["grade"] + B["grade"])
            has = yg[ids] >= 0
            Y = np.zeros_like(P)
            Y[has, yg[ids][has]] = 1
            G = (P - Y) * wts * has[:, None]
            grads["grade"] = (X.T @ G, G.sum(0))
            # ингредиенты
            P = 1 / (1 + np.exp(-(X @ W["ing"] + B["ing"])))
            G = (P - yi[ids]) * wts
            grads["ing"] = (X.T @ G, G.sum(0))
            for h, (gw, gb) in grads.items():
                gw = gw / len(ids) + l2 * W[h]
                m[h] = 0.9 * m[h] + 0.1 * gw
                v[h] = 0.999 * v[h] + 0.001 * gw * gw
                W[h] -= lr * (m[h] / (1 - 0.9 ** t)) / (np.sqrt(v[h] / (1 - 0.999 ** t)) + 1e-8)
                B[h] -= lr * gb / len(ids)
        if log:
            log(f"эпоха {ep + 1}/{epochs}: loss(спец.) = {tot_loss / n:.4f}")
    return export(W, B, n_examples=n)


def export(W, B, **meta) -> dict:
    enc = lambda a: base64.b64encode(a.astype(np.float16).tobytes()).decode()  # noqa: E731
    return {"format": "proof-textmodel/1", "dim": DIM, "specs": SPECS, "grades": GRADES, "ingredients": INGS,
            "hash": "crc32 & (dim-1); признаки: w:слово, b:пара слов, cN:символьная N-грамма слова в <…>",
            "W": {h: enc(W[h]) for h in W}, "B": {h: B[h].round(4).tolist() for h in B}, **meta}


_decoded: dict[int, tuple[dict, dict]] = {}


def _weights(model: dict):
    key = id(model)
    if key not in _decoded:
        W = {h: np.frombuffer(base64.b64decode(s), dtype=np.float16).astype(np.float32).reshape(model["dim"], -1)
             for h, s in model["W"].items()}
        B = {h: np.array(b, dtype=np.float32) for h, b in model["B"].items()}
        _decoded.clear()
        _decoded[key] = (W, B)
    return _decoded[key]


def predict(model: dict, text: str) -> dict:
    W, B = _weights(model)
    X = _dense([featurize(text)])
    ps = _softmax(X @ W["spec"] + B["spec"])[0]
    pg = _softmax(X @ W["grade"] + B["grade"])[0]
    pi = 1 / (1 + np.exp(-(X @ W["ing"] + B["ing"])))[0]
    return {"specialization": {s: round(float(p), 3) for s, p in zip(model["specs"], ps)},
            "grade": {g: round(float(p), 3) for g, p in zip(model["grades"], pg)},
            "ingredients": {i: round(float(p), 3) for i, p in zip(model["ingredients"], pi)}}


def evidence(model: dict, text: str, ingredient: str, top: int = 3) -> list[str]:
    """Слова текста, сильнее всего «проголосовавшие» за ингредиент (объяснение рецепта)."""
    W, _ = _weights(model)
    col = model["ingredients"].index(ingredient)
    seen, scored = set(), []
    for w in tokens(text):
        if w in seen or len(w) < 3:
            continue
        seen.add(w)
        ix = featurize(w)
        scored.append((float(W["ing"][ix, col].sum()) / np.sqrt(len(ix)), w))
    scored.sort(reverse=True)
    best = scored[0][0] if scored else 0.0
    return [w for s, w in scored[:top] if s > 0.6 and s >= 0.5 * best]


def top_ngrams(model: dict, ingredient: str, vocab: list[str], top: int = 8) -> list[str]:
    """Слова из словаря, которые модель сильнее всего связывает с ингредиентом (для «паспорта модели»)."""
    W, _ = _weights(model)
    col = model["ingredients"].index(ingredient)
    sc = []
    for w in vocab:
        ix = featurize(w)
        sc.append((float(W["ing"][ix, col].sum()) / np.sqrt(len(ix)), w))
    sc.sort(reverse=True)
    best = sc[0][0] if sc else 0.0
    return [w for s, w in sc[:top] if s > 0.6 and s >= 0.5 * best]
