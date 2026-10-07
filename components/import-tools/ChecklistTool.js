import React, { useEffect, useRef, useState } from 'react';
import {useImportTeamRecord} from '../../lib/importTeamClient';
import {
  DAYS, MONTHLY_TASKS, EMPLOYEES, PLANT_VARIETIES, SHARED_KEYS,
  getKstDate, isDate, checklistDayKey, checklistMonthKey, checklistVacationKey,
  weekdayForDate, weekDates, dailyTasks, checklistProgress, monthlyTaskKey,
  sortFlights, upsertEntry, deleteEntry, validateVacation, vacationSummary,
  validatePlanting, plantingSummary, groupPlanting, fmtUSD,
  checklistErrorMessage, saveChecklistDraft,
  checklistTemplateKey, defaultWeekdayTemplate, validateWeekdayTemplate,
  rebaseChecklistDraft, checkedActorLabel,
  checklistEmployeeSettingsKey, validatePlantingSettings,
  checklistSettingsOptions,
  validateEmployeeSettingsChange, adjustVacationRemaining,
  validateVacationEntries, validatePlantingEntries,
} from '../../lib/importTeamChecklist';
import {
  checklistTaskLabel, checklistCountryLabel, checklistMonthlyLabel,
  checklistWeekdayLabel, checklistErrorLabel,
} from '../../lib/importTeamKorean';

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
    <span className={`status-badge ${record.error ? 'status-error' : record.busy ? 'status-neutral' : dirty ? 'status-warning' : record.notice ? 'status-success' : 'status-neutral'}`}>{record.loading ? '공동 상태 불러오는 중…' : record.busy ? '공동 저장 중…' : dirty ? '미저장 초안' : record.notice || '공동 상태'}</span>
    <small className="revision">저장 버전 {record.revision ?? 0}</small>
    <button type="button" disabled={record.busy} onClick={record.reload}>최신 상태 다시 불러오기 (초안 유지)</button>
    {record.error && <div role="alert" className="error">{checklistErrorLabel(checklistErrorMessage(record.error))}</div>}
  </div>;
}

function ChecksPanel({ date, month, templateRecord }) {
  const daily = !!date;
  const record = useManagedRecord(daily ? checklistDayKey(date) : checklistMonthKey(month), EMPTY_OBJECT);
  const [draft, setDraft] = useState(null);
  const state = draft?.value ?? record.value;
  const stale = draft !== null && draft.revision !== record.revision;
  const template = templateRecord?.value;
  const blocked = record.busy || !!templateRecord?.busy || !!templateRecord?.error;
  function toggle(key, checked) {
    setDraft(previous => ({ revision: previous?.revision ?? record.revision, base: previous?.base ?? { ...record.value }, value: { ...(previous?.value ?? record.value), [key]: checked } }));
  }
  const progress = daily ? checklistProgress(date, state, template) : null;
  return <section className="panel">
    <h3>{daily ? `${date} · ${checklistWeekdayLabel(weekdayForDate(date), true)}` : `월별 결제 · 콜롬비아 · ${month}`}</h3>
    <RecordStatus record={record} dirty={draft !== null} />
    {stale && <div role="alert" className="warning-message">공동 상태가 바뀌었습니다. 아래 체크 옆의 저장값과 초안을 비교하세요.
      <button type="button" disabled={blocked} onClick={() => setDraft(previous => rebaseChecklistDraft(previous, record.value, record.revision))}>비교 완료 · 초안 재확인</button>
    </div>}
    {templateRecord && (templateRecord.loading || templateRecord.error) && <RecordStatus record={templateRecord} />}
    {templateRecord && <WeekdayTemplatePanel weekday={weekdayForDate(date)} record={templateRecord} />}
    {progress && <div className="progress-row"><p>완료 {progress.done} / {progress.total}개 · {progress.percent}% {draft && '(미저장 초안 기준)'}</p><progress max="100" value={progress.percent} aria-label="일일 업무 완료율" /></div>}
    <fieldset disabled={blocked}>
      <div className="cards">
        {(daily ? dailyTasks(date, template) : [{ country: 'Pagos', tasks: MONTHLY_TASKS.map((task, index) => ({ key: monthlyTaskKey(task, index), text: checklistMonthlyLabel(task) })) }]).map(group => <div className="task-group" key={group.country}>
          <h4>{checklistCountryLabel(group.country)}<small>{group.tasks.length}개 업무</small></h4>
          {group.tasks.map(task => <label className={`check-row ${state[task.key] === true ? 'checked' : ''}`} key={task.key}>
            <input type="checkbox" checked={state[task.key] === true} onChange={event => toggle(task.key, event.target.checked)} />
            <span>{daily ? checklistTaskLabel(task.text) : task.text}{draft && <small className="saved-value">공동 저장값: {record.value[task.key] === true ? '완료' : '미완료'}</small>}
              {draft && draft.value[task.key] !== draft.base[task.key] && <small className="saved-value pending-check">체크 변경 미저장 · 저장 후 담당자 확정</small>}
              {record.value[task.key] === true && <small className="saved-value">{checkedActorLabel(true, record.taskActors?.[task.key])}</small>}
            </span>
          </label>)}
        </div>)}
      </div>
    </fieldset>
    <div className="actions">
      <button type="button" className="primary" disabled={blocked || !draft || stale} onClick={() => record.run(draft.value, () => setDraft(null))}>초안 공동 저장</button>
      <button type="button" disabled={record.busy || !draft} onClick={() => setDraft(null)}>초안 취소</button>
      <button type="button" className="danger-button" disabled={blocked || stale} onClick={() => { if (window.confirm(daily ? `${date}의 업무 체크를 모두 초기화할까요?\n공동 저장된 체크와 현재 초안이 초기화됩니다.` : `${month}의 월별 결제 체크를 모두 초기화할까요?\n공동 저장된 체크와 현재 초안이 초기화됩니다.`)) record.run({}, () => setDraft(null)); }}>{daily ? '선택 날짜 체크 초기화' : '월별 결제 체크 초기화'}</button>
    </div>
  </section>;
}

function WeekdayTemplatePanel({ weekday, record }) {
  const [draft, setDraft] = useState(null);
  const [editId, setEditId] = useState(null);
  const stale = draft !== null && draft.revision !== record.revision;
  const tasks = record.value.tasks;
  function cancel() { setDraft(null); setEditId(null); }
  function field(name, value) {
    setDraft(previous => ({ ...(previous ?? { country: '', text: '', revision: record.revision }), [name]: value }));
  }
  async function submit(event) {
    event.preventDefault();
    if (!draft || stale || record.busy) return;
    try {
      const existing = tasks.find(task => task.id === editId);
      if (editId !== null && !existing) throw new Error('다른 팀원이 이 업무를 삭제했습니다. 입력 초안은 유지됩니다.');
      // UUIDs never depend on list position or country, so edits/deletes cannot
      // reassign an old country's ::index check to a different task.
      const id = editId ?? `task::${globalThis.crypto.randomUUID()}`;
      const task = { id, country: draft.country.trim(), text: draft.text.trim() };
      const next = { tasks: existing ? tasks.map(row => row.id === id ? task : row) : [...tasks, task] };
      validateWeekdayTemplate(weekday.id, next);
      await record.run(next, cancel);
    } catch (error) { record.fail(error); }
  }
  return <details className="weekday-editor">
    <summary>요일별 업무 추가·수정·삭제 · {checklistWeekdayLabel(weekday, true)}</summary>
    <p>이 목록은 선택 날짜만이 아니라 매주 {checklistWeekdayLabel(weekday, true)}에 반복되는 팀 공동 업무 템플릿입니다. 지난 날짜에도 수정된 목록이 표시됩니다. 날짜별 체크·담당자 기록과 미저장 초안은 별도로 유지됩니다.</p>
    <RecordStatus record={record} dirty={draft !== null} />
    {stale && <div role="alert" className="warning-message">요일 업무 목록이 바뀌었습니다. 최신 목록과 입력 초안을 비교한 뒤 다시 확인하세요.
      <button type="button" disabled={record.busy} onClick={() => setDraft(previous => ({ ...previous, revision: record.revision }))}>목록 비교 완료 · 입력 초안 재확인</button>
    </div>}
    <form onSubmit={submit}><fieldset disabled={record.busy} className="form-row">
      <label>국가·분류<input maxLength={80} value={draft?.country ?? ''} onChange={event => field('country', event.target.value)} /></label>
      <label>반복 업무 내용<textarea rows={2} maxLength={1000} value={draft?.text ?? ''} onChange={event => field('text', event.target.value)} /></label>
      <button type="submit" className="primary" disabled={!draft || stale}>{editId !== null ? '반복 업무 수정 · 공동 저장' : '반복 업무 추가 · 공동 저장'}</button>
      <button type="button" onClick={cancel}>입력 초안 취소</button>
    </fieldset></form>
    {!tasks.length && <p className="empty-state">등록된 반복 업무가 없습니다. 국가·분류와 업무 내용을 입력하여 추가하세요.</p>}
    <div className="record-list" role="region" aria-label={`${checklistWeekdayLabel(weekday, true)} 반복 업무 목록`} tabIndex={0}>{tasks.map(task => <div className="entry" key={task.id}>
      <div>{checklistCountryLabel(task.country)} · {checklistTaskLabel(task.text)}</div>
      <div className="actions">
        <button type="button" disabled={record.busy || draft !== null} onClick={() => { setEditId(task.id); setDraft({ country: task.country, text: checklistTaskLabel(task.text), revision: record.revision }); }}>반복 업무 수정</button>
        <button type="button" className="danger-button" disabled={record.busy || draft !== null} onClick={() => {
          if (window.confirm(`이 반복 업무를 삭제할까요?\n매주 ${checklistWeekdayLabel(weekday, true)}의 팀 공동 목록에서 삭제됩니다. 날짜별 체크 기록은 삭제하지 않습니다.`)) record.run({ tasks: tasks.filter(row => row.id !== task.id) });
        }}>반복 업무 삭제</button>
      </div>
    </div>)}</div>
  </details>;
}

// One shared template scope per weekday; each visited date keeps its own draft.
function WeekdayChecklist({ weekday, dates, date }) {
  const record = useManagedRecord(checklistTemplateKey(weekday.id), defaultWeekdayTemplate(weekday.id));
  return <>{dates.map(value => <div hidden={date !== value} key={value}><ChecksPanel date={value} templateRecord={record} /></div>)}</>;
}

function NotesPanel({ flights = false, onFlightCountChange }) {
  const record = useManagedRecord(flights ? SHARED_KEYS.flights : SHARED_KEYS.pending, EMPTY_LIST);
  const [text, setText] = useState('');
  const [editId, setEditId] = useState(null);
  const [pendingCheck, setPendingCheck] = useState(null);
  const list = flights ? sortFlights(record.value) : record.value;
  const count = list.filter(row => flights ? !row.banib : !row.done).length;
  useEffect(() => {
    if (flights && !record.loading && !record.error) onFlightCountChange?.(count);
  }, [flights, count, record.loading, record.error, onFlightCountChange]);
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
    <h3>{flights ? '주간 항공 일정' : '미결 업무'}<span className="heading-count">{count}건 {flights ? '반입 대기' : '미완료'}</span>{flights&&<span className="heading-count">도착·반입 완료 {list.filter(row=>row.llegado&&row.banib).length}건</span>}</h3>
    <RecordStatus record={record} dirty={text !== '' || editId !== null} />
    <form onSubmit={submit}>
      <fieldset disabled={record.busy} className="form-row">
        <label>{flights ? '항공 일정 원문' : '미결 업무'}<textarea rows={flights ? 4 : 2} maxLength={flights ? 10000 : 200} value={text} onChange={event => setText(event.target.value)} onKeyDown={event=>{if(!flights||event.nativeEvent.isComposing)return;if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();event.currentTarget.form.requestSubmit();}else if(event.key==='Escape'){event.preventDefault();cancel();}}} placeholder={flights ? '22-2차 콜수국 (POLAR)\n5월 30일(토) 12:15 도착 예정\n(992-01527724 PO947 353 BOX)' : '잊지 말아야 할 업무를 입력하세요.'} /></label>
        <button type="submit" className="primary">{editId !== null ? '수정 공동 저장' : flights ? '+ 일정 추가 · 공동 저장' : '+ 업무 추가 · 공동 저장'}</button>
        <button type="button" onClick={cancel}>입력 취소</button>
      </fieldset>
    </form>
    {flights && <small>Ctrl/Cmd+Enter로 저장 · Esc로 입력 취소. 일정은 KST 기준으로 정렬합니다. 날짜가 없으면 맨 뒤, 60일 이상 지난 일정은 다음 연도로 추정합니다.</small>}
    {!list.length && !record.loading && <p className="empty-state">{flights ? '등록된 항공 일정이 없습니다. 위에서 일정을 추가하세요.' : '등록된 미결 업무가 없습니다. 위에서 업무를 추가하세요.'}</p>}
    <div className="record-list" role="region" aria-label={flights ? '항공 일정 목록' : '미결 업무 목록'} tabIndex={0}>{list.map(row => <div className={`entry ${flights && row.llegado && row.banib ? 'flight-complete' : ''}`} key={row.id}>
      <div className="entry-text">{row.text}</div>
      <div className="actions">
        {(flights ? [{ field: 'llegado', label: '도착 완료' }, { field: 'banib', label: '반입 완료' }] : [{ field: 'done', label: '완료' }]).map(({ field, label }) => <label className="inline-check" key={field}>
          <input type="checkbox" disabled={record.busy} checked={row[field] === true} onChange={async event => {
            setPendingCheck(`${row.id}::${field}`);
            try { await record.run(upsertEntry(record.value, { ...row, [field]: event.target.checked })); }
            finally { setPendingCheck(null); }
          }} /> <span>{label}
            {pendingCheck === `${row.id}::${field}` && <small className="saved-value pending-check">체크 변경 저장 중 · 저장 후 담당자 확정</small>}
            {row[field] === true && <small className="saved-value">{checkedActorLabel(true, record.taskActors?.[`${row.id}::${field}`])}</small>}
          </span>
        </label>)}
        <button type="button" disabled={record.busy} onClick={() => { setEditId(row.id); setText(row.text); }}>수정</button>
        <button type="button" className="danger-button" disabled={record.busy} onClick={() => { if (window.confirm(flights ? '이 항공 일정을 삭제할까요?\n팀 공동 목록에서도 삭제됩니다.' : '이 업무를 삭제할까요?\n팀 공동 목록에서도 삭제됩니다.')) record.run(deleteEntry(record.value, row.id), () => { if (editId === row.id) cancel(); }); }}>삭제</button>
      </div>
    </div>)}</div>
  </section>;
}

function SettingsPanel({ record, employees = false, year }) {
  const [draft, setDraft] = useState(null);
  const [editName, setEditName] = useState(null);
  const fieldName = employees ? 'total' : 'target';
  const label = employees ? '직원' : '품종';
  const numberLabel = employees ? '연간 연차 (일)' : '목표 (박스)';
  const stale = draft !== null && draft.revision !== record.revision;
  function cancel() { setDraft(null); setEditName(null); }
  function field(name, value) {
    setDraft(previous => ({ ...(previous ?? { name: '', amount: '', reason: '', revision: record.revision }), [name]: value }));
  }
  async function submit(event) {
    event.preventDefault();
    if (!draft || stale || record.busy) return;
    try {
      if (draft.amount.trim() === '') throw new Error('연차·목표를 입력하세요. 0도 저장할 수 있습니다.');
      if (editName !== null && !record.value.some(row => row.name === editName)) throw new Error('다른 팀원이 이 설정을 삭제했습니다. 초안은 유지됩니다.');
      const previous = record.value.find(row => row.name === editName);
      if (employees && previous && previous.total !== Number(draft.amount) && !draft.reason.trim()) throw new Error('연차·잔여 일수를 변경하려면 조정 사유를 입력하세요.');
      const row = { ...previous, name: editName ?? draft.name.trim(), [fieldName]: Number(draft.amount), ...(employees && draft.reason.trim() ? { adjustmentReason: draft.reason.trim() } : {}) };
      delete row.remainingAdjustment;
      const next = editName === null ? [...record.value, row] : record.value.map(item => item.name === editName ? row : item);
      if (employees) validateEmployeeSettingsChange(record.value, next);
      else validatePlantingSettings(next);
      await record.run(next, cancel);
    } catch (error) { record.fail(error); }
  }
  return <details className="weekday-editor">
    <summary>{employees ? `${year}년 직원·연차 설정` : '공통 품종·목표 설정'} · 추가·수정·삭제</summary>
    <p>{employees ? '선택한 연도에만 적용되는 팀 공동 연차 설정입니다. 다른 연도는 변경하지 않습니다.' : '모든 재배 계획에 적용되는 팀 공동 품종 목표입니다.'} 기존 이름은 기록 연결을 위해 변경할 수 없습니다. 삭제해도 기존 내역과 수정용 선택지는 유지됩니다.</p>
    <RecordStatus record={record} dirty={draft !== null} />
    {stale && <div role="alert" className="warning-message">공동 설정이 바뀌었습니다. 최신 목록과 입력 초안을 비교하세요.
      <button type="button" disabled={record.busy} onClick={() => setDraft(previous => ({ ...previous, revision: record.revision }))}>설정 비교 완료 · 초안 재확인</button>
    </div>}
    <form onSubmit={submit}><fieldset disabled={record.busy} className="form-row">
      <label>{label} 이름<input maxLength={80} readOnly={editName !== null} value={draft?.name ?? ''} onChange={event => field('name', event.target.value)} /></label>
      <label>{numberLabel}<input type="number" min="0" step="any" value={draft?.amount ?? ''} onChange={event => field('amount', event.target.value)} /></label>
      {employees && <label className="note-field">조정 사유 (연차 변경 시 필수)<input maxLength={500} value={draft?.reason ?? ''} onChange={event => field('reason', event.target.value)} /></label>}
      <button type="submit" className="primary" disabled={!draft || stale}>{editName !== null ? `${label} 설정 수정 · 공동 저장` : `+ ${label} 설정 추가 · 공동 저장`}</button>
      <button type="button" onClick={cancel}>설정 초안 취소</button>
    </fieldset></form>
    {!record.value.length && !record.loading && <p className="empty-state">등록된 {label} 설정이 없습니다. 빈 목록은 기본값으로 돌아가지 않습니다.</p>}
    <div className="record-list" role="region" aria-label={`${label} 설정 목록`} tabIndex={0}>{record.value.map(row => <div className="entry" key={row.name}>
      <div>{row.name} · {numberLabel}: {row[fieldName]}</div>
      <div className="actions">
        <button type="button" disabled={record.busy || draft !== null} onClick={() => { setEditName(row.name); setDraft({ name: row.name, amount: String(row[fieldName]), reason: '', revision: record.revision }); }}>설정 수정</button>
        <button type="button" className="danger-button" disabled={record.busy || draft !== null} onClick={() => {
          if (window.confirm(`${row.name}의 ${employees ? `${year}년 연차` : '품종 목표'} 설정을 삭제할까요?\n기존 내역과 수정 이력은 삭제하지 않습니다.`)) record.run(record.value.filter(item => item.name !== row.name));
        }}>설정 삭제</button>
      </div>
    </div>)}</div>
  </details>;
}

function RemainingVacationEditor({ employee, settings, vacations }) {
  const [draft, setDraft] = useState(null);
  const stale = draft !== null && (draft.settingsRevision !== settings.revision || draft.vacationRevision !== vacations.revision);
  const blocked = settings.busy || vacations.busy || !!vacations.error;
  function field(name, value) {
    setDraft(previous => ({ ...(previous ?? { remaining: String(Math.max(0, employee.remaining)), reason: '', settingsRevision: settings.revision, vacationRevision: vacations.revision }), [name]: value }));
  }
  async function submit(event) {
    event.preventDefault();
    if (!draft || stale || blocked) return;
    try {
      if (!draft.remaining.trim()) throw new Error('잔여 일수를 입력하세요. 0도 저장할 수 있습니다.');
      const next = adjustVacationRemaining(settings.value, vacations.value, employee.name, Number(draft.remaining), draft.reason, draft.vacationRevision);
      await settings.run(next, () => setDraft(null));
    } catch (error) { settings.fail(error); }
  }
  return <details className="weekday-editor">
    <summary>{employee.name} 잔여 일수 직접 수정</summary>
    <p>연간 연차 = 현재 사용 {employee.used}일 + 원하는 잔여 일수. 기존 휴가 내역은 변경하지 않습니다. 서버가 휴가 버전을 재확인하며 변경되었으면 저장을 중단합니다. 변경 전후·사유·수정 계정은 서버 이력에 기록합니다.</p>
    <button type="button" disabled={blocked} onClick={vacations.reload}>최신 휴가 내역 다시 불러오기 (조정 초안 유지)</button>
    <RecordStatus record={settings} dirty={draft !== null} />
    {stale && <div role="alert" className="warning-message">연차 설정 또는 휴가 내역이 바뀌었습니다. 최신 사용량과 초안을 비교하세요.
      <button type="button" disabled={blocked} onClick={() => setDraft(previous => ({ ...previous, settingsRevision: settings.revision, vacationRevision: vacations.revision }))}>사용량·설정 비교 완료 · 초안 재확인</button>
    </div>}
    <form onSubmit={submit}><fieldset disabled={blocked} className="form-row">
      <label>원하는 잔여 일수<input type="number" min="0" step="any" value={draft?.remaining ?? ''} onChange={event => field('remaining', event.target.value)} /></label>
      <label className="note-field">조정 사유 (필수)<input maxLength={500} value={draft?.reason ?? ''} onChange={event => field('reason', event.target.value)} /></label>
      <button type="submit" className="primary" disabled={!draft || stale}>잔여 일수 조정 · 공동 저장</button>
      <button type="button" onClick={() => setDraft(null)}>잔여 조정 취소</button>
    </fieldset></form>
  </details>;
}

function VacationAdjustmentHistory({ record, year }) {
  const history = [...(record.history ?? [])].reverse().filter(event => event.changes?.length);
  function dateLabel(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? `${date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })} KST` : '시각 알 수 없음';
  }
  return <details className="weekday-editor">
    <summary>휴가 조정·계정 이력 · {year}년</summary>
    <p>서버에 기록된 최근 설정 이력입니다. 잔여량은 변경 당시 휴가 사용량 기준이며, 이전 이력은 서버 보관 이력에 유지됩니다.</p>
    {!history.length && <p className="empty-state">기록된 휴가 설정·조정 이력이 없습니다. 기존 기록의 변경 전후 값을 추정하지 않습니다.</p>}
    <div className="record-list" role="region" aria-label={`${year}년 휴가 조정 계정 이력`} tabIndex={0}>{history.map(event => <div className="task-group" key={event.revision}>
      <h4>저장 버전 {event.revision}<small>{dateLabel(event.at)}</small></h4>
      <p>수정자: {event.userName || '이름 알 수 없음'} · 계정 {event.userId || '알 수 없음'}</p>
      {event.changes.map(change => <div className="entry" key={change.name}><div>
        <strong>{change.name} · {!change.after ? '설정 삭제' : !change.before ? '설정 추가' : '연차·잔여 조정'}</strong>
        <p>잔여: {change.before ? `${change.beforeRemaining ?? '알 수 없음'}일` : '설정 없음'} → {change.after ? `${change.afterRemaining ?? '알 수 없음'}일` : '설정 삭제'}</p>
        <p>연간 연차: {change.before ? `${change.before.total}일` : '설정 없음'} → {change.after ? `${change.after.total}일` : '설정 삭제'} · 당시 사용 {change.used ?? '알 수 없음'}일</p>
        <p>사유: {change.reason || (!change.after ? '설정 삭제' : !change.before ? '설정 추가' : '기록된 사유 없음')}</p>
        {change.vacationRevision !== undefined && <small>확인한 휴가 버전 {change.vacationRevision}</small>}
      </div></div>)}
    </div>)}</div>
  </details>;
}

const emptyVacation = () => ({ employee: '', start: '', end: '', days: '', note: '' });
function VacationPanel({ year }) {
  const record = useManagedRecord(checklistVacationKey(year), EMPTY_LIST);
  const settings = useManagedRecord(checklistEmployeeSettingsKey(year), EMPLOYEES);
  const employees = checklistSettingsOptions(record.value, settings.value, 'employee');
  const [draft, setDraft] = useState(emptyVacation);
  const [editId, setEditId] = useState(null);
  const [filter, setFilter] = useState('all');
  const selectedEmployee = draft.employee || employees[0]?.name || '';
  const blocked = record.busy || settings.busy || !!settings.error;
  function cancel() { setDraft(emptyVacation()); setEditId(null); }
  function field(name, value) { setDraft(previous => ({ ...previous, [name]: value })); }
  async function submit(event) {
    event.preventDefault();
    try {
      if (blocked) return;
      const fields = validateVacation({ ...draft, employee: selectedEmployee }, year, employees);
      if (editId !== null && !record.value.some(row => row.id === editId)) throw new Error('다른 팀원이 이 항목을 삭제했습니다. 초안은 유지됩니다.');
      const next = upsertEntry(record.value, { ...fields, id: editId ?? newId() });
      validateVacationEntries(next, year);
      await record.run(next, cancel);
    } catch (error) { record.fail(error); }
  }
  const list = record.value.filter(row => filter === 'all' || row.employee === filter).sort((a, b) => String(b.start ?? '').localeCompare(String(a.start ?? '')));
  return <section className="panel">
    <h3>휴가 관리 · {year}년</h3>
    <SettingsPanel record={settings} employees year={year} />
    <VacationAdjustmentHistory record={settings} year={year} />
    <RecordStatus record={record} dirty={editId !== null || !!(draft.start || draft.days || draft.note)} />
    <div className="cards">{vacationSummary(record.value, settings.value).map(employee => <div className={`summary ${employee.status}`} key={employee.name}>
      <h4>{employee.name}</h4>{employee.configured ? <p>잔여 {employee.remaining}일 / 연간 {employee.total}일</p> : <p>연차 설정 없음 · 기존 내역 유지</p>}<p>사용 {employee.used}일 · {employee.status === 'unconfigured' ? '설정에서 삭제됨' : employee.status === 'danger' ? '잔여 휴가 소진' : employee.status === 'warning' ? '잔여 휴가 부족' : '사용 가능'}</p>
      {employee.configured && <progress max="100" value={employee.percent} aria-label={`${employee.name} 잔여 휴가 비율`} />}
      {employee.configured && <RemainingVacationEditor employee={employee} settings={settings} vacations={record} />}
    </div>)}</div>
    <form onSubmit={submit}>
      <fieldset disabled={blocked} className="form-row">
        <label>직원<select value={selectedEmployee} onChange={event => field('employee', event.target.value)}><option value="">직원 선택</option>{selectedEmployee && !employees.some(row => row.name === selectedEmployee) && <option value={selectedEmployee} disabled>{selectedEmployee} (설정 없음)</option>}{employees.map(employee => <option key={employee.name} value={employee.name}>{employee.name}{!employee.configured ? ' (기존 기록)' : ''}</option>)}</select></label>
        <label>시작일<input type="date" value={draft.start} onChange={event => field('start', event.target.value)} /></label>
        <label>종료일<input type="date" value={draft.end} onChange={event => field('end', event.target.value)} /></label>
        <label>휴가 일수<input type="number" min="0.5" max="366" step="0.5" value={draft.days} onChange={event => field('days', event.target.value)} /></label>
        <label className="note-field">메모<input maxLength={2000} value={draft.note} onChange={event => field('note', event.target.value)} /></label>
        <button type="submit" className="primary">{editId !== null ? '수정 공동 저장' : '+ 휴가 등록 · 공동 저장'}</button>
        <button type="button" onClick={cancel}>입력 취소</button>
      </fieldset>
    </form>
    <p>휴가 일수는 원본처럼 직접 입력하며 시작일 연도로 저장합니다. 다른 연도는 먼저 위 연도를 선택하세요.</p>
    <label className="view-filter">직원별 보기 <select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">전체 직원</option>{employees.map(employee => <option key={employee.name} value={employee.name}>{employee.name}</option>)}</select></label>
    {filter !== 'all' && <p>{filter} · {list.length}건 · 사용 {list.reduce((sum, row) => sum + Number(row.days || 0), 0)}일</p>}
    {!list.length && !record.loading && <p className="empty-state">선택한 연도·직원의 휴가 내역이 없습니다.</p>}
    <div className="record-list" role="region" aria-label="휴가 내역 목록" tabIndex={0}>{list.map(row => <div className="entry" key={row.id}>
      <div>{row.employee} · {row.start} → {row.end} · {row.days}일<div className="entry-text">{row.note}</div></div>
      <div className="actions"><button type="button" disabled={record.busy} onClick={() => { setEditId(row.id); setDraft({ ...row }); }}>수정</button>
        <button type="button" className="danger-button" disabled={record.busy} onClick={() => { if (window.confirm('이 휴가 내역을 삭제할까요?\n팀 공동 목록에서도 삭제됩니다.')) record.run(deleteEntry(record.value, row.id), () => { if (editId === row.id) cancel(); }); }}>삭제</button></div>
    </div>)}</div>
  </section>;
}

const emptyPlanting = () => ({ variety: '', farm: '', boxes: '', price: '', note: '' });
function PlantingPanel() {
  const record = useManagedRecord(SHARED_KEYS.planting, EMPTY_LIST);
  const settings = useManagedRecord(SHARED_KEYS.plantingSettings, PLANT_VARIETIES);
  const varieties = checklistSettingsOptions(record.value, settings.value, 'variety');
  const [draft, setDraft] = useState(emptyPlanting);
  const [editId, setEditId] = useState(null);
  const [view, setView] = useState('farm');
  const selectedVariety = draft.variety || varieties[0]?.name || '';
  const blocked = record.busy || settings.busy || !!settings.error;
  function cancel() { setDraft(emptyPlanting()); setEditId(null); }
  function field(name, value) { setDraft(previous => ({ ...previous, [name]: value })); }
  async function submit(event) {
    event.preventDefault();
    try {
      if (blocked) return;
      const fields = validatePlanting({ ...draft, variety: selectedVariety }, varieties);
      const existing = record.value.find(row => row.id === editId);
      if (editId !== null && !existing) throw new Error('다른 팀원이 이 항목을 삭제했습니다. 초안은 유지됩니다.');
      const next = upsertEntry(record.value, { ...existing, ...fields, id: editId ?? newId(), createdAt: existing?.createdAt ?? Date.now() });
      validatePlantingEntries(next);
      await record.run(next, cancel);
    } catch (error) { record.fail(error); }
  }
  return <section className="panel">
    <h3>재배 계획</h3>
    <SettingsPanel record={settings} />
    <RecordStatus record={record} dirty={editId !== null || !!(draft.farm || draft.boxes || draft.price || draft.note)} />
    <div className="cards">{plantingSummary(record.value, settings.value).map(variety => <div className={`summary ${variety.status}`} key={variety.name}>
      <h4>{variety.name}</h4><p>배정 {variety.assigned}{variety.configured ? ` / 목표 ${variety.target}박스` : '박스 · 목표 설정 없음'}</p>
      {variety.configured && <progress max="100" value={variety.percent} aria-label={`${variety.name} 할당 비율`} />}
      <p>{variety.status === 'unconfigured' ? '설정에서 삭제됨 · 기존 내역 유지' : variety.status === 'complete' ? '✓ 배정 완료' : variety.status === 'over' ? `⚠ 목표보다 ${-variety.remaining}박스 초과` : `추가 배정 필요: ${variety.remaining}박스`}</p>
    </div>)}</div>
    <form onSubmit={submit}><fieldset disabled={blocked} className="form-row">
      <label>품종<select value={selectedVariety} onChange={event => field('variety', event.target.value)}><option value="">품종 선택</option>{selectedVariety && !varieties.some(row => row.name === selectedVariety) && <option value={selectedVariety} disabled>{selectedVariety} (설정 없음)</option>}{varieties.map(variety => <option key={variety.name} value={variety.name}>{variety.name}{!variety.configured ? ' (기존 기록)' : ''}</option>)}</select></label>
      <label>농장명<input maxLength={200} list="import-checklist-farms" value={draft.farm} onChange={event => field('farm', event.target.value)} /></label>
      <datalist id="import-checklist-farms">{[...new Set(record.value.map(row => row.farm))].filter(Boolean).sort().map(farm => <option key={farm} value={farm} />)}</datalist>
      <label>박스 수<input type="number" min="0.01" step="any" value={draft.boxes} onChange={event => field('boxes', event.target.value)} /></label>
      <label>줄기당 단가 (USD)<input type="number" min="0" step="any" value={draft.price} onChange={event => field('price', event.target.value)} /></label>
      <label className="note-field">메모<input maxLength={2000} value={draft.note} onChange={event => field('note', event.target.value)} /></label>
      <button type="submit" className="primary">{editId !== null ? '수정 공동 저장' : '+ 배정 추가 · 공동 저장'}</button>
      <button type="button" onClick={cancel}>입력 취소</button>
    </fieldset></form>
    <p>단가는 줄기당 USD입니다. 박스당 줄기 수가 없으므로 박스 수 × 단가로 금액을 추정하지 않습니다.</p>
    <label className="view-filter">배정 내역 보기 <select value={view} onChange={event => setView(event.target.value)}><option value="farm">농장별</option><option value="variety">품종별</option><option value="all">전체</option></select></label>
    {!record.value.length && !record.loading && <p className="empty-state">등록된 배정 내역이 없습니다.</p>}
    <div className="record-list" role="region" aria-label="재배 배정 내역 목록" tabIndex={0}>{groupPlanting(record.value, view, settings.value).map(group => <div className="task-group" key={group.name}>
      <h4>{view === 'all' ? '전체 배정 내역' : group.entries.every(row => !row[view]) ? '이름 없음' : group.name}<small>{group.entries.length}건 · {group.boxes}박스</small></h4>
      {group.entries.map(row => <div className="entry" key={row.id}>
        <div>{row.variety} · {row.farm} · {row.boxes}박스 · 줄기당 {fmtUSD(row.price)}<div className="entry-text">{row.note}</div></div>
        <div className="actions"><button type="button" disabled={record.busy} onClick={() => { setEditId(row.id); setDraft({ ...row }); }}>수정</button>
          <button type="button" className="danger-button" disabled={record.busy} onClick={() => { if (window.confirm('이 배정 내역을 삭제할까요?\n팀 공동 목록에서도 삭제됩니다.')) record.run(deleteEntry(record.value, row.id), () => { if (editId === row.id) cancel(); }); }}>삭제</button></div>
      </div>)}
    </div>)}</div>
  </section>;
}

// Keep visited panels mounted so changing tab/date/month/year does not discard a failed draft.
export default function ChecklistTool({ activeTab, hideNavigation = false, onFlightCountChange }) {
  const [date, setDate] = useState(getKstDate);
  const [month, setMonth] = useState(() => getKstDate().slice(0, 7));
  const [year, setYear] = useState(() => getKstDate().slice(0, 4));
  const [dates, setDates] = useState(() => [getKstDate()]);
  const [months, setMonths] = useState(() => [getKstDate().slice(0, 7)]);
  const [years, setYears] = useState(() => [getKstDate().slice(0, 4)]);
  const [localTab, setTab] = useState('daily');
  const tab = activeTab ?? localTab;
  function chooseDate(next) { if (isDate(next)) { setDate(next); setDates(previous => previous.includes(next) ? previous : [...previous, next]); } }
  function chooseMonth(next) { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(next)) { setMonth(next); setMonths(previous => previous.includes(next) ? previous : [...previous, next]); } }
  function chooseYear(next) { if (/^\d{4}$/.test(next)) { setYear(next); setYears(previous => previous.includes(next) ? previous : [...previous, next]); } }
  return <div className="import-checklist">
    <header className="tool-heading"><h2>{({daily:'일일 업무·결제',flights:'항공 일정 관리',vacations:'휴가 관리',planting:'재배 계획 관리'})[tab]}</h2><p>추가·수정·삭제는 팀 공동 자료에 저장되며 수정자 이력이 남습니다. ERP 주문·분배·재고는 변경하지 않습니다.</p></header>
    {!hideNavigation&&<nav className="actions tool-tabs" aria-label="체크리스트 도구">
      {[['daily', '일일 업무·결제'], ['flights', '항공 일정'], ['vacations', '휴가 관리'], ['planting', '재배 계획']].map(([key, label]) => <button type="button" key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}
    </nav>}
    <div hidden={tab !== 'daily'}>
      <div className="selectors"><label>업무 날짜<input type="date" value={date} onChange={event => chooseDate(event.target.value)} /></label>
        <label>결제 월<input type="month" value={month} onChange={event => chooseMonth(event.target.value)} /></label></div>
      <div className="actions week-picker" aria-label="선택 날짜의 주간 요일">{weekDates(date).map(day => <button type="button" key={day.date} aria-pressed={date === day.date} aria-label={`${day.date} ${checklistWeekdayLabel(day, true)}`} onClick={() => chooseDate(day.date)}>{checklistWeekdayLabel(day)} · {day.date}</button>)}</div>
      {DAYS.filter(day => dates.some(value => weekdayForDate(value).id === day.id)).map(day => <WeekdayChecklist key={day.id} weekday={day} dates={dates.filter(value => weekdayForDate(value).id === day.id)} date={date} />)}
      <NotesPanel />
      {months.map(value => <div hidden={month !== value} key={value}><ChecksPanel month={value} /></div>)}
    </div>
    <div hidden={tab !== 'flights'}><NotesPanel flights onFlightCountChange={onFlightCountChange} /></div>
    <div hidden={tab !== 'vacations'}><div className="selectors"><label>휴가 연도<input type="number" min="1000" max="9999" step="1" value={year} onChange={event => chooseYear(event.target.value)} /></label>
      <button type="button" disabled={Number(year) <= 1000} onClick={() => chooseYear(String(Number(year) - 1))}>‹ 이전 연도</button>
      <button type="button" disabled={Number(year) >= 9999} onClick={() => chooseYear(String(Number(year) + 1))}>다음 연도 ›</button></div>
      {years.map(value => <div hidden={year !== value} key={value}><VacationPanel year={value} /></div>)}
    </div>
    <div hidden={tab !== 'planting'}><PlantingPanel /></div>
    <style jsx global>{`
      .import-checklist { width:100%; min-width:0; color:#172b4d; font-size:14px; line-height:1.5; }
      .import-checklist * { box-sizing:border-box; }
      .import-checklist [hidden] { display:none !important; }
      .import-checklist h2,.import-checklist h3 { margin:0 0 8px; font-size:18px; font-weight:700; line-height:1.4; overflow-wrap:anywhere; }
      .import-checklist h4 { display:flex; flex-wrap:wrap; align-items:center; gap:6px 10px; margin:0 0 8px; font-size:14px; font-weight:700; }
      .import-checklist h4 small { margin-left:auto; font-size:12px; font-weight:400; }
      .import-checklist p { margin:6px 0; }
      .import-checklist .tool-heading { padding:0 0 8px; }
      .import-checklist .tool-heading p { color:#52647c; }
      .import-checklist .heading-count { margin-left:10px; padding:3px 8px; border-radius:5px; color:#52647c; background:#f1f5f9; font-size:13px; font-weight:500; white-space:nowrap; }
      .import-checklist .panel { background:#fff; border:1px solid #d5deea; border-radius:8px; padding:14px; margin:12px 0; min-width:0; }
      .import-checklist .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr)); align-items:start; gap:12px; }
      .import-checklist .task-group,.import-checklist .summary { background:#f8fafc; border:1px solid #dae2eb; border-radius:6px; padding:12px; min-width:0; overflow-wrap:anywhere; }
      .import-checklist .check-row { display:flex; gap:9px; align-items:flex-start; padding:8px 4px; border-top:1px solid #e2e8f0; font-size:14px; overflow-wrap:anywhere; cursor:pointer; }
      .import-checklist .check-row.checked { background:#ecfdf5; }
      .import-checklist .check-row span { min-width:0; }
      .import-checklist .saved-value { display:block; font-size:12px; }
      .import-checklist .pending-check { color:#92400e; }
      .import-checklist .weekday-editor { margin:10px 0; padding:10px; border:1px solid #d5deea; border-radius:6px; min-width:0; overflow-wrap:anywhere; }
      .import-checklist .weekday-editor summary { cursor:pointer; font-weight:600; min-height:36px; }
      .import-checklist input[type=checkbox] { width:16px; height:16px; min-height:0; flex-shrink:0; margin:3px 0 0; padding:0; accent-color:#2457c5; }
      .import-checklist small { color:#52647c; }
      .import-checklist label { font-size:13px; }
      .import-checklist .record-status,.import-checklist .actions,.import-checklist .selectors,.import-checklist .form-row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
      .import-checklist .record-status { margin:8px 0 12px; padding:8px 10px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; }
      .import-checklist .record-status>button { margin-left:auto; font-size:13px; }
      .import-checklist .status-badge { display:inline-flex; align-items:center; min-height:28px; padding:3px 8px; border:1px solid transparent; border-radius:5px; font-size:13px; font-weight:600; }
      .import-checklist .status-neutral { color:#334155; background:#eaf0f7; border-color:#cbd5e1; }
      .import-checklist .status-success { color:#166534; background:#f0fdf4; border-color:#86efac; }
      .import-checklist .status-warning { color:#92400e; background:#fffbeb; border-color:#fcd34d; }
      .import-checklist .status-error { color:#991b1b; background:#fef2f2; border-color:#fca5a5; }
      .import-checklist .revision { font-variant-numeric:tabular-nums; }
      .import-checklist .actions { margin:8px 0; }
      .import-checklist button { min-height:36px; max-width:100%; border:1px solid #9bacc4; background:#fff; border-radius:5px; padding:7px 12px; font:inherit; font-size:13px; line-height:20px; color:inherit; cursor:pointer; white-space:normal; overflow-wrap:anywhere; }
      .import-checklist button:hover:not(:disabled) { background:#edf3ff; border-color:#2457c5; }
      .import-checklist button.primary,.import-checklist button[aria-pressed=true] { background:#2457c5; border-color:#2457c5; color:#fff; }
      .import-checklist button.primary:hover:not(:disabled),.import-checklist button[aria-pressed=true]:hover { background:#1b439b; }
      .import-checklist button.danger-button { color:#b42318; border-color:#e5b7b3; }
      .import-checklist button.danger-button:hover:not(:disabled) { background:#fef2f2; border-color:#b42318; }
      .import-checklist button:disabled { color:#687990; background:#f1f5f9; border-color:#cbd5e1; opacity:.75; cursor:not-allowed; }
      .import-checklist :is(button,input,textarea,select,.record-list):focus-visible { outline:3px solid #2457c5; outline-offset:2px; }
      .import-checklist input,.import-checklist textarea,.import-checklist select { min-width:0; max-width:100%; min-height:36px; border:1px solid #9bacc4; background:#fff; border-radius:5px; padding:6px 9px; font:inherit; color:inherit; }
      .import-checklist input:disabled,.import-checklist textarea:disabled,.import-checklist select:disabled { background:#f1f5f9; color:#687990; cursor:not-allowed; }
      .import-checklist textarea { display:block; width:100%; min-width:0; resize:vertical; line-height:1.5; }
      .import-checklist .form-row { align-items:flex-end; padding:10px; margin:10px 0; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; }
      .import-checklist .form-row label,.import-checklist .selectors label { display:flex; flex-direction:column; gap:4px; min-width:0; flex:0 1 160px; }
      .import-checklist .form-row label.note-field { flex:1 1 200px; }
      .import-checklist .form-row label:has(textarea) { flex:1 1 360px; }
      .import-checklist .selectors { align-items:flex-end; padding:10px; background:#f1f5f9; border:1px solid #d5deea; border-radius:6px; }
      .import-checklist .tool-tabs { padding:6px; background:#f1f5f9; border:1px solid #d5deea; border-radius:7px; margin:0 0 12px; }
      .import-checklist .tool-tabs button { flex:0 1 150px; font-weight:600; }
      .import-checklist .week-picker button { font-variant-numeric:tabular-nums; }
      .import-checklist .view-filter { display:inline-flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:8px; }
      .import-checklist .inline-check { display:inline-flex; gap:6px; align-items:center; min-height:36px; padding:4px 8px; background:#f1f5f9; border-radius:5px; }
      .import-checklist .inline-check input[type=checkbox] { margin:0; }
      .import-checklist .progress-row { display:flex; flex-wrap:wrap; align-items:center; gap:8px 16px; margin-bottom:10px; }
      .import-checklist fieldset { border:0; margin:0; padding:0; min-width:0; }
      .import-checklist .record-list { margin-top:12px; padding:2px; }
      .import-checklist .record-list>.task-group { margin-bottom:10px; }
      .import-checklist .entry { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; padding:10px; border-bottom:1px solid #e2e8f0; }
      .import-checklist .entry>div { min-width:0; overflow-wrap:anywhere; }
      .import-checklist .entry.flight-complete { background:#ecfdf5; border-color:#86efac; }
      .import-checklist .entry>div:first-child { flex:1 1 280px; }
      .import-checklist .entry>.actions { flex:0 1 auto; margin:0; }
      .import-checklist .entry-text { white-space:pre-wrap; overflow-wrap:anywhere; flex:1 1 280px; }
      .import-checklist .error,.import-checklist .warning-message { border-radius:5px; padding:10px; flex-basis:100%; overflow-wrap:anywhere; }
      .import-checklist .error { color:#991b1b; background:#fef2f2; border:1px solid #fecaca; }
      .import-checklist .warning-message { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-bottom:10px; color:#92400e; background:#fffbeb; border:1px solid #fcd34d; }
      .import-checklist .warning,.import-checklist .over { color:#92400e; background:#fffbeb; border-color:#f0b94c; }
      .import-checklist .danger { border-color:#fca5a5; background:#fef2f2; color:#991b1b; }
      .import-checklist .complete { color:#166534; background:#f0fdf4; border-color:#86efac; }
      .import-checklist .empty-state { padding:12px; margin-top:12px; color:#52647c; background:#f8fafc; border:1px dashed #cbd5e1; border-radius:6px; }
      .import-checklist progress { display:block; width:100%; max-width:280px; height:8px; accent-color:#2457c5; }
      .import-checklist .warning progress,.import-checklist .over progress { accent-color:#d97706; }
      .import-checklist .danger progress { accent-color:#dc2626; }
      .import-checklist .complete progress { accent-color:#16a34a; }
      @media(max-width:900px) { .import-checklist .form-row label { flex:1 1 160px; } .import-checklist .record-status>button { margin-left:0; } }
      @media(max-width:600px) { .import-checklist .panel { padding:10px; } .import-checklist .form-row label,.import-checklist .form-row label.note-field { flex:1 1 100%; } .import-checklist .selectors label { flex:1 1 140px; } .import-checklist .tool-tabs button { flex:1 1 120px; } .import-checklist .heading-count { display:inline-block; margin:4px 0 0 8px; } .import-checklist .entry>.actions { flex:1 1 100%; } }
    `}</style>
  </div>;
}
