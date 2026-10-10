"""HTTP-эндпоинты «Маринада»: обучение на живых данных платформы (вызывает backend)."""
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import cat
from ..ingredients import SPECIALIZATIONS
from ..templates import ALL_TEMPLATES
from . import calibration as L_cal, drift as L_drift, ranker as L_rank, store as L_store, textmodel as L_text

router = APIRouter(prefix="/learn", tags=["Маринад"])
EVAL = Path(__file__).resolve().parents[2] / "training" / "needs_eval.json"
PROBE_WORDS = ["двойные", "списания", "дубли", "гонки", "блокировки", "параллельно", "легаси", "монолит", "падения",
               "когорты", "удержание", "пропуски", "соединения", "дисбаланс", "утечка", "вебсокеты", "котировки",
               "перерисовки", "хранилище", "типизация", "фильтры", "сводные", "ретраи", "контракты", "пагинация"]


def _version(prefix: str) -> str:
    return f"{prefix}-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"


@router.get("/status")
def status():
    """Паспорт моделей: какие версии активны, на чём обучены, насколько отошли от экспертных значений."""
    cal, rk, tm = L_store.load("calibration"), L_store.load("ranker"), L_store.load("textmodel")
    words = {}
    if tm:
        for ing in ("idempotency", "concurrency", "sql_window", "ml_metrics", "js_async", "code_reading"):
            words[ing] = L_text.top_ngrams(tm, ing, PROBE_WORDS, 4)
    return {
        "calibration": None if not cal else {
            "version": cal.get("version"), "source": L_store.source("calibration"), "saved_at": cal.get("saved_at"),
            "n_responses": cal.get("n_responses"), "n_persons": cal.get("n_persons"), "population": cal.get("population"),
            "holdout": cal.get("holdout"), **L_cal.shift_report(cal)},
        "ranker": None if not rk else {**L_rank.model_card(rk), "source": L_store.source("ranker"), "saved_at": rk.get("saved_at"),
                                       "n_fit": rk["fit"].get("n"), "n_accept": rk["accept"].get("n")},
        "textmodel": None if not tm else {"version": tm.get("version"), "source": L_store.source("textmodel"), "saved_at": tm.get("saved_at"),
                                          "trained_on": tm.get("trained_on"), "dim": tm.get("dim"), "learned_words": words},
        "drift": {"k": L_drift.K, "h": L_drift.H},
    }


class CompareReq(BaseModel):
    text: str


@router.post("/recipe-compare")
def recipe_compare(req: CompareReq):
    """Тот же текст — словарём правил и собственной моделью шаурматч_ (для витрины «попробуйте сами»)."""
    from .. import recipe
    text = req.text[:3000]
    return {"rules": recipe.parse_need(text, model=False), "model": recipe.parse_need(text)}


@router.get("/titles")
def titles():
    """Человеческие названия шаблонов и начинок (для графиков «Маринада»)."""
    return {"templates": {t.id: t.title for t in ALL_TEMPLATES},
            "ops": {f"{t.id}:{o.id}": o.title for t in ALL_TEMPLATES for o in t.ops}}


class LearnResponses(BaseModel):
    responses: list[dict]                      # [{"person", "template_id", "ops", "correct", "n_options"?, "ts"?}]
    reset_keys: dict[str, float] = {}          # «шаблон:начинка» → ts тревоги: более старые ответы на неё не учат модель
    activate: bool = True
    min_responses: int = 300


@router.post("/calibrate")
def calibrate(req: LearnResponses):
    """Перекалибровка теста. Новая версия включается, только если лучше объясняет ответы отложенных кандидатов."""
    rows = req.responses
    if req.reset_keys:
        rows = [r for r in rows if not any(f"{r['template_id']}:{o}" in req.reset_keys
                                           and r.get("ts", 0) <= req.reset_keys[f"{r['template_id']}:{o}"] for o in r.get("ops") or [])]
    if len(rows) < req.min_responses:
        return {"activated": False, "reason": f"мало данных: {len(rows)} из {req.min_responses} ответов", "n_responses": len(rows)}
    res = L_cal.gated_fit(rows, L_store.load("calibration"))
    params = {**res["params"], "version": _version("cal"), "holdout": res["holdout"], "active": True}
    activated = bool(req.activate and res["accept"])
    if activated:
        L_store.save("calibration", params)
    return {"activated": activated, "reason": None if res["accept"] else "новая версия не лучше текущей на отложенных кандидатах",
            "version": params["version"], "n_responses": len(rows), "holdout": res["holdout"], **L_cal.shift_report(params)}


class DriftReq(BaseModel):
    items: list[dict]                          # по времени: [{"template_id", "ops", "b", "correct", "theta", "ts"?}]
    reset_keys: dict[str, float] = {}          # начинки, по которым уже была тревога и перекалибровка


@router.post("/drift")
def drift(req: DriftReq):
    """Детектор «чёрствого лаваша»: какие шаблоны и начинки внезапно стали легче, чем должны."""
    from ..templates import CATALOG, difficulty
    known = [i for i in req.items if i.get("template_id") in CATALOG]
    res = L_drift.scan(known, cat.item_a, lambda t, ops: difficulty(CATALOG[t], ops), req.reset_keys)
    titles = {t.id: t.title for t in ALL_TEMPLATES}
    op_titles = {f"{t.id}:{o.id}": o.title for t in ALL_TEMPLATES for o in t.ops}
    for group in ("keys", "alarms", "watch"):
        for r in res[group]:
            r["title"] = op_titles.get(r["key"]) or titles.get(r["key"], r["key"])
            r["template_title"] = titles.get(r["key"].split(":")[0])
    res["keys"] = res["keys"][:20]
    return res


class RankerReq(BaseModel):
    invitations: list[dict]                    # [{"candidate", "recipe", "offer", "accepted": bool, "hired": bool | None}]
    min_accept: int = 30
    min_fit: int = 50                         # голову «Подойдёт» на десятке собеседований не переучиваем — шум


@router.post("/ranker")
def ranker(req: RankerReq):
    """Дообучение двустороннего ранжировщика на ответах кандидатов и итогах собеседований (L2 к тёплому старту)."""
    base = L_store.load("ranker")
    acc_x, acc_y, fit_x, fit_y = [], [], [], []
    for r in req.invitations:
        fx, ax = L_rank.features(r["candidate"], r["recipe"], r.get("offer"))
        acc_x.append(ax)
        acc_y.append(1.0 if r["accepted"] else 0.0)
        if r["accepted"] and r.get("hired") is not None:
            fit_x.append(fx)
            fit_y.append(1.0 if r["hired"] else 0.0)
    if len(acc_y) < req.min_accept or len(set(acc_y)) < 2:
        return {"activated": False, "reason": f"мало ответов на приглашения: {len(acc_y)} из {req.min_accept}"}
    new = dict(base or {})
    new["accept"] = L_rank.train_head(np.array(acc_x), np.array(acc_y), np.array(base["accept"]["w"]) if base else None, l2=3.0)
    if len(fit_y) >= req.min_fit and len(set(fit_y)) == 2:
        new["fit"] = L_rank.train_head(np.array(fit_x), np.array(fit_y), np.array(base["fit"]["w"]) if base else None, l2=3.0)
    if "fit" not in new:
        return {"activated": False, "reason": "нет стартовой головы «Подойдёт» и мало итогов собеседований"}
    new.update({"version": _version("ranker"), "trained_on": {"invitations": len(acc_y), "interviews": len(fit_y)}, "warm_start": False})
    L_store.save("ranker", new)
    return {"activated": True, "version": new["version"], **L_rank.model_card(new)}


class TextReq(BaseModel):
    examples: list[dict]                       # правки работодателей: [{"text", "recipe": {specialization, grade, ingredients: {id: w}}}]


@router.post("/textmodel")
def textmodel(req: TextReq):
    """Переобучение модели «текст → рецепт»: корпус + ручной набор + правки работодателей (вес ×4)."""
    from training import vacancy_gen
    corpus = vacancy_gen.corpus(8000, 7)
    manual = json.loads(EVAL.read_text(encoding="utf-8")) if EVAL.exists() else []
    edits = []
    for e in req.examples:
        rc = e.get("recipe") or {}
        ings = rc.get("ingredients") or {}
        if not ings or rc.get("specialization") not in SPECIALIZATIONS:
            continue
        top = max(ings.values())
        key = [i for i, w in ings.items() if w >= 0.5 * top]   # «заказанные» — те, что работодатель поднял ползунком
        edits.append({"text": e["text"], "specialization": rc["specialization"], "grade": rc.get("grade"), "ingredients": key, "weight": 4.0})
    m = L_text.train(corpus + [{**x, "weight": 4.0} for x in manual] + edits, epochs=6, seed=7)
    m.update({"version": _version("text"), "trained_on": {"synthetic": len(corpus), "manual": len(manual), "employer_edits": len(edits)}})
    L_store.save("textmodel", m)
    return {"activated": True, "version": m["version"], "trained_on": m["trained_on"]}


class ResetReq(BaseModel):
    name: str


@router.post("/reset")
def reset(req: ResetReq):
    """Откат: удалить дообученную версию (вернуться к запечённой или экспертной)."""
    if req.name not in ("calibration", "ranker", "textmodel"):
        raise HTTPException(400, "unknown model")
    L_store.remove(req.name)
    return {"ok": True, "source": L_store.source(req.name)}
