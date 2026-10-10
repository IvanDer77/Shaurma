"""Исполнение сгенерированного кода — источник «правильного ответа».

Код генерируем мы сами (не кандидат), поэтому эталон получаем исполнением,
а не нейросетью: ошибка LLM не может стать «правильным ответом».
"""
import os
import sqlite3
import subprocess
import sys
from functools import lru_cache

TIMEOUT = 5
NODE = os.environ.get("NODE_BIN", "node")


class RunError(Exception):
    pass


def _run(cmd: list[str], code: str) -> str:
    try:
        p = subprocess.run(cmd, input=code, capture_output=True, text=True,
                           timeout=TIMEOUT, encoding="utf-8")
    except subprocess.TimeoutExpired as e:
        raise RunError("timeout") from e
    if p.returncode != 0:
        # Ошибка исполнения — тоже валидный «вывод» (например, TypeError в JS)
        last = (p.stderr.strip().splitlines() or ["Error"])[-1]
        return "Ошибка: " + last.split(":")[0].strip()
    return p.stdout.strip()


def run_sql(code: str) -> str:
    """Схема + данные + последний запрос; вывод — строки результата."""
    con = sqlite3.connect(":memory:")
    try:
        statements = [s.strip() for s in code.split(";") if s.strip()]
        rows = []
        for s in statements:
            cur = con.execute(s)
            if s.lstrip().upper().startswith(("SELECT", "WITH")):
                rows = cur.fetchall()
        return "\n".join(" | ".join("NULL" if v is None else str(v) for v in r) for r in rows) or "(пусто)"
    except sqlite3.Error as e:
        return "Ошибка: " + type(e).__name__
    finally:
        con.close()


@lru_cache(maxsize=4096)
def execute(language: str, code: str) -> str:
    if language == "python":
        return _run([sys.executable, "-I", "-"], code)
    if language == "javascript":
        return _run([NODE, "-"], code)
    if language == "sql":
        return run_sql(code)
    raise RunError(f"unknown language {language}")
