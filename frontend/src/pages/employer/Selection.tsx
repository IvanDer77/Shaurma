import { useEffect, useMemo, useState } from "react";
import { api, qs } from "../../api";
import { GRADE_TITLES, SPEC_TITLES, range } from "../../format";
import { useApi } from "../../hooks";
import { Empty, ErrorBox, Field, Skeleton, Spinner, useToast } from "../../ui";
import { CandidateDrawer, CandidateRow, InviteDrawer } from "./shared";

const EXAMPLE = "Ищем Middle backend-разработчика в команду платежей: Python или Go, PostgreSQL, Kafka, идемпотентная обработка событий, REST API. Удалёнка или гибрид, 250-330 тыс.";
const SOURCE: Record<string, string> = { rules: "словарь", "proof-model": "модель шаурматч_", llm: "LLM" };

/** Рецепт: специализация, грейд, вилка из текста и веса ингредиентов с цитатами-доказательствами. */
export function RecipeEditor({ recipe, onChange }: { recipe: any; onChange: (r: any) => void }) {
  const dict = useApi<any>("/dict");
  if (!dict.data) return <Spinner />;
  const ings = Object.entries(recipe.ingredients as Record<string, number>).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...ings.map(([, w]) => w), 0.01);
  const total = ings.reduce((s, [, x]) => s + x, 0) || 1;
  const setW = (id: string, w: number) => onChange({ ...recipe, ingredients: { ...recipe.ingredients, [id]: w } });
  return (
    <div className="col" style={{ gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 14 }}>
        <Field label="Специализация">
          <select className="select" value={recipe.specialization} onChange={(e) => onChange({ ...recipe, specialization: e.target.value })}>
            {dict.data.specializations.map((s: any) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </Field>
        <Field label="Грейд">
          <select className="select" value={recipe.grade} onChange={(e) => onChange({ ...recipe, grade: e.target.value })}>
            {dict.data.grades.map((g: any) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </Field>
      </div>
      {recipe.salary_from && <span className="small">Вилка из текста: <span className="money" style={{ fontSize: 14 }}>{range(recipe.salary_from, recipe.salary_to ?? recipe.salary_from)}</span></span>}
      <div className="col">
        {ings.map(([id, w]) => {
          const fill = (w / max) * 100;
          return (
            <div key={id} className="col" style={{ gap: 6, borderTop: "var(--hair)", padding: "12px 0 6px" }}>
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{dict.data.ingredients[id]?.title ?? id}</span>
                <span className="num" style={{ fontSize: 13 }}>{Math.round((w / total) * 100)}%</span>
              </div>
              {recipe.evidence?.[id]?.length > 0 && <span className="small muted">в тексте: {recipe.evidence[id].slice(0, 2).map((e: string) => <span key={e} className="hl" style={{ marginRight: 4 }}>{e}</span>)}</span>}
              <input type="range" className="slider" min={0} max={1} step={0.01} value={w / max} style={{ ["--fill" as any]: `${fill}%` }}
                onChange={(e) => setW(id, Math.max(0.001, Number(e.target.value) * max))} aria-label={`Вес: ${dict.data.ingredients[id]?.title}`} />
            </div>
          );
        })}
      </div>
      {recipe.stacks?.length > 0 && <span className="small">Стек: <span className="vtag">{recipe.stacks.join(", ")}</span></span>}
    </div>
  );
}

function NeedForm({ onCreated, onCancel, onParsed }: { onCreated: (n: any) => void; onCancel?: () => void; onParsed: (v: boolean) => void }) {
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [recipe, setRecipe] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => onParsed(!!recipe), [recipe, onParsed]);
  const parse = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.post("/employer/needs/parse", { text });
      setRecipe(r);
      if (!title) setTitle(`${GRADE_TITLES[r.grade]} ${SPEC_TITLES[r.specialization].toLowerCase()}`);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setError(null);
    try { onCreated(await api.post("/employer/needs", { title, text, recipe })); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 className="h2">Новая потребность</h2>
        {onCancel && <button className="linkbtn" onClick={onCancel}>Отмена</button>}
      </div>
      <span className="small" style={{ color: "var(--ink-2)", lineHeight: 1.5 }}>Опишите словами, кто нужен и чем занимается команда. Разложим текст на специализацию, грейд и ингредиенты — по ним строится подборка.</span>
      <textarea className="textarea" rows={6} value={text} onChange={(e) => { setText(e.target.value); setRecipe(null); }} placeholder={EXAMPLE} aria-label="Описание потребности" />
      <div className="row">
        <button className={`btn btn-md ${recipe ? "btn-outline" : "btn-primary"}`} onClick={parse} disabled={busy || text.length < 10}>{busy && !recipe ? <><span className="spin" />Разбираю…</> : recipe ? "Разобрать заново" : "Разобрать в рецепт"}</button>
        {!text && <button className="linkbtn" onClick={() => setText(EXAMPLE)}>Подставить пример</button>}
      </div>
      {recipe && (
        <>
          <div className="row rule-top" style={{ justifyContent: "space-between", paddingTop: 16 }}><h3 className="h3">Рецепт</h3><span className="small muted">{SOURCE[recipe.source] ?? recipe.source}</span></div>
          <RecipeEditor recipe={recipe} onChange={setRecipe} />
          <Field label="Название потребности"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <button className="btn btn-primary btn-lg btn-block" onClick={save} disabled={busy || title.length < 3}>Сохранить и показать подборку</button>
        </>
      )}
      <ErrorBox error={error} />
    </div>
  );
}

export default function Selection() {
  const needs = useApi<any[]>("/employer/needs");
  const toast = useToast();
  const [needId, setNeedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [parsed, setParsed] = useState(false);
  const [grades, setGrades] = useState<string[]>([]);
  const [fspOnly, setFspOnly] = useState(false);
  const [stack, setStack] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [inviting, setInviting] = useState<any>(null);
  const [draft, setDraft] = useState<any>(null);
  const [limit, setLimit] = useState(12);

  useEffect(() => { if (!needId && needs.data?.length) setNeedId(needs.data[0].id); }, [needs.data, needId]);
  const sel = useApi<any>(needId ? `/employer/needs/${needId}/selection${qs({ grades, fsp_only: fspOnly ? "true" : undefined, stacks: stack ? [stack] : undefined })}` : null, [needId, grades.join(), fspOnly, stack]);
  const need = sel.data?.need ?? needs.data?.find((n) => n.id === needId);
  useEffect(() => { setDraft(need?.recipe ?? null); }, [need?.id, need?.recipe]);
  const stacks = useMemo(() => Array.from(new Set((sel.data?.results ?? []).flatMap((r: any) => r.candidate.stacks))).slice(0, 10) as string[], [sel.data]);
  const dirty = !!draft && !!need && JSON.stringify(draft) !== JSON.stringify(need.recipe);
  const toggleGrade = (g: string) => setGrades(grades.includes(g) ? grades.filter((x) => x !== g) : [...grades, g]);

  const saveRecipe = async () => {
    await api.put(`/employer/needs/${needId}`, { recipe: draft });
    await needs.reload(); await sel.reload();
    toast("Рецепт обновлён — подборка пересчитана");
  };

  if (needs.loading && !needs.data) return <Skeleton h={300} />;
  const showForm = creating || !needs.data?.length;
  const results: any[] = sel.data?.results ?? [];

  return (
    <>
      <div className="row" style={{ gap: 8 }} role="tablist" aria-label="Потребности">
        {(needs.data ?? []).map((n) => (
          <button key={n.id} role="tab" aria-selected={!showForm && n.id === needId} className={`btn btn-md ${!showForm && n.id === needId ? "btn-dark" : "btn-outline"}`}
            style={{ maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-block", lineHeight: "40px" }}
            onClick={() => { setCreating(false); setNeedId(n.id); setGrades([]); setStack(""); setLimit(12); }}>{n.title}</button>
        ))}
        <button className="btn btn-md btn-dashed" aria-pressed={showForm} onClick={() => setCreating(true)}>+ Новая потребность</button>
      </div>

      <div className="sel-grid">
        <aside className="col" style={{ gap: 18 }}>
          {showForm ? (
            <NeedForm onParsed={setParsed} onCancel={needs.data?.length ? () => setCreating(false) : undefined}
              onCreated={(n) => { setCreating(false); needs.reload(); setNeedId(n.id); toast("Потребность сохранена — вот подборка"); }} />
          ) : need && draft ? (
            <>
              <div className="row" style={{ justifyContent: "space-between" }}><h2 className="h2">Рецепт</h2><span className="small muted">{SOURCE[need.recipe?.source] ?? need.recipe?.source ?? ""}</span></div>
              {need.text && <p style={{ borderLeft: "3px solid var(--blue)", padding: "2px 0 2px 14px", fontSize: 14, lineHeight: 1.55, color: "var(--ink-2)", margin: 0 }}>{need.text}</p>}
              <RecipeEditor recipe={draft} onChange={setDraft} />
              {dirty && (
                <div className="row" style={{ gap: 12 }}>
                  <button className="btn btn-primary btn-md" onClick={saveRecipe}>Пересчитать подборку</button>
                  <button className="linkbtn" onClick={() => setDraft(need.recipe)}>Вернуть как было</button>
                </div>
              )}
              <span className="small muted">Правки весов учит «Маринад»: следующие тексты он разберёт точнее.</span>
            </>
          ) : <Skeleton h={300} />}
        </aside>

        <section className="col" style={{ gap: 14, minWidth: 0 }}>
          {showForm ? (
            <div className="rule-top" style={{ paddingTop: 20 }}>
              <p style={{ fontSize: 16 }}>{parsed ? "Проверьте веса слева и сохраните — покажем подборку." : "Опишите потребность слева — подборка появится здесь."}</p>
              <p className="small muted" style={{ marginTop: 8 }}>Выдача строится по категориям, присвоенным тестом, а не по самоописанию в резюме.</p>
            </div>
          ) : (
            <>
              <div className="row" style={{ gap: 8 }}>
                {(sel.data?.categories ?? []).map((c: any) => {
                  const on = grades.includes(c.grade) || (!grades.length && c.recommended);
                  return (
                    <button key={c.code} className={`btn btn-md ${on ? "btn-dark" : "btn-outline"}`} onClick={() => toggleGrade(c.grade)} aria-pressed={on} style={{ gap: 8, fontFamily: "var(--mono)" }}>
                      {c.code} {c.n}{c.recommended && <span style={{ background: "var(--sauce)", color: "var(--ink)", font: "700 11px var(--sans)", padding: "2px 6px" }}>рекомендуем</span>}
                    </button>
                  );
                })}
                <span aria-hidden style={{ width: 1.5, height: 28, background: "var(--ink)", margin: "0 4px" }} />
                <button className="chip" aria-pressed={fspOnly} onClick={() => setFspOnly(!fspOnly)} title="Только с достижениями ФСП">только ФСП</button>
              </div>
              {stacks.length > 0 && (
                <div className="row" style={{ gap: 6 }}>
                  <span className="small muted">Стек:</span>
                  {stack ? <button className="chip sm" aria-pressed onClick={() => setStack("")}>{stack} ×</button>
                    : stacks.map((s) => <button key={s} className="chip sm" onClick={() => setStack(s)}>{s}</button>)}
                </div>
              )}
              <span className="small" style={{ color: "var(--ink-2)" }}>
                {sel.data ? <><b className="mono" style={{ color: "var(--ink)", fontSize: 15 }}>{results.length} кандидатов</b>, в специализации {sel.data.total_in_specialization}, число — насколько подходит, порядок — шанс найма, фильтры поверх рецепта</> : "…"}
              </span>
              {sel.loading && !sel.data ? <Skeleton h={300} /> : sel.error ? <ErrorBox error={sel.error} /> : !results.length ? (
                <Empty title="Никого не нашлось">Ослабьте фильтры или поправьте рецепт — например, снимите «ФСП».</Empty>
              ) : (
                <div className="rule-top">
                  {results.slice(0, limit).map((r: any) => (
                    <CandidateRow key={r.candidate_id} c={r.candidate} match={r.match_percent} why={r.why} invitation={r.invitation_status} accept={r.p_accept}
                      onOpen={() => setOpenId(r.candidate_id)} onInvite={() => setInviting(r.candidate)} />
                  ))}
                  {results.length > limit && <button className="btn btn-outline btn-md btn-block" style={{ marginTop: 16 }} onClick={() => setLimit(limit + 12)}>Показать ещё {results.length - limit}</button>}
                </div>
              )}
            </>
          )}
        </section>
      </div>
      <CandidateDrawer id={openId} needId={needId ?? undefined} onClose={() => setOpenId(null)} onInvite={(c) => { setOpenId(null); setInviting(c); }} />
      <InviteDrawer candidate={inviting} need={need} onClose={() => setInviting(null)} onSent={() => { setInviting(null); sel.reload(); }} />
    </>
  );
}
