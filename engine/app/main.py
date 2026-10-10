"""ШАУРМА-движок: генерация вариантов, адаптивный тест, рейтинг, рецепты, матчинг, антислив.

Сервис без состояния: данные хранит backend (PostgreSQL), движок только считает.
"""
import random
import secrets
from datetime import datetime, timezone

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from . import antileak, cat, glicko, llm, matching, recipe, resume
from .generator import InvalidVariant, build_variant_safe
from .ingredients import GRADES, INGREDIENTS, SPECIALIZATIONS, category_code
from .templates import ALL_TEMPLATES, CATALOG, difficulty, ingredients_of, op_combos

app = FastAPI(title="шаурматч_ · движок ШАУРМА", version="1.1.0",
              description="Шаблоны · Адаптивность · Уникальная начинка · Рейтинг · Матчинг вслепую · Антислив · Маринад (обучение)")


def _mount_learning():
    from .learn.api import router
    app.include_router(router)


_mount_learning()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def public_variant(v: dict) -> dict:
    """То, что видит кандидат: без правильного ответа."""
    return {k: v[k] for k in ("variant_id", "template_title", "language", "kind", "prompt", "code",
                              "options", "b", "ingredients", "ops_titles")}


@app.get("/health")
def health():
    return {"status": "ok", "llm": llm.available()}


@app.get("/catalog")
def catalog():
    return {
        "ingredients": INGREDIENTS,
        "specializations": SPECIALIZATIONS,
        "grades": [{**g, "threshold": None if g["threshold"] == float("-inf") else g["threshold"]} for g in GRADES],
        "templates": [{"id": t.id, "title": t.title, "specs": t.specs, "language": t.language, "kind": t.kind,
                       "ingredients": t.ingredients, "b0": t.b0,
                       "ops": [o.__dict__ for o in t.ops], "variants_per_seed": len(op_combos(t))}
                      for t in ALL_TEMPLATES],
        "cat": {"min_items": cat.MIN_ITEMS, "max_items": cat.MAX_ITEMS, "target_se": cat.TARGET_SE,
                "confirm_p": cat.CONFIRM_P, "upgrade_p": cat.UPGRADE_P, "cooldown_days": cat.GRADE_COOLDOWN_DAYS},
    }


class VariantReq(BaseModel):
    template_id: str
    ops: list[str] = []
    seed: int | None = None


@app.post("/variants")
def variant(req: VariantReq):
    if req.template_id not in CATALOG:
        raise HTTPException(404, "template not found")
    try:
        return build_variant_safe(req.template_id, req.seed if req.seed is not None else secrets.randbelow(10 ** 9), req.ops)
    except InvalidVariant as e:
        raise HTTPException(422, str(e))


class Resp(BaseModel):
    template_id: str
    ops: list[str] = []
    b: float
    correct: bool
    n_options: int = 4


class CatReq(BaseModel):
    specialization: str
    declared_grade: str
    responses: list[Resp] = []
    exposure: dict[str, int] = {}


@app.post("/cat/next")
def cat_next(req: CatReq):
    """Шаг адаптивного теста: следующий уникальный вариант (с ответом — backend хранит его у себя) или итог."""
    resps = [cat.Response(r.template_id, tuple(r.ops), r.b, r.correct, r.n_options) for r in req.responses]
    used = {(r.template_id, tuple(sorted(r.ops))) for r in resps}
    tested = set()
    for r in resps:
        tested |= set(ingredients_of(CATALOG[r.template_id], r.ops))
    res = cat.step(req.specialization, req.declared_grade, resps, used, tested, req.exposure, random.Random())
    if not res["done"]:
        nxt = res["next"]
        try:
            res["variant"] = build_variant_safe(nxt["template_id"], secrets.randbelow(10 ** 9), nxt["ops"])
        except InvalidVariant:
            # очень редкий случай — берём вариант без мутаций того же шаблона
            res["variant"] = build_variant_safe(nxt["template_id"], secrets.randbelow(10 ** 9), [])
    else:
        d = res["decision"]
        if d.get("grade"):
            d["category"] = category_code(req.specialization, d["grade"])
    return res


class RatingsReq(BaseModel):
    ratings: dict[str, dict] = {}
    results: list[dict] = []          # [{"b", "ingredients", "correct"}]
    achievements: list[dict] = []     # достижения ФСП


@app.post("/ratings/apply")
def ratings_apply(req: RatingsReq):
    r = req.ratings
    if req.results:
        r = glicko.apply_session(r, req.results, now_iso())
    if req.achievements:
        r = glicko.apply_fsp(r, req.achievements, now_iso())
    return {"ratings": r}


class NeedReq(BaseModel):
    text: str


@app.post("/recipe/parse")
def recipe_parse(req: NeedReq):
    """Заказ → рецепт. Если доступна LLM — уточняет веса; иначе правила."""
    base = recipe.parse_need(req.text)
    refined = llm.ask_json(
        "Ты — аналитик ИТ-найма. По описанию потребности работодателя верни JSON: "
        "specialization (backend|frontend|data), grade (intern|junior|middle|senior), "
        f"ingredients (объект: ключ из списка {list(INGREDIENTS)} → вес 0..1), stacks (массив).",
        req.text)
    if refined and isinstance(refined.get("ingredients"), dict):
        ings = {k: float(v) for k, v in refined["ingredients"].items() if k in INGREDIENTS and float(v) > 0}
        if ings:
            tot = sum(ings.values())
            base["ingredients"] = {k: round(v / tot, 3) for k, v in sorted(ings.items(), key=lambda kv: -kv[1])}
            base["ingredient_titles"] = {i: INGREDIENTS[i]["title"] for i in base["ingredients"]}
        for k in ("specialization", "grade"):
            if refined.get(k) in (SPECIALIZATIONS if k == "specialization" else matching.GRADE_CENTER):
                base[k] = refined[k]
        base["source"] = refined["_provider"]
    return base


class TaskByRecipeReq(BaseModel):
    recipe: dict
    seed: int | None = None
    grade: str | None = None
    exclude_templates: list[str] = []


@app.post("/recipe/task")
def recipe_task(req: TaskByRecipeReq):
    """«Шаурма по заказу»: вариант, максимально покрывающий ингредиенты рецепта, сложность — под грейд."""
    rcp = req.recipe
    target_b = matching.GRADE_CENTER[req.grade or rcp.get("grade", "middle")]
    best = []
    for t in ALL_TEMPLATES:
        if rcp["specialization"] not in t.specs or t.id in req.exclude_templates:
            continue
        for combo in op_combos(t):
            ings = ingredients_of(t, combo)
            cover = sum(rcp["ingredients"].get(i, 0) for i in ings)
            b = difficulty(t, combo)
            best.append((cover - 0.15 * abs(b - target_b), t.id, combo))
    if not best:
        raise HTTPException(404, "нет подходящих шаблонов")
    best.sort(reverse=True)
    rng = random.Random(req.seed)
    _, tid, combo = rng.choice(best[:4])
    # Шаблон и начинка общие для заказа, seed — свой у каждого кандидата (уникальный вариант)
    return {"template_id": tid, "ops": list(combo), "b": round(difficulty(CATALOG[tid], combo), 3),
            "ingredients": ingredients_of(CATALOG[tid], combo)}


class PracticeReq(BaseModel):
    specialization: str
    grade: str
    theta: float | None = None
    ratings: dict = {}
    exclude_templates: list[str] = []
    seed: int | None = None


@app.post("/practice/pick")
def practice_pick(req: PracticeReq):
    """«Свежая начинка»: какую задачу система адресно предложит кандидату и почему."""
    from . import practice
    res = practice.pick(req.specialization, req.grade, req.theta, req.ratings, req.exclude_templates, req.seed)
    if res.get("error"):
        raise HTTPException(404, "нет подходящих шаблонов")
    return res


class MatchReq(BaseModel):
    recipe: dict
    candidates: list[dict]
    filters: dict = {}
    limit: int = 50
    offer: dict | None = None          # {salary_from, salary_to, formats, trust} — для головы «Примет»


@app.post("/match")
def match(req: MatchReq):
    return {"results": matching.rank(req.candidates, req.recipe, req.limit, req.filters, req.offer)}


class StrengthReq(BaseModel):
    candidates: list[dict]
    specialization: str


@app.post("/category/rank")
def category_rank(req: StrengthReq):
    """Ранжирование внутри категории по силе подтверждённого профиля (тесты + ФСП)."""
    ings = SPECIALIZATIONS[req.specialization]["ingredients"]
    out = [{"candidate_id": c["id"], "strength": round(matching.category_strength(c, ings), 1)} for c in req.candidates]
    out.sort(key=lambda x: -x["strength"])
    return {"results": out}


class CanaryReq(BaseModel):
    answer_label: str
    own: dict
    others: list[dict] = []


@app.post("/antileak/canary")
def canary(req: CanaryReq):
    return {"flag": antileak.canary_check(req.answer_label, req.own, req.others)}


class FitReq(BaseModel):
    theta: float
    items: list[dict]


@app.post("/antileak/report")
def antileak_report(req: FitReq):
    return antileak.session_report(req.theta, req.items)


@app.get("/demo/population")
def demo_population(n: int = 300, seed: int = 2026):
    """Синтетические кандидаты для демо-базы (прошли ту же механику, что и живые)."""
    from .demo import population
    return {"candidates": population(min(n, 2000), seed)}


class ResumeText(BaseModel):
    text: str


@app.post("/resume/parse-text")
def resume_text(req: ResumeText):
    return resume.parse_resume_text(req.text)


@app.post("/resume/parse-pdf")
async def resume_pdf(file: UploadFile = File(...)):
    data = await file.read()
    try:
        text = resume.pdf_to_text(data)
    except Exception as e:
        raise HTTPException(422, f"не удалось прочитать PDF: {e}")
    res = resume.parse_resume_text(text)
    res["text_preview"] = text[:800]
    return res
