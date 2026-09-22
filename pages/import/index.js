// pages/import/index.js
// 수입부 한 화면 — 농장을 축으로 "발주→입고→클레임→크레딧→송금→잔액"을 한눈에.
//   상단 KPI 띠(이번 차수 흐름·송금/클레임 대기·ETA) / 왼쪽 농장 목록(상태·잔액·클레임) / 가운데 선택 농장 흐름(없으면 차수 보드) / 오른쪽 할 일(송금 확인·클레임 확인·ETA)
// 새 쿼리 없음: /api/incoming/insight(board·ledger·farm…), /api/incoming/remit-inbox, /api/incoming/eta 조합. 기획 2026-09-22(사장님 "한 페이지에 한눈에").
import { useEffect, useMemo, useState } from 'react';
import { IncomingInsight } from '../incoming/insight';

const fmt = (n) => (n == null || n === '' ? '–' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 }));
const ST_C = { 미송금: '#dc2626', 부분송금: '#ea580c', 완납: '#16a34a', 청구없음: '#9ca3af' };
const api = async (u, o) => { const r = await fetch(u, o); const j = await r.json().catch(() => ({})); if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`); return j; };
const LINKS = [['/incoming', '입고 원장'], ['/incoming-price', '단가·송금 입력'], ['/arrival-cost', '도착원가'], ['/freight', '운송기준원가'], ['/stats/pivot-import', '수입 피벗'], ['/stats/pivot-import-farm-settings', '결제일 설정'], ['/sales/farm-quality', '농장 품질'], ['/incoming/kakao-summary', '카톡 수량집계']];

export default function ImportOnePage() {
  const [weeks, setWeeks] = useState([]); const [year, setYear] = useState(''); const [week, setWeek] = useState('');
  const [months, setMonths] = useState('6');
  const [board, setBoard] = useState(null); const [ledger, setLedger] = useState(null); const [inbox, setInbox] = useState(null); const [eta, setEta] = useState(null);
  const [farm, setFarm] = useState('');            // 선택 농장('' = 차수 보드)
  const [view, setView] = useState('board');       // 가운데 보기: board | reconcile | product | eta (농장 선택 시 farm)
  const [q, setQ] = useState(''); const [stF, setStF] = useState(''); const [sort, setSort] = useState('balance');
  const [todo, setTodo] = useState('remit');        // 오른쪽 탭: remit | claims | eta | missing
  const [edit, setEdit] = useState({}); const [err, setErr] = useState(''); const [tick, setTick] = useState(0);
  const [rightOpen, setRightOpen] = useState(true);

  useEffect(() => {
    const u = new URLSearchParams(window.location.search); if (u.get('farm')) setFarm(u.get('farm')); if (u.get('view')) setView(u.get('view'));
    api('/api/incoming/insight?view=weeks').then((j) => { setWeeks(j.weeks); const w = j.weeks[0]; if (u.get('year') && u.get('week')) { setYear(u.get('year')); setWeek(u.get('week')); } else if (w) { setYear(String(w.year)); setWeek(w.week); } }).catch((e) => setErr(e.message));
  }, []);
  useEffect(() => { if (!year || !week) return; const u = new URLSearchParams({ year, week }); if (farm) u.set('farm', farm); if (view) u.set('view', view); window.history.replaceState(null, '', `/import?${u}`); }, [year, week, farm, view]);
  const refresh = () => {
    if (year && week) api(`/api/incoming/insight?view=board&year=${year}&week=${week}`).then(setBoard).catch((e) => setErr(e.message));
    api(`/api/incoming/insight?view=ledger&months=${months}`).then(setLedger).catch((e) => setErr(e.message));
    api('/api/incoming/remit-inbox').then(setInbox).catch(() => {});
    api('/api/incoming/eta').then(setEta).catch(() => {});
  };
  useEffect(refresh, [year, week, months, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const farms = useMemo(() => (ledger?.rows || []).filter((r) => (!q || r.farm.toLowerCase().includes(q.toLowerCase())) && (!stF || r.status === stF))
    .sort((a, b) => sort === 'dday' ? ((a.pay?.dday ?? 9999) - (b.pay?.dday ?? 9999)) : sort === 'balance' ? b.balance - a.balance : sort === 'claims' ? b.claims.pending - a.claims.pending || b.claims.n - a.claims.n : sort === 'recent' ? (b.lastInput || '').localeCompare(a.lastInput || '') : a.farm.localeCompare(b.farm)), [ledger, q, stF, sort]);
  const pendingClaims = useMemo(() => (ledger?.rows || []).flatMap((r) => r.claims.items.filter((c) => !c.confirmed || c.review).map((c) => ({ ...c, farm: r.farm }))), [ledger]);
  const etaRows = eta?.rows || []; const lateEta = etaRows.filter((r) => r.late); const missing = (board?.items || []).filter((i) => i.tag === '미입고');
  const inboxRows = inbox?.rows || [];
  const act = async (body) => { try { await api('/api/incoming/remit-inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); setTick((t) => t + 1); } catch (e) { alert(e.message); } };
  const pick = (f) => { setFarm(f); setView('farm'); };
  const centerTab = farm ? 'farm' : view;

  return (
    <div className="op">
      {/* ── 상단 KPI ── */}
      <div className="kpi">
        <div className="ttl"><b>수입부</b><select className="filter-input" value={`${year}|${week}`} onChange={(e) => { const [y, w] = e.target.value.split('|'); setYear(y); setWeek(w); }}>{weeks.map((w) => <option key={`${w.year}|${w.week}`} value={`${w.year}|${w.week}`}>{w.year} {w.week}</option>)}</select>
          <select className="filter-input" value={months} onChange={(e) => setMonths(e.target.value)}><option value="3">3개월</option><option value="6">6개월</option><option value="12">12개월</option></select></div>
        {board && <>
          <button className="k" onClick={() => { setFarm(''); setView('board'); }}><span>발주 → 입고 → 분배</span><b>{fmt(board.totals.ordered)} → {fmt(board.totals.received)} → {fmt(board.totals.shipped)}</b></button>
          <button className="k" style={{ '--c': '#dc2626' }} onClick={() => { setFarm(''); setView('reconcile'); setTodo('missing'); }}><span>미입고 품목</span><b>{board.totals.missing}</b></button>
          <button className="k" style={{ '--c': '#ea580c' }} onClick={() => { setFarm(''); setView('reconcile'); }}><span>부족 / 초과</span><b>{board.totals.short} / {board.totals.over}</b></button>
        </>}
        {ledger && <>
          <button className="k" onClick={() => { setStF(''); setSort('balance'); }}><span>청구 − 크레딧 − 송금 = 잔액 (USD)</span><b>{fmt(ledger.totals.billed)} − {fmt(ledger.totals.credit)} − {fmt(ledger.totals.remit)} = <em style={{ color: ledger.totals.balance > 0 ? '#dc2626' : '#16a34a' }}>{fmt(ledger.totals.balance)}</em></b></button>
          <button className="k" style={{ '--c': ledger.totals.overdueFarms ? '#dc2626' : '#16a34a' }} onClick={() => { setStF(''); setSort('dday'); }}><span>결제 연체 / 7일 내 만기</span><b>{ledger.totals.overdueFarms}농장 ${fmt(ledger.totals.overdueUSD)} / {ledger.totals.dueSoon}</b></button>
          <button className="k" style={{ '--c': inboxRows.length ? '#ea580c' : '#16a34a' }} onClick={() => { setTodo('remit'); setRightOpen(true); }}><span>송금 확인 대기</span><b>{inboxRows.length}건 · ${fmt(inboxRows.reduce((a, r) => a + (r.amountUSD || 0), 0))}</b></button>
          <button className="k" style={{ '--c': pendingClaims.length ? '#dc2626' : '#16a34a' }} onClick={() => { setTodo('claims'); setRightOpen(true); }}><span>클레임 수입부 확인</span><b>{pendingClaims.length} / {ledger.totals.claims}건</b></button>
        </>}
        <button className="k" style={{ '--c': lateEta.length ? '#dc2626' : '#9ca3af' }} onClick={() => { setTodo('eta'); setRightOpen(true); }}><span>입고 예정</span><b>{etaRows.length}건 · 지연 {lateEta.length}</b></button>
        <div className="links">{LINKS.map(([h, l]) => <a key={h} href={h}>{l}</a>)}<button className="tog" onClick={() => setRightOpen(!rightOpen)}>{rightOpen ? '할 일 접기 ›' : '‹ 할 일'}</button></div>
      </div>
      {err && <div className="err">⚠️ {err}</div>}

      <div className="body">
        {/* ── 왼쪽: 농장 ── */}
        <aside className="left">
          <div className="lh"><input className="filter-input" placeholder="농장 검색" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="filter-input" value={stF} onChange={(e) => setStF(e.target.value)}><option value="">상태 전체</option>{Object.keys(ST_C).map((s) => <option key={s}>{s}</option>)}</select>
            <select className="filter-input" value={sort} onChange={(e) => setSort(e.target.value)}><option value="balance">잔액 큰 순</option><option value="dday">결제 D-day 순</option><option value="claims">클레임 순</option><option value="recent">최근 입고 순</option><option value="name">이름 순</option></select></div>
          <button className={'fm all' + (!farm ? ' on' : '')} onClick={() => { setFarm(''); setView('board'); }}><span>전체 (차수 보드)</span><small>{ledger ? `${ledger.totals.farms}곳` : ''}</small></button>
          <div className="fl">{farms.map((r) => (
            <button key={r.farm} className={'fm' + (farm === r.farm ? ' on' : '')} onClick={() => pick(r.farm)} title={`청구 ${fmt(r.billed)} · 크레딧 ${fmt(r.credit)} · 송금 ${fmt(r.remit)} · 마지막 입고 ${r.lastInput}`}>
              <i style={{ background: ST_C[r.status] }} /><span className="n">{r.farm}</span>
              <span className="v"><b style={{ color: r.balance > 0.5 ? '#dc2626' : '#16a34a' }}>${fmt(r.balance)}</b>{r.pay?.unpaidN && r.pay.day ? <small style={{ color: r.pay.dday < 0 ? '#dc2626' : r.pay.dday <= 7 ? '#ea580c' : '#6b7280', fontWeight: 700 }}>{r.pay.dday < 0 ? `D+${-r.pay.dday}` : r.pay.dday === 0 ? 'D-DAY' : `D-${r.pay.dday}`}</small> : null}{r.claims.n ? <small style={{ color: r.claims.pending ? '#dc2626' : '#6b7280' }}>클레임 {r.claims.n}{r.claims.pending ? `·대기${r.claims.pending}` : ''}</small> : null}{r.pendingN ? <small style={{ color: '#ea580c' }}>송금대기 {r.pendingN}</small> : null}</span>
            </button>))}{ledger && farms.length === 0 && <div className="dim" style={{ padding: 10 }}>해당 농장 없음</div>}</div>
        </aside>

        {/* ── 가운데 ── */}
        <main className="center">
          <div className="ch">
            {farm ? <><b>{farm}</b><button className="lnk" onClick={() => { setFarm(''); setView('board'); }}>✕ 전체로</button></> : <div className="seg">{[['board', '차수 보드'], ['reconcile', '발주·입고 비교'], ['product', '품목 추이'], ['eta', '입고 예정 칸반']].map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}</div>}
          </div>
          <IncomingInsight key={`${centerTab}|${farm}|${year}|${week}|${tick}`} initialTab={centerTab} initialFarm={farm} hideTabs />
        </main>

        {/* ── 오른쪽: 할 일 ── */}
        {rightOpen && <aside className="right">
          <div className="seg small">{[['remit', `송금 ${inboxRows.length}`], ['claims', `클레임 ${pendingClaims.length}`], ['eta', `ETA ${etaRows.length}`], ['missing', `미입고 ${missing.length}`]].map(([k, l]) => <button key={k} className={todo === k ? 'on' : ''} onClick={() => setTodo(k)}>{l}</button>)}</div>
          {todo === 'remit' && <div className="tl">
            {inboxRows.length === 0 && <div className="dim">송금 확인 대기 없음</div>}
            {inboxRows.slice(0, 60).map((r) => { const ed = edit[r.key] || {}; const fv = ed.farmName ?? r.farm ?? ''; return (
              <div key={r.key} className={'td' + (r.farm ? '' : ' warn')}>
                <div className="t1"><b>{r.payee}</b><span>{r.currency} {fmt(r.amountOrig ?? r.amountUSD)}</span></div>
                <div className="t2 dim">{r.date} · {r.fileName?.replace(/\.xlsx?$/i, '')}</div>
                <div className="t3"><input className="filter-input" list="op-farms" value={fv} placeholder="농장" onChange={(e) => setEdit({ ...edit, [r.key]: { ...ed, farmName: e.target.value } })} />{r.score != null && <small className="dim">{Math.round(r.score * 100)}%</small>}
                  <input className="filter-input wk" value={ed.weeks ?? r.weeks ?? ''} placeholder="차수" onChange={(e) => setEdit({ ...edit, [r.key]: { ...ed, weeks: e.target.value } })} /></div>
                <div className="t4"><button className="btn btn-primary" disabled={!fv || r.currency !== 'USD'} onClick={() => act({ action: 'confirm', key: r.key, farmName: fv, weeks: ed.weeks ?? r.weeks ?? '' })}>확정</button><button className="btn btn-secondary" onClick={() => confirm('거절할까요?') && act({ action: 'reject', key: r.key })}>거절</button>{fv && <button className="lnk" onClick={() => pick(fv)}>농장 보기</button>}</div>
              </div>); })}
            <datalist id="op-farms">{(inbox?.farms || []).map((f) => <option key={f} value={f} />)}</datalist>
          </div>}
          {todo === 'claims' && <div className="tl">{pendingClaims.length === 0 && <div className="dim">수입부 확인 대기 클레임 없음</div>}
            {pendingClaims.slice(0, 60).map((c) => <div key={c.key} className="td warn"><div className="t1"><b><button className="lnk" onClick={() => pick(c.farm)}>{c.farm}</button></b><span>{c.week}</span></div><div className="t2">{c.cust} · {c.prod}{c.color ? ` (${c.color})` : ''} · {fmt(c.qty)} {c.unit}</div>{c.note && <div className="t2 dim">{c.note}</div>}<div className="t4"><a className="btn btn-secondary" href={`/sales/defect-deductions?year=${c.week.split('-')[0]}&week=${c.week.split('-').slice(1).join('-')}`}>불량차감 원장에서 확인</a></div></div>)}</div>}
          {todo === 'eta' && <div className="tl">{etaRows.length === 0 && <div className="dim">등록된 입고 예정 없음 — 가운데 '입고 예정 칸반'에서 등록</div>}
            {etaRows.slice(0, 60).map((r) => <div key={r.id} className={'td' + (r.late ? ' warn' : '')}><div className="t1"><b><button className="lnk" onClick={() => pick(r.farm)}>{r.farm}</button></b><span>{r.stage}</span></div><div className="t2">{r.year} {r.week}{r.country ? ' · ' + r.country : ''} · ETA {r.eta || '미정'}{r.late ? ' · 지연' : ''}{r.awb ? ' · ' + r.awb : ''}</div>{r.note && <div className="t2 dim">{r.note}</div>}</div>)}</div>}
          {todo === 'missing' && <div className="tl">{missing.length === 0 && <div className="dim">미입고 품목 없음</div>}
            {missing.slice(0, 80).map((i) => <div key={i.prodKey} className="td warn"><div className="t1"><b>{i.name}</b><span>발주 {fmt(i.ordered)}</span></div><div className="t2 dim">{i.country} · {i.flower}</div></div>)}</div>}
        </aside>}
      </div>

      <style jsx>{`
        .op{font-size:12px}
        .kpi{display:flex;gap:6px;align-items:stretch;flex-wrap:wrap;padding:6px 8px;background:#fff;border:1px solid var(--border);margin-bottom:6px}
        .ttl{display:flex;flex-direction:column;gap:3px;justify-content:center;margin-right:4px}.ttl b{font-size:14px}
        .k{--c:#1166BB;display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:5px 10px;border:1px solid var(--border);border-left:3px solid var(--c);background:#fafbfc;border-radius:6px;cursor:pointer;font:inherit;text-align:left;min-width:120px}.k:hover{background:#f0f4ff}
        .k span{font-size:10.5px;color:var(--text3)}.k b{font-size:13px}.k em{font-style:normal}
        .links{margin-left:auto;display:flex;gap:4px;flex-wrap:wrap;align-items:center}.links a{font-size:11px;padding:3px 8px;border:1px solid var(--border2);border-radius:12px;background:#f7f8fa;color:var(--text1);text-decoration:none}.links a:hover{border-color:#1166BB;color:#1166BB}
        .tog{border:1px solid var(--border2);background:#fff;border-radius:6px;padding:3px 8px;cursor:pointer;font:inherit;font-size:11px}
        .err{padding:6px 10px;background:var(--red-bg);color:var(--red);border-radius:6px;margin-bottom:6px}
        .body{display:grid;grid-template-columns:250px minmax(0,1fr) ${rightOpen ? '330px' : '0'};gap:6px;align-items:start}
        .left{background:#fff;border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;max-height:calc(100vh - 150px)}
        .lh{display:flex;flex-direction:column;gap:4px;padding:6px;border-bottom:1px solid var(--border)}
        .fl{overflow:auto;flex:1}
        .fm{display:flex;align-items:center;gap:6px;width:100%;padding:6px 8px;border:0;border-left:3px solid transparent;background:transparent;cursor:pointer;font:inherit;text-align:left;border-bottom:1px solid #f0f1f4}
        .fm:hover{background:#f5f8ff}.fm.on{background:#e8f0fe;border-left-color:#1166BB}.fm.all{font-weight:600}
        .fm i{width:8px;height:8px;border-radius:50%;flex:0 0 8px}.fm .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .fm .v{display:flex;flex-direction:column;align-items:flex-end;line-height:1.15}.fm .v b{font-size:11.5px}.fm .v small{font-size:10px}.fm small{color:var(--text3)}
        .center{min-width:0}.ch{display:flex;align-items:center;gap:8px;margin-bottom:4px}.ch b{font-size:14px}
        .seg{display:inline-flex;gap:2px;padding:2px;background:#e7e9ee;border-radius:8px}.seg button{border:0;background:transparent;padding:4px 10px;border-radius:6px;cursor:pointer;color:#555;font:inherit}.seg button.on{background:#fff;color:#1166BB;font-weight:700;box-shadow:0 1px 2px rgba(0,0,0,.1)}.seg.small button{padding:3px 8px;font-size:11px}
        .lnk{border:0;background:transparent;color:#1166BB;cursor:pointer;padding:0;font:inherit}
        .right{background:#fff;border:1px solid var(--border);border-radius:8px;padding:6px;max-height:calc(100vh - 150px);display:flex;flex-direction:column;gap:6px;overflow:hidden}
        .tl{overflow:auto;display:flex;flex-direction:column;gap:6px}
        .td{border:1px solid var(--border);border-radius:8px;padding:6px 8px;background:#fafbfc}.td.warn{border-color:#fdba74;background:#fff7ed}
        .t1{display:flex;justify-content:space-between;gap:6px}.t1 b{font-size:12px}.t1 span{color:var(--text3);white-space:nowrap}
        .t2{font-size:11px;margin-top:2px}.t3{display:flex;gap:4px;align-items:center;margin-top:4px}.t3 input{font-size:11px;height:22px;flex:1;min-width:0}.t3 .wk{flex:0 0 70px}.t4{display:flex;gap:4px;align-items:center;margin-top:4px}
        .dim{color:var(--text3)}
        @media(max-width:1100px){.body{grid-template-columns:1fr}.left{max-height:220px}.right{max-height:none}}
      `}</style>
    </div>
  );
}
