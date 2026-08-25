import { useEffect, useMemo, useRef, useState } from 'react';

const todayYear = () => String(new Date().getFullYear());
const number = value => Number(value || 0);
const fmt = value => number(value).toLocaleString('ko-KR', { maximumFractionDigits: 4 });

export default function PreShipmentPage() {
  const [data, setData] = useState({ plans: [], plan: null, items: [], schedules: [], allocations: [] });
  const [planKey, setPlanKey] = useState('');
  const [year, setYear] = useState(todayYear());
  const [week, setWeek] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [newSchedule, setNewSchedule] = useState({ shipmentDate: '', dayLabel: '추가 출고', targetOrderYear: todayYear(), targetMajorWeek: '' });
  const fileRef = useRef(null);

  async function load(key = planKey) {
    setError('');
    const response = await fetch(`/api/pre-shipment${key ? `?planKey=${key}` : ''}`);
    const json = await response.json();
    if (!response.ok || !json.success) throw new Error(json.error || '조회 실패');
    setData(json);
    if (json.plan?.PlanKey) setPlanKey(String(json.plan.PlanKey));
    if (json.plan) setNewSchedule(current => ({ ...current, targetOrderYear: json.plan.OrderYear, targetMajorWeek: String(json.plan.MajorWeek) }));
  }
  useEffect(() => { load('').catch(e => setError(e.message)); }, []);

  const allocationMap = useMemo(() => new Map(data.allocations.map(row => [`${row.ScheduleKey}:${row.ItemKey}`, number(row.Quantity)])), [data.allocations]);
  const groupedItems = useMemo(() => {
    const groups = [];
    for (const item of data.items) {
      let group = groups.find(row => row.name === item.SpeciesName);
      if (!group) { group = { name: item.SpeciesName, items: [] }; groups.push(group); }
      group.items.push(item);
    }
    return groups;
  }, [data.items]);

  async function upload(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const file = fileRef.current?.files?.[0];
      if (!file) throw new Error('엑셀 파일을 선택하세요.');
      if (!week) throw new Error('등록 차수를 입력하세요.');
      const body = new FormData(); body.append('file', file); body.append('orderYear', year); body.append('majorWeek', week);
      const response = await fetch('/api/pre-shipment/upload', { method: 'POST', body });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || '업로드 실패');
      const mismatch = Number(json.sourceSheetMajor) !== Number(week) ? ` (주의: 원본 시트명은 ${json.sourceSheetMajor}차)` : '';
      setMessage(`${json.sheetName} 시트의 ${json.itemCount}개 품목을 ${year}년 ${week}차로 불러왔습니다.${mismatch}`);
      setPlanKey(String(json.planKey)); await load(String(json.planKey));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  function patchAllocation(scheduleKey, itemKey, quantity) {
    setData(current => {
      const next = current.allocations.filter(row => !(Number(row.ScheduleKey) === Number(scheduleKey) && Number(row.ItemKey) === Number(itemKey)));
      next.push({ ScheduleKey: scheduleKey, ItemKey: itemKey, Quantity: number(quantity) });
      return { ...current, allocations: next };
    });
  }
  async function saveCell(scheduleKey, itemKey, quantity) {
    patchAllocation(scheduleKey, itemKey, quantity);
    try {
      const response = await fetch('/api/pre-shipment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save-cell', scheduleKey, itemKey, quantity: number(quantity) }) });
      const json = await response.json(); if (!response.ok || !json.success) throw new Error(json.error || '수량 저장 실패');
    } catch (e) { setError(e.message); await load(); }
  }
  function patchSchedule(scheduleKey, field, value) {
    setData(current => ({ ...current, schedules: current.schedules.map(row => Number(row.ScheduleKey) === Number(scheduleKey) ? { ...row, [field]: value } : row) }));
  }
  async function saveSchedule(schedule) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/pre-shipment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save-schedule', scheduleKey: schedule.ScheduleKey, shipmentDate: schedule.ShipmentDate ? String(schedule.ShipmentDate).slice(0, 10) : '', dayLabel: schedule.DayLabel, targetOrderYear: schedule.TargetOrderYear, targetMajorWeek: schedule.TargetMajorWeek }) });
      const json = await response.json(); if (!response.ok || !json.success) throw new Error(json.error || '출고 기준 저장 실패');
      setMessage('출고일·견적 이동 차수를 저장했습니다.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function addSchedule() {
    if (!data.plan) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/pre-shipment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add-schedule', planKey: data.plan.PlanKey, ...newSchedule }) });
      const json = await response.json(); if (!response.ok || !json.success) throw new Error(json.error || '출고열 추가 실패');
      await load(); setMessage('출고열을 추가했습니다.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const scheduleTotal = scheduleKey => data.items.reduce((sum, item) => sum + number(allocationMap.get(`${scheduleKey}:${item.ItemKey}`)), 0);
  return <main className="page">
    <h1>선출고 관리</h1>
    <p className="desc">주광 카장수알 원본 시트를 불러와 차수·실제 출고일·견적 이동 차수를 분리 관리합니다. 이 화면은 ERP 입고·주문·출고·재고를 자동 변경하지 않습니다.</p>
    <form className="upload" onSubmit={upload}>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" />
      <label>등록연도 <input value={year} onChange={e => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} /></label>
      <label>등록차수 <input value={week} onChange={e => setWeek(e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="32" /></label>
      <button disabled={busy}>{busy ? '처리 중…' : '주광 시트 업로드'}</button>
      <span className="hint">`주광 카장수알 숫자차` 원본만 사용 · `(2)`/고정수량 제외</span>
    </form>
    {error ? <div className="error" role="alert">{error}</div> : null}
    {message ? <div className="success" role="status">{message}</div> : null}
    <div className="toolbar">
      <label>저장 차수 <select value={planKey} onChange={e => { setPlanKey(e.target.value); load(e.target.value).catch(x => setError(x.message)); }}><option value="">선택</option>{data.plans.map(row => <option key={row.PlanKey} value={row.PlanKey}>{row.OrderYear}년 {row.MajorWeek}차 · {row.SourceSheetName}</option>)}</select></label>
      {data.plan ? <strong>{data.plan.OrderYear}년 {data.plan.MajorWeek}차 · 품목 {data.items.length}개</strong> : null}
    </div>
    {data.plan ? <>
      <section className="addSchedule">
        <b>출고열 추가</b>
        <input type="date" value={newSchedule.shipmentDate} onChange={e => setNewSchedule({ ...newSchedule, shipmentDate: e.target.value })} />
        <input value={newSchedule.dayLabel} onChange={e => setNewSchedule({ ...newSchedule, dayLabel: e.target.value })} placeholder="목요일 선출고" />
        <span>견적 이동</span><input className="year" value={newSchedule.targetOrderYear} onChange={e => setNewSchedule({ ...newSchedule, targetOrderYear: e.target.value.replace(/\D/g, '').slice(0, 4) })} /><input className="week" value={newSchedule.targetMajorWeek} onChange={e => setNewSchedule({ ...newSchedule, targetMajorWeek: e.target.value.replace(/\D/g, '').slice(0, 2) })} /><span>차</span>
        <button onClick={addSchedule} disabled={busy}>추가</button>
      </section>
      <div className="matrixWrap">
        <table><thead><tr>
          <th className="species">품종</th><th className="item">품목명</th><th>발주(박스)</th><th>발주(단)</th><th>부산윌슨</th>
          {data.schedules.map(schedule => <th key={schedule.ScheduleKey} className="scheduleHead">
            <input value={schedule.DayLabel || ''} onChange={e => patchSchedule(schedule.ScheduleKey, 'DayLabel', e.target.value)} aria-label="출고 구분" />
            <input type="date" value={schedule.ShipmentDate ? String(schedule.ShipmentDate).slice(0, 10) : ''} onChange={e => patchSchedule(schedule.ScheduleKey, 'ShipmentDate', e.target.value)} />
            <div className="target"><span>견적</span><input value={schedule.TargetOrderYear || data.plan.OrderYear} onChange={e => patchSchedule(schedule.ScheduleKey, 'TargetOrderYear', e.target.value.replace(/\D/g, '').slice(0, 4))} /><input value={schedule.TargetMajorWeek || data.plan.MajorWeek} onChange={e => patchSchedule(schedule.ScheduleKey, 'TargetMajorWeek', e.target.value.replace(/\D/g, '').slice(0, 2))} /><span>차</span></div>
            <button onClick={() => saveSchedule(schedule)} disabled={busy}>기준 저장</button>
          </th>)}
          <th>출고합계</th><th>발주-출고</th><th>메모</th>
        </tr></thead><tbody>
          {groupedItems.flatMap(group => group.items.map((item, index) => <tr key={item.ItemKey}>
            {index === 0 ? <th className="species body" rowSpan={group.items.length}>{group.name}</th> : null}
            <th className="item body">{item.ItemName}</th><td>{fmt(item.OrderBoxQty)}</td><td>{fmt(item.OrderUnitQty)}</td><td>{fmt(item.BusanWilsonQty)}</td>
            {data.schedules.map(schedule => <td key={schedule.ScheduleKey} className="qtyCell"><input type="number" min="0" step="0.01" value={allocationMap.get(`${schedule.ScheduleKey}:${item.ItemKey}`) ?? ''} onChange={e => patchAllocation(schedule.ScheduleKey, item.ItemKey, e.target.value)} onBlur={e => saveCell(schedule.ScheduleKey, item.ItemKey, e.target.value)} /></td>)}
            {(() => { const shipped = data.schedules.reduce((sum, schedule) => sum + number(allocationMap.get(`${schedule.ScheduleKey}:${item.ItemKey}`)), 0); return <><td className="sum">{fmt(shipped)}</td><td className={number(item.OrderBoxQty) - shipped < 0 ? 'over' : 'balance'}>{fmt(number(item.OrderBoxQty) - shipped)}</td></>; })()}<td className="memo">{item.Memo || ''}</td>
          </tr>))}
        </tbody><tfoot><tr><th colSpan="2">합계</th><td>{fmt(data.items.reduce((s, x) => s + number(x.OrderBoxQty), 0))}</td><td>{fmt(data.items.reduce((s, x) => s + number(x.OrderUnitQty), 0))}</td><td>{fmt(data.items.reduce((s, x) => s + number(x.BusanWilsonQty), 0))}</td>{data.schedules.map(schedule => <td key={schedule.ScheduleKey}>{fmt(scheduleTotal(schedule.ScheduleKey))}</td>)}<td>{fmt(data.schedules.reduce((s, x) => s + scheduleTotal(x.ScheduleKey), 0))}</td><td>{fmt(data.items.reduce((s, x) => s + number(x.OrderBoxQty), 0) - data.schedules.reduce((s, x) => s + scheduleTotal(x.ScheduleKey), 0))}</td><td /></tr></tfoot></table>
      </div>
    </> : <div className="empty">엑셀을 업로드하거나 저장 차수를 선택하세요.</div>}
    <style jsx>{`
      .page{padding:18px 22px;max-width:none}h1{font-size:22px;margin:0 0 5px}.desc{font-size:13px;color:#64748b;margin:0 0 14px}.upload,.toolbar,.addSchedule{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;background:#f8fafc;border:1px solid #dbe3ec;border-radius:8px;margin-bottom:10px}.upload input:not([type=file]),.addSchedule input,.toolbar select{padding:6px;border:1px solid #cbd5e1;border-radius:5px}.upload label{font-size:12px}.upload label input{width:56px}.upload button,.addSchedule button,.scheduleHead button{border:0;background:#2563eb;color:white;padding:7px 12px;border-radius:5px;font-weight:700;cursor:pointer}.hint{font-size:11px;color:#64748b}.error,.success{padding:9px 12px;border-radius:6px;margin-bottom:9px}.error{background:#fee2e2;color:#991b1b}.success{background:#dcfce7;color:#166534}.toolbar{justify-content:space-between}.addSchedule{position:sticky;top:0;z-index:20;background:#eff6ff}.addSchedule .year{width:58px}.addSchedule .week{width:36px}.matrixWrap{overflow:auto;max-height:calc(100vh - 275px);border:1px solid #cbd5e1}table{border-collapse:separate;border-spacing:0;font-size:12px;min-width:max-content;width:100%}th,td{border-right:1px solid #dbe3ec;border-bottom:1px solid #dbe3ec;padding:5px 7px;text-align:center;background:white;white-space:nowrap}thead th{position:sticky;top:0;z-index:10;background:#eaf2ff}.species{position:sticky;left:0;z-index:13;min-width:90px}.item{position:sticky;left:105px;z-index:12;min-width:180px}.body{background:#f8fafc}.species.body{vertical-align:middle;color:#1d4ed8}.scheduleHead{min-width:170px}.scheduleHead>input{display:block;width:145px;margin:2px auto;padding:4px;border:1px solid #bfdbfe;border-radius:4px}.target{display:flex;align-items:center;justify-content:center;gap:3px}.target input{width:43px;padding:3px;border:1px solid #cbd5e1}.target input:first-of-type{width:55px}.scheduleHead button{font-size:11px;padding:4px 8px;margin-top:3px}.qtyCell input{width:76px;text-align:right;padding:5px;border:1px solid #93c5fd;border-radius:4px;background:#eff6ff}.sum,tfoot td,tfoot th{font-weight:800;background:#fef3c7}.balance{font-weight:700;color:#166534}.over{font-weight:800;color:#b91c1c;background:#fee2e2}.memo{max-width:220px;white-space:normal;text-align:left}.empty{padding:40px;color:#64748b;text-align:center}@media(max-width:700px){.page{padding:10px}.matrixWrap{max-height:calc(100vh - 320px)}}
    `}</style>
  </main>;
}
