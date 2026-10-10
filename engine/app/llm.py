"""Адаптер российских LLM: GigaChat (Сбер) и YandexGPT.

Платформа полностью работает без ключей (правила и словари). Если ключи заданы,
LLM уточняет рецепт вакансии, разбор резюме и формулировки («обёртку») —
но НИКОГДА не определяет правильный ответ: он получается исполнением кода.
"""
import json
import os
import uuid

import httpx

GIGACHAT_KEY = os.environ.get("GIGACHAT_AUTH_KEY")          # Basic-ключ авторизации
GIGACHAT_SCOPE = os.environ.get("GIGACHAT_SCOPE", "GIGACHAT_API_PERS")
YANDEX_KEY = os.environ.get("YANDEX_API_KEY")
YANDEX_FOLDER = os.environ.get("YANDEX_FOLDER_ID")
TIMEOUT = 25


def available() -> list[str]:
    out = []
    if GIGACHAT_KEY:
        out.append("gigachat")
    if YANDEX_KEY and YANDEX_FOLDER:
        out.append("yandexgpt")
    return out


def _gigachat(system: str, user: str) -> str:
    with httpx.Client(timeout=TIMEOUT, verify=False) as cl:  # сертификаты Минцифры могут отсутствовать в контейнере
        tok = cl.post("https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
                      headers={"Authorization": f"Basic {GIGACHAT_KEY}", "RqUID": str(uuid.uuid4()),
                               "Content-Type": "application/x-www-form-urlencoded"},
                      data={"scope": GIGACHAT_SCOPE}).json()["access_token"]
        r = cl.post("https://gigachat.devices.sberbank.ru/api/v1/chat/completions",
                    headers={"Authorization": f"Bearer {tok}"},
                    json={"model": "GigaChat", "temperature": 0.1,
                          "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]})
        return r.json()["choices"][0]["message"]["content"]


def _yandex(system: str, user: str) -> str:
    with httpx.Client(timeout=TIMEOUT) as cl:
        r = cl.post("https://llm.api.cloud.yandex.net/foundationModels/v1/completion",
                    headers={"Authorization": f"Api-Key {YANDEX_KEY}", "x-folder-id": YANDEX_FOLDER},
                    json={"modelUri": f"gpt://{YANDEX_FOLDER}/yandexgpt/latest",
                          "completionOptions": {"temperature": 0.1, "maxTokens": 1500},
                          "messages": [{"role": "system", "text": system}, {"role": "user", "text": user}]})
        return r.json()["result"]["alternatives"][0]["message"]["text"]


def ask_json(system: str, user: str, provider: str | None = None) -> dict | None:
    """Вернёт JSON-ответ первой доступной модели или None (тогда работают правила)."""
    providers = [provider] if provider else available()
    for p in providers:
        try:
            text = _gigachat(system, user) if p == "gigachat" else _yandex(system, user)
            start, end = text.find("{"), text.rfind("}")
            if start >= 0:
                data = json.loads(text[start:end + 1])
                data["_provider"] = p
                return data
        except Exception:
            continue
    return None


def cross_check(system: str, user: str) -> dict:
    """Перекрёстная проверка двух моделей: если обе доступны, сравниваем ответы."""
    a = ask_json(system, user, "gigachat") if "gigachat" in available() else None
    b = ask_json(system, user, "yandexgpt") if "yandexgpt" in available() else None
    return {"gigachat": a, "yandexgpt": b, "consensus": (a is not None and b is not None and a == b)}
