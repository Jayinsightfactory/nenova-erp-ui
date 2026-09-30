// components/ProfitWorkbookSourcesTab.js — 주차별 매출이익 보고서의 [원천시트] 보기.
// 매출원가 양식의 판매현황·불량차감+그외매출액·구매현황 + 지역별 판매현황/매출현황.
// 기본 = 최신 확정 스냅샷(불변). [스냅샷 확정]/[최신화]/수기 편집 저장은 새 버전을 만든다. 데이터: /api/sales/profit-workbook
// 주의: 입력칸은 이 컴포넌트 render 안에서 새 컴포넌트를 정의하지 않고 함수 호출로 그린다(포커스 유실 방지).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { REGION_ALL, buildRegionRevenue, effectiveData, isManualRowKey, EDITABLE_FIELDS } from '../lib/profitWorkbookRules';

const fmt = (v, d = 0) => (v == null || v === '' || Number.isNaN(Number(v)) ? '' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));
const st = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 10 },
  bar: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
  tab: (on) => ({ padding: '6px 12px', borderRadius: 8, border: '1px solid #cbd5e1', background: on ? '#1f4e78' : '#fff', color: on ? '#fff' : '#1f2937', fontWeight: 700, cursor: 'pointer', fontSize: 13 }),
  btn: { padding: '6px 12px', borderRadius: 8, border: '1px solid #94a3b8', background: '#f8fafc', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  primary: { padding: '6px 12px', borderRadius: 8, border: 'none', background: '#1f4e78', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 },
  badge: (live) => ({ padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: live ? '#fef3c7' : '#dcfce7', color: live ? '#92400e' : '#166534' }),
  tableWrap: { overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 8, maxHeight: '65vh' },
  table: { borderCollapse: 'collapse', fontSize: 12.5, width: '100%' },
  th: { position: 'sticky', top: 0, background: '#f1f5f9', padding: '5px 8px', textAlign: 'left', borderBottom: '1px solid #cbd5e1', whiteSpace: 'nowrap' },
  td: { padding: '4px 8px', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' },
  num: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  manualRow: { background: '#fffbeb' },
  editedCell: { background: '#fef3c7' },
  total: { background: '#dbeafe', fontWeight: 700 },
  input: { width: 110, padding: '2px 4px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 4 },
  note: { background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, color: '#3730a3', lineHeight: 1.6 },
  error: { background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '8px 12px', fontSize: 13 },
  msg: { background: '#f0f9ff', border: '1px solid #bae6fd', color: '#0369a1', borderRadius: 8, padding: '8px 12px', fontSize: 13 },
};

const COLS = {
  sales: [['custName', '거래처'], ['prodName', '품목'], ['category', '품명'], ['qty', '수량', 1], ['unitPrice', '단가', 1], ['supply', '공급가액', 1], ['vat', '부가세', 1], ['total', '합계', 1]],
  deduct: [['date', '일자'], ['custName', '거래처명'], ['typeName', '품목명'], ['qty', '수량', 1], ['unitCost', '단가(vat포함)', 1], ['supply', '공급가액', 1], ['vat', '부가세', 1], ['total', '합계', 1], ['prodName', '적요'], ['category', '품명'], ['memo', '비고']],
  purchase: [['date', '일자'], ['farmName', '거래처명(농장)'], ['farmDisplay', '농장(정리)'], ['prodName', '품목명'], ['country', '국가'], ['qty', '수량', 1], ['boxQty', '박스', 1], ['unitPrice', '단가', 1], ['usd', '외화금액', 2], ['week', '차수'], ['invoiceNo', '인보이스'], ['category', '품명']],
};
const SUM_FIELDS = new Set(['qty', 'supply', 'vat', 'total', 'usd']);

export default function ProfitWorkbookSourcesTab({ weekValue, year }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState('');
  const [region, setRegion] = useState(null);
  const [snapshotKey, setSnapshotKey] = useState('');
  const [live, setLive] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [edits, setEdits] = useState([]); // 저장 전 수기 편집 초안
  const [drafts, setDrafts] = useState({}); // 입력칸 문자열(키: sheet|rowKey|field)

  const load = useCallback(async ({ diff = false } = {}) => {
    if (!weekValue || !year) return;
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ week: weekValue, year });
      if (live) qs.set('live', '1'); else if (snapshotKey) qs.set('snapshot', snapshotKey);
      if (diff) qs.set('diff', '1');
      const res = await fetch(`/api/sales/profit-workbook?${qs}`, { credentials: 'same-origin' });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '원천시트 조회 실패');
      setData(d);
      setTab((cur) => (d.subTabs.some((t) => t.key === cur) ? cur : d.subTabs[0]?.key || ''));
      setRegion((cur) => cur ?? d.defaultRegion ?? REGION_ALL);
      setEdits([]); setDrafts({});
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [weekValue, year, live, snapshotKey]);

  useEffect(() => { load({ diff: showDiff }); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    let base = (data?.rows || []).map((r) => ({ ...r }));
    // 초안 편집 반영(화면 미리보기)
    for (const e of edits) {
      if (e.op === 'addRow') base.push({ sheet: e.sheet, rowKey: e.rowKey, isManual: true, data: e.data, manual: {}, draft: true });
      else if (e.op === 'removeRow') base = base.filter((r) => !(r.sheet === e.sheet && r.rowKey === e.rowKey));
      else if (e.op === 'set') {
        const r = base.find((x) => x.sheet === e.sheet && x.rowKey === e.rowKey);
        if (r) {
          if (isManualRowKey(r.rowKey)) r.data = { ...r.data, [e.field]: e.value };
          else r.manual = { ...(r.manual || {}), [e.field]: { value: e.value, by: '(저장 전)' } };
        }
      }
    }
    return base;
  }, [data, edits]);

  const access = data?.access || {};
  const canEdit = Boolean(access.canEdit) && data?.source === 'snapshot';

  async function post(action, extra = {}) {
    setBusy(true); setError(''); setMessage('');
    try {
      const res = await fetch('/api/sales/profit-workbook', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week: weekValue, year, action, ...extra }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '저장 실패');
      setMessage(`v${d.versionNo} 생성(${d.kind}) — ${d.rowCount}행`);
      setLive(false); setSnapshotKey('');
      await load({ diff: showDiff });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  function setField(sheet, rowKey, field, value) {
    setEdits((prev) => [...prev.filter((e) => !(e.op === 'set' && e.sheet === sheet && e.rowKey === rowKey && e.field === field)), { op: 'set', sheet, rowKey, field, value }]);
  }
  function addManualRow(sheet) {
    const rowKey = `M:${sheet}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const base = sheet === 'purchase' ? { farmName: '', prodName: '', qty: 0, usd: 0 } : { custName: '', typeName: '', qty: 0, supply: 0, vat: 0, prodName: '' };
    setEdits((prev) => [...prev, { op: 'addRow', sheet, rowKey, data: base }]);
  }

  function cell(r, field, numeric, digits) {
    const d = effectiveData(r);
    const editable = canEdit && EDITABLE_FIELDS[r.sheet]?.includes(field) && (isManualRowKey(r.rowKey) || ['category', 'memo'].includes(field));
    const edited = r.manual && r.manual[field];
    const style = { ...st.td, ...(numeric ? st.num : {}), ...(edited ? st.editedCell : {}) };
    const title = edited ? `수기 보정: ${edited.by || ''} ${edited.at ? String(edited.at).slice(0, 16).replace('T', ' ') : ''}` : (isManualRowKey(r.rowKey) && r.manualBy ? `수기행: ${r.manualBy} ${String(r.manualAt || '').slice(0, 16).replace('T', ' ')}` : undefined);
    if (!editable) return <td key={field} style={style} title={title}>{numeric ? fmt(d[field], digits) : d[field]}</td>;
    const k = `${r.sheet}|${r.rowKey}|${field}`;
    const shown = k in drafts ? drafts[k] : (d[field] ?? '');
    return (
      <td key={field} style={style} title={title}>
        <input
          style={{ ...st.input, ...(numeric ? { textAlign: 'right' } : {}) }}
          value={shown}
          onChange={(e) => setDrafts((p) => ({ ...p, [k]: e.target.value }))}
          onBlur={(e) => { if (String(e.target.value) !== String(d[field] ?? '')) setField(r.sheet, r.rowKey, field, numeric ? Number(String(e.target.value).replace(/,/g, '')) || 0 : e.target.value); }}
        />
      </td>
    );
  }

  function table(sheetRows, cols, { removable = false, regionCol = false } = {}) {
    const sums = {};
    for (const r of sheetRows) { const d = effectiveData(r); for (const [f] of cols) if (SUM_FIELDS.has(f)) sums[f] = (sums[f] || 0) + (Number(d[f]) || 0); }
    return (
      <div style={st.tableWrap}>
        <table style={st.table}>
          <thead><tr>{regionCol && <th style={st.th}>지역</th>}{cols.map(([f, l]) => <th key={f} style={st.th}>{l}</th>)}{removable && <th style={st.th} />}</tr></thead>
          <tbody>
            <tr style={st.total}>{regionCol && <td style={st.td} />}{cols.map(([f, , n, dg]) => <td key={f} style={{ ...st.td, ...(n ? st.num : {}) }}>{f === cols[0][0] ? `합계 ${sheetRows.length}행` : SUM_FIELDS.has(f) ? fmt(sums[f], dg) : ''}</td>)}{removable && <td style={st.td} />}</tr>
            {sheetRows.map((r) => (
              <tr key={`${r.sheet}|${r.rowKey}`} style={isManualRowKey(r.rowKey) ? st.manualRow : undefined}>
                {regionCol && <td style={st.td}>{r.data.region}</td>}
                {cols.map(([f, , n, dg]) => cell(r, f, n, dg))}
                {removable && <td style={st.td}>{canEdit && isManualRowKey(r.rowKey) && <button type="button" style={st.btn} onClick={() => setEdits((p) => [...p, { op: 'removeRow', sheet: r.sheet, rowKey: r.rowKey }])}>삭제</button>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const bySheet = (s) => rows.filter((r) => r.sheet === s);
  const regionFilter = (list) => (region && region !== REGION_ALL ? list.filter((r) => effectiveData(r).region === region) : list);
  const regionRevenue = useMemo(() => buildRegionRevenue(rows, region || REGION_ALL), [rows, region]);

  if (!weekValue) return <div style={st.msg}>차수를 선택하세요.</div>;
  return (
    <div style={st.wrap}>
      <div style={st.note}>
        매출원가 양식 원천시트 — 판매현황 수량=출고 EstQuantity·금액=저장 공급가/부가세, 차감=견적 차감(품목 조인), 구매현황=입고 외화금액
        (국가: {(data?.purchaseCountries || []).join('·')}). 재고잔량·그외통관비·포워딩·환율 시트는 수기 영역이라 여기서 다루지 않습니다.
        기본 화면은 <b>최신 확정 스냅샷</b>(불변)이며 ERP 원장은 읽기만 합니다.
      </div>
      <div style={st.bar}>
        {data && <span style={st.badge(data.source === 'live')}>{data.source === 'snapshot' ? `스냅샷 v${data.snapshot.version} · ${data.snapshot.kind} · ${data.snapshot.createdBy} · ${String(data.snapshot.createdAt || '').slice(0, 16).replace('T', ' ')}` : '현재 DB(확정 전)'}</span>}
        {access.full && (data?.snapshots || []).length > 0 && (
          <select value={live ? 'live' : snapshotKey} onChange={(e) => { if (e.target.value === 'live') setLive(true); else { setLive(false); setSnapshotKey(e.target.value); } }} style={st.btn}>
            <option value="">최신 스냅샷</option>
            {data.snapshots.map((s) => <option key={s.key} value={s.key}>v{s.version} {s.kind} {s.createdBy}</option>)}
            <option value="live">현재 DB 보기</option>
          </select>
        )}
        {access.canConfirm && data?.initialized && !(data?.snapshots || []).length && <button type="button" style={st.primary} disabled={busy} onClick={() => post('confirm')}>스냅샷 확정</button>}
        {access.canConfirm && (data?.snapshots || []).length > 0 && <button type="button" style={st.btn} disabled={busy} onClick={() => post('refresh')}>최신화(새 버전)</button>}
        {access.full && data?.source === 'snapshot' && <button type="button" style={st.btn} onClick={() => { const next = !showDiff; setShowDiff(next); load({ diff: next }); }}>{showDiff ? '변경분 닫기' : '변경분(현재 DB 대비)'}</button>}
        {access.canDownload && <button type="button" style={st.btn} onClick={() => { const qs = new URLSearchParams({ week: weekValue, year, excel: '1' }); if (live) qs.set('live', '1'); else if (snapshotKey) qs.set('snapshot', snapshotKey); window.location.href = `/api/sales/profit-workbook?${qs}`; }}>엑셀(양식) 다운로드</button>}
        {canEdit && edits.length > 0 && <button type="button" style={st.primary} disabled={busy} onClick={() => post('saveEdits', { edits })}>수기 편집 저장({edits.length}) → 새 버전</button>}
        {canEdit && edits.length > 0 && <button type="button" style={st.btn} onClick={() => { setEdits([]); setDrafts({}); }}>편집 취소</button>}
        {access.full && data && !data.initialized && <span style={{ fontSize: 12, color: '#b45309' }}>스냅샷 테이블 migration 미적용 — 현재 DB만 표시</span>}
      </div>
      {error && <div style={st.error}>{error}</div>}
      {message && <div style={st.msg}>{message}</div>}
      {loading && <div style={st.msg}>원천시트를 불러오는 중…</div>}
      {showDiff && data?.changes && (
        <div style={st.note}>
          <b>변경분</b>(스냅샷 v{data.snapshot?.version} → 현재 DB): {data.changes.length}건
          {data.changes.length > 0 && (
            <div style={{ ...st.tableWrap, maxHeight: 240, marginTop: 6 }}>
              <table style={st.table}><thead><tr><th style={st.th}>구분</th><th style={st.th}>시트</th><th style={st.th}>대상</th><th style={st.th}>필드</th><th style={st.th}>스냅샷</th><th style={st.th}>현재</th></tr></thead>
                <tbody>{data.changes.slice(0, 300).map((c) => {
                  const d = c.after || c.before || {};
                  const f = c.fields?.[0] || (c.sheet === 'purchase' ? 'usd' : 'supply');
                  return <tr key={`${c.sheet}|${c.rowKey}`}><td style={st.td}>{{ added: '추가', removed: '삭제', changed: '변경' }[c.kind]}</td><td style={st.td}>{c.sheet}</td><td style={st.td}>{d.custName || d.farmName} / {d.prodName}</td><td style={st.td}>{(c.fields || [f]).join(',')}</td><td style={{ ...st.td, ...st.num }}>{fmt(c.before?.[f], 2)}</td><td style={{ ...st.td, ...st.num }}>{fmt(c.after?.[f], 2)}</td></tr>;
                })}</tbody></table>
            </div>
          )}
        </div>
      )}
      <div style={st.bar}>{(data?.subTabs || []).map((t) => <button type="button" key={t.key} style={st.tab(tab === t.key)} onClick={() => setTab(t.key)}>{t.label}</button>)}</div>
      {(tab === 'regionSales' || tab === 'regionRevenue') && (
        <div style={st.bar}>지역:
          {(data?.regions || []).map((r) => <button type="button" key={r} style={st.tab(region === r)} onClick={() => setRegion(r)}>{r}</button>)}
          <span style={{ fontSize: 12, color: '#64748b' }}>지역 = 거래처관리 지역(Customer.CustArea): 경부선·호남선→경부호남, 지방·지방직매장→지방</span>
        </div>
      )}
      {data && tab === 'sales' && table(bySheet('sales'), COLS.sales)}
      {data && tab === 'deduct' && (
        <>
          <div style={st.bar}><b>불량차감</b>{canEdit && <button type="button" style={st.btn} onClick={() => addManualRow('defect')}>+ 수기행</button>}</div>
          {table(bySheet('defect'), COLS.deduct, { removable: true })}
          <div style={st.bar}><b>그 외 매출액</b>{canEdit && <button type="button" style={st.btn} onClick={() => addManualRow('other')}>+ 수기행</button>}</div>
          {table(bySheet('other'), COLS.deduct, { removable: true })}
        </>
      )}
      {data && tab === 'purchase' && (
        <>
          <div style={st.bar}>{canEdit && <button type="button" style={st.btn} onClick={() => addManualRow('purchase')}>+ 수기행</button>}</div>
          {table(bySheet('purchase'), COLS.purchase, { removable: true })}
        </>
      )}
      {data && tab === 'regionSales' && table(regionFilter(bySheet('sales')), COLS.sales, { regionCol: true })}
      {data && tab === 'regionRevenue' && (
        <div style={st.tableWrap}>
          <table style={st.table}>
            <thead><tr>{['지역', '거래처', '매출(공급가)', '부가세', '불량차감', '그 외', '순매출'].map((h) => <th key={h} style={st.th}>{h}</th>)}</tr></thead>
            <tbody>
              <tr style={st.total}><td style={st.td}>합계</td><td style={st.td}>{regionRevenue.length}곳</td>
                {['sales', 'salesVat', 'defect', 'other', 'net'].map((f) => <td key={f} style={{ ...st.td, ...st.num }}>{fmt(regionRevenue.reduce((a, x) => a + x[f], 0))}</td>)}</tr>
              {regionRevenue.map((x) => (
                <tr key={`${x.region}|${x.custName}`}><td style={st.td}>{x.region}</td><td style={st.td}>{x.custName}</td>
                  {['sales', 'salesVat', 'defect', 'other', 'net'].map((f) => <td key={f} style={{ ...st.td, ...st.num }}>{fmt(x[f])}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
