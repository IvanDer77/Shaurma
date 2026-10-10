"""Графики и отчёт «Маринада» (docs/training)."""
from __future__ import annotations

from pathlib import Path

import numpy as np

OUT = Path(__file__).resolve().parents[2] / "docs" / "training"
BASE, LEARN, THIRD = "#9B9C9E", "#402FFF", "#FF8A1F"   # палитра бренда: «до» — серый, «Маринад» — синий, третья серия — соус
INK, MUTED, GRID = "#1B1C21", "#6B6C72", "#E3E3E5"


def _style(plt):
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10.5, "axes.edgecolor": GRID, "axes.labelcolor": MUTED,
                         "xtick.color": MUTED, "ytick.color": MUTED, "axes.spines.top": False, "axes.spines.right": False,
                         "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.8, "axes.axisbelow": True,
                         "axes.titleweight": "bold", "axes.titlesize": 11.5, "axes.titlecolor": INK, "legend.frameon": False})


def charts(m: dict):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    _style(plt)
    mon = m["monthly"]
    x = [r["month"] for r in mon]

    # 1. Год в перемотке: 4 малых графика, у каждого своя ось
    fig, ax = plt.subplots(2, 2, figsize=(11, 7.2))
    a = ax[0][0]
    for kind, col, label in (("eta", LEARN, "сложность начинок η"), ("b0", THIRD, "сложность шаблонов b0"), ("a", BASE, "дискриминация a")):
        ys = [100 * r["rmse_learned"][kind] / r["rmse_expert"][kind] for r in mon]
        a.plot(x, ys, color=col, lw=2, marker="o", ms=4, label=label)
    a.axhline(100, color=MUTED, lw=1, ls="--")
    a.text(x[0], 101.5, "ошибка эксперта = 100%", color=MUTED, fontsize=9)
    a.set_ylim(0, 112)
    a.set_title("Сколько осталось от ошибки эксперта, %")
    a.legend(loc="lower left", fontsize=9)
    hand = m["counterfactual"]["matching"]["hand"]
    a = ax[0][1]
    a.plot(x, [r["hires_per_10"] for r in mon], color=LEARN, lw=2, marker="o", ms=5)
    a.axhline(hand["hires_per_10"], color=BASE, lw=2, ls="--")
    a.text(x[-1], hand["hires_per_10"], "ручная формула ", color=MUTED, ha="right", va="bottom", fontsize=9)
    a.set_title("Наймов на 10 приглашений (ожидаемое)")
    a.set_ylim(bottom=0)
    a = ax[1][0]
    a.plot(x, [r["acceptance"] * 100 for r in mon], color=LEARN, lw=2, marker="o", ms=5)
    a.axhline(hand["acceptance"] * 100, color=BASE, lw=2, ls="--")
    a.text(x[-1], hand["acceptance"] * 100, "ручная формула ", color=MUTED, ha="right", va="bottom", fontsize=9)
    a.set_title("Кандидаты принимают приглашение, %")
    a.set_ylim(0, 100)
    a.set_xlabel("месяц")
    a = ax[1][1]
    d = m["drift"]
    v0, va = d.get("viral_start_ts"), d.get("alarm_ts")
    if d.get("trace") and v0:
        def window(trace, ts):
            pts = [(i, s) for i, (s, t) in enumerate(zip(trace, ts))]
            k0 = next((i for i, t in enumerate(ts) if t > v0), len(ts))
            return [(i - k0, s) for i, s in pts if -300 <= i - k0 <= 500], k0
        wc, kc = window(d["control_trace"], d["control_ts"])
        wv, kv = window(d["trace"], d["trace_ts"])
        a.plot([x for x, _ in wc], [y for _, y in wc], color=BASE, lw=1.2, label=f"обычная начинка")
        a.plot([x for x, _ in wv], [y for _, y in wv], color=LEARN, lw=1.6, label="начинка с вирусным разбором")
        a.axhline(d["h"], color=INK, lw=1, ls="--")
        a.text(-300, d["h"] + 0.4, f"порог тревоги h = {d['h']:g}", color=INK, fontsize=9)
        a.axvline(0, color=MUTED, lw=1, ls=":")
        a.text(-8, d["h"] * 1.45, "разбор\nзавирусился", color=MUTED, fontsize=9, ha="right")
        if d.get("detected"):
            n = d["detected"]["responses_since_viral"]
            a.annotate(f"тревога через\n{n} ответов", xy=(n, d["h"]), xytext=(n + 110, d["h"] * 0.35), fontsize=9.5, color=INK,
                       arrowprops={"arrowstyle": "->", "color": INK, "lw": 1})
        a.set_ylim(0, max(d["h"] * 1.8, max(y for _, y in wv) * 1.1))
    a.set_title("Детектор «чёрствого лаваша» (CUSUM)")
    a.set_xlabel("ответы на начинку относительно начала разбора")
    a.legend(loc="upper left", fontsize=9)
    for a in (ax[0][0], ax[0][1], ax[1][0]):
        a.set_xticks(x)
    fig.suptitle("шаурматч_ учится: год жизни платформы в перемотке", fontsize=14, fontweight="bold", color=INK)
    fig.tight_layout()
    fig.savefig(OUT / "timelapse.png", dpi=150)
    plt.close(fig)

    # 2. η: эксперт и Маринад против истины
    pts = m["calibration"]["eta_points"]
    fig, ax2 = plt.subplots(1, 2, figsize=(10, 4.6), sharey=True)
    lo = min(min(p["truth"], p["expert"], p["learned"]) for p in pts) - 0.1
    hi = max(max(p["truth"], p["expert"], p["learned"]) for p in pts) + 0.1
    for a, key, col, title in ((ax2[0], "expert", BASE, "Эксперт «на глаз»"), (ax2[1], "learned", LEARN, "Маринад (по ответам)")):
        a.plot([lo, hi], [lo, hi], color=MUTED, lw=1, ls="--")
        a.scatter([p["truth"] for p in pts], [p[key] for p in pts], s=34, color=col, edgecolor="white", linewidth=1.2)
        tv, ev = np.array([p["truth"] for p in pts]), np.array([p[key] for p in pts])
        a.set_title(f"{title}: r = {np.corrcoef(tv, ev)[0, 1]:.2f}, RMSE = {np.sqrt(np.mean((tv - ev) ** 2)):.2f}")
        a.set_xlabel("истинная сложность начинки η")
    ax2[0].set_ylabel("оценка η")
    fig.tight_layout()
    fig.savefig(OUT / "eta.png", dpi=150)
    plt.close(fig)

    # 3. До и после (контрфакт): малые графики, у каждой метрики своя шкала
    cf = m["counterfactual"]
    items = [("Грейд точно, %", cf["grade"]["expert"]["exact"] * 100, cf["grade"]["learned"]["exact"] * 100),
             ("Завышенных грейдов, %", cf["grade"]["expert"]["overestimated"] * 100, cf["grade"]["learned"]["overestimated"] * 100),
             ("Наймов на 10 приглашений", cf["matching"]["hand"]["hires_per_10"], cf["matching"]["learned"]["hires_per_10"]),
             ("Приглашений принято, %", cf["matching"]["hand"]["acceptance"] * 100, cf["matching"]["learned"]["acceptance"] * 100)]
    fig, ax3 = plt.subplots(1, 4, figsize=(12, 3.6))
    for a, (t, b, l) in zip(ax3, items):
        a.bar([0, 1], [b, l], color=[BASE, LEARN], width=0.6)
        a.set_xticks([0, 1], ["до", "Маринад"])
        a.set_title(t, fontsize=10.5)
        for i, v in enumerate([b, l]):
            a.text(i, v, f"{v:.1f}" if v < 10 else f"{v:.0f}", ha="center", va="bottom", color=INK, fontsize=10)
        a.set_ylim(0, max(b, l) * 1.2)
        a.grid(axis="x", visible=False)
    fig.suptitle("Те же люди и вакансии: экспертные параметры и ручная формула против обученных", fontsize=12, fontweight="bold", color=INK)
    fig.tight_layout()
    fig.savefig(OUT / "before_after.png", dpi=150)
    plt.close(fig)

    # 4. Язык: правила против модели и обучение на правках
    L = m["language"]
    fig, ax4 = plt.subplots(1, 2, figsize=(11, 4))
    keys = [("specialization", "специализация"), ("grade", "грейд"), ("ingredients_hit3", "навыки в топ-3")]
    xx = np.arange(len(keys))
    ax4[0].bar(xx - 0.18, [L["rules"][k] * 100 for k, _ in keys], 0.34, color=BASE, label="словарь правил")
    ax4[0].bar(xx + 0.18, [L["model"][k] * 100 for k, _ in keys], 0.34, color=LEARN, label="модель шаурматч_")
    ax4[0].set_xticks(xx, [t for _, t in keys])
    ax4[0].set_ylim(0, 110)
    ax4[0].legend(loc="upper right", ncol=2)
    ax4[0].set_title("Разбор потребности, % верно")
    ax4[0].set_xlabel(f"{L['eval_size']} текстов, написаны вручную, в обучении не участвовали")
    ax4[0].grid(axis="x", visible=False)
    curve = L["learning_curve"]
    ks = sorted(int(k) for k in curve)
    ax4[1].plot(ks, [curve[str(k) if str(k) in curve else k]["ingredients_hit3"] * 100 for k in ks], color=LEARN, lw=2, marker="o", label="навыки в топ-3")
    ax4[1].plot(ks, [curve[str(k) if str(k) in curve else k]["grade"] * 100 for k in ks], color=THIRD, lw=2, marker="s", label="грейд")
    ax4[1].set_xticks(ks)
    ax4[1].set_xlabel("правок рецептов от работодателей")
    ax4[1].set_title("Учится на правках работодателей")
    ax4[1].set_ylim(50, 100)
    ax4[1].legend(loc="center right")
    fig.tight_layout()
    fig.savefig(OUT / "language.png", dpi=150)
    plt.close(fig)

    # 5. Чему научился подбор
    if m.get("ranker"):
        fig, ax5 = plt.subplots(1, 2, figsize=(13, 4.4))
        for a, head, title in ((ax5[0], "fit", "«Подойдёт»: что ведёт к найму"), (ax5[1], "accept", "«Примет»: что ведёт к «да»")):
            rows = sorted(m["ranker"][head], key=lambda r: r["weight"])
            a.barh([r["title"] for r in rows], [r["weight"] for r in rows],
                   color=[LEARN if r["weight"] > 0 else BASE for r in rows], height=0.6)
            a.axvline(0, color=INK, lw=0.8)
            a.set_title(title)
            a.grid(axis="y", visible=False)
            a.tick_params(axis="y", labelsize=9)
        fig.tight_layout()
        fig.savefig(OUT / "ranker.png", dpi=150)
        plt.close(fig)


def report(m: dict):
    cf, L, d, c = m["counterfactual"], m["language"], m["drift"], m["calibration"]
    first, last = m["monthly"][0], m["monthly"][-1]
    det = d.get("detected")
    n_resp = det["responses_since_viral"] if det else 0
    word = "ответ" if n_resp % 10 == 1 and n_resp % 100 != 11 else "ответа" if n_resp % 10 in (2, 3, 4) and n_resp % 100 not in (12, 13, 14) else "ответов"
    det_txt = (f"Детектор поднял тревогу в {det['month']}-м месяце, через **{n_resp} {word}** на эту начинку "
               f"после начала разбора, и оценил, что она стала легче на **{det['easier_by']} логита**. История этой начинки "
               f"обнулилась, и следующая калибровка выучила её новую сложность.") if det else "Детектор тревогу не поднял."
    fa = sorted({k for r in m["monthly"] for k in r["false_alarms"]})
    ve = d.get("viral_eta")
    try:
        from app.templates import CATALOG
        tid, oid = d["viral_key"].split(":")
        viral_title = f"{CATALOG[tid].title}: {CATALOG[tid].op(oid).title.lower()}"
    except Exception:
        viral_title = d.get("viral_key")
    viral_txt = (f"Сложность этой начинки: эксперт {ve['expert']:+.2f}, истинная до разбора {ve['truth_before']:+.2f}, "
                 f"после разбора в среднем по кандидатам {ve['truth_after']:+.2f}; «Маринад» к концу года выучил "
                 f"**{ve['by_month'][-1]['learned']:+.2f}**.") if ve and ve.get("by_month") else ""
    curve = L["learning_curve"]
    ck = sorted(curve, key=lambda k: int(k))
    md = f"""# «Маринад»: как шаурматч_ учится на собственных данных

Шаурма вкуснее, чем дольше маринуется. шаурматч_ точнее, чем больше им пользуются: три модели
дообучаются на том, что люди и так делают в продукте. Никаких отдельных разметчиков и внешних API.

| Действие в продукте | Чему учит | Модель |
|---|---|---|
| Кандидат отвечает на задание теста | Сложность каждой начинки и шаблона, их различающую силу | Калибровка LLTM + 3PL (MML-EM с априорными распределениями вокруг экспертных значений) |
| Работодатель правит рецепт ползунками | Как текст потребности превращается в навыки | Собственная языковая модель «текст → рецепт» (символьные n-граммы, линейные головы) |
| Кандидат принимает или отклоняет приглашение, работодатель отмечает найм | Кого приглашать, чтобы найм состоялся | Двусторонний ранжировщик: P(подойдёт) × P(примет) |

Код: `engine/app/learn/`, симуляция: `engine/training/marinate.py`, сырые цифры: `metrics.json`.
Все модели — открытые JSON-файлы с весами, без pickle и обфускации.

![Год в перемотке](timelapse.png)

## 1. Год жизни платформы в ускоренной перемотке

Синтетический мир с известной истиной: эксперт ошибся в сложностях заданий примерно так же,
как ошибаются эксперты в психометрической литературе, у кандидатов есть скрытые навыки по каждому ингредиенту,
а решения «принять приглашение» и «нанять» они принимают по скрытым правилам (деньги, формат,
переквалификация, репутация компании, истинное совпадение навыков). Каждый месяц приходят
{m['per_month']} кандидатов и {m['vacancies_per_month']} вакансий, а в конце месяца модели дообучаются.

| | Месяц 1 | Месяц {last['month']} |
|---|---|---|
| Накоплено ответов на задания | {first['responses']:,} | {last['responses']:,} |
| Ошибка сложности начинок η, RMSE (эксперт: {first['rmse_expert']['eta']}) | {first['rmse_learned']['eta']} | **{last['rmse_learned']['eta']}** |
| Ошибка базовой сложности шаблонов, RMSE (эксперт: {first['rmse_expert']['b0']}) | {first['rmse_learned']['b0']} | **{last['rmse_learned']['b0']}** |
| Ошибка дискриминации, RMSE log a (эксперт: {first['rmse_expert']['a']}) | {first['rmse_learned']['a']} | **{last['rmse_learned']['a']}** |
| Наймов на 10 приглашений | {first['hires_per_10']} | **{last['hires_per_10']}** |
| Приглашений принято | {first['acceptance']:.0%} | **{last['acceptance']:.0%}** |

![η](eta.png)

## 2. До и после на одних и тех же людях

Свежая когорта из 2000 кандидатов проходит тест дважды на одних и тех же случайных числах:
с экспертными параметрами и с выученными. 150 новых вакансий ранжируются ручной формулой ШАУРМЫ
и обученным ранжировщиком.

| Метрика | До (эксперт / формула) | После (Маринад) |
|---|---|---|
| Грейд определён точно | {cf['grade']['expert']['exact']:.1%} | **{cf['grade']['learned']['exact']:.1%}** |
| κ Коэна (квадратичная) | {cf['grade']['expert']['kappa']} | **{cf['grade']['learned']['kappa']}** |
| Доля завышенных грейдов | {cf['grade']['expert']['overestimated']:.1%} | **{cf['grade']['learned']['overestimated']:.1%}** |
| Наймов на 10 приглашений | {cf['matching']['hand']['hires_per_10']} | **{cf['matching']['learned']['hires_per_10']}** |
| Приглашений принято | {cf['matching']['hand']['acceptance']:.0%} | **{cf['matching']['learned']['acceptance']:.0%}** |

![До и после](before_after.png)

## 3. Детектор «чёрствого лаваша»

Банк шаблонов ШАУРМЫ открыт, и ответы не утекают: варианты уникальны. Но может «утечь приём»:
разбор трюка начинки завирусился, и задание перестаёт различать сильных и слабых. В {d['viral_month']}-м месяце
так случилось с начинкой «{viral_title}» (`{d['viral_key']}`): 70% новых кандидатов видели разбор.

Для каждого ответа считается остаток «ответ минус предсказание текущей модели». У любой начинки есть постоянное
небольшое несоответствие модели, поэтому детектор ищет не отклонение от нуля, а **изменение**: после разогрева
(150 ответов) он копит CUSUM по отклонению остатков от собственной прошлой нормы начинки (k = {d['k']}, h = {d['h']}).
{det_txt}
{viral_txt}
Ложных тревог на других начинках за год: {len(fa)}{' (' + ', '.join(f'`{k}`' for k in fa) + ')' if fa else ''}.

## 4. Своя языковая модель вместо словаря

Корпус — {L['corpus_size']:,} сгенерированных описаний потребностей (банки формулировок по навыкам, грейдам и стекам;
парсить чужие вакансии ТЗ запрещает). Проверка — на **{L['eval_size']} текстах, написанных вручную отдельно**
и генератором не порождаемых: в них много формулировок, которых нет в словаре («двойные списания»,
«одно место продаётся двум людям», «трёхзначная логика»).

| | Словарь правил | Модель шаурматч_ |
|---|---|---|
| Специализация | {L['rules']['specialization']:.0%} | **{L['model']['specialization']:.0%}** |
| Грейд | {L['rules']['grade']:.0%} | **{L['model']['grade']:.0%}** |
| Заказанные навыки в топ-3 рецепта | {L['rules']['ingredients_hit3']:.0%} | **{L['model']['ingredients_hit3']:.0%}** |

Обучение на правках (4 фолда: модель видит k вручную размеченных текстов как «правки работодателей»
и проверяется на остальных): навыки в топ-3 {' → '.join(f"{curve[k]['ingredients_hit3']:.0%}" for k in ck)},
грейд {' → '.join(f"{curve[k]['grade']:.0%}" for k in ck)} при k = {', '.join(str(k) for k in ck)}.

![Язык](language.png)

## 5. Чему научился подбор

Веса обеих голов открыты и названы по-русски, поэтому подбор остаётся объяснимым:
работодатель видит не только «почему кандидат подходит», но и «примет ли он ваше приглашение».

![Подбор](ranker.png)

## Как это работает в продукте
- **Калибровка теста** учится только на живых ответах: в образ она не запекается, иначе тест выучил бы
  сложности вымышленного мира. Пока ответов мало, априорное распределение держит параметры у экспертных значений.
  Пересчёт запускается автоматически каждые 300 новых ответов и пишется в журнал версий (`model_versions`).
- **Ранжировщик** стартует с весов, выученных на симуляции («тёплый старт»), и дообучается на реальных
  ответах на приглашения с L2-притяжением к стартовым весам.
- **Языковая модель** запечена в образ (корпус + ручные тексты) и переобучается, когда работодатель правит рецепт.
- **Откат** к экспертным параметрам — одна команда; каждая версия модели хранится с метриками.

## Ограничения
- Мир синтетический: абсолютные цифры зависят от допущений о поведении людей. Механизм проверен,
  величина эффекта на реальном рынке будет другой.
- Ручная выборка для языковой модели маленькая ({L['eval_size']} текстов), поэтому погрешность около ±7 п. п.
- Ранжировщик учится на приглашениях, которые сам же и предложил. Чтобы не замкнуться на собственном топе,
  одно из пяти приглашений в симуляции — «тёмная лошадка» из топ-30.
"""
    (OUT / "report.md").write_text(md, encoding="utf-8")
