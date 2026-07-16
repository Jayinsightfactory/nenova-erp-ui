// 판매등록 히스토리 — 차수별 분배(매출) 고정 스냅샷과 변경 이력.
// 화 17:00(최종 분배 적용) · 수 16:00(점검) · 차주 화 17:00(판매등록 마감) · 차주 수 16:00(마감 점검) — 모두 불변.
// 기준금액은 기본 화요일 최종분배, 타임라인의 [✓ 적용 확인]으로 다른 스냅샷(예: 수요일)을 기준으로 바꿀 수 있음.
// 판매등록은 차주 화요일까지 수정 가능(그다음 수요일부터 수정금지) — 마감 스냅샷(TUE_CLOSE)이 차수 확정본.
import { useEffect, useMemo, useState } from 'react';
// Layout 은 _app.js 가 전역 래핑 — 페이지 자체 래핑 금지(이중 사이드바 원인)
import { getCurrentWeek, useWeekInput } from '../../lib/useWeekInput';

function getDefaultWeek() {
  // 기본 = 대차수(합산 모드). '27' → 27-01+27-02 합산이 27차.
  const current = getCurrentWeek();
  const m = String(current || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? m[2] : current;
}
const fmt = n => Number(n || 0).toLocaleString();
const TYPE_META = {
  TUE_FINAL: { label: '🔒 화요일 최종분배', color: '#1d4ed8', bg: '#dbeafe' },
  WED_CHECK: { label: '🔒 수요일 점검', color: '#7c3aed', bg: '#ede9fe' },
  TUE_CLOSE: { label: '🔒 판매등록 마감(차주 화 17시)', color: '#166534', bg: '#dcfce7' },
  CLOSE_CHECK: { label: '🔒 마감 점검(차주 수 16시)', color: '#9a3412', bg: '#ffedd5' },
  CHANGE: { label: '⚠ 변경감지', color: '#b91c1c', bg: '#fee2e2' },
  MANUAL: { label: '📌 수동', color: '#334155', bg: '#e2e8f0' },
};
const shortType = (t) => (TYPE_META[t]?.label || t || '').replace('🔒 ', '').replace('⚠ ', '').replace('📌 ', '');

// 접기/열기 패널 — 접혀도 헤더 요약은 보이게 (공간 최대 활용)
function Section({ title, badge, right, open, onToggle, children, accent }) {
  return (
    <div style={{ ...st.panel, ...(accent ? { borderColor: accent } : {}) }}>
      <div
        style={{ ...st.panelHead, cursor: 'pointer', userSelect: 'none', background: open ? '#fff' : '#f8fafc' }}
        onClick={onToggle}
        title={open ? '접기' : '펼치기'}
      >
        <strong style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 11, color: '#64748b', width: 12 }}>{open ? '▾' : '▸'}</span>
          <span style={{ whiteSpace: 'nowrap' }}>{title}</span>
          {badge}
        </strong>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
          {right}
        </div>
      </div>
      {open && children}
    </div>
  );
}

export default function SalesRegistrationHistoryPage() {
  const weekInput = useWeekInput(getDefaultWeek());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [data, setData] = useState(null);            // { snapshots, live, baseline }
  const [selKey, setSelKey] = useState(null);        // 선택 스냅샷
  const [selCombined, setSelCombined] = useState(null); // 대차수 합산 보기 { type, snaps }
  const [rows, setRows] = useState([]);              // 선택 스냅샷(또는 합산) 행
  const [selCust, setSelCust] = useState(null);      // 업체 시트 선택
  const [viewTab, setViewTab] = useState('cust');    // cust | flower | compare
  const [diff, setDiff] = useState(null);            // 기준 vs 현재 diff
  const [changeLog, setChangeLog] = useState(null);
  const [compare, setCompare] = useState(null);      // 화/수/수정 3기준 비교
  const [custChanges, setCustChanges] = useState(null); // 업체 추가/취소 (기준 대비)

  // 접기/열기 상태
  const [tlOpen, setTlOpen] = useState(true);        // 좌측 타임라인
  const [secLog, setSecLog] = useState(true);        // 변경 로그
  const [secContent, setSecContent] = useState(true); // 스냅샷 내용
  const [secDiff, setSecDiff] = useState(true);      // 기준 vs 현재
  const [logTab, setLogTab] = useState('amount');    // amount | addcancel | history

  const load = async () => {
    setLoading(true); setError(''); setMessage(''); setDiff(null); setChangeLog(null); setCompare(null); setSelCust(null); setCustChanges(null);
    try {
      const res = await fetch(`/api/sales/registration-history?week=${encodeURIComponent(weekInput.value)}`, { credentials: 'same-origin' });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '조회 실패');
      setData(d);
      const tueSnaps = (d.snapshots || []).filter(s => s.SnapshotType === 'TUE_FINAL');
      if (d.majorMode && tueSnaps.length > 0) {
        await selectCombined('TUE_FINAL', tueSnaps);
      } else {
        const first = tueSnaps[0] || (d.snapshots || [])[0];
        if (first) await selectSnapshot(first.SnapshotKey);
        else { setSelKey(null); setSelCombined(null); setRows([]); }
      }
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  const fetchRows = async (key) => {
    const res = await fetch(`/api/sales/registration-history?week=${encodeURIComponent(weekInput.value)}&rows=${key}`, { credentials: 'same-origin' });
    const d = await res.json();
    return d.rows || [];
  };

  const selectSnapshot = async (key) => {
    setSelKey(key); setSelCombined(null); setSelCust(null);
    try { setRows(await fetchRows(key)); } catch { setRows([]); }
  };

  // 대차수 합산 보기 — 세부차수별 해당 타입 스냅샷 행을 합쳐 27차 전체로
  const selectCombined = async (type, snaps) => {
    setSelKey(null); setSelCust(null);
    setSelCombined({ type, snaps });
    try {
      const all = await Promise.all(snaps.map(s => fetchRows(s.SnapshotKey)));
      setRows(all.flat());
    } catch { setRows([]); }
  };

  const runDiff = async (fromKey) => {
    setDiff(null); setSecDiff(true);
    try {
      const res = await fetch(`/api/sales/registration-history?week=${encodeURIComponent(weekInput.value)}&diffFrom=${fromKey}&diffTo=current`, { credentials: 'same-origin' });
      const d = await res.json();
      if (d.success) setDiff({ fromKey, ...d.diff });
    } catch { /* ignore */ }
  };

  const loadChangeLog = async () => {
    try {
      const res = await fetch(`/api/sales/registration-history?week=${encodeURIComponent(weekInput.value)}&changeLog=1`, { credentials: 'same-origin' });
      const d = await res.json();
      if (d.success) setChangeLog(d);
    } catch { /* ignore */ }
  };

  const loadCompare = async () => {
    try {
      const res = await fetch(`/api/sales/registration-history?week=${encodeURIComponent(weekInput.value)}&compare3=1`, { credentials: 'same-origin' });
      const d = await res.json();
      if (d.success) setCompare(d);
    } catch { /* ignore */ }
  };

  // ── 기준([적용 확인]) ──────────────────────────────────────────
  const baselineArr = data?.baseline || [];
  const baselineKeys = useMemo(() => new Set(baselineArr.map(b => b.snapshotKey)), [baselineArr]);
  const baselineConfirmed = baselineArr.some(b => b.source === 'confirmed');
  const baselineSnaps = (data?.snapshots || []).filter(s => baselineKeys.has(s.SnapshotKey));
  const baselineTotal = baselineSnaps.length
    ? baselineSnaps.reduce((s, x) => s + Number(x.TotalAmount) + Number(x.TotalVat), 0)
    : null;
  const baselineTypeLabel = baselineSnaps.length
    ? [...new Set(baselineSnaps.map(s => shortType(s.SnapshotType)))].join(' + ')
    : null;
  const liveTotal = data?.live?.total ?? null;
  const driftAmt = baselineTotal != null && liveTotal != null ? liveTotal - baselineTotal : null;

  // 업체 추가/취소 (기준 대비) — diff API 재사용, 추가/취소만 필터
  const loadCustChanges = async () => {
    if (!baselineKeys.size) { setCustChanges({ added: [], cancelled: [], noBaseline: true }); return; }
    setCustChanges({ loading: true });
    try {
      const res = await fetch(`/api/sales/registration-history?week=${encodeURIComponent(weekInput.value)}&diffFrom=${[...baselineKeys].join(',')}&diffTo=current`, { credentials: 'same-origin' });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '조회 실패');
      const by = d.diff?.byCust || [];
      setCustChanges({
        added: by.filter(g => Math.abs(g.baseTotal || 0) < 0.5 && Math.abs(g.currTotal || 0) >= 0.5),
        cancelled: by.filter(g => Math.abs(g.currTotal || 0) < 0.5 && Math.abs(g.baseTotal || 0) >= 0.5),
      });
    } catch (e) { setCustChanges({ added: [], cancelled: [], error: e.message }); }
  };

  const confirmBaseline = async (keys, label) => {
    if (!window.confirm(`${label}\n\n이 스냅샷을 기준금액으로 적용할까요?\n적용 후 변경검사·차이 비교·변경 로그가 모두 이 기준으로 계산됩니다.`)) return;
    setMessage(''); setError('');
    try {
      const res = await fetch('/api/sales/registration-history', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ action: 'confirmBaseline', week: weekInput.value, snapshotKeys: keys }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '기준 적용 실패');
      setMessage(`✓ 기준 적용됨 — ${d.confirmed.map(c => `${c.week} ${shortType(c.type)}(#${c.snapshotKey})`).join(', ')}`);
      await load();
    } catch (e) { setError(e.message); }
  };

  const resetBaseline = async () => {
    if (!window.confirm('기준을 화요일 최종분배로 되돌릴까요?')) return;
    try {
      const res = await fetch('/api/sales/registration-history', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ action: 'resetBaseline', week: weekInput.value }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '실패');
      setMessage('기준을 화요일 최종분배로 되돌렸습니다.');
      await load();
    } catch (e) { setError(e.message); }
  };

  // ── 총금액 변동 현황 (스냅샷 시간순, Δ직전 = 같은 세부차수 직전 스냅샷 대비) ──
  const amountLog = useMemo(() => {
    const snaps = [...(data?.snapshots || [])]
      .sort((a, b) => String(a.takenAt).localeCompare(String(b.takenAt)) || a.SnapshotKey - b.SnapshotKey);
    const lastByWeek = new Map();
    const baseTotalByWeek = new Map();
    for (const b of baselineArr) {
      const s = snaps.find(x => x.SnapshotKey === b.snapshotKey);
      if (s) baseTotalByWeek.set(b.week, Number(s.TotalAmount) + Number(s.TotalVat));
    }
    return snaps.map(s => {
      const total = Number(s.TotalAmount) + Number(s.TotalVat);
      const prev = lastByWeek.get(s.OrderWeek);
      lastByWeek.set(s.OrderWeek, total);
      const baseTotal = baseTotalByWeek.get(s.OrderWeek);
      return {
        key: s.SnapshotKey, week: s.OrderWeek, type: s.SnapshotType, takenAt: s.takenAt,
        total, rowCnt: s.RowCnt, note: s.Note,
        dPrev: prev == null ? null : total - prev,
        dBase: baseTotal == null ? null : total - baseTotal,
        isBase: baselineKeys.has(s.SnapshotKey),
      };
    });
  }, [data, baselineArr, baselineKeys]);

  // 업체 클릭 → 새 창에 품목별 화요일/수요일/현재(수정) 금액 + 차액 + 변경자
  const openCustCompare = (c, hasWed) => {
    const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const n = v => Number(v || 0).toLocaleString();
    const dCol = d => d === 0 ? '#64748b' : (d > 0 ? '#dc2626' : '#2563eb');
    const rowsHtml = (c.items || []).map(it => {
      const chg = Math.abs(it.delta) > 0.5;
      return `<tr style="background:${chg ? '#fff7ed' : '#fff'}">
        <td>${esc(it.prodName)}${it.rowType === 'EST' ? '<span style="color:#b91c1c;font-size:11px"> (차감)</span>' : ''}</td>
        <td style="text-align:right">${n(it.tue)}</td>
        <td style="text-align:right">${it.wed == null ? '<span style="color:#cbd5e1">—</span>' : n(it.wed)}</td>
        <td style="text-align:right;font-weight:700">${n(it.curr)}</td>
        <td style="text-align:right;font-weight:800;color:${dCol(it.delta)}">${it.delta > 0 ? '+' : ''}${n(it.delta)}</td>
        <td style="font-size:12px;color:#7c3aed;font-weight:700">${esc((it.changers || []).join(', '))}</td>
      </tr>`;
    }).join('');
    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(c.custName)} — 화/수/수정 비교</title>
      <style>
        body{font-family:'Malgun Gothic',system-ui,sans-serif;margin:0;padding:20px;color:#0f172a;background:#f8fafc}
        h1{font-size:18px;margin:0 0 4px} .sub{color:#64748b;font-size:13px;margin-bottom:14px}
        .tot{display:flex;gap:14px;margin:0 0 16px;flex-wrap:wrap}
        .tot div{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;min-width:120px}
        .tot b{display:block;font-size:19px;margin-top:2px}
        table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;font-size:13px}
        th,td{padding:8px 10px;border-bottom:1px solid #eef2f7} th{background:#f1f5f9;font-size:12px;color:#475569}
        td:first-child{font-weight:600}
      </style></head><body>
      <h1>${esc(c.custName)}</h1>
      <div class="sub">화요일 최종분배 → 수요일 점검 → 현재(수정) 금액 비교 · 품목금액(VAT포함)</div>
      <div class="tot">
        <div>화요일 기준<b>${n(c.tue)}원</b></div>
        <div>수요일 기준<b>${c.wed == null ? '<span style="color:#94a3b8;font-size:14px">스냅샷 없음</span>' : n(c.wed) + '원'}</b></div>
        <div>현재(수정)<b>${n(c.curr)}원</b></div>
        <div>차액(현재−화요일)<b style="color:${dCol(c.delta)}">${c.delta > 0 ? '+' : ''}${n(c.delta)}원</b></div>
      </div>
      <table>
        <thead><tr><th style="text-align:left">품목</th><th style="text-align:right">화요일 기준</th><th style="text-align:right">수요일 기준</th><th style="text-align:right">현재(수정)</th><th style="text-align:right">차액</th><th style="text-align:left">변경자</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <p style="color:#94a3b8;font-size:12px;margin-top:12px">주황 배경 = 화요일 기준과 금액이 달라진 품목. 변경자 = 화요일 이후 해당 품목을 수정한 사람(ShipmentHistory).${hasWed ? '' : ' 이 차수는 수요일 점검 스냅샷이 없어 수요일 열은 —.'}</p>
      </body></html>`;
    const w = window.open('', '_blank', 'width=980,height=680,scrollbars=yes');
    if (!w) { alert('팝업이 차단되었습니다. 팝업 허용 후 다시 눌러주세요.'); return; }
    w.document.open(); w.document.write(html); w.document.close();
  };

  // 업체 클릭 → 새 창에 "기존 vs 변경" 품목·수량·단가 상세
  const openCustDetail = (g) => {
    const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const n = v => Number(v || 0).toLocaleString();
    const kindMeta = { changed: ['수정', '#b45309', '#fef3c7'], added: ['추가', '#1d4ed8', '#dbeafe'], removed: ['삭제', '#dc2626', '#fee2e2'], same: ['동일', '#64748b', '#f1f5f9'] };
    const qtyOf = s => s ? (s.outQty || s.estQty) : 0;
    const cellCmp = (a, b, fmtv) => { const diffv = Math.abs(Number(a || 0) - Number(b || 0)) > 0.001; return `<td style="text-align:right;${diffv ? 'color:#dc2626;font-weight:800' : ''}">${fmtv}</td>`; };
    const rowsHtml = (g.items || []).map(it => {
      const [klabel, kcolor, kbg] = kindMeta[it.kind] || kindMeta.same;
      const b = it.before, a = it.after;
      return `<tr style="background:${it.kind === 'same' ? '#fff' : kbg + '55'}">
        <td>${esc(it.prodName)}</td>
        <td style="text-align:center"><span style="font-size:11px;font-weight:800;color:${kcolor};background:${kbg};border-radius:999px;padding:2px 8px">${klabel}</span></td>
        ${b ? `<td style="text-align:right">${n(qtyOf(b))}${b.unit ? `<span style="color:#94a3b8"> ${esc(b.unit)}</span>` : ''}</td><td style="text-align:right">${n(b.unitPrice)}</td><td style="text-align:right">${n(b.total)}</td>`
             : `<td colspan="3" style="text-align:center;color:#94a3b8">—</td>`}
        ${a ? cellCmp(b && qtyOf(b), qtyOf(a), n(qtyOf(a)) + (a.unit ? `<span style="color:#94a3b8"> ${esc(a.unit)}</span>` : ''))
              + cellCmp(b && b.unitPrice, a.unitPrice, n(a.unitPrice))
              + cellCmp(b && b.total, a.total, n(a.total))
             : `<td colspan="3" style="text-align:center;color:#94a3b8">—</td>`}
        <td style="text-align:right;font-weight:800;color:${((a ? a.total : 0) - (b ? b.total : 0)) === 0 ? '#64748b' : (((a ? a.total : 0) - (b ? b.total : 0)) > 0 ? '#dc2626' : '#2563eb')}">${((a ? a.total : 0) - (b ? b.total : 0)) > 0 ? '+' : ''}${n((a ? a.total : 0) - (b ? b.total : 0))}</td>
      </tr>`;
    }).join('');
    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(g.custName)} — 기존 vs 변경</title>
      <style>
        body{font-family:'Malgun Gothic',system-ui,sans-serif;margin:0;padding:20px;color:#0f172a;background:#f8fafc}
        h1{font-size:18px;margin:0 0 4px} .sub{color:#64748b;font-size:13px;margin-bottom:14px}
        .tot{display:flex;gap:18px;margin:0 0 16px;flex-wrap:wrap}
        .tot div{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px}
        .tot b{display:block;font-size:20px;margin-top:2px}
        table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;font-size:13px}
        th,td{padding:8px 10px;border-bottom:1px solid #eef2f7} th{background:#f1f5f9;font-size:12px;text-align:center;color:#475569}
        thead .grp th{background:#e2e8f0;font-weight:800}
        td:first-child{font-weight:600} .delta{font-size:15px}
      </style></head><body>
      <h1>${esc(g.custName)}</h1>
      <div class="sub">기준 스냅샷 → 현재 DB 비교 · 수정 ${g.changedCnt} · 추가 ${g.addedCnt} · 삭제 ${g.removedCnt}</div>
      <div class="tot">
        <div>기준 금액<b>${n(g.baseTotal)}원</b></div>
        <div>현재 금액<b>${n(g.currTotal)}원</b></div>
        <div>차이<b style="color:${g.delta === 0 ? '#059669' : (g.delta > 0 ? '#dc2626' : '#2563eb')}">${g.delta > 0 ? '+' : ''}${n(g.delta)}원</b></div>
      </div>
      <table>
        <thead>
          <tr class="grp"><th rowspan="2">품목</th><th rowspan="2">구분</th><th colspan="3">기존(기준)</th><th colspan="3">변경(현재)</th><th rowspan="2">Δ 금액</th></tr>
          <tr><th>수량</th><th>단가</th><th>금액(VAT포함)</th><th>수량</th><th>단가</th><th>금액(VAT포함)</th></tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <p style="color:#94a3b8;font-size:12px;margin-top:12px">단가 = 금액 ÷ 견적기준수량(EstQuantity), 원 단위 반올림. 빨강 = 기준과 달라진 값.</p>
      </body></html>`;
    const w = window.open('', '_blank', 'width=920,height=680,scrollbars=yes');
    if (!w) { alert('팝업이 차단되었습니다. 팝업 허용 후 다시 눌러주세요.'); return; }
    w.document.open(); w.document.write(html); w.document.close();
  };

  const post = async (action) => {
    setMessage(''); setError('');
    try {
      const res = await fetch('/api/sales/registration-history', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ action, week: weekInput.value }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '실패');
      if (action === 'checkNow') setMessage(d.changed ? `변경 발견 → CHANGE 스냅샷 기록: ${d.note || ''}` : '변경 없음 — 마지막 스냅샷과 현재 DB가 일치합니다.');
      else setMessage(d.skipped ? `건너뜀 (${d.reason})` : `수동 스냅샷 저장 (#${d.snapshotKey}, ${fmt(d.rowCnt)}행)`);
      await load();
    } catch (e) { setError(e.message); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const tueSnapshots = (data?.snapshots || []).filter(s => s.SnapshotType === 'TUE_FINAL');
  const wedSnapshots = (data?.snapshots || []).filter(s => s.SnapshotType === 'WED_CHECK');
  const closeSnapshots = (data?.snapshots || []).filter(s => s.SnapshotType === 'TUE_CLOSE');
  const closeCheckSnapshots = (data?.snapshots || []).filter(s => s.SnapshotType === 'CLOSE_CHECK');

  // 업체별 합산 (Amount+Vat)
  const byCust = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const k = r.CustKey ?? r.CustName;
      if (!m.has(k)) m.set(k, { custKey: r.CustKey, custName: r.CustName || '(미지정)', total: 0, sdCnt: 0, estCnt: 0 });
      const e = m.get(k);
      e.total += Number(r.Amount || 0) + Number(r.Vat || 0);
      if (r.RowType === 'SD') e.sdCnt += 1; else e.estCnt += 1;
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [rows]);

  // 품종별 합산
  const byFlower = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const k = r.CountryFlower || `${r.CounName}${r.FlowerName}` || '(기타)';
      if (!m.has(k)) m.set(k, { name: k, total: 0, estQty: 0 });
      const e = m.get(k);
      e.total += Number(r.Amount || 0) + Number(r.Vat || 0);
      if (r.RowType === 'SD') e.estQty += Number(r.EstQuantity || 0);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [rows]);

  const custRows = useMemo(() => {
    if (selCust == null) return [];
    return rows.filter(r => (r.CustKey ?? r.CustName) === selCust)
      .sort((a, b) => (a.RowType === b.RowType ? String(a.ProdName).localeCompare(String(b.ProdName)) : a.RowType === 'SD' ? -1 : 1));
  }, [rows, selCust]);

  const selSnap = (data?.snapshots || []).find(s => s.SnapshotKey === selKey);

  // 대차수 합산 [적용 확인] 대상 — 같은 타입 스냅샷 묶음
  const combinedConfirm = (type, snaps) => confirmBaseline(
    snaps.map(s => s.SnapshotKey),
    `${shortType(type)} 합산 (${snaps.map(s => s.OrderWeek).join(' + ')})`
  );

  const badgePill = (text, color, bg) => (
    <span style={{ fontSize: 10, fontWeight: 800, color, background: bg, borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>{text}</span>
  );

  return (
    <div style={st.page}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={st.h1}>🧾 판매등록 히스토리</h1>
        <span style={{ fontSize: 12, color: '#64748b' }}>
          화 17시 최종분배·수 16시 점검·차주 화 17시 마감 자동 고정(불변) · 변경검사는 [🔄 최신화] 시점
        </span>
      </div>

      <div style={st.bar}>
        <label style={st.label}>차수</label>
        <input style={st.weekInput} value={weekInput.value} onChange={e => weekInput.setValue(e.target.value)} placeholder="27=차수 전체 / 27-01" title="27 처럼 대차수만 넣으면 27-01+27-02 합산(=27차)으로 봅니다" />
        <button style={st.primaryBtn} onClick={load} disabled={loading}>{loading ? '조회 중…' : '조회'}</button>
        <button
          style={{ ...st.primaryBtn, background: '#16a34a' }}
          onClick={() => post('checkNow')}
          disabled={loading}
          title="현재 DB를 마지막 스냅샷과 대조 — 달라졌으면 변경감지 스냅샷을 기록합니다 (자동 폴링 없음, 이 버튼이 최신화)"
        >
          🔄 최신화 (변경검사)
        </button>
        <button style={st.secondaryBtn} onClick={() => post('manual')} disabled={loading}>수동 스냅샷</button>

        {/* 기준 상태 배지 — 어떤 스냅샷이 기준금액인지 항상 표시 */}
        {baselineTotal != null && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800,
            background: baselineConfirmed ? '#fef9c3' : '#e0f2fe',
            border: `1px solid ${baselineConfirmed ? '#eab308' : '#7dd3fc'}`,
            color: baselineConfirmed ? '#854d0e' : '#075985',
            borderRadius: 999, padding: '5px 12px',
          }}>
            📍 기준: {baselineTypeLabel} · {fmt(Math.round(baselineTotal))}원
            {baselineConfirmed && (
              <>
                <span style={{ fontWeight: 400, fontSize: 11 }}>
                  (적용 확인: {baselineArr.find(b => b.confirmedBy)?.confirmedBy || ''} {String(baselineArr.find(b => b.confirmedDtm)?.confirmedDtm || '').slice(5, 16)})
                </span>
                <button style={{ ...st.tinyBtn, borderColor: '#eab308', color: '#854d0e' }} onClick={resetBaseline}>화요일로 되돌리기</button>
              </>
            )}
          </span>
        )}
        {driftAmt != null && (
          <span style={{ fontSize: 13, fontWeight: 800, color: Math.abs(driftAmt) > 0.5 ? '#dc2626' : '#059669' }}>
            {Math.abs(driftAmt) > 0.5
              ? `⚠ 현재 DB가 기준과 ${fmt(Math.round(driftAmt))}원 다릅니다`
              : '✓ 현재 DB = 기준금액과 일치'}
          </span>
        )}
      </div>

      {error && <div style={st.error}>{error}</div>}
      {message && <div style={st.message}>{message}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: tlOpen ? '330px 1fr' : '44px 1fr', gap: 12, alignItems: 'start' }}>
        {/* 좌: 스냅샷 타임라인 (접으면 세로 탭으로 축소 → 우측이 전체 폭 사용) */}
        {!tlOpen ? (
          <button
            onClick={() => setTlOpen(true)}
            title="스냅샷 타임라인 펼치기"
            style={{
              writingMode: 'vertical-rl', textOrientation: 'mixed',
              border: '1px solid #dbe3ef', borderRadius: 10, background: '#fff', cursor: 'pointer',
              padding: '14px 8px', fontSize: 12, fontWeight: 800, color: '#334155',
              minHeight: 200, position: 'sticky', top: 12,
            }}>
            ▸ 📸 스냅샷 타임라인 ({(data?.snapshots || []).length})
          </button>
        ) : (
        <div style={{ ...st.panel, position: 'sticky', top: 12 }}>
          <div style={{ ...st.panelHead, cursor: 'pointer' }} onClick={() => setTlOpen(false)} title="접기 — 우측 공간을 넓게 씁니다">
            <strong>◂ 스냅샷 타임라인{data?.majorMode ? ` — ${data.week}차 (${(data.subweeks || []).join(' + ')})` : ''}</strong>
          </div>
          {data?.majorMode && tueSnapshots.length > 0 && (
            <div style={{ padding: '8px 10px', borderBottom: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                ['TUE_FINAL', tueSnapshots, '화요일 최종분배 합산'],
                ['WED_CHECK', wedSnapshots, '수요일 점검 합산'],
                ['TUE_CLOSE', closeSnapshots, '판매등록 마감 합산 (차수 확정본)'],
                ['CLOSE_CHECK', closeCheckSnapshots, '마감 점검 합산 (차주 수 16시)'],
              ].filter(([, snaps]) => snaps.length > 0).map(([type, snaps, label]) => {
                const isBaseType = snaps.every(s => baselineKeys.has(s.SnapshotKey));
                return (
                  <div key={type} style={{ display: 'flex', gap: 4, alignItems: 'stretch' }}>
                    <button
                      style={{ ...(selCombined?.type === type ? st.combinedOn : st.combinedBtn), flex: 1 }}
                      onClick={() => selectCombined(type, snaps)}
                    >
                      🔒 {label} — {fmt(Math.round(snaps.reduce((s, x) => s + Number(x.TotalAmount) + Number(x.TotalVat), 0)))}원
                      {isBaseType && ' 📍'}
                    </button>
                    <button
                      style={{ ...st.confirmBtn, ...(isBaseType ? st.confirmBtnOn : {}) }}
                      title={isBaseType ? '현재 기준금액입니다' : '이 스냅샷 합산을 기준금액으로 적용'}
                      disabled={isBaseType}
                      onClick={() => combinedConfirm(type, snaps)}
                    >
                      {isBaseType ? '📍 기준' : '✓ 적용 확인'}
                    </button>
                  </div>
                );
              })}
              <button style={st.tinyBtn} onClick={() => runDiff([...baselineKeys].join(','))} disabled={!baselineKeys.size}>
                기준 합산 vs 현재 DB 비교
              </button>
            </div>
          )}
          <div style={{ maxHeight: 'calc(100vh - 320px)', overflow: 'auto' }}>
            {(data?.snapshots || []).length === 0 && (
              <div style={{ padding: 12, fontSize: 12, color: '#64748b' }}>
                이 차수의 스냅샷이 아직 없습니다. 화요일 17:00에 자동 생성되며, 지금 [수동 스냅샷]으로 만들 수도 있습니다.
              </div>
            )}
            {(data?.snapshots || []).map(s => {
              const meta = TYPE_META[s.SnapshotType] || TYPE_META.MANUAL;
              const on = s.SnapshotKey === selKey;
              const isBase = baselineKeys.has(s.SnapshotKey);
              return (
                <div key={s.SnapshotKey}
                  style={{
                    padding: '8px 10px', borderBottom: '1px solid #eef2f7', cursor: 'pointer',
                    background: on ? '#f0f9ff' : isBase ? '#fefce8' : '#fff',
                    borderLeft: isBase ? '3px solid #eab308' : '3px solid transparent',
                  }}
                  onClick={() => selectSnapshot(s.SnapshotKey)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {badgePill(meta.label, meta.color, meta.bg)}
                    {badgePill(s.OrderWeek, '#0f766e', '#ccfbf1')}
                    {isBase && badgePill('📍 기준', '#854d0e', '#fef9c3')}
                    <span style={{ fontSize: 11, color: '#64748b' }}>#{s.SnapshotKey}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#64748b' }}>{s.takenAt}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 3, fontSize: 12, alignItems: 'center' }}>
                    <b>{fmt(Math.round(Number(s.TotalAmount) + Number(s.TotalVat)))}원</b>
                    <span style={{ color: '#64748b' }}>{fmt(s.RowCnt)}행</span>
                    <button style={st.tinyBtn} onClick={(e) => { e.stopPropagation(); runDiff(s.SnapshotKey); }}>현재와 비교</button>
                    {!isBase && (
                      <button
                        style={{ ...st.tinyBtn, color: '#854d0e', borderColor: '#eab308', marginLeft: 'auto' }}
                        title="이 스냅샷을 기준금액으로 적용 — 변경검사·비교가 이 기준으로 계산됩니다"
                        onClick={(e) => { e.stopPropagation(); confirmBaseline([s.SnapshotKey], `${s.OrderWeek} ${shortType(s.SnapshotType)} #${s.SnapshotKey} (${s.takenAt})`); }}
                      >
                        ✓ 적용 확인
                      </button>
                    )}
                  </div>
                  {s.Note && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{s.Note}</div>}
                </div>
              );
            })}
          </div>
        </div>
        )}

        {/* 우: 접기/열기 패널 스택 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          {/* ① 변경 로그 — 두 타입(총금액 변동 / 업체 추가·취소) + 수정 이력 */}
          <Section
            title="변경 로그"
            open={secLog}
            onToggle={() => setSecLog(v => !v)}
            badge={driftAmt != null && Math.abs(driftAmt) > 0.5
              ? badgePill(`기준 대비 ${driftAmt > 0 ? '+' : ''}${fmt(Math.round(driftAmt))}원`, '#b91c1c', '#fee2e2')
              : badgePill('변동 없음', '#166534', '#dcfce7')}
            right={secLog && (
              <>
                <button style={logTab === 'amount' ? st.segOn : st.seg} onClick={() => setLogTab('amount')}>총금액 변동 현황</button>
                <button style={logTab === 'addcancel' ? st.segOn : st.seg}
                  onClick={() => { setLogTab('addcancel'); if (!custChanges) loadCustChanges(); }}>
                  업체 추가/취소
                </button>
                <button style={logTab === 'history' ? st.segOn : st.seg}
                  onClick={() => { setLogTab('history'); if (!changeLog) loadChangeLog(); }}>
                  수정 이력(누가)
                </button>
              </>
            )}
          >
            {logTab === 'amount' && (
              <div style={{ maxHeight: 300, overflow: 'auto' }}>
                <table style={st.table}>
                  <thead><tr>
                    <th>시각</th><th>차수</th><th>스냅샷</th>
                    <th style={{ textAlign: 'right' }}>총금액(VAT포함)</th>
                    <th style={{ textAlign: 'right' }}>Δ 직전</th>
                    <th style={{ textAlign: 'right' }}>Δ 기준</th>
                  </tr></thead>
                  <tbody>
                    {amountLog.map(r => {
                      const meta = TYPE_META[r.type] || TYPE_META.MANUAL;
                      return (
                        <tr key={r.key} style={{ background: r.isBase ? '#fefce8' : undefined }}>
                          <td style={{ whiteSpace: 'nowrap' }}>{r.takenAt}</td>
                          <td>{r.week}</td>
                          <td>{badgePill(meta.label, meta.color, meta.bg)}{r.isBase ? ' 📍' : ''}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(Math.round(r.total))}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: r.dPrev == null || Math.round(r.dPrev) === 0 ? '#94a3b8' : (r.dPrev > 0 ? '#dc2626' : '#2563eb') }}>
                            {r.dPrev == null ? '—' : `${r.dPrev > 0 ? '+' : ''}${fmt(Math.round(r.dPrev))}`}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: r.dBase == null || Math.round(r.dBase) === 0 ? '#94a3b8' : (r.dBase > 0 ? '#dc2626' : '#2563eb') }}>
                            {r.dBase == null ? '—' : `${r.dBase > 0 ? '+' : ''}${fmt(Math.round(r.dBase))}`}
                          </td>
                        </tr>
                      );
                    })}
                    {liveTotal != null && (
                      <tr style={{ background: '#f0fdf4', fontWeight: 800 }}>
                        <td>지금</td><td>{data?.week}</td><td>현재 DB</td>
                        <td style={{ textAlign: 'right' }}>{fmt(Math.round(liveTotal))}</td>
                        <td style={{ textAlign: 'right' }}>—</td>
                        <td style={{ textAlign: 'right', color: driftAmt == null || Math.round(driftAmt) === 0 ? '#059669' : (driftAmt > 0 ? '#dc2626' : '#2563eb') }}>
                          {driftAmt == null ? '—' : `${driftAmt > 0 ? '+' : ''}${fmt(Math.round(driftAmt))}`}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <div style={{ padding: '6px 10px', fontSize: 11, color: '#94a3b8' }}>
                  Δ 직전 = 같은 세부차수의 바로 앞 스냅샷 대비 · Δ 기준 = 📍기준 스냅샷 대비 · 노란 행 = 현재 기준
                </div>
              </div>
            )}

            {logTab === 'addcancel' && (
              <div style={{ maxHeight: 300, overflow: 'auto' }}>
                {!custChanges || custChanges.loading ? (
                  <div style={{ padding: 14, fontSize: 12, color: '#64748b' }}>기준 대비 업체 변동을 계산 중…</div>
                ) : custChanges.noBaseline ? (
                  <div style={{ padding: 14, fontSize: 12, color: '#b91c1c' }}>기준 스냅샷이 없어 계산할 수 없습니다.</div>
                ) : custChanges.error ? (
                  <div style={{ padding: 14, fontSize: 12, color: '#b91c1c' }}>{custChanges.error}</div>
                ) : (custChanges.added.length + custChanges.cancelled.length) === 0 ? (
                  <div style={{ padding: 14, fontSize: 12, color: '#059669' }}>기준 이후 새로 분배된 업체·취소된 업체가 없습니다. (금액 수정은 [수정 이력] 탭)</div>
                ) : (
                  <table style={st.table}>
                    <thead><tr><th>구분</th><th>업체</th><th style={{ textAlign: 'right' }}>기준 금액</th><th style={{ textAlign: 'right' }}>현재 금액</th><th>품목수</th></tr></thead>
                    <tbody>
                      {custChanges.added.map((g, i) => (
                        <tr key={`a${i}`} style={{ cursor: 'pointer', background: '#eff6ff' }} onClick={() => openCustDetail(g)} title="클릭 → 새 창에서 품목별 세부 내역">
                          <td>{badgePill('➕ 분배추가', '#1d4ed8', '#dbeafe')}</td>
                          <td style={{ fontWeight: 700, color: '#0369a1', textDecoration: 'underline' }}>{g.custName}</td>
                          <td style={{ textAlign: 'right', color: '#94a3b8' }}>0</td>
                          <td style={{ textAlign: 'right', fontWeight: 800 }}>{fmt(g.currTotal)}</td>
                          <td>{g.addedCnt}</td>
                        </tr>
                      ))}
                      {custChanges.cancelled.map((g, i) => (
                        <tr key={`c${i}`} style={{ cursor: 'pointer', background: '#fef2f2' }} onClick={() => openCustDetail(g)} title="클릭 → 새 창에서 품목별 세부 내역">
                          <td>{badgePill('❌ 취소', '#dc2626', '#fee2e2')}</td>
                          <td style={{ fontWeight: 700, color: '#0369a1', textDecoration: 'underline' }}>{g.custName}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(g.baseTotal)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 800, color: '#dc2626' }}>0</td>
                          <td>{g.removedCnt}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div style={{ padding: '6px 10px', fontSize: 11, color: '#94a3b8' }}>
                  📍기준 스냅샷에 없다가 새로 분배된 업체(➕)와 기준엔 있었는데 전부 취소된 업체(❌)만 표시 · 업체 클릭 = 세부 내역
                </div>
              </div>
            )}

            {logTab === 'history' && (
              <div style={{ maxHeight: 300, overflow: 'auto' }}>
                {!changeLog ? (
                  <div style={{ padding: 14, fontSize: 12, color: '#64748b' }}>불러오는 중…</div>
                ) : (changeLog.entries || []).length === 0 ? (
                  <div style={{ padding: 14, fontSize: 12, color: '#059669' }}>기준 시각({changeLog.baselineAt || '-'}) 이후 수정 이력이 없습니다.</div>
                ) : (
                  <table style={st.table}>
                    <thead><tr><th>시각</th><th>수정자</th><th>업체</th><th>품목</th><th>전→후</th><th>메모</th></tr></thead>
                    <tbody>
                      {changeLog.entries.map((e, i) => (
                        <tr key={i}>
                          <td style={{ whiteSpace: 'nowrap' }}>{e.changeDtm}</td>
                          <td style={{ fontWeight: 700 }}>{e.ChangeID}</td>
                          <td>{e.CustName || '-'}</td><td>{e.ProdName || '-'}</td>
                          <td>{e.BeforeValue}→{e.AfterValue}</td>
                          <td style={{ fontSize: 10, color: '#64748b' }}>{e.Descr}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </Section>

          {/* ② 기준 vs 현재 diff */}
          {diff && (
            <Section
              title={`#${diff.fromKey} vs 현재 DB`}
              open={secDiff}
              onToggle={() => setSecDiff(v => !v)}
              accent={diff.hasDiff ? '#fca5a5' : '#86efac'}
              badge={badgePill(
                diff.hasDiff ? `수정 ${diff.changed.length} · 추가 ${diff.added.length} · 삭제 ${diff.removed.length} · Δ ${fmt(Math.round(diff.amtDelta))}원` : '완전 일치',
                diff.hasDiff ? '#b91c1c' : '#166534', diff.hasDiff ? '#fee2e2' : '#dcfce7')}
            >
              {diff.hasDiff && (
                <>
                  <div style={{ padding: '6px 10px', fontSize: 12, color: '#64748b', borderBottom: '1px solid #eef2f7' }}>
                    업체를 클릭하면 새 창에 <b>기존(기준) vs 변경(현재)</b> 품목·수량·단가가 나란히 표시됩니다.
                  </div>
                  <div style={{ maxHeight: 300, overflow: 'auto' }}>
                    <table style={st.table}>
                      <thead><tr><th>업체</th><th style={{ textAlign: 'right' }}>기준 금액</th><th style={{ textAlign: 'right' }}>현재 금액</th><th style={{ textAlign: 'right' }}>차이</th><th>변경</th></tr></thead>
                      <tbody>
                        {(diff.byCust || []).map((g, i) => (
                          <tr key={`g${i}`} style={{ cursor: 'pointer' }} onClick={() => openCustDetail(g)}
                            title="클릭 → 새 창에서 품목별 기존 vs 변경 보기">
                            <td style={{ fontWeight: 700, color: '#0369a1', textDecoration: 'underline' }}>{g.custName}</td>
                            <td style={{ textAlign: 'right' }}>{fmt(g.baseTotal)}</td>
                            <td style={{ textAlign: 'right' }}>{fmt(g.currTotal)}</td>
                            <td style={{ textAlign: 'right', fontWeight: 800, color: g.delta === 0 ? '#64748b' : (g.delta > 0 ? '#dc2626' : '#2563eb') }}>
                              {g.delta > 0 ? '+' : ''}{fmt(g.delta)}
                            </td>
                            <td style={{ fontSize: 11 }}>
                              {g.changedCnt ? <span style={{ color: '#b45309', fontWeight: 700 }}>수정 {g.changedCnt} </span> : null}
                              {g.addedCnt ? <span style={{ color: '#1d4ed8', fontWeight: 700 }}>추가 {g.addedCnt} </span> : null}
                              {g.removedCnt ? <span style={{ color: '#dc2626', fontWeight: 700 }}>삭제 {g.removedCnt}</span> : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </Section>
          )}

          {/* ③ 선택 스냅샷 내용 */}
          {(selSnap || selCombined) && (
            <Section
              title={selCombined
                ? `${(TYPE_META[selCombined.type] || {}).label} 합산`
                : `#${selSnap.SnapshotKey} ${(TYPE_META[selSnap.SnapshotType] || {}).label} · ${selSnap.OrderWeek}`}
              open={secContent}
              onToggle={() => setSecContent(v => !v)}
              badge={badgePill(
                `${fmt(Math.round(selCombined
                  ? selCombined.snaps.reduce((s, x) => s + Number(x.TotalAmount) + Number(x.TotalVat), 0)
                  : Number(selSnap.TotalAmount) + Number(selSnap.TotalVat)))}원`,
                '#1d4ed8', '#dbeafe')}
              right={secContent && (
                <>
                  <button style={viewTab === 'cust' ? st.segOn : st.seg} onClick={() => setViewTab('cust')}>업체별 매출</button>
                  <button style={viewTab === 'flower' ? st.segOn : st.seg} onClick={() => setViewTab('flower')}>품종별 판매금액</button>
                  <button style={viewTab === 'compare' ? st.segOn : st.seg} onClick={() => { setViewTab('compare'); if (!compare) loadCompare(); }}>화/수/수정 비교</button>
                </>
              )}
            >
              {viewTab === 'cust' ? (
                <div style={{ display: 'grid', gridTemplateColumns: selCust != null ? '1fr 1.4fr' : '1fr', gap: 0 }}>
                  <div style={{ maxHeight: 'calc(100vh - 340px)', overflow: 'auto', borderRight: selCust != null ? '1px solid #e2e8f0' : 'none' }}>
                    <table style={st.table}>
                      <thead><tr><th>업체</th><th style={{ textAlign: 'right' }}>매출금액(VAT포함)</th><th>정상출고</th><th>차감</th></tr></thead>
                      <tbody>
                        {byCust.map(c => (
                          <tr key={c.custKey ?? c.custName}
                            style={{ cursor: 'pointer', background: selCust === (c.custKey ?? c.custName) ? '#eff6ff' : undefined }}
                            onClick={() => setSelCust(c.custKey ?? c.custName)}>
                            <td style={{ fontWeight: 700 }}>{c.custName}</td>
                            <td style={{ textAlign: 'right' }}>{fmt(Math.round(c.total))}</td>
                            <td>{c.sdCnt}</td><td>{c.estCnt}</td>
                          </tr>
                        ))}
                        <tr style={{ background: '#f8fafc', fontWeight: 800 }}>
                          <td>합계</td>
                          <td style={{ textAlign: 'right' }}>{fmt(Math.round(byCust.reduce((s, c) => s + c.total, 0)))}</td>
                          <td colSpan={2}></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  {selCust != null && (
                    <div style={{ maxHeight: 'calc(100vh - 340px)', overflow: 'auto' }}>
                      <div style={{ padding: '6px 10px', fontSize: 12, fontWeight: 800, color: '#334155', borderBottom: '1px solid #e2e8f0' }}>
                        {custRows[0]?.CustName} — 품목별 (견적서 구조)
                        <button style={{ ...st.tinyBtn, marginLeft: 8 }} onClick={() => setSelCust(null)}>닫기</button>
                      </div>
                      <table style={st.table}>
                        <thead><tr><th>구분</th><th>품목</th><th>단위</th><th style={{ textAlign: 'right' }}>수량</th><th style={{ textAlign: 'right' }}>단가</th><th style={{ textAlign: 'right' }}>공급가</th><th style={{ textAlign: 'right' }}>부가세</th><th style={{ textAlign: 'right' }}>합계</th></tr></thead>
                        <tbody>
                          {custRows.map((r, i) => (
                            <tr key={i} style={{ color: r.RowType === 'EST' ? '#b91c1c' : undefined }}>
                              <td>{r.RowType === 'SD' ? '정상출고' : (r.EstimateType || '차감')}</td>
                              <td>{r.ProdName}</td>
                              <td>{r.EstUnit}</td>
                              <td style={{ textAlign: 'right' }}>{fmt(r.EstQuantity)}</td>
                              <td style={{ textAlign: 'right' }}>{fmt(r.Cost)}</td>
                              <td style={{ textAlign: 'right' }}>{fmt(Math.round(r.Amount))}</td>
                              <td style={{ textAlign: 'right' }}>{fmt(Math.round(r.Vat))}</td>
                              <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(Math.round(Number(r.Amount) + Number(r.Vat)))}</td>
                            </tr>
                          ))}
                          <tr style={{ background: '#f8fafc', fontWeight: 800 }}>
                            <td colSpan={7}>합계</td>
                            <td style={{ textAlign: 'right' }}>{fmt(Math.round(custRows.reduce((s, r) => s + Number(r.Amount) + Number(r.Vat), 0)))}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : viewTab === 'compare' ? (
                <div style={{ maxHeight: 'calc(100vh - 340px)', overflow: 'auto' }}>
                  {!compare ? (
                    <div style={{ padding: 16, fontSize: 13, color: '#64748b' }}>불러오는 중…</div>
                  ) : (
                    <>
                      <div style={{ padding: '6px 10px', fontSize: 12, color: '#64748b', borderBottom: '1px solid #eef2f7' }}>
                        업체를 클릭하면 새 창에 <b>품목별 화요일/수요일/현재 금액 + 변경자</b>가 나옵니다.
                        {compare.hasWed ? '' : ' (이 차수는 수요일 점검 스냅샷이 없어 수요일 열은 —)'}
                      </div>
                      <table style={st.table}>
                        <thead><tr>
                          <th>업체</th>
                          <th style={{ textAlign: 'right' }}>화요일 기준</th>
                          <th style={{ textAlign: 'right' }}>수요일 기준</th>
                          <th style={{ textAlign: 'right' }}>현재(수정)</th>
                          <th style={{ textAlign: 'right' }}>차액</th>
                        </tr></thead>
                        <tbody>
                          {(compare.byCust || []).map(c => (
                            <tr key={c.custKey ?? c.custName} style={{ cursor: 'pointer', background: c.changed ? '#fff7ed' : undefined }}
                              onClick={() => openCustCompare(c, compare.hasWed)} title="클릭 → 새 창에서 품목별 화/수/수정 + 변경자">
                              <td style={{ fontWeight: 700, color: '#0369a1', textDecoration: 'underline' }}>{c.custName}</td>
                              <td style={{ textAlign: 'right' }}>{fmt(c.tue)}</td>
                              <td style={{ textAlign: 'right', color: c.wed == null ? '#cbd5e1' : undefined }}>{c.wed == null ? '—' : fmt(c.wed)}</td>
                              <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(c.curr)}</td>
                              <td style={{ textAlign: 'right', fontWeight: 800, color: c.delta === 0 ? '#64748b' : (c.delta > 0 ? '#dc2626' : '#2563eb') }}>
                                {c.delta > 0 ? '+' : ''}{fmt(c.delta)}
                              </td>
                            </tr>
                          ))}
                          <tr style={{ background: '#f8fafc', fontWeight: 800 }}>
                            <td>합계</td>
                            <td style={{ textAlign: 'right' }}>{fmt((compare.byCust || []).reduce((s, c) => s + c.tue, 0))}</td>
                            <td style={{ textAlign: 'right' }}>{compare.hasWed ? fmt((compare.byCust || []).reduce((s, c) => s + (c.wed || 0), 0)) : '—'}</td>
                            <td style={{ textAlign: 'right' }}>{fmt((compare.byCust || []).reduce((s, c) => s + c.curr, 0))}</td>
                            <td style={{ textAlign: 'right' }}>{(() => { const d = (compare.byCust || []).reduce((s, c) => s + c.delta, 0); return `${d > 0 ? '+' : ''}${fmt(d)}`; })()}</td>
                          </tr>
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              ) : (
                <div style={{ maxHeight: 'calc(100vh - 340px)', overflow: 'auto' }}>
                  <table style={st.table}>
                    <thead><tr><th>품종(국가+꽃)</th><th style={{ textAlign: 'right' }}>판매금액(VAT포함)</th><th style={{ textAlign: 'right' }}>수량(견적단위)</th></tr></thead>
                    <tbody>
                      {byFlower.map(f => (
                        <tr key={f.name}>
                          <td style={{ fontWeight: 700 }}>{f.name}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(Math.round(f.total))}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(f.estQty)}</td>
                        </tr>
                      ))}
                      <tr style={{ background: '#f8fafc', fontWeight: 800 }}>
                        <td>합계</td>
                        <td style={{ textAlign: 'right' }}>{fmt(Math.round(byFlower.reduce((s, f) => s + f.total, 0)))}</td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

const st = {
  page: { padding: 16, maxWidth: 1500, margin: '0 auto' },
  h1: { fontSize: 20, fontWeight: 800, margin: '0 0 6px' },
  bar: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  label: { fontSize: 13, fontWeight: 700, color: '#334155' },
  weekInput: { border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px', fontSize: 14, width: 100 },
  primaryBtn: { background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  secondaryBtn: { background: '#fff', color: '#334155', border: '1px solid #94a3b8', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  tinyBtn: { background: '#fff', color: '#2563eb', border: '1px solid #93c5fd', borderRadius: 6, padding: '1px 8px', fontSize: 10, fontWeight: 700, cursor: 'pointer' },
  confirmBtn: { background: '#fff', color: '#854d0e', border: '1px solid #eab308', borderRadius: 8, padding: '4px 8px', fontSize: 11, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' },
  confirmBtnOn: { background: '#fef9c3', cursor: 'default' },
  error: { background: '#fef2f2', border: '1px solid #ef4444', color: '#b91c1c', borderRadius: 8, padding: '10px 12px', fontSize: 13, marginBottom: 10 },
  message: { background: '#ecfdf5', border: '1px solid #34d399', color: '#065f46', borderRadius: 8, padding: '10px 12px', fontSize: 13, marginBottom: 10 },
  panel: { border: '1px solid #dbe3ef', borderRadius: 10, background: '#fff', overflow: 'hidden' },
  panelHead: { minHeight: 40, padding: '6px 12px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  seg: { background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#475569' },
  combinedBtn: { background: '#fff', border: '1px solid #1d4ed8', borderRadius: 8, padding: '7px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer', color: '#1d4ed8', textAlign: 'left' },
  combinedOn: { background: '#1d4ed8', border: '1px solid #1d4ed8', borderRadius: 8, padding: '7px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer', color: '#fff', textAlign: 'left' },
  segOn: { background: '#1d4ed8', border: '1px solid #1d4ed8', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#fff' },
};
