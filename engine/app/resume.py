"""Разбор резюме (PDF/текст): ФИО, контакты, стек, грейд, роли, стаж, софт-скиллы.

Внимание: по ТЗ резюме НЕ определяет категорию — это делает только тест.
Распознанные данные лишь предзаполняют профиль и опрос.
"""
import io
import re

from . import llm
from .recipe import GRADE_HINTS, SPEC_HINTS, STACKS

SOFT = ["коммуникаб", "команд", "лидер", "ответствен", "самостоят", "наставни", "менторств", "презентац",
        "аналитическ", "внимательн", "обучаем", "инициатив", "тайм-менеджмент", "критическ"]
SOFT_TITLES = {"коммуникаб": "Коммуникабельность", "команд": "Работа в команде", "лидер": "Лидерство",
               "ответствен": "Ответственность", "самостоят": "Самостоятельность", "наставни": "Наставничество",
               "менторств": "Менторство", "презентац": "Презентация результатов", "аналитическ": "Аналитическое мышление",
               "внимательн": "Внимательность к деталям", "обучаем": "Обучаемость", "инициатив": "Инициативность",
               "тайм-менеджмент": "Тайм-менеджмент", "критическ": "Критическое мышление"}
ROLES = {"backend": "Backend-разработчик", "frontend": "Frontend-разработчик", "data": "Data / ML-специалист"}


def pdf_to_text(data: bytes) -> str:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    return "\n".join((p.extract_text() or "") for p in reader.pages)


def _years(text: str) -> float | None:
    low = text.lower()
    m = re.search(r"(?:опыт|стаж)[^\d]{0,30}(\d{1,2})(?:[.,](\d))?\s*(?:\+\s*)?(?:год|лет|года)", low)
    if m:
        return float(m.group(1) + ("." + m.group(2) if m.group(2) else ""))
    # по периодам вида 2019 — 2023 / 2021 – н.в.
    total = 0
    for a, b in re.findall(r"(20\d\d|19\d\d)\s*[-–—]\s*(20\d\d|н\.?\s*в\.?|наст|по настоящее)", low):
        end = int(b) if b[:2] in ("19", "20") else 2026
        total += max(0, end - int(a))
    return float(total) if total else None


PERIOD = re.compile(r"((?:0?[1-9]|1[0-2])[./])?((?:19|20)\d\d)\s*[-–—]\s*((?:0?[1-9]|1[0-2])[./])?((?:19|20)\d\d|н\.?\s*в\.?|наст[а-я.]*|по настоящее(?: время)?)", re.I)
COMPANY = re.compile(r"(^|\s)(ООО|АО|ПАО|ЗАО|НКО|ИП|ГК|Банк|Inc\.?|LLC|Ltd\.?|Group)(\s|$)|[«\"]", re.I)
TITLE = re.compile(r"(разработчик|программист|инженер|аналитик|архитектор|тимлид|team ?lead|тестировщик|data scientist|"
                   r"developer|engineer|devops|qa|стажёр|стажер|руководитель)", re.I)


def _experience(lines: list[str]) -> list[dict]:
    """Места работы: строка с периодом «2019 — 2023» / «03.2021 – н.в.» + соседние строки (компания, должность)."""
    out = []
    for i, l in enumerate(lines):
        m = PERIOD.search(l)
        if not m:
            continue
        rest = (l[:m.start()] + l[m.end():]).strip(" ,;:|│—–-	")
        near = [x.strip(" |│") for x in lines[i + 1:i + 3] if not PERIOD.search(x) and len(x) < 90]
        parts = [p for p in [rest, *near] if p]
        # «ООО «Ритейл Аналитика»» содержит «аналитик», но это компания: признаки юрлица важнее
        company = next((p for p in parts if COMPANY.search(p)), None)
        title = next((p for p in parts if p != company and TITLE.search(p)), None)
        company = company or next((p for p in parts if p != title), None)
        end = m.group(4)
        out.append({"period": f"{m.group(2)} — {end if end[:2] in ('19', '20') else 'н. в.'}",
                    "company": company, "title": title})
        if len(out) >= 6:
            break
    return out


def _ml_hints(text: str) -> dict | None:
    """Подсказки собственной модели шаурматч_: вероятная специализация и навыки (только для предзаполнения опроса)."""
    from .learn import store, textmodel
    model = store.load("textmodel")
    if not model:
        return None
    p = textmodel.predict(model, text[:6000])
    spec = max(p["specialization"], key=p["specialization"].get)
    ings = sorted(p["ingredients"], key=lambda k: -p["ingredients"][k])[:4]
    from .ingredients import INGREDIENTS
    return {"specialization": spec, "confidence": p["specialization"][spec],
            "skills": [{"id": i, "title": INGREDIENTS[i]["title"], "p": p["ingredients"][i]} for i in ings if p["ingredients"][i] >= 0.3]}


def parse_resume_text(text: str) -> dict:
    text = re.sub(r"[   ]", " ", text)  # неразрывные пробелы из PDF
    text = re.sub(r"[­‐‑‒−]", "-", text)  # мягкие переносы и «типографские» дефисы в номерах
    low = text.lower()
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    name = None
    for l in lines[:6]:
        if re.fullmatch(r"[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,2}", l):
            name = l
            break
    email = (re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", text) or [None])[0]
    phone = (re.search(r"(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}", text) or [None])[0]
    tg = (re.search(r"(?:t\.me/|telegram[:\s]+|@)([A-Za-z][\w]{4,31})", text) or [None, None])[1]
    stacks = [s for s in STACKS if re.search(r"(?<![a-zа-я])" + re.escape(s.lower()) + r"(?![a-zа-я])", low)]
    spec_scores = {s: sum(low.count(h) for h in hints) for s, hints in SPEC_HINTS.items()}
    spec = max(spec_scores, key=spec_scores.get) if any(spec_scores.values()) else None
    years = _years(text)
    experience = _experience(lines)
    # Подсказка грейда для опроса: текущая должность → стаж → слова в тексте («Junior» из прошлой работы не в счёт)
    current = (experience[0].get("title") or "").lower() if experience else ""
    grade = next((g for g, hints in GRADE_HINTS if any(h in current for h in hints)), None)
    if grade is None and years is not None:
        grade = "intern" if years < 0.5 else "junior" if years < 2 else "middle" if years < 5 else "senior"
    if grade is None:
        grade = next((g for g, hints in GRADE_HINTS if any(h in low for h in hints)), None)
    soft = [SOFT_TITLES[k] for k in SOFT if k in low]
    roles = list(dict.fromkeys(e["title"] for e in experience if e.get("title")))
    ml = _ml_hints(text)
    if spec is None and ml and ml["confidence"] >= 0.6:
        spec = ml["specialization"]
    result = {
        "full_name": name, "email": email, "phone": phone, "telegram": tg,
        "specialization": spec, "role": ROLES.get(spec) if spec else None, "roles": roles,
        "suggested_grade": grade, "experience_years": years, "experience": experience,
        "stacks": stacks, "soft_skills": soft, "ml_hints": ml, "source": "rules+proof-model" if ml else "rules",
    }
    # 152-ФЗ: во внешнюю LLM уходит текст без ФИО и контактов — их уже извлекли правила локально
    masked = text[:6000]
    for secret in filter(None, [name, email, phone, tg and "@" + tg, tg]):
        masked = masked.replace(secret, "[скрыто]")
    refined = llm.ask_json(
        "Ты разбираешь резюме ИТ-специалиста (контакты скрыты). Верни JSON с полями "
        "specialization (backend|frontend|data), suggested_grade (intern|junior|middle|senior), "
        "experience_years (число), stacks (массив), soft_skills (массив). Ничего не выдумывай.",
        masked)
    if refined:
        for k, v in refined.items():
            if k in result and k not in ("full_name", "email", "phone", "telegram") and v not in (None, "", []):
                result[k] = v
        result["source"] = refined.get("_provider", "llm")
    return result
