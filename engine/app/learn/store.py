"""Хранилище обученных моделей «Маринада».

Модели — открытые JSON-файлы (без pickle и обфускации): их можно прочитать глазами и проверить.
  * app/models/*.json   — «запечённые» в образ модели (стартовая точка);
  * $MODELS_DIR/*.json  — модели, дообученные на живых данных (docker-том). Имеют приоритет.
Файлы перечитываются при изменении (mtime), поэтому все воркеры uvicorn видят новую версию.
"""
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

BAKED_DIR = Path(__file__).resolve().parents[1] / "models"
LIVE_DIR = Path(os.environ.get("MODELS_DIR", "")) if os.environ.get("MODELS_DIR") else None

_cache: dict[str, tuple[float, str, dict]] = {}
_checked: dict[str, tuple[float, dict | None]] = {}
RECHECK_SECONDS = 2.0  # модель читается в горячем цикле CAT — mtime проверяем не чаще раза в 2 с


def _path(name: str) -> Path | None:
    for d in (LIVE_DIR, BAKED_DIR):
        if d is not None:
            p = d / f"{name}.json"
            if p.exists():
                return p
    return None


def load(name: str) -> dict | None:
    import time
    now = time.monotonic()
    hit = _checked.get(name)
    if hit and now - hit[0] < RECHECK_SECONDS:
        return hit[1]
    data = _load(name)
    _checked[name] = (now, data)
    return data


def _load(name: str) -> dict | None:
    p = _path(name)
    if p is None:
        _cache.pop(name, None)
        return None
    mtime = p.stat().st_mtime
    hit = _cache.get(name)
    if hit and hit[0] == mtime and hit[1] == str(p):
        return hit[2]
    data = json.loads(p.read_text(encoding="utf-8"))
    _cache[name] = (mtime, str(p), data)
    return data


def save(name: str, data: dict, baked: bool = False) -> Path:
    """Атомарная запись: сначала во временный файл, затем rename (воркер не прочитает половину)."""
    d = BAKED_DIR if baked or LIVE_DIR is None else LIVE_DIR
    d.mkdir(parents=True, exist_ok=True)
    data = {**data, "saved_at": datetime.now(timezone.utc).isoformat()}
    fd, tmp = tempfile.mkstemp(dir=d, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    target = d / f"{name}.json"
    os.replace(tmp, target)
    _cache.pop(name, None)
    _checked.pop(name, None)
    return target


def remove(name: str) -> None:
    """Откат к запечённой модели: удалить дообученную версию."""
    if LIVE_DIR is not None and (LIVE_DIR / f"{name}.json").exists():
        (LIVE_DIR / f"{name}.json").unlink()
    _cache.pop(name, None)
    _checked.pop(name, None)


def source(name: str) -> str:
    p = _path(name)
    if p is None:
        return "none"
    return "live" if LIVE_DIR is not None and p.parent == LIVE_DIR else "baked"
