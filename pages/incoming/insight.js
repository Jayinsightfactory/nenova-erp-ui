// pages/incoming/insight.js
// 입고 인사이트 — nenova.exe 원장에 없는 교차 보기 5종 (읽기 전용 + 입고 예정은 웹 전용 파일 저장)
//   차수 보드: 차수×국가×농장 발주→입고→분배 채움률 / 대사: 품목 단위 발주·입고·분배 차이 / 농장: 프로필 / 품목: 단가·수량 추이 / 예정: ETA 단계 보드
// 근거: Orbit 실측(수입부가 엑셀·카톡·WhatsApp으로 손대사·ETA 추적) — docs 기획 2026-09-22
import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';

const fmt = (n) => (n == null || n === '' ? '–' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }));
const TAG_C = { 미입고: '#dc2626', 부족: '#ea580c', 초과: '#ca8a04', 일치: '#16a34a', 미발주: '#7c3aed' };
const TABS = [['board', '차수 보드'], ['reconcile', '발주·입고 비교'], ['ledger', '농장 정산·송금'], ['farm', '농장'], ['product', '품목'], ['eta', '입고 예정']];
const ST_C = { 미송금: '#dc2626', 부분송금: '#ea580c', 완납: '#16a34a', 청구없음: '#9ca3af' };
// 결제 D-day 표기: 음수=지남(연체), 0=오늘, 양수=남음. 결제일 미설정이면 '설정 필요'
const DDay = ({ pay, small }) => {
  if (!pay) return null;
  if (!pay.unpaidN) return <span className="dim">{small ? '' : '미결 없음'}</span>;
  if (!pay.day) return <a href="/stats/pivot-import-farm-settings" className="dim" title="농장 결제일(5/15/25/30)을 설정하면 D-day가 계산됩니다">결제일 설정 필요</a>;
  const d = pay.dday; const c = d < 0 ? '#dc2626' : d <= 7 ? '#ea580c' : '#16a34a';
  return <span style={{ color: c, fontWeight: 700 }} title={`결제일 매월 ${pay.day}일 · 가장 오래된 미결 인보이스 ${pay.oldestUnpaid} → 만기 ${pay.nextDue} · 미결 ${pay.unpaidN}건`}>{d < 0 ? `D+${-d}` : d === 0 ? 'D-DAY' : `D-${d}`}{!small && <small style={{ fontWeight: 400, marginLeft: 4, color: '#6b7280' }}>{pay.nextDue.slice(5)}</small>}{pay.overdueUSD > 0.5 && !small && <small style={{ display: 'block', color: '#dc2626', fontWeight: 400 }}>연체 {Number(pay.overdueUSD).toLocaleString()} </small>}</span>;
};
const api = async (url, opt) => { const r = await fetch(url, opt); const j = await r.json().catch(() => ({})); if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`); return j; };

export function IncomingInsight({ initialTab, hideTabs, initialFarm } = {}) {
  const [tab, setTab] = useState(initialTab || 'board');
  const [ledger, setLedger] = useState(null);
  const [inbox, setInbox] = useState(null);        // 송금 자동 인식 대기함
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inboxEdit, setInboxEdit] = useState({}); // key → { farmName, weeks }
  const [ledgerF, setLedgerF] = useState('');
  const [weeks, setWeeks] = useState([]);
  const [year, setYear] = useState('');
  const [week, setWeek] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [board, setBoard] = useState(null);
  const [tagF, setTagF] = useState('');
  const [farmName, setFarmName] = useState(initialFarm || '');
  const [farmData, setFarmData] = useState(null);
  const [prodQ, setProdQ] = useState('');
  const [prodData, setProdData] = useState(null);
  const [months, setMonths] = useState('6');
  const [eta, setEta] = useState(null);
  const [etaForm, setEtaForm] = useState({ farm: '', country: '', awb: '', eta: '', stage: '발주', note: '' });
  const [etaScope, setEtaScope] = useState('active'); // active | week

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('tab')) setTab(q.get('tab'));
    if (q.get('farm')) { setFarmName(q.get('farm')); }
    if (q.get('q')) setProdQ(q.get('q'));
    api('/api/incoming/insight?view=weeks').then((j) => { setWeeks(j.weeks); const y = q.get('year'), w = q.get('week'); if (y && w) { setYear(y); setWeek(w); } else if (j.weeks[0]) { setYear(String(j.weeks[0].year)); setWeek(j.weeks[0].week); } }).catch((e) => setErr(e.message));
  }, []);
  useEffect(() => {
    if (!year || !week) return;
    const q = new URLSearchParams({ tab, year, week }); if (farmName) q.set('farm', farmName); if (prodQ) q.set('q', prodQ);
    window.history.replaceState(null, '', `${window.location.pathname}?${q}`);
  }, [tab, year, week, farmName, prodQ]);

  const loadBoard = async () => { if (!year || !week) return; setLoading(true); setErr(''); try { setBoard(await api(`/api/incoming/insight?view=board&year=${year}&week=${week}`)); } catch (e) { setErr(e.message); } finally { setLoading(false); } };
  const loadFarm = async (f = farmName) => { if (!f) return; setLoading(true); setErr(''); try { setFarmData(await api(`/api/incoming/insight?view=farm&farm=${encodeURIComponent(f)}&months=${months}`)); } catch (e) { setErr(e.message); } finally { setLoading(false); } };
  const loadProd = async (q = prodQ) => { if (!q) return; setLoading(true); setErr(''); try { setProdData(await api(`/api/incoming/insight?view=product&q=${encodeURIComponent(q)}&months=${months}`)); } catch (e) { setErr(e.message); } finally { setLoading(false); } };
  const loadLedger = async () => { setLoading(true); setErr(''); try { setLedger(await api(`/api/incoming/insight?view=ledger&months=${months}`)); } catch (e) { setErr(e.message); } finally { setLoading(false); } };
  const loadInbox = async () => { try { setInbox(await api('/api/incoming/remit-inbox')); } catch (e) { setErr(e.message); } };
  const inboxAct = async (body) => { try { await api('/api/incoming/remit-inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); await loadInbox(); await loadLedger(); } catch (e) { alert(e.message); } };
  const rescan = async () => { if (!confirm('드라이브의 송금신청 파일을 전부 다시 읽어 대기함을 채울까요? (확정/거절한 건은 유지)')) return; setLoading(true); try { const r = await api('/api/incoming/remit-inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'rescan' }) }); alert(`파일 ${r.files} · 행 ${r.parsed} · 새로 ${r.inserted} · 갱신 ${r.updated} · 농장 미매칭 ${r.unmatched}${r.errors.length ? '\n오류 ' + r.errors.length : ''}`); await loadInbox(); await loadLedger(); } catch (e) { alert(e.message); } finally { setLoading(false); } };
  const loadEta = async () => { setLoading(true); setErr(''); try { setEta(await api(`/api/incoming/eta${etaScope === 'week' && year && week ? `?year=${year}&week=${week}` : ''}`)); } catch (e) { setErr(e.message); } finally { setLoading(false); } };

  useEffect(() => { if (tab === 'board' || tab === 'reconcile') loadBoard(); }, [year, week, tab === 'board' || tab === 'reconcile']); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'farm' && farmName && !farmData) loadFarm(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'product' && prodQ && !prodData) loadProd(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'eta') loadEta(); }, [tab, etaScope, year, week]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'ledger') { loadLedger(); loadInbox(); } }, [tab, months]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => (board?.items || []).filter((i) => !tagF || i.tag === tagF), [board, tagF]);
  const exportRows = (rows, name) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name.slice(0, 30)); XLSX.writeFile(wb, `${name}.xlsx`); };
  const goFarm = (f) => { setFarmName(f); setFarmData(null); setTab('farm'); setTimeout(() => loadFarm(f), 0); };
  const goProd = (q) => { setProdQ(q); setProdData(null); setTab('product'); setTimeout(() => loadProd(q), 0); };
  const saveEta = async (row) => { try { await api('/api/incoming/eta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ year, week, ...row }) }); setEtaForm({ farm: '', country: '', awb: '', eta: '', stage: '발주', note: '' }); loadEta(); } catch (e) { alert(e.message); } };

  const Tag = ({ t }) => <span className="tag" style={{ background: TAG_C[t] || '#6b7280' }}>{t}</span>;
  const Bar = ({ v, c = '#1166BB' }) => <span className="bar"><i style={{ width: `${Math.min(100, Math.max(0, v || 0))}%`, background: c }} />{v == null ? '–' : v + '%'}</span>;
  const Sparks = ({ rows }) => { const m = Math.max(1, ...rows.map((r) => r.qty)); return <span className="sparks">{rows.map((r, i) => <i key={i} title={`${r.week}: ${fmt(r.qty)}${r.uprice != null ? ' · ' + fmt(r.uprice) : ''}`} style={{ height: `${Math.max(8, 100 * r.qty / m)}%` }} />)}</span>; };

  return (
    <div className="ii">
      <div className="filter-bar">
        <span className="filter-label">차수</span>
        <select className="filter-input" value={`${year}|${week}`} onChange={(e) => { const [y, w] = e.target.value.split('|'); setYear(y); setWeek(w); }}>
          {weeks.map((w) => <option key={`${w.year}|${w.week}`} value={`${w.year}|${w.week}`}>{w.year} {w.week} ({w.n})</option>)}
        </select>
        <span className="filter-label" style={{ marginLeft: 6 }}>기간</span>
        <select className="filter-input" value={months} onChange={(e) => setMonths(e.target.value)}><option value="3">3개월</option><option value="6">6개월</option><option value="12">12개월</option><option value="24">24개월</option></select>
        {!hideTabs && <div className="tabs">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>}
        <div className="page-actions"><a className="btn btn-secondary" href={`/incoming?from=${new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`}>원장으로</a></div>
      </div>
      {err && <div className="msg err">⚠️ {err}</div>}
      {loading && <div className="skeleton" style={{ height: 6, margin: '4px 0' }} />}

      {/* ── 차수 보드 ── */}
      {tab === 'board' && board && (
        <>
          <div className="sum">
            <div><b>{fmt(board.totals.ordered)}</b><span>발주 수량</span></div><div><b>{fmt(board.totals.received)}</b><span>입고 수량</span></div><div><b>{fmt(board.totals.shipped)}</b><span>분배(출고) 수량</span></div>
            <div><b style={{ color: TAG_C.미입고 }}>{board.totals.missing}</b><span>미입고 품목</span></div><div><b style={{ color: TAG_C.부족 }}>{board.totals.short}</b><span>부족</span></div><div><b style={{ color: TAG_C.초과 }}>{board.totals.over}</b><span>초과</span></div><div><b style={{ color: TAG_C.미발주 }}>{board.totals.unordered}</b><span>미발주 입고</span></div>
            <div style={{ marginLeft: 'auto' }}><button className="btn btn-secondary" onClick={() => exportRows(board.items.map((i) => ({ 국가: i.country, 꽃: i.flower, 품목: i.name, 발주: i.ordered, 입고: i.received, 분배: i.shipped, 차이: i.diff, 판정: i.tag, 농장: i.farms.map((f) => `${f.farm}(${f.qty})`).join(', ') })), `차수보드_${year}_${week}`)}>📊 엑셀</button></div>
          </div>
          <div className="cards">
            {board.cards.map((c) => (
              <div className="ccard" key={c.country} onClick={() => { setTab('reconcile'); setTagF(''); }} title="클릭하면 발주·입고 비교 탭">
                <div className="ch"><b>{c.country}</b><span>{c.products}품목{c.missing ? <em style={{ color: TAG_C.미입고 }}> · 미입고 {c.missing}</em> : null}</span></div>
                <div className="row3"><div><span>발주</span><b>{fmt(c.ordered)}</b></div><div><span>입고</span><b>{fmt(c.received)}</b></div><div><span>분배</span><b>{fmt(c.shipped)}</b></div></div>
                <div className="bars"><span>입고율</span><Bar v={c.fill} c={c.fill == null ? '#9ca3af' : c.fill < 90 ? TAG_C.부족 : c.fill > 110 ? TAG_C.초과 : TAG_C.일치} /><span>분배율</span><Bar v={c.shipRate} /></div>
                <div className="farms">{c.farms.slice(0, 6).map((f) => <button key={f.farm} onClick={(e) => { e.stopPropagation(); goFarm(f.farm); }} title="농장 프로필">{f.farm} <em>{fmt(f.qty)}</em></button>)}{c.farms.length > 6 && <span className="dim">+{c.farms.length - 6}</span>}{c.farms.length === 0 && <span className="dim">입고 없음</span>}</div>
              </div>
            ))}
            {board.cards.length === 0 && <div className="empty">이 차수에 발주·입고 데이터가 없습니다</div>}
          </div>
        </>
      )}

      {/* ── 발주·입고 비교 ── */}
      {tab === 'reconcile' && board && (
        <div className="card" style={{ padding: 0 }}>
          <div className="card-header"><span className="card-title">발주·입고 비교 · {year} {week}</span>
            <span className="tagf">{['', '미입고', '부족', '초과', '일치', '미발주'].map((t) => <button key={t} className={tagF === t ? 'on' : ''} onClick={() => setTagF(t)}>{t || '전체'} <em>{t ? board.items.filter((i) => i.tag === t).length : board.items.length}</em></button>)}</span>
            <button className="btn btn-secondary" onClick={() => exportRows(items.map((i) => ({ 국가: i.country, 꽃: i.flower, 품목: i.name, 발주: i.ordered, 입고: i.received, 차이: i.diff, 입고율: i.fill, 분배: i.shipped, 분배율: i.shipRate, 판정: i.tag, 농장: i.farms.map((f) => `${f.farm}(${f.qty}${f.uprice != null ? '@' + f.uprice : ''})`).join(', ') })), `발주입고비교_${year}_${week}`)}>📊 엑셀</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl" style={{ minWidth: 900 }}>
              <thead><tr><th>국가</th><th>꽃</th><th>품목</th><th className="r">발주</th><th className="r">입고</th><th className="r">차이</th><th>입고율</th><th className="r">분배</th><th>분배율</th><th>판정</th><th>입고 농장 (수량@단가)</th></tr></thead>
              <tbody>{items.length === 0 ? <tr><td colSpan={11} className="empty">해당 없음</td></tr> : items.map((i) => (
                <tr key={i.prodKey}>
                  <td>{i.country}</td><td>{i.flower}</td><td className="name"><button className="lnk" onClick={() => goProd(i.name)} title="품목 추이">{i.name}</button></td>
                  <td className="num">{fmt(i.ordered)}</td><td className="num">{fmt(i.received)}</td><td className="num" style={{ color: i.diff < 0 ? TAG_C.부족 : i.diff > 0 ? TAG_C.초과 : 'inherit', fontWeight: 600 }}>{i.diff > 0 ? '+' : ''}{fmt(i.diff)}</td>
                  <td><Bar v={i.fill} c={i.fill == null ? '#9ca3af' : i.fill < 90 ? TAG_C.부족 : i.fill > 110 ? TAG_C.초과 : TAG_C.일치} /></td>
                  <td className="num">{fmt(i.shipped)}</td><td><Bar v={i.shipRate} /></td><td><Tag t={i.tag} /></td>
                  <td>{i.farms.map((f) => <button key={f.farm} className="lnk" onClick={() => goFarm(f.farm)}>{f.farm} <em>{fmt(f.qty)}{f.uprice != null ? '@' + fmt(f.uprice) : ''}</em></button>)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 농장 정산·송금 ── */}
      {tab === 'ledger' && inbox && (
        <div className="card" style={{ padding: 8, marginBottom: 6, borderLeft: `4px solid ${inbox.rows.length ? '#ea580c' : '#16a34a'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <b>송금 자동 인식</b>
            <span>{inbox.rows.length ? <>확인 대기 <b style={{ color: '#ea580c' }}>{inbox.rows.length}건</b> · {fmt(inbox.rows.reduce((a, r) => a + (r.amountUSD || 0), 0))} USD{inbox.rows.some((r) => !r.farm) ? ` · 농장 미매칭 ${inbox.rows.filter((r) => !r.farm).length}` : ''}</> : <span className="dim">대기 없음 — 경영지원이 '해외건별송금신청' 파일을 저장하면 자동으로 여기 들어옵니다</span>}</span>
            {inbox.rows.length > 0 && <button className="btn btn-primary" onClick={() => setInboxOpen(!inboxOpen)}>{inboxOpen ? '접기' : '확인하기'}</button>}
            <button className="btn btn-secondary" onClick={rescan} title="드라이브의 과거 송금신청 파일까지 다시 읽기(사장)">과거 파일 소급</button>
          </div>
          {inboxOpen && inbox.rows.length > 0 && (
            <div style={{ overflowX: 'auto', marginTop: 6 }}>
              <table className="tbl" style={{ minWidth: 900 }}>
                <thead><tr><th>송금(예정)일</th><th>받는 분(법인명)</th><th className="r">금액</th><th>통화</th><th>농장 (제안 · 신뢰도)</th><th>차수</th><th>출처 파일</th><th></th></tr></thead>
                <tbody>{inbox.rows.map((r) => { const ed = inboxEdit[r.key] || {}; const farmV = ed.farmName ?? r.farm ?? ''; return (
                  <tr key={r.key} style={{ background: r.farm ? 'transparent' : '#fff7ed' }}>
                    <td className="mono">{r.date}</td><td>{r.payee}</td><td className="num">{fmt(r.amountOrig ?? r.amountUSD)}</td><td>{r.currency}</td>
                    <td><input className="filter-input" list="farm-dl" value={farmV} onChange={(e) => setInboxEdit({ ...inboxEdit, [r.key]: { ...ed, farmName: e.target.value } })} placeholder="농장명 입력" style={{ width: 200 }} />{r.score != null && <span className="dim" style={{ marginLeft: 4 }}>{Math.round(r.score * 100)}%</span>}</td>
                    <td><input className="filter-input" value={ed.weeks ?? r.weeks ?? ''} onChange={(e) => setInboxEdit({ ...inboxEdit, [r.key]: { ...ed, weeks: e.target.value } })} placeholder="예: 38-01,38-02" style={{ width: 120 }} /></td>
                    <td className="dim" style={{ fontSize: 11 }}>{r.fileName}</td>
                    <td style={{ whiteSpace: 'nowrap' }}><button className="btn btn-primary" disabled={!farmV || r.currency !== 'USD'} title={r.currency !== 'USD' ? 'USD만 자동 확정(다른 통화는 송금 입력 화면에서)' : ''} onClick={() => inboxAct({ action: 'confirm', key: r.key, farmName: farmV, weeks: ed.weeks ?? r.weeks ?? '' })}>확정</button> <button className="btn btn-secondary" onClick={() => confirm('이 행을 거절(무시)할까요?') && inboxAct({ action: 'reject', key: r.key })}>거절</button></td>
                  </tr>); })}</tbody>
              </table>
              <datalist id="farm-dl">{(inbox.farms || []).map((f) => <option key={f} value={f} />)}</datalist>
            </div>
          )}
        </div>
      )}
      {tab === 'ledger' && ledger && (
        <div className="card" style={{ padding: 0 }}>
          <div className="card-header"><span className="card-title">농장 정산·송금 ({months}개월 입고 기준)</span>
            <span className="tagf">{['', '미송금', '부분송금', '완납'].map((t) => <button key={t} className={ledgerF === t ? 'on' : ''} onClick={() => setLedgerF(t)}>{t || '전체'} <em>{t ? ledger.rows.filter((r) => r.status === t).length : ledger.rows.length}</em></button>)}</span>
            <span className="dim" style={{ marginLeft: 8 }}><b style={{ color: ledger.totals.overdueFarms ? '#dc2626' : '#16a34a' }}>연체 {ledger.totals.overdueFarms}농장 {fmt(ledger.totals.overdueUSD)}</b> · 7일 내 만기 {ledger.totals.dueSoon} · 결제일 미설정 {ledger.totals.noPayDay} · 클레임 {ledger.totals.claims}건(확인 대기 {ledger.totals.claimsPending}) · 청구 {fmt(ledger.totals.billed)} · 크레딧 {fmt(ledger.totals.credit)} · 송금 {fmt(ledger.totals.remit)} · <b style={{ color: ledger.totals.balance > 0 ? ST_C.미송금 : ST_C.완납 }}>잔액 {fmt(ledger.totals.balance)}</b> (USD)</span>
            <a className="btn btn-secondary" href="/incoming-price" style={{ marginLeft: 8 }}>송금·크레딧 입력</a>
            <button className="btn btn-secondary" onClick={() => exportRows(ledger.rows.map((r) => ({ 농장: r.farm, 인보이스: r.invoices, 상품금액: r.goods, 운임: r.freight, 청구: r.billed, 크레딧: r.credit, 송금: r.remit, 잔액: r.balance, 상태: r.status, 클레임건수: r.claims.n, 클레임수량: r.claims.qty, 클레임확인대기: r.claims.pending, 결제일: r.pay.day, 다음만기: r.pay.nextDue, Dday: r.pay.dday, 연체USD: r.pay.overdueUSD, 미결인보이스: r.pay.unpaidN, 마지막입고: r.lastInput, 마지막송금: r.lastRemit })), `농장정산_${months}개월`)}>📊 엑셀</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl" style={{ minWidth: 980 }}>
              <thead><tr><th>농장</th><th className="r">인보이스</th><th className="r">상품 금액</th><th className="r">운임</th><th className="r">청구 합계</th><th className="r">크레딧</th><th className="r">송금</th><th className="r">잔액</th><th>지급률</th><th>상태</th><th>결제 D-day</th><th className="r">클레임</th><th>마지막 입고</th><th>마지막 송금</th></tr></thead>
              <tbody>{ledger.rows.filter((r) => !ledgerF || r.status === ledgerF).map((r) => (
                <tr key={r.farm}>
                  <td className="name"><button className="lnk" onClick={() => goFarm(r.farm)}>{r.farm}</button></td>
                  <td className="num">{r.invoices}</td><td className="num">{fmt(r.goods)}</td><td className="num">{fmt(r.freight)}</td><td className="num" style={{ fontWeight: 600 }}>{fmt(r.billed)}</td>
                  <td className="num">{fmt(r.credit)}</td><td className="num">{fmt(r.remit)}{r.pendingN ? <div style={{ fontSize: 10, color: '#ea580c' }}>대기 {r.pendingN}건 {fmt(r.pendingRemit)}</div> : null}</td><td className="num" style={{ fontWeight: 700, color: r.balance > 0.5 ? ST_C.미송금 : r.balance < -0.5 ? ST_C.부분송금 : ST_C.완납 }}>{fmt(r.balance)}</td>
                  <td><Bar v={r.paidRate} c={r.paidRate == null ? '#9ca3af' : r.paidRate >= 100 ? ST_C.완납 : ST_C.부분송금} /></td>
                  <td><span className="tag" style={{ background: ST_C[r.status] }}>{r.status}</span></td><td><DDay pay={r.pay} /></td><td className="num">{r.claims.n ? <span title={`수량 ${fmt(r.claims.qty)} · 크레딧 반영 ${r.claims.credited} · 수입부 확인 대기 ${r.claims.pending}`}>{r.claims.n}건{r.claims.pending ? <em style={{ color: ST_C.미송금, fontStyle: 'normal' }}> (대기 {r.claims.pending})</em> : null}</span> : <span className="dim">–</span>}</td><td className="mono">{r.lastInput}{r.pay.lastInputDays != null && <small className="dim"> ({r.pay.lastInputDays}일 전)</small>}</td><td className="mono">{r.lastRemit || '–'}{r.pay.lastRemitDays != null && <small className="dim"> ({r.pay.lastRemitDays}일 전)</small>}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 농장 프로필 ── */}
      {tab === 'farm' && (
        <>
          <div className="filter-bar"><span className="filter-label">농장명</span><input className="filter-input" style={{ width: 260 }} value={farmName} onChange={(e) => setFarmName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadFarm()} placeholder="예: American Flowers Medellin S.A.S" /><button className="btn btn-primary" onClick={() => loadFarm()}>조회</button><span className="dim">차수 보드·비교 탭의 농장 이름을 눌러도 옵니다</span></div>
          {farmData && (
            <div className="grid2">
              <div className="card">
                <div className="card-header"><span className="card-title">{farmData.farm} · 차수별 입고 ({months}개월)</span><span className="dim">{farmData.invoices.length}건 인보이스</span></div>
                <div className="wk">{farmData.weeks.map((w) => <div key={w.week}><span>{w.week}</span><i style={{ width: `${Math.round(100 * w.qty / Math.max(1, ...farmData.weeks.map((x) => x.qty)))}%` }} /><b>{fmt(w.qty)}</b><small>{w.products}품목</small></div>)}{farmData.weeks.length === 0 && <div className="empty">입고 없음</div>}</div>
                {farmData.ledger && (
                  <div className="sum" style={{ margin: '0 0 6px', borderLeft: 0, borderRight: 0 }}>
                    <div><b>{fmt(farmData.ledger.billed)}</b><span>청구(상품+운임, USD)</span></div><div><b>{fmt(farmData.ledger.credit)}</b><span>크레딧</span></div><div><b>{fmt(farmData.ledger.remit)}</b><span>송금</span></div>
                    <div><b style={{ color: farmData.ledger.balance > 0.5 ? ST_C.미송금 : ST_C.완납 }}>{fmt(farmData.ledger.balance)}</b><span>잔액</span></div><div><b><DDay pay={farmData.ledger.pay} /></b><span>결제 D-day{farmData.ledger.pay?.day ? ` (매월 ${farmData.ledger.pay.day}일)` : ''}</span></div><div><span className="tag" style={{ background: ST_C[farmData.ledger.status] }}>{farmData.ledger.status}</span><span>마지막 송금 {farmData.ledger.lastRemit || '–'}</span></div>
                    <div style={{ marginLeft: 'auto' }}><a className="btn btn-secondary" href="/incoming-price">송금·크레딧 입력</a></div>
                  </div>
                )}
                {farmData.ledger && farmData.ledger.pay && farmData.ledger.pay.unpaidN > 0 && (
                  <div style={{ padding: '0 12px 6px', fontSize: 11 }}><b>미결 인보이스 {farmData.ledger.pay.unpaidN}건</b> {farmData.ledger.pay.unpaid.map((u) => { const late = u.due && u.due < new Date().toISOString().slice(0, 10); return <span key={u.key} className="pillx" style={late ? { background: '#fee2e2', color: '#b91c1c' } : {}}>{u.date} · {fmt(u.amount)} USD{u.due ? ` · 만기 ${u.due.slice(5)}` : ''}</span>; })}</div>
                )}
                {farmData.ledger && farmData.ledger.remits.length > 0 && (
                  <div style={{ padding: '4px 12px 8px', fontSize: 11 }}><b>송금 기록</b> {farmData.ledger.remits.slice(0, 8).map((r) => <span key={r.key} className="pillx">{r.date} · {fmt(r.amount)} USD{r.weeks ? ` (${r.weeks})` : ''}{r.memo ? ` · ${r.memo}` : ''}</span>)}</div>
                )}
                {farmData.ledger && farmData.ledger.claims.n > 0 && (
                  <div style={{ padding: '4px 12px 8px', fontSize: 11 }}><b>클레임(불량차감) {farmData.ledger.claims.n}건 · 수량 {fmt(farmData.ledger.claims.qty)} · 크레딧 반영 {farmData.ledger.claims.credited} · 수입부 확인 대기 {farmData.ledger.claims.pending}</b> <a href="/sales/farm-quality" style={{ marginLeft: 6 }}>농장 품질 화면</a>
                    <table className="tbl mini" style={{ marginTop: 4 }}><thead><tr><th>차수</th><th>거래처</th><th>품목</th><th className="r">수량</th><th>구분</th><th>크레딧</th><th>수입부 확인</th><th>메모</th></tr></thead>
                      <tbody>{farmData.ledger.claims.items.map((c) => <tr key={c.key}><td>{c.week}</td><td>{c.cust}</td><td>{c.prod}{c.color ? ` (${c.color})` : ''}</td><td className="num">{fmt(c.qty)} {c.unit}</td><td>{c.type}</td><td>{c.credited ? '반영' : <span style={{ color: ST_C.부분송금 }}>미반영</span>}</td><td>{c.confirmed && !c.review ? '확인' : <span style={{ color: ST_C.미송금 }}>대기</span>}</td><td>{c.note}</td></tr>)}</tbody></table>
                  </div>
                )}
                <div className="card-header"><span className="card-title">인보이스 · 운임</span><button className="btn btn-secondary" onClick={() => exportRows(farmData.invoices, `농장_${farmData.farm}`)}>📊 엑셀</button></div>
                <div style={{ overflowX: 'auto' }}><table className="tbl"><thead><tr><th>차수</th><th>인보이스</th><th>AWB</th><th>입력일</th><th className="r">박스</th><th className="r">금액</th><th className="r">GW</th><th className="r">CW</th><th className="r">Rate</th><th className="r">운임(USD)</th></tr></thead>
                  <tbody>{farmData.invoices.map((v) => <tr key={v.WarehouseKey}><td>{v.OrderYear} {v.OrderWeek}</td><td className="mono">{v.InvoiceNo}</td><td className="mono">{v.AWB}</td><td className="mono">{v.InputDate}</td><td className="num">{fmt(v.Box)}</td><td className="num">{fmt(v.Amount)}</td><td className="num">{fmt(v.GrossWeight)}</td><td className="num">{fmt(v.ChargeableWeight)}</td><td className="num">{fmt(v.FreightRateUSD)}</td><td className="num">{fmt(v.freightUSD)}</td></tr>)}</tbody></table></div>
              </div>
              <div className="card">
                <div className="card-header"><span className="card-title">품목 구성 · 단가 흐름</span></div>
                <div style={{ overflowX: 'auto' }}><table className="tbl"><thead><tr><th>품목</th><th>꽃</th><th className="r">수량</th><th className="r">박스</th><th>차수별 수량</th><th className="r">최근 단가</th><th className="r">이전</th></tr></thead>
                  <tbody>{farmData.products.map((p) => { const ups = p.weeks.filter((w) => w.uprice != null); const last = ups[ups.length - 1], prev = ups[ups.length - 2]; return <tr key={p.prodKey}><td className="name"><button className="lnk" onClick={() => goProd(p.name)}>{p.name}</button></td><td>{p.flower}</td><td className="num">{fmt(p.qty)}</td><td className="num">{fmt(p.box)}</td><td><Sparks rows={p.weeks} /></td><td className="num">{last ? fmt(last.uprice) : '–'}</td><td className="num dim">{prev ? fmt(prev.uprice) : '–'}</td></tr>; })}</tbody></table></div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── 품목 추이 ── */}
      {tab === 'product' && (
        <>
          <div className="filter-bar"><span className="filter-label">품목</span><input className="filter-input" style={{ width: 260 }} value={prodQ} onChange={(e) => setProdQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadProd()} placeholder="품목명·꽃 이름 일부 (예: Hydrangea, 장미)" /><button className="btn btn-primary" onClick={() => loadProd()}>조회</button>{prodData && <button className="btn btn-secondary" onClick={() => exportRows(prodData.products.flatMap((p) => p.rows.map((r) => ({ 품목: p.name, 국가: p.country, 차수: r.week, 농장: r.farm, 수량: r.qty, 박스: r.box, 평균단가: r.uprice, 최저: r.min, 최고: r.max }))), `품목추이_${prodQ}`)}>📊 엑셀</button>}</div>
          {prodData && <div className="cards">{prodData.products.map((p) => (
            <div className="ccard" key={p.prodKey}>
              <div className="ch"><b>{p.name}</b><span>{p.country} · 농장 {p.farms.length} · 수량 {fmt(p.totalQty)}</span></div>
              <div className="row3"><div><span>최근 단가</span><b>{fmt(p.lastPrice)}</b></div><div><span>이전</span><b>{fmt(p.prevPrice)}</b></div><div><span>변동</span><b style={{ color: p.changePct > 0 ? TAG_C.부족 : p.changePct < 0 ? TAG_C.일치 : 'inherit' }}>{p.changePct == null ? '–' : (p.changePct > 0 ? '+' : '') + p.changePct + '%'}</b></div></div>
              <table className="tbl mini"><thead><tr><th>차수</th><th>농장</th><th className="r">수량</th><th className="r">단가</th></tr></thead><tbody>{p.rows.slice(-8).map((r, i) => <tr key={i}><td>{r.week}</td><td className="name"><button className="lnk" onClick={() => goFarm(r.farm)}>{r.farm}</button></td><td className="num">{fmt(r.qty)}</td><td className="num">{fmt(r.uprice)}</td></tr>)}</tbody></table>
            </div>))}{prodData.products.length === 0 && <div className="empty">해당 품목 입고 없음</div>}</div>}
        </>
      )}

      {/* ── 입고 예정 보드 ── */}
      {tab === 'eta' && (
        <>
          <div className="filter-bar">
            <div className="tabs"><button className={etaScope === 'active' ? 'on' : ''} onClick={() => setEtaScope('active')}>진행 중 전체</button><button className={etaScope === 'week' ? 'on' : ''} onClick={() => setEtaScope('week')}>{year} {week}만</button></div>
            <span className="dim">카톡·WhatsApp·엑셀에 흩어진 ETA를 한 줄씩 등록하면 원장이 올라오는 순간 자동으로 '입고등록'으로 바뀝니다</span>
          </div>
          <div className="card" style={{ padding: 8, marginBottom: 6 }}>
            <div className="etaform">
              <span className="dim">{year} {week}</span>
              <input className="filter-input" placeholder="농장명*" value={etaForm.farm} onChange={(e) => setEtaForm({ ...etaForm, farm: e.target.value })} style={{ width: 200 }} />
              <input className="filter-input" placeholder="국가" value={etaForm.country} onChange={(e) => setEtaForm({ ...etaForm, country: e.target.value })} style={{ width: 90 }} />
              <input className="filter-input" placeholder="AWB" value={etaForm.awb} onChange={(e) => setEtaForm({ ...etaForm, awb: e.target.value })} style={{ width: 130 }} />
              <input className="filter-input" type="date" value={etaForm.eta} onChange={(e) => setEtaForm({ ...etaForm, eta: e.target.value })} />
              <select className="filter-input" value={etaForm.stage} onChange={(e) => setEtaForm({ ...etaForm, stage: e.target.value })}>{(eta?.stages || ['발주', '선적', '통관중', '도착']).filter((s) => s !== '입고등록').map((s) => <option key={s}>{s}</option>)}</select>
              <input className="filter-input" placeholder="메모(예: 통관 지연, 9/29 도착 예정)" value={etaForm.note} onChange={(e) => setEtaForm({ ...etaForm, note: e.target.value })} style={{ flex: 1, minWidth: 160 }} />
              <button className="btn btn-primary" disabled={!etaForm.farm} onClick={() => saveEta(etaForm)}>등록</button>
            </div>
          </div>
          {eta && (
            <div className="kan">
              {eta.stages.map((s) => { const rows = eta.rows.filter((r) => r.stage === s); return (
                <div className="kcol" key={s}><div className="kh">{s} <em>{rows.length}</em></div>
                  {rows.map((r) => (
                    <div className={'kcard' + (r.late ? ' late' : '')} key={r.id}>
                      <div className="kt"><b>{r.farm}</b><span>{r.year} {r.week}{r.country ? ' · ' + r.country : ''}</span></div>
                      <div className="km">{r.eta ? <span>ETA {r.eta}{r.late ? ' · 지연' : ''}</span> : <span className="dim">ETA 미정</span>}{r.awb && <span> · AWB {r.awb}</span>}</div>
                      {r.note && <div className="kn">{r.note}</div>}
                      {r.matched && <div className="kn" style={{ color: TAG_C.일치 }}>원장 {r.matched.n}건 · 마지막 입력 {r.matched.lastInput}</div>}
                      {s !== '입고등록' && <div className="ka">
                        <select className="filter-input" value={r.stage} onChange={(e) => saveEta({ ...r, stage: e.target.value })}>{eta.stages.filter((x) => x !== '입고등록').map((x) => <option key={x}>{x}</option>)}</select>
                        <input className="filter-input" type="date" value={r.eta || ''} onChange={(e) => saveEta({ ...r, eta: e.target.value })} />
                        <button className="btn btn-secondary" onClick={() => confirm('삭제할까요?') && api('/api/incoming/eta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id, deleted: true }) }).then(loadEta)}>✕</button>
                      </div>}
                    </div>))}
                  {rows.length === 0 && <div className="empty small">—</div>}
                </div>); })}
            </div>
          )}
        </>
      )}

      <style jsx>{`
        .ii{font-size:12px}
        .tabs{display:inline-flex;gap:2px;margin-left:10px;padding:2px;background:#e7e9ee;border-radius:8px}.tabs button{border:0;background:transparent;padding:4px 10px;border-radius:6px;cursor:pointer;color:#555;font:inherit}.tabs button.on{background:#fff;color:#1166BB;font-weight:700;box-shadow:0 1px 2px rgba(0,0,0,.1)}
        .msg.err{padding:8px 14px;background:var(--red-bg);color:var(--red);border-radius:8px;margin:6px 0}
        .dim{color:var(--text3)}.r{text-align:right}.mono{font-family:var(--mono);font-size:11px}
        .sum{display:flex;gap:18px;align-items:center;flex-wrap:wrap;padding:8px 12px;background:#fff;border:1px solid var(--border);margin-bottom:8px}.sum div{display:flex;flex-direction:column}.sum b{font-size:16px}.sum span{font-size:11px;color:var(--text3)}
        .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:8px}
        .ccard{background:#fff;border:1px solid var(--border);border-radius:8px;padding:10px;cursor:pointer}.ccard:hover{border-color:#1166BB}
        .ch{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}.ch b{font-size:14px}.ch span{font-size:11px;color:var(--text3)}
        .row3{display:flex;gap:12px;margin-bottom:6px}.row3 div{display:flex;flex-direction:column}.row3 span{font-size:10.5px;color:var(--text3)}.row3 b{font-size:13px}
        .bars{display:grid;grid-template-columns:auto 1fr;gap:3px 8px;align-items:center;font-size:11px;color:var(--text3);margin-bottom:6px}
        .bar{position:relative;display:inline-block;width:100%;min-width:90px;height:14px;background:#eef0f3;border-radius:4px;font-size:10.5px;line-height:14px;padding-left:4px;overflow:hidden;color:#222}.bar i{position:absolute;left:0;top:0;bottom:0;opacity:.35}
        .farms{display:flex;flex-wrap:wrap;gap:4px}.farms button{border:1px solid var(--border2);background:#f7f8fa;border-radius:10px;padding:1px 8px;font-size:11px;cursor:pointer}.farms em{font-style:normal;color:var(--text3)}
        .tag{display:inline-block;color:#fff;font-size:10.5px;padding:1px 7px;border-radius:10px;font-weight:600}
        .pillx{display:inline-block;background:#eef0f3;border-radius:10px;padding:1px 8px;margin:2px 4px 2px 0}
        .tagf{display:inline-flex;gap:4px;margin-left:10px}.tagf button{border:1px solid var(--border2);background:#fff;border-radius:10px;padding:1px 8px;font-size:11px;cursor:pointer}.tagf button.on{background:#1166BB;color:#fff;border-color:#1166BB}.tagf em{font-style:normal;opacity:.8}
        .lnk{border:0;background:transparent;color:#1166BB;cursor:pointer;padding:0;font:inherit;text-align:left}.lnk em{font-style:normal;color:var(--text3);margin-left:2px}.lnk+.lnk{margin-left:6px}
        .empty{text-align:center;color:var(--text3);padding:24px}.empty.small{padding:8px}
        .grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}@media(max-width:1100px){.grid2{grid-template-columns:1fr}}
        .wk{padding:8px 12px;display:flex;flex-direction:column;gap:3px}.wk div{display:grid;grid-template-columns:80px 1fr 70px 50px;align-items:center;gap:6px;font-size:11px}.wk i{display:block;height:10px;background:#1166BB;opacity:.5;border-radius:3px}.wk b{text-align:right}.wk small{color:var(--text3)}
        .sparks{display:inline-flex;align-items:flex-end;gap:2px;height:22px}.sparks i{display:inline-block;width:7px;background:#1166BB;opacity:.55;border-radius:2px 2px 0 0}
        .tbl.mini th,.tbl.mini td{padding:2px 6px;font-size:11px}
        .etaform{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
        .kan{display:flex;gap:8px;align-items:flex-start;overflow-x:auto}.kcol{flex:0 0 240px;background:#eef0f3;border-radius:8px;padding:6px}.kh{font-weight:700;margin:2px 4px 6px}.kh em{font-style:normal;color:var(--text3);margin-left:4px}
        .kcard{background:#fff;border:1px solid var(--border);border-radius:8px;padding:8px;margin-bottom:6px}.kcard.late{border-color:#dc2626;background:#fff5f5}
        .kt{display:flex;flex-direction:column}.kt span{font-size:11px;color:var(--text3)}.km{font-size:11px;margin-top:3px}.kn{font-size:11px;margin-top:3px;color:#444}.ka{display:flex;gap:4px;margin-top:6px}.ka select,.ka input{font-size:11px;height:22px}
      `}</style>
    </div>
  );
}

export default function IncomingInsightPage() { return <IncomingInsight />; }
