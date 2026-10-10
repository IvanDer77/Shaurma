import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PublicShell } from "../../layout";

const PARTS = [
  ["Ш", "Шаблоны", "лаваш", "Банк базовых задач открыт: секретов нет — сливать нечего. Готовиться по нему честно и полезно."],
  ["А", "Адаптивная сборка по заказу", "заказ", "Вакансия превращается в рецепт навыков-ингредиентов; тест подстраивается под ответы и стартует с заявленного грейда."],
  ["У", "Уникальная начинка", "начинка", "Каждый получает свой вариант: шаблон + seed + операторы мутации. Сложность варианта известна заранее (LLTM), а правильный ответ — результат запуска кода, не нейросети."],
  ["Р", "Рейтинг на вертеле", "вертел", "Glicko-2 по каждому ингредиенту: кандидат «играет матчи» против задач. Без практики рейтинг остывает — регулярные задачи возвращают профиль наверх."],
  ["М", "Матчинг вслепую", "окошко", "Подборка по категориям теста с объяснением. «Слепая дегустация»: компании выбирают анонимные решения и приглашают с вилкой зарплаты."],
  ["А", "Антислив", "фирменный соус", "Канарейки: ответ к чужому варианту выдаёт списавшего и источник утечки. Плюс статистика соответствия ответов модели."],
];

export default function Method() {
  const [m, setM] = useState<any>(null);
  useEffect(() => { fetch("/validation/metrics.json").then((r) => (r.ok ? r.json() : null)).then(setM).catch(() => setM(null)); }, []);
  const L = m?.leak, M = m?.matching;
  return (
    <PublicShell>
      <div>
        <span className="eyebrow">Механика тестирования и подбора</span>
        <h1 className="page-title" style={{ marginTop: 8 }}>Метод «ШАУРМА»</h1>
        <p className="page-sub" style={{ fontSize: 18, color: "var(--ink)" }}>Задачу можно слить. Шаурму — нет: каждую заворачивают заново, при вас и по вашему заказу.</p>
        <p className="page-sub">Ядро — единое «Меню ингредиентов»: один и тот же навык задаёт сложность задачи, измеряется у кандидата и заказывается работодателем. Тест, профиль и вакансия говорят на одном языке.</p>
      </div>

      <section className="col" style={{ gap: 14 }}>
        <h2 className="h2">Шесть частей метода</h2>
        <div className="rows">
          {PARTS.map(([l, t, s, d], i) => (
            <div key={i} className="ri" style={{ alignItems: "flex-start", gap: 24 }}>
              <span className="big-num" style={{ width: 48, flexShrink: 0 }}>{l}</span>
              <div className="ri-main" style={{ gap: 6 }}>
                <span className="row" style={{ gap: 10 }}><span className="ri-title" style={{ fontSize: 18, fontWeight: 700 }}>{t}</span><span className="tag-line">{s}</span></span>
                <span className="ri-sub" style={{ lineHeight: 1.6, maxWidth: 820 }}>{d}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="col" style={{ gap: 18 }}>
        <h2 className="h2">Валидация на синтетическом мире</h2>
        {!m ? <span className="muted">Отчёт валидации ещё не сгенерирован (engine/validation/simulate.py).</span> : (
          <>
            <p className="page-sub" style={{ marginTop: 0 }}>{m.n_candidates} синтетических кандидатов с известными истинными навыками прошли ту же механику, что и живые пользователи. Сравниваем результат с истиной.</p>
            <div className="tiles" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,260px),1fr))" }}>
              {[
                [`${Math.round(m.grade_within_one * 100)}%`, "грейд верен ±1 уровень"],
                [m.grade_kappa_quadratic, "κ Коэна: тест против истины"],
                [`${Math.round(m.retest_agreement * 100)}%`, "тот же грейд при пересдаче на других вариантах"],
                [m.template_discrimination_mean, "дискриминативность заданий, r_pb"],
                [`+${L.fixed_test_inflation_cheaters}`, "завышение грейда у фиксированного теста при сливе"],
                [`${L.shaurma_inflation_cheaters > 0 ? "+" : ""}${L.shaurma_inflation_cheaters}`, "завышение у ШАУРМЫ при сливе всего банка"],
                [`${Math.round(L.shaurma_cheaters_caught_by_canary * 100)}%`, "списывающих поймано канарейками"],
                [M.shaurma.precision_at_10, `Precision@10 подбора (BM25 по резюме — ${M.bm25.precision_at_10})`],
              ].map(([v, t]) => (
                <div key={String(t)} style={{ borderTop: "var(--hair)" }}><span className="tile-num" style={{ fontSize: 40 }}>{v}</span><span className="tile-label">{t}</span></div>
              ))}
            </div>
            <div className="split">
              {[["leak.png", "Устойчивость к сливу банка задач"], ["matching.png", "Качество подборки на 60 вакансиях"], ["confusion.png", "Категоризация: истина против теста"]].map(([f, t]) => (
                <figure key={f} className="col" style={{ margin: 0, gap: 8, background: "var(--white)", border: "var(--rule)", padding: 16 }}>
                  <img src={`/validation/${f}`} alt={t} style={{ width: "100%" }} />
                  <figcaption className="small muted">{t}</figcaption>
                </figure>
              ))}
            </div>
          </>
        )}
      </section>

      <div className="row rule-top" style={{ paddingTop: 24 }}>
        <Link to="/?mode=register" className="btn btn-primary btn-lg">Пройти тест</Link>
        <Link to="/marinade" className="btn btn-outline btn-lg">Маринад</Link>
      </div>
    </PublicShell>
  );
}
