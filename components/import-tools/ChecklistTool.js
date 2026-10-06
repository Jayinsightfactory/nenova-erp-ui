import React, { useRef, useState } from 'react';
import {useImportTeamRecord} from '../../lib/importTeamClient';
import {
  MONTHLY_TASKS, EMPLOYEES, PLANT_VARIETIES, SHARED_KEYS,
  getKstDate, isDate, checklistDayKey, checklistMonthKey, checklistVacationKey,
  weekdayForDate, weekDates, dailyTasks, checklistProgress, monthlyTaskKey,
  sortFlights, upsertEntry, deleteEntry, validateVacation, vacationSummary,
  validatePlanting, plantingSummary, groupPlanting, fmtUSD,
  checklistErrorMessage, saveChecklistDraft,
} from '../../lib/importTeamChecklist';

const EMPTY_OBJECT = {};
const EMPTY_LIST = [];
const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

function useManagedRecord(key, initialValue) {
  const record = useImportTeamRecord(key, initialValue);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [notice, setNotice] = useState('');
  async function run(nextValue, onSuccess) {
    if (lock.current || record.loading || record.saving) return false;
    lock.current = true;
    setBusy(true);
    setLocalError(null);
    setNotice('');
    try {
      await saveChecklistDraft(record.save, nextValue, onSuccess);
      setNotice('공동 저장 완료');
      return true;
    } catch (error) {
      setLocalError(error);
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function reload() {
    if (lock.current || record.saving) return;
    setLocalError(null);
    setNotice('');
    try {
      await record.reload();
    } catch (error) { setLocalError(error); }
  }
  return { ...record, key, value: record.value ?? initialValue, busy: busy || record.saving || record.loading, error: localError ?? record.error, run, reload, notice, fail: setLocalError };
}

function RecordStatus({ record, dirty = false }) {
  return <div className="record-status" aria-live="polite">
    <span>{record.loading ? '공동 상태 불러오는 중…' : record.busy ? '공동 저장 중…' : dirty ? '미저장 초안' : record.notice || '공동 상태'} · revision {record.revision ?? 0}</span>
    <button type="button" disabled={record.busy} onClick={record.reload}>최신 상태 다시 불러오기 (초안 유지)</button>
    {record.error && <div role="alert" className="error">{checklistErrorMessage(record.error)}</div>}
  </div>;
}

function ChecksPanel({ date, month }) {
  const daily = !!date;
  const record = useManagedRecord(daily ? checklistDayKey(date) : checklistMonthKey(month), EMPTY_OBJECT);
  const [draft, setDraft] = useState(null);
  const state = draft?.value ?? record.value;
  const stale = draft !== null && draft.revision !== record.revision;
  function toggle(key, checked) {
    setDraft(previous => ({ revision: previous?.revision ?? record.revision, value: { ...(previous?.value ?? record.value), [key]: checked } }));
  }
  const progress = daily ? checklistProgress(date, state) : null;
  return <section className="panel">
    <h3>{daily ? `${date} · ${weekdayForDate(date).full}` : `Pagos Mensuales · Colombia · ${month}`}</h3>
    <RecordStatus record={record} dirty={draft !== null} />
    {stale && <div role="alert" className="error">공동 상태가 바뀌었습니다. 아래 체크 옆의 저장값과 초안을 비교하세요.
      <button type="button" disabled={record.busy} onClick={() => setDraft(previous => ({ ...previous, revision: record.revision }))}>비교 완료 · 초안 재확인</button>
    </div>}
    {progress && <p>Progreso {progress.done} / {progress.total} · {progress.percent}% {draft && '(미저장 초안 기준)'}</p>}
    <fieldset disabled={record.busy}>
      <div className="cards">
        {(daily ? dailyTasks(date) : [{ country: 'Pagos', tasks: MONTHLY_TASKS.map((task, index) => ({ key: monthlyTaskKey(task, index), text: `Día ${task.day} · ${task.desc}` })) }]).map(group => <div className="task-group" key={group.country}>
          <h4>{group.country}</h4>
          {group.tasks.map(task => <label className="check-row" key={task.key}>
            <input type="checkbox" checked={state[task.key] === true} onChange={event => toggle(task.key, event.target.checked)} />
            <span>{task.text}{draft && <small> (공동 저장값: {record.value[task.key] === true ? '✓' : '—'})</small>}</span>
          </label>)}
        </div>)}
      </div>
    </fieldset>
    <div className="actions">
      <button type="button" disabled={record.busy || !draft || stale} onClick={() => record.run(draft.value, () => setDraft(null))}>초안 공동 저장</button>
      <button type="button" disabled={record.busy || !draft} onClick={() => setDraft(null)}>초안 취소</button>
      <button type="button" disabled={record.busy} onClick={() => { if (window.confirm(daily ? `¿Reiniciar las tareas del ${date}?` : `¿Reiniciar las tareas mensuales de ${month}?`)) record.run({}, () => setDraft(null)); }}>{daily ? 'Reiniciar día actual' : 'Reiniciar tareas mensuales'}</button>
    </div>
  </section>;
}

function NotesPanel({ flights = false }) {
  const record = useManagedRecord(flights ? SHARED_KEYS.flights : SHARED_KEYS.pending, EMPTY_LIST);
  const [text, setText] = useState('');
  const [editId, setEditId] = useState(null);
  const list = flights ? sortFlights(record.value) : record.value;
  const count = list.filter(row => flights ? !row.banib : !row.done).length;
  function cancel() { setText(''); setEditId(null); }
  async function submit(event) {
    event.preventDefault();
    if (!text.trim()) { record.fail(new Error('업무 내용을 입력하세요.')); return; }
    const previous = record.value.find(row => row.id === editId);
    if (editId !== null && !previous) { record.fail(new Error('다른 팀원이 이 항목을 삭제했습니다. 초안은 유지됩니다.')); return; }
    const entry = previous ? { ...previous, text: text.trim() } : flights ? { id: newId(), text: text.trim(), llegado: false, banib: false } : { id: newId(), text: text.trim(), done: false };
    await record.run(upsertEntry(record.value, entry), cancel);
  }
  return <section className="panel">
    <h3>{flights ? 'Aviones de la semana' : 'Pendientes'} · {count} 미완료</h3>
    <RecordStatus record={record} dirty={text !== '' || editId !== null} />
    <form onSubmit={submit}>
      <fieldset disabled={record.busy} className="form-row">
        <label>{flights ? '항공 일정 원문' : '미결 업무'}<textarea rows={flights ? 4 : 2} maxLength={flights ? 10000 : 200} value={text} onChange={event => setText(event.target.value)} placeholder={flights ? '22-2차 콜수국 (POLAR)\n5월 30일(토) 12:15 도착 예정\n(992-01527724 PO947 353 BOX)' : 'Escribe algo pendiente…'} /></label>
        <button type="submit">{editId !== null ? '수정 공동 저장' : '+ Añadir · 공동 저장'}</button>
        <button type="button" onClick={cancel}>Cancelar</button>
      </fieldset>
    </form>
    {flights && <small>일정은 KST 기준으로 정렬합니다. 날짜가 없으면 맨 뒤, 60일 이상 지난 일정은 다음 연도로 추정합니다.</small>}
    {!list.length && !record.loading && <p>{flights ? 'Sin aviones' : 'Sin pendientes — añade lo que no quieras olvidar'}</p>}
    <div className="record-list">{list.map(row => <div className="entry" key={row.id}>
      <div className="entry-text">{row.text}</div>
      <div className="actions">
        {(flights ? [{ field: 'llegado', label: 'Llegado' }, { field: 'banib', label: '반입' }] : [{ field: 'done', label: '완료' }]).map(({ field, label }) => <label key={field}>
          <input type="checkbox" disabled={record.busy} checked={row[field] === true} onChange={event => record.run(upsertEntry(record.value, { ...row, [field]: event.target.checked }))} /> {label}
        </label>)}
        <button type="button" disabled={record.busy} onClick={() => { setEditId(row.id); setText(row.text); }}>수정</button>
        <button type="button" disabled={record.busy} onClick={() => { if (window.confirm('¿Eliminar esta entrada?')) record.run(deleteEntry(record.value, row.id), () => { if (editId === row.id) cancel(); }); }}>Eliminar</button>
      </div>
    </div>)}</div>
  </section>;
}

const emptyVacation = () => ({ employee: 'Gabriel', start: '', end: '', days: '', note: '' });
function VacationPanel({ year }) {
  const record = useManagedRecord(checklistVacationKey(year), EMPTY_LIST);
  const [draft, setDraft] = useState(emptyVacation);
  const [editId, setEditId] = useState(null);
  const [filter, setFilter] = useState('all');
  function cancel() { setDraft(emptyVacation()); setEditId(null); }
  function field(name, value) { setDraft(previous => ({ ...previous, [name]: value })); }
  async function submit(event) {
    event.preventDefault();
    try {
      const fields = validateVacation(draft, year);
      if (editId !== null && !record.value.some(row => row.id === editId)) throw new Error('다른 팀원이 이 항목을 삭제했습니다. 초안은 유지됩니다.');
      await record.run(upsertEntry(record.value, { ...fields, id: editId ?? newId() }), cancel);
    } catch (error) { record.fail(error); }
  }
  const list = record.value.filter(row => filter === 'all' || row.employee === filter).sort((a, b) => String(b.start ?? '').localeCompare(String(a.start ?? '')));
  return <section className="panel">
    <h3>Vacaciones · {year}</h3>
    <RecordStatus record={record} dirty={editId !== null || !!(draft.start || draft.days || draft.note)} />
    <div className="cards">{vacationSummary(record.value).map(employee => <div className={`summary ${employee.status}`} key={employee.name}>
      <h4>{employee.name}</h4><p>Días restantes: {employee.remaining} / {employee.total}</p><p>Usados: {employee.used} días</p>
      <progress max="100" value={employee.percent} aria-label={`${employee.name} 잔여 휴가 비율`} />
    </div>)}</div>
    <form onSubmit={submit}>
      <fieldset disabled={record.busy} className="form-row">
        <label>Empleado<select value={draft.employee} onChange={event => field('employee', event.target.value)}>{EMPLOYEES.map(employee => <option key={employee.name}>{employee.name}</option>)}</select></label>
        <label>Inicio<input type="date" value={draft.start} onChange={event => field('start', event.target.value)} /></label>
        <label>Fin<input type="date" value={draft.end} onChange={event => field('end', event.target.value)} /></label>
        <label>Días<input type="number" min="0.5" step="0.5" value={draft.days} onChange={event => field('days', event.target.value)} /></label>
        <label>Nota<input maxLength={100} value={draft.note} onChange={event => field('note', event.target.value)} /></label>
        <button type="submit">{editId !== null ? '수정 공동 저장' : '+ Nueva entrada · 공동 저장'}</button>
        <button type="button" onClick={cancel}>Cancelar</button>
      </fieldset>
    </form>
    <p>휴가 일수는 원본처럼 직접 입력하며 시작일 연도로 저장합니다. 다른 연도는 먼저 위 연도를 선택하세요.</p>
    <label>Ver: <select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Todos</option>{EMPLOYEES.map(employee => <option key={employee.name}>{employee.name}</option>)}</select></label>
    {filter !== 'all' && <p>{filter} · {list.length} entradas · {list.reduce((sum, row) => sum + Number(row.days || 0), 0)} días usados</p>}
    {!list.length && !record.loading && <p>Sin vacaciones registradas para este año</p>}
    <div className="record-list">{list.map(row => <div className="entry" key={row.id}>
      <div>{row.employee} · {row.start} → {row.end} · {row.days} días<div className="entry-text">{row.note}</div></div>
      <div className="actions"><button type="button" disabled={record.busy} onClick={() => { setEditId(row.id); setDraft({ ...row }); }}>수정</button>
        <button type="button" disabled={record.busy} onClick={() => { if (window.confirm('¿Eliminar estas vacaciones?')) record.run(deleteEntry(record.value, row.id), () => { if (editId === row.id) cancel(); }); }}>Eliminar</button></div>
    </div>)}</div>
  </section>;
}

const emptyPlanting = () => ({ variety: PLANT_VARIETIES[0].name, farm: '', boxes: '', price: '', note: '' });
function PlantingPanel() {
  const record = useManagedRecord(SHARED_KEYS.planting, EMPTY_LIST);
  const [draft, setDraft] = useState(emptyPlanting);
  const [editId, setEditId] = useState(null);
  const [view, setView] = useState('farm');
  function cancel() { setDraft(emptyPlanting()); setEditId(null); }
  function field(name, value) { setDraft(previous => ({ ...previous, [name]: value })); }
  async function submit(event) {
    event.preventDefault();
    try {
      const fields = validatePlanting(draft);
      const existing = record.value.find(row => row.id === editId);
      if (editId !== null && !existing) throw new Error('다른 팀원이 이 항목을 삭제했습니다. 초안은 유지됩니다.');
      await record.run(upsertEntry(record.value, { ...existing, ...fields, id: editId ?? newId(), createdAt: existing?.createdAt ?? Date.now() }), cancel);
    } catch (error) { record.fail(error); }
  }
  return <section className="panel">
    <h3>Plan de siembra</h3>
    <RecordStatus record={record} dirty={editId !== null || !!(draft.farm || draft.boxes || draft.price || draft.note)} />
    <div className="cards">{plantingSummary(record.value).map(variety => <div className={`summary ${variety.status}`} key={variety.name}>
      <h4>{variety.name}</h4><p>Asignado: {variety.assigned} / {variety.target} cajas</p>
      <progress max="100" value={variety.percent} aria-label={`${variety.name} 할당 비율`} />
      <p>{variety.status === 'complete' ? '✓ Completo' : variety.status === 'over' ? `⚠ Sobra ${-variety.remaining} cajas` : `Faltan ${variety.remaining} cajas`}</p>
    </div>)}</div>
    <form onSubmit={submit}><fieldset disabled={record.busy} className="form-row">
      <label>Variedad<select value={draft.variety} onChange={event => field('variety', event.target.value)}>{PLANT_VARIETIES.map(variety => <option key={variety.name}>{variety.name}</option>)}</select></label>
      <label>Finca<input list="import-checklist-farms" value={draft.farm} onChange={event => field('farm', event.target.value)} /></label>
      <datalist id="import-checklist-farms">{[...new Set(record.value.map(row => row.farm))].filter(Boolean).sort().map(farm => <option key={farm} value={farm} />)}</datalist>
      <label>Cajas<input type="number" min="0.01" step="any" value={draft.boxes} onChange={event => field('boxes', event.target.value)} /></label>
      <label>USD / tallo<input type="number" min="0" step="any" value={draft.price} onChange={event => field('price', event.target.value)} /></label>
      <label>Nota<input value={draft.note} onChange={event => field('note', event.target.value)} /></label>
      <button type="submit">{editId !== null ? '수정 공동 저장' : '+ Asignación · 공동 저장'}</button>
      <button type="button" onClick={cancel}>Cancelar</button>
    </fieldset></form>
    <p>원본 단가: USD/tallo (줄기당). 줄기/박스 수량이 없으므로 박스 수 × 단가로 금액을 추정하지 않습니다.</p>
    <label>Ver: <select value={view} onChange={event => setView(event.target.value)}><option value="farm">Por finca</option><option value="variety">Por variedad</option><option value="all">Todas</option></select></label>
    {!record.value.length && !record.loading && <p>Sin asignaciones</p>}
    <div className="record-list">{groupPlanting(record.value, view).map(group => <div className="task-group" key={group.name}>
      <h4>{group.name} · {group.entries.length} entradas · {group.boxes} cajas</h4>
      {group.entries.map(row => <div className="entry" key={row.id}>
        <div>{row.variety} · {row.farm} · {row.boxes} cajas · @ {fmtUSD(row.price)}/tallo<div className="entry-text">{row.note}</div></div>
        <div className="actions"><button type="button" disabled={record.busy} onClick={() => { setEditId(row.id); setDraft({ ...row }); }}>수정</button>
          <button type="button" disabled={record.busy} onClick={() => { if (window.confirm('¿Eliminar esta asignación?')) record.run(deleteEntry(record.value, row.id), () => { if (editId === row.id) cancel(); }); }}>Eliminar</button></div>
      </div>)}
    </div>)}</div>
  </section>;
}

// Keep visited panels mounted so changing tab/date/month/year does not discard a failed draft.
export default function ChecklistTool() {
  const [date, setDate] = useState(getKstDate);
  const [month, setMonth] = useState(() => getKstDate().slice(0, 7));
  const [year, setYear] = useState(() => getKstDate().slice(0, 4));
  const [dates, setDates] = useState(() => [getKstDate()]);
  const [months, setMonths] = useState(() => [getKstDate().slice(0, 7)]);
  const [years, setYears] = useState(() => [getKstDate().slice(0, 4)]);
  const [tab, setTab] = useState('daily');
  function chooseDate(next) { if (isDate(next)) { setDate(next); setDates(previous => previous.includes(next) ? previous : [...previous, next]); } }
  function chooseMonth(next) { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(next)) { setMonth(next); setMonths(previous => previous.includes(next) ? previous : [...previous, next]); } }
  function chooseYear(next) { if (/^\d{4}$/.test(next)) { setYear(next); setYears(previous => previous.includes(next) ? previous : [...previous, next]); } }
  return <div className="import-checklist">
    <header><h2>Import Team · Checklist Diario</h2><p>팀 공동 업무 상태 · KST 기준 · ERP 원장에는 반영하지 않습니다.</p></header>
    <nav className="actions" aria-label="체크리스트 도구">
      {[['daily', 'Checklist'], ['flights', 'Aviones'], ['vacations', 'Vacaciones'], ['planting', 'Plan de siembra']].map(([key, label]) => <button type="button" key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}
    </nav>
    <div hidden={tab !== 'daily'}>
      <div className="selectors"><label>실제 업무 날짜 (YYYY-MM-DD)<input type="date" value={date} onChange={event => chooseDate(event.target.value)} /></label>
        <label>결제 월 (YYYY-MM)<input type="month" value={month} onChange={event => chooseMonth(event.target.value)} /></label></div>
      <div className="actions" aria-label="선택 날짜의 주간 요일">{weekDates(date).map(day => <button type="button" key={day.date} aria-pressed={date === day.date} onClick={() => chooseDate(day.date)}>{day.label} · {day.date}</button>)}</div>
      <NotesPanel />
      {dates.map(value => <div hidden={date !== value} key={value}><ChecksPanel date={value} /></div>)}
      {months.map(value => <div hidden={month !== value} key={value}><ChecksPanel month={value} /></div>)}
    </div>
    <div hidden={tab !== 'flights'}><NotesPanel flights /></div>
    <div hidden={tab !== 'vacations'}><div className="selectors"><label>휴가 연도<input type="number" min="1000" max="9999" step="1" value={year} onChange={event => chooseYear(event.target.value)} /></label>
      <button type="button" disabled={Number(year) <= 1000} onClick={() => chooseYear(String(Number(year) - 1))}>‹ 이전 연도</button>
      <button type="button" disabled={Number(year) >= 9999} onClick={() => chooseYear(String(Number(year) + 1))}>다음 연도 ›</button></div>
      {years.map(value => <div hidden={year !== value} key={value}><VacationPanel year={value} /></div>)}
    </div>
    <div hidden={tab !== 'planting'}><PlantingPanel /></div>
    <style jsx global>{`
      .import-checklist { width:100%; min-width:0; color:#25354a; font-size:14px; }
      .import-checklist [hidden] { display:none !important; }
      .import-checklist h2,.import-checklist h3,.import-checklist h4 { margin:0 0 10px; }
      .import-checklist p { margin:8px 0; }
      .import-checklist .panel { background:#fff; border:1px solid #cbd5e1; border-radius:8px; padding:16px; margin:12px 0; min-width:0; }
      .import-checklist .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr)); gap:12px; }
      .import-checklist .task-group,.import-checklist .summary { border:1px solid #dae2eb; border-radius:6px; padding:12px; min-width:0; overflow-wrap:anywhere; }
      .import-checklist .check-row { display:flex; gap:8px; align-items:flex-start; padding:6px 0; overflow-wrap:anywhere; }
      .import-checklist input[type=checkbox] { flex-shrink:0; margin-top:3px; }
      .import-checklist small { color:#64748b; }
      .import-checklist .record-status,.import-checklist .actions,.import-checklist .selectors,.import-checklist .form-row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
      .import-checklist .record-status { margin:8px 0 12px; }
      .import-checklist .actions { margin:8px 0; }
      .import-checklist button { border:1px solid #94a3b8; background:#f8fafc; border-radius:5px; padding:7px 10px; color:inherit; cursor:pointer; white-space:normal; }
      .import-checklist button[aria-pressed=true] { background:#dbeafe; border-color:#2563eb; }
      .import-checklist button:disabled { opacity:.55; cursor:wait; }
      .import-checklist input,.import-checklist textarea,.import-checklist select { max-width:100%; border:1px solid #94a3b8; border-radius:4px; padding:6px; font:inherit; color:inherit; }
      .import-checklist textarea { display:block; width:100%; min-width:0; resize:vertical; }
      .import-checklist .form-row { align-items:flex-end; padding:8px 0; }
      .import-checklist .form-row label,.import-checklist .selectors label { display:flex; flex-direction:column; gap:4px; min-width:0; }
      .import-checklist .form-row label:has(textarea) { flex:1 1 360px; }
      .import-checklist fieldset { border:0; margin:0; padding:0; min-width:0; }
      .import-checklist .record-list { max-height:480px; overflow:auto; margin-top:12px; }
      .import-checklist .entry { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; padding:10px 0; border-bottom:1px solid #e2e8f0; }
      .import-checklist .entry>div { min-width:0; overflow-wrap:anywhere; }
      .import-checklist .entry-text { white-space:pre-wrap; overflow-wrap:anywhere; flex:1 1 280px; }
      .import-checklist .error { color:#991b1b; background:#fef2f2; border:1px solid #fecaca; border-radius:4px; padding:8px; flex-basis:100%; overflow-wrap:anywhere; }
      .import-checklist .warning,.import-checklist .over { border-color:#d97706; }
      .import-checklist .danger { border-color:#dc2626; color:#991b1b; }
      .import-checklist .complete { border-color:#16a34a; }
      .import-checklist progress { width:100%; max-width:280px; }
      @media(max-width:700px) { .import-checklist .panel { padding:10px; } .import-checklist .form-row label { flex:1 1 100%; } }
    `}</style>
  </div>;
}
