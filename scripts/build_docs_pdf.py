"""Сборка сопроводительной документации в один PDF (ТЗ, п. 3.4 и 5.2: «документация в формате doc или pdf»).

Источники — те же Markdown-файлы из docs/ (единственный источник правды), API — из docs/openapi.json.
Порядок разделов повторяет перечень п. 3.4 ТЗ. Диаграммы mermaid рендерятся в браузере.

Запуск (нужны пакеты markdown и playwright с Chromium/Edge):
    python scripts/build_docs_pdf.py            (результат: docs/шаурматч_документация.pdf)
"""
import asyncio
import datetime as dt
import html
import json
import re
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
OUT = DOCS / "шаурматч_документация.pdf"

SECTIONS = [
    ("Обзор решения и быстрый старт", ROOT / "README.md"),
    ("Функциональная и компонентная архитектура", DOCS / "АРХИТЕКТУРА.md"),
    ("Механика тестирования и подбора: метод «ШАУРМА»", DOCS / "МЕТОД ШАУРМА.md"),
    ("Валидация метода: процедура и результаты", DOCS / "validation" / "report.md"),
    ("Обучение моделей на данных платформы («Маринад»)", DOCS / "МАРИНАД.md"),
    ("Отчёт симуляции обучения", DOCS / "training" / "report.md"),
    ("Интеграция с реестром ФСП", DOCS / "ИНТЕГРАЦИЯ ФСП.md"),
    ("Описание API", None),
    ("Библиотеки и компоненты", DOCS / "БИБЛИОТЕКИ.md"),
    ("Сборка, развёртывание и локальный запуск", DOCS / "РАЗВЁРТЫВАНИЕ.md"),
]


# Требования п. 3.4 ТЗ к составу документации и разделы, которые их закрывают
TZ_34 = [
    ("Функциональная и компонентная архитектура решения", "2"),
    ("Механика тестирования кандидатов с обоснованием устойчивости к распространению заданий", "3 (пункты 5–7 и 11), 4"),
    ("Механика подбора и логика категоризации кандидатов", "3 (пункты 7–9)"),
    ("Собственная процедура валидации решения и её результаты", "4, 5, 6"),
    ("Схема предполагаемой интеграции с реестром ФСП", "7"),
    ("Описание API", "8"),
    ("Используемые библиотеки и компоненты с указанием версий", "9"),
    ("Пошаговая инструкция по сборке, развёртыванию и локальному запуску", "10, 1"),
]
DEMO_URL = "http://62.113.107.39:8200"
REPO_URL = "https://github.com/IvanDer77/Shaurma"


def md_to_html(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    if path.name == "README.md":
        # таблица ссылок на файлы репозитория в PDF не нужна: её заменяет содержание
        text = re.sub(r"## Документация\n.*?(?=\n## )", "", text, flags=re.S)
    text = re.sub(r"^# .*\n", "", text, count=1)                    # заголовок раздела даём свой
    # ```mermaid → <div class="mermaid">
    text = re.sub(r"```mermaid\n(.*?)```", lambda m: f'<div class="mermaid">{html.escape(m.group(1))}</div>', text, flags=re.S)
    body = markdown.markdown(text, extensions=["tables", "fenced_code", "sane_lists"])
    # относительные картинки → абсолютные file:// (в одном PDF у разделов разные папки)
    body = re.sub(r'src="(?!https?:|file:)([^"]+)"', lambda m: f'src="{(path.parent / m.group(1)).resolve().as_uri()}"', body)
    # ссылки на соседние .md внутри PDF не работают — оставляем текст
    body = re.sub(r'<a href="(?!https?:)[^"]*">(.*?)</a>', r"\1", body)
    return body


def api_html() -> str:
    spec = json.loads((DOCS / "openapi.json").read_text(encoding="utf-8"))
    base = spec.get("servers", [{}])[0].get("url", "")
    by_tag: dict[str, list] = {}
    for path, ops in spec["paths"].items():
        for method, op in ops.items():
            by_tag.setdefault((op.get("tags") or ["Прочее"])[0], []).append((method.upper(), path, op))
    out = [f"<p>Полная спецификация OpenAPI 3: <code>docs/openapi.json</code>, интерактивно — Swagger UI на <code>/api/docs</code>. "
           f"Базовый путь: <code>{html.escape(base)}</code>. Методов: {sum(len(v) for v in by_tag.values())}. "
           "Авторизация — httpOnly-cookie или <code>Authorization: Bearer</code>; ошибки — JSON <code>{error, message, details?}</code>.</p>"]
    for tag, ops in by_tag.items():
        out.append(f"<h3>{html.escape(tag)}</h3><table><tr><th>Метод</th><th>Путь</th><th>Назначение</th><th>Доступ</th><th>Коды</th></tr>")
        for m, p, op in ops:
            roles = "по входу" if op.get("security") else "публично"
            codes = ", ".join(sorted(op.get("responses", {}).keys()))
            desc = html.escape(op.get("summary", ""))
            if op.get("description"):
                desc += f'<br><span class="muted">{html.escape(op["description"])}</span>'
            out.append(f"<tr><td><code>{m}</code></td><td><code>{html.escape(p)}</code></td><td>{desc}</td><td>{roles}</td><td>{codes}</td></tr>")
        out.append("</table>")
    return "\n".join(out)


CSS = """
@font-face { font-family: "Onest"; src: url("brand/fonts/Onest.ttf") format("truetype"); font-weight: 100 900; }
@font-face { font-family: "JetBrains Mono"; src: url("brand/fonts/JetBrainsMono.ttf") format("truetype"); font-weight: 100 800; }
@page { size: A4; margin: 18mm 16mm 18mm 16mm; }
/* фирменный стиль «шаурматч_»: чернила, синий ФСП, соус; прямые углы и тонкие линии */
body { font-family: Onest, 'Segoe UI', Arial, sans-serif; color: #1B1C21; font-size: 10.5pt; line-height: 1.55; }
h1, h2, h3 { font-family: 'JetBrains Mono', Consolas, monospace; font-weight: 800; letter-spacing: -.03em; }
h1 { font-size: 22pt; margin: 0 0 10pt; page-break-before: always; border-bottom: 1.5px solid #1B1C21; padding-bottom: 6pt; }
h1.first { page-break-before: avoid; }
h1.plain { border-bottom: 1.5px solid #1B1C21; }
h2 { font-size: 14pt; margin-top: 18pt; }
h3 { font-size: 11.5pt; margin-top: 14pt; }
a { color: #402FFF; }
code { font-family: 'JetBrains Mono', Consolas, monospace; font-size: 9pt; background: #EDEDED; padding: 0 3px; }
pre { background: #F4F4F5; border: 1px solid #D9D9D9; padding: 8pt; white-space: pre-wrap; font-size: 8.5pt; }
pre code { background: none; padding: 0; }
blockquote { margin: 8pt 0; padding: 2pt 0 2pt 12pt; border-left: 3px solid #402FFF; color: #4A4B53; }
table { border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 9pt; page-break-inside: auto; }
tr { page-break-inside: avoid; }
th, td { border: 1px solid #D9D9D9; padding: 4pt 6pt; vertical-align: top; text-align: left; }
th { background: #EDEDED; }
img { max-width: 100%; margin: 6pt 0; }
.muted { color: #6B6C72; font-size: 8.5pt; }
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; }
.cover .st { font-size: 13pt; line-height: 1.45; max-width: 150mm; color: #4A4B53; }
.cover table.meta { width: auto; margin-top: 22pt; font-size: 10pt; }
.cover table.meta td { border: 0; border-top: 1px solid #D9D9D9; padding: 5pt 14pt 5pt 0; }
.cover table.meta td:first-child { color: #6B6C72; white-space: nowrap; }
.cover .brand { font: 800 44pt 'JetBrains Mono', monospace; letter-spacing: -.04em; color: #1B1C21; }
.cover .brand span { color: #FF8A1F; }
.cover .t { font: 800 22pt 'JetBrains Mono', monospace; letter-spacing: -.03em; margin: 14pt 0 8pt; }
.toc li { margin: 3pt 0; }
.mermaid { text-align: center; margin: 8pt 0; }
"""


async def main():
    from playwright.async_api import async_playwright
    toc = "".join(f"<li>{html.escape(t)}</li>" for t, _ in SECTIONS)
    tz = "".join(f"<tr><td>{html.escape(req)}</td><td>{sec}</td></tr>" for req, sec in TZ_34)
    parts = [f"""<div class="cover"><div class="brand">шаурматч<span>_</span></div>
      <div class="t">Сопроводительная документация</div>
      <div class="st">Цифровая платформа-агрегатор ИТ-вакансий с верифицированным профилем достижений участника
      Федерации спортивного программирования (ФСП)</div>
      <table class="meta">
        <tr><td>Мероприятие</td><td>Хакатон «Лидеры цифровой трансформации 2026», спецтрек ФСП</td></tr>
        <tr><td>Команда</td><td>«Дергачёв и жена»</td></tr>
        <tr><td>Развёрнутый стенд</td><td>{DEMO_URL}</td></tr>
        <tr><td>Исходный код</td><td>{REPO_URL}</td></tr>
        <tr><td>Редакция документа</td><td>{dt.date.today():%d.%m.%Y}</td></tr>
      </table></div>
      <h1 class="plain">Содержание</h1><ol class="toc">{toc}</ol>
      <h2>Соответствие требованиям к документации (ТЗ, п. 3.4)</h2>
      <table><tr><th>Требование ТЗ</th><th style="width:34%">Раздел документа</th></tr>{tz}</table>
      <p class="muted">Документ собирается из файлов каталога docs/ и спецификации docs/openapi.json скриптом
      scripts/build_docs_pdf.py, поэтому его содержание совпадает с документацией в репозитории.</p>"""]
    for i, (title, path) in enumerate(SECTIONS):
        body = api_html() if path is None else md_to_html(path)
        parts.append(f'<h1 class="{"first" if False else ""}">{i + 1}. {html.escape(title)}</h1>{body}')
    doc = f"""<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>{CSS}</style>
      <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script></head>
      <body>{''.join(parts)}<script>mermaid.initialize({{ startOnLoad: true, theme: 'base', themeVariables: {{ primaryColor: '#FFFFFF', primaryBorderColor: '#1B1C21', primaryTextColor: '#1B1C21', lineColor: '#1B1C21', fontFamily: 'Onest' }} }});</script></body></html>"""
    tmp = DOCS / "_build_docs.html"
    tmp.write_text(doc, encoding="utf-8")
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="msedge")
        pg = await b.new_page()
        await pg.goto(tmp.resolve().as_uri(), wait_until="networkidle")
        await pg.wait_for_timeout(1500)
        await pg.pdf(path=str(OUT), format="A4", print_background=True, display_header_footer=True,
                     header_template="<span></span>",
                     footer_template='<div style="font-size:8px;width:100%;text-align:center;color:#6B6C72">шаурматч_, сопроводительная документация, стр. <span class="pageNumber"></span> из <span class="totalPages"></span></div>',
                     margin={"top": "16mm", "bottom": "16mm", "left": "14mm", "right": "14mm"})
        await b.close()
    tmp.unlink()
    print(f"готово: {OUT} ({OUT.stat().st_size // 1024} КБ)")


if __name__ == "__main__":
    asyncio.run(main())
