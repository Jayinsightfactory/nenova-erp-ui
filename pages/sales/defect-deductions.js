// 영업수입불량차감 — 원본 양식 업로드/수정/이력/견적서관리 일괄 등록

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../../components/Layout';
import { apiDelete, apiGet, apiPost } from '../../lib/useApi';
import { parseJsonResponse } from '../../lib/parseJsonResponse';
import { getCurrentWeek } from '../../lib/useWeekInput';

const fmt = (n) => Number(n || 0).toLocaleString();
const emptyRow = () => ({
  deductionKey: null,
  customerName: '', custKey: null,
  productName: '', prodKey: null,
  colorName: '', quantity: '', sourceUnit: '', unit: '',
  creditApplied: false, farmName: '', farmKey: null, note: '',
  status: 'DRAFT', estimateKey: null, estimateCost: null,
  customerSuggestions: [], productSuggestions: [],
});

function initialScope() {
  const parts = String(getCurrentWeek() || '').split('-');
  return {
    year: parts.length === 3 ? parts[0] : String(new Date().getFullYear()),
    week: parts.length === 3 ? String(Number(parts[1])) : String(Number(parts[0]) || 1),
  };
}

function valueOf(row, key) {
  return row[key] == null ? '' : row[key];
}

export default function SalesDefectDeductionsPage() {
  const scope = useMemo(initialScope, []);
  const [year, setYear] = useState(scope.year);
  const [week, setWeek] = useState(scope.week);
  const [manager, setManager] = useState('');
  const [managerOptions, setManagerOptions] = useState([]);
  const [deductionType, setDeductionType] = useState('불량차감');
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [activeSearch, setActiveSearch] = useState(null); // { index, kind }
  const [lookup, setLookup] = useState([]);
  const [preflight, setPreflight] = useState({});
  const fileRef = useRef(null);
  const searchTimer = useRef(null);

  const load = useCallback(async () => {
    if (!year || !week) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiGet('/api/sales/defect-deductions', { year, week, manager, history: '1' });
      setRows(data.rows || []);
      setHistory(data.history || []);
      setManagerOptions(data.managerOptions || []);
      setSelected(new Set());
      setPreflight({});
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [year, week, manager]);

  useEffect(() => { load(); }, [load]);

  const updateRow = (index, patch) => {
    setRows((current) => current.map((row, i) => i === index ? { ...row, ...patch } : row));
  };

  const changeText = (index, field, value) => {
    const reset = field === 'customerName'
      ? { custKey: null, customerSuggestions: [] }
      : field === 'productName' || field === 'colorName'
        ? { prodKey: null, productSuggestions: [], estimateCost: null }
        : field === 'farmName' ? { farmKey: null } : {};
    updateRow(index, { [field]: value, ...reset, status: 'DRAFT' });
  };

  const runLookup = (index, kind) => {
    const row = rows[index] || {};
    const term = kind === 'customer'
      ? row.customerName
      : kind === 'product'
        ? `${row.productName || ''} ${row.colorName || ''}`.trim()
        : row.farmName;
    setActiveSearch({ index, kind });
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        const data = await apiGet('/api/sales/defect-deductions', { view: 'lookups', kind, q: term });
        setLookup(kind === 'customer' ? (data.customers || []) : kind === 'product' ? (data.products || []) : (data.farms || []));
      } catch (e) { setError(e.message); }
    }, 120);
  };

  const chooseLookup = (item) => {
    if (!activeSearch) return;
    const { index, kind } = activeSearch;
    if (kind === 'customer') {
      updateRow(index, { customerName: item.CustName, custKey: Number(item.CustKey), customerSuggestions: [] });
    } else if (kind === 'product') {
      updateRow(index, {
        productName: item.DisplayName || item.ProdName,
        prodKey: Number(item.ProdKey),
        unit: item.EstUnit || item.OutUnit || '',
        productSuggestions: [],
      });
    } else {
      updateRow(index, { farmName: item.FarmName, farmKey: Number(item.FarmKey) || null });
    }
    setLookup([]);
    setActiveSearch(null);
  };

  const addRow = () => setRows((current) => [...current, emptyRow()]);

  const upload = async (file) => {
    if (!file) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/sales/defect-deductions-upload', {
        method: 'POST', credentials: 'include', body: form,
      });
      const data = await parseJsonResponse(res);
      if (!res.ok) throw new Error(data.error || '업로드 실패');
      setRows((current) => [...current, ...(data.rows || [])]);
      const summary = data.summary || {};
      setMessage(`엑셀 ${data.rows?.length || 0}건을 불러왔습니다. 거래처 매칭 ${summary.customerMatched || 0}건 · 품목 매칭 ${summary.productMatched || 0}건 · 확인 필요 ${summary.needsReview || 0}건`);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const save = async () => {
    setSaving(true); setError(''); setMessage('');
    try {
      const data = await apiPost('/api/sales/defect-deductions', {
        action: 'save', year, week, rows,
        sourceFileName: rows.find((r) => r.sourceFileName)?.sourceFileName || '',
      });
      setRows(data.rows || []);
      setSelected(new Set());
      setMessage(`${data.saved || 0}건 저장 완료. 이제 견적서관리 등록을 진행할 수 있습니다.`);
      await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const register = async () => {
    const ids = [...selected].map((i) => rows[i]?.deductionKey).filter(Boolean);
    if (!ids.length) { setError('먼저 저장된 행을 선택하세요.'); return; }
    setSaving(true); setError(''); setMessage('');
    try {
      const check = await apiPost('/api/sales/defect-deductions', {
        action: 'preflight', year, week,
        rows: rows.filter((_, i) => selected.has(i)),
      });
      setPreflight(Object.fromEntries((check.rows || []).map((r) => [r.deductionKey, r])));
      const invalid = (check.rows || []).filter((r) => r.error);
      if (invalid.length) {
        throw new Error(invalid.map((r) => `행 ${r.index + 1}: ${r.error}`).join('\n'));
      }
      const data = await apiPost('/api/sales/defect-deductions', {
        action: 'register', year, week, ids, deductionType,
      });
      setMessage(`${data.registered || 0}건을 견적서관리 ${deductionType}로 등록했습니다. (이전 차수 분배단가 적용)`);
      await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    const ids = [...selected].map((i) => rows[i]?.deductionKey).filter(Boolean);
    if (!ids.length) { setError('삭제할 저장 행을 선택하세요.'); return; }
    if (!window.confirm('선택한 원장과 연결된 견적서 차감행을 삭제하고 이력으로 남길까요?')) return;
    setSaving(true); setError('');
    try {
      await apiDelete('/api/sales/defect-deductions', { year, week, ids });
      setMessage('삭제 처리 완료. 변경 이력은 보존되었습니다.');
      await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const download = async () => {
    try {
      const res = await fetch(`/api/sales/defect-deductions-excel?year=${encodeURIComponent(year)}&week=${encodeURIComponent(week)}&manager=${encodeURIComponent(manager)}`, { credentials: 'include' });
      if (!res.ok) {
        const data = await parseJsonResponse(res);
        throw new Error(data.error || '다운로드 실패');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `영업수입불량차감_${year}_${week}차.xlsx`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(e.message); }
  };

  const printForm = () => {
    setError('');
    window.print();
  };

  const toggle = (index) => setSelected((current) => {
    const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next;
  });
  const toggleAll = () => setSelected(selected.size === rows.length ? new Set() : new Set(rows.map((_, i) => i)));

  const statusText = (row) => row.status === 'REGISTERED'
    ? `견적서 등록완료${row.estimateKey ? ` (#${row.estimateKey})` : ''}`
    : row.status === 'DELETED' ? '삭제됨' : row.deductionKey ? '웹 저장' : '미저장';

  const printRows = Array.from({ length: Math.max(rows.length, 39) }, (_, index) => rows[index] || null);
  const printQuantity = (row) => {
    if (!row || row.quantity == null || row.quantity === '') return '';
    const quantity = Number(row.quantity);
    const value = Number.isFinite(quantity) && Number.isInteger(quantity) ? fmt(quantity) : String(row.quantity);
    return `${value}${row.sourceUnit || row.unit || ''}`;
  };

  return (
    <Layout pageTitle="영업수입불량차감">
      <div className="sales-defect-page">
      <div className="screenOnly">
      <div className="page-head" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>영업수입불량차감</h2>
        <span style={{ color: '#64748b', fontSize: 12 }}>원본 양식 업로드 → 확인/수정 → 저장 → 견적서관리 일괄 등록</span>
      </div>

      <div className="card" style={{ padding: 10, marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
          <label>연도 <input className="input" style={{ width: 80 }} value={year} onChange={(e) => setYear(e.target.value)} /></label>
          <label>차수 <input className="input" style={{ width: 60 }} value={week} onChange={(e) => setWeek(e.target.value)} /> 차</label>
          <label>담당자 <select className="input" style={{ minWidth: 150 }} value={manager} onChange={(e) => setManager(e.target.value)}><option value="">전체 담당자</option>{managerOptions.map((item) => <option key={item.managerId} value={item.managerId}>{item.managerName}</option>)}</select></label>
          <label>견적서 등록 구분 <select className="input" value={deductionType} onChange={(e) => setDeductionType(e.target.value)}><option>불량차감</option><option>검역차감</option></select></label>
          <button className="btn btn-primary" onClick={load} disabled={loading}>조회</button>
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={saving}>엑셀 업로드</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(e) => upload(e.target.files?.[0])} />
          <button className="btn" onClick={addRow}>빈 행 추가</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !rows.length}>저장</button>
          <button className="btn" onClick={register} disabled={saving || !selected.size}>선택 일괄 견적서관리 등록</button>
          <button className="btn" onClick={printForm} disabled={!rows.length}>인쇄</button>
          <button className="btn" onClick={download} disabled={loading}>엑셀 다운로드</button>
          <button className="btn" onClick={() => setShowHistory((v) => !v)}>수정이력 {showHistory ? '닫기' : '보기'}</button>
          <button className="btn btn-danger" onClick={remove} disabled={saving || !selected.size}>선택 삭제</button>
        </div>
        <div style={{ marginTop: 7, color: '#475569', fontSize: 12 }}>
          {message && <span style={{ color: '#166534', marginRight: 12 }}>{message}</span>}
          {error && <span style={{ color: '#b91c1c', whiteSpace: 'pre-wrap' }}>{error}</span>}
        </div>
      </div>
      </div>

      {showHistory && (
        <div className="screenOnly">
        <div className="card" style={{ padding: 10, marginBottom: 10, maxHeight: 260, overflow: 'auto' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>수정 이력 — 거래처명/품명/수량 변경내용 포함</div>
          <table className="data-table" style={{ fontSize: 12 }}><thead><tr><th>일시</th><th>작업자</th><th>작업</th><th>변경내용</th></tr></thead><tbody>
            {history.map((h) => <tr key={h.HistoryKey}><td>{String(h.ChangedAt || '').slice(0, 19)}</td><td>{h.ChangedByName || h.ChangedBy}</td><td>{h.ActionType}</td><td>{h.ChangeSummary}</td></tr>)}
            {!history.length && <tr><td colSpan="4">이력이 없습니다.</td></tr>}
          </tbody></table>
        </div>
        </div>
      )}

      <div className="screenOnly">
      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table className="data-table" style={{ minWidth: 1320, fontSize: 12 }}>
          <thead><tr>
            <th style={{ width: 34 }}><input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleAll} /></th>
            <th>No</th><th>담당자</th><th>거래처</th><th>품명</th><th>색상</th><th>차감수량</th><th>크레딧</th><th>농장</th><th>비고</th><th>이전차수 분배단가</th><th>견적서관리 등록</th><th>검색/선택</th>
          </tr></thead>
          <tbody>
            {rows.map((row, index) => {
              const pf = row.deductionKey ? preflight[row.deductionKey] : null;
              return <tr key={row.deductionKey || `new-${index}`} style={{ background: row.status === 'REGISTERED' ? '#f0fdf4' : row.needsReview ? '#fff7ed' : undefined }}>
                <td><input type="checkbox" checked={selected.has(index)} onChange={() => toggle(index)} /></td>
                <td>{index + 1}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{row.managerName || '-'}</td>
                <td>
                  <input className="input cell" value={valueOf(row, 'customerName')} onChange={(e) => changeText(index, 'customerName', e.target.value)} />
                  <div className={row.custKey ? 'match-ok' : 'match-warn'}>{row.custKey ? `✓ 전산 거래처 ${row.matchedCustomerName || row.customerName}` : '미매칭: 전산 거래처 선택 필요'}</div>
                </td>
                <td>
                  <input className="input cell" value={valueOf(row, 'productName')} onChange={(e) => changeText(index, 'productName', e.target.value)} />
                  <div className={row.prodKey ? 'match-ok' : 'match-warn'}>{row.prodKey ? `✓ 품목 ${row.matchedProductName || row.productName} (#${row.prodKey})` : '미매칭: 품목 선택 필요'}</div>
                </td>
                <td><input className="input cell" value={valueOf(row, 'colorName')} onChange={(e) => changeText(index, 'colorName', e.target.value)} /></td>
                <td><div style={{ display: 'flex', gap: 3 }}><input className="input cell qty" type="number" min="0" value={valueOf(row, 'quantity')} onChange={(e) => changeText(index, 'quantity', e.target.value)} /><input className="input unit" value={valueOf(row, 'sourceUnit') || valueOf(row, 'unit')} placeholder="단위" onChange={(e) => changeText(index, 'sourceUnit', e.target.value)} /></div></td>
                <td style={{ textAlign: 'center' }}><input type="checkbox" checked={!!row.creditApplied} onChange={(e) => updateRow(index, { creditApplied: e.target.checked })} /></td>
                <td><input className="input cell" value={valueOf(row, 'farmName')} onChange={(e) => changeText(index, 'farmName', e.target.value)} /></td>
                <td><input className="input cell" value={valueOf(row, 'note')} onChange={(e) => changeText(index, 'note', e.target.value)} /></td>
                <td style={{ whiteSpace: 'nowrap', color: pf?.error ? '#b91c1c' : '#334155' }}>
                  {row.estimateCost ? `${fmt(row.estimateCost)}원` : pf?.cost ? `${fmt(pf.cost)}원` : '등록 전 확인'}
                  {pf?.error && <div style={{ fontSize: 10 }}>{pf.error}</div>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}><span style={{ color: row.status === 'REGISTERED' ? '#166534' : '#64748b' }}>{statusText(row)}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-xs" onClick={() => runLookup(index, 'customer')}>거래처</button>{' '}
                  <button className="btn btn-xs" onClick={() => runLookup(index, 'product')}>품목</button>{' '}
                  <button className="btn btn-xs" onClick={() => runLookup(index, 'farm')}>농장</button>
                  {activeSearch?.index === index && <div style={{ position: 'absolute', zIndex: 10, background: '#fff', border: '1px solid #94a3b8', maxHeight: 180, overflow: 'auto', minWidth: 300 }}>
                    {lookup.map((item, i) => <button key={i} style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, background: '#fff', padding: '5px 8px', cursor: 'pointer' }} onClick={() => chooseLookup(item)}>
                      {activeSearch.kind === 'customer' ? `${item.CustName} (${item.CustKey})` : activeSearch.kind === 'product' ? `${item.DisplayName || item.ProdName} · ${item.CounName || ''} ${item.FlowerName || ''}` : `${item.FarmName}`}
                    </button>)}
                    {!lookup.length && <div style={{ padding: 8, color: '#64748b' }}>검색 결과 없음 — 직접 입력은 가능하지만 견적서 등록 전 매칭이 필요합니다.</div>}
                  </div>}
                </td>
              </tr>;
            })}
            {!rows.length && <tr><td colSpan="13" style={{ textAlign: 'center', padding: 30, color: '#64748b' }}>엑셀을 업로드하거나 빈 행을 추가하세요.</td></tr>}
          </tbody>
        </table>
      </div>
      </div>

      <div className="printOnly print-form" aria-hidden="true">
        <div className="print-top">
          <div className="print-title">{year}년 ( {week} )차 차감 내역</div>
          <table className="print-approval"><tbody><tr><th>담당자</th><th>차장</th><th>이사</th></tr><tr><td>{scope.userName || ''}</td><td></td><td></td></tr></tbody></table>
        </div>
        <table className="print-table">
          <colgroup><col className="customer-col" /><col className="product-col" /><col className="color-col" /><col className="quantity-col" /><col className="credit-col" /><col className="farm-col" /><col className="note-col" /></colgroup>
          <thead><tr><th>거래처</th><th>품명</th><th>색상</th><th>차감수량</th><th>크레딧(수입부)</th><th>농장</th><th>비고</th></tr></thead>
          <tbody>{printRows.map((row, index) => <tr key={`print-${index}`}>
            <td>{row?.customerName || ''}</td>
            <td>{row?.productName || ''}</td>
            <td>{row?.colorName || ''}</td>
            <td>{printQuantity(row)}</td>
            <td>{row?.creditApplied ? '✓' : ''}</td>
            <td>{row?.farmName || ''}</td>
            <td>{row?.note || ''}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <style jsx>{`
        .cell { min-width: 100px; width: 100%; box-sizing: border-box; }
        .qty { width: 65px; min-width: 65px; }
        .unit { width: 62px; min-width: 62px; }
        .btn-xs { padding: 2px 5px; font-size: 11px; }
        td { position: relative; vertical-align: middle; }
        .match-ok, .match-warn { font-size: 10px; line-height: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .match-ok { color: #166534; }
        .match-warn { color: #b45309; }
        .printOnly { display: none; }
        .print-form { color: #111; background: #fff; font-family: Arial, sans-serif; }
        .print-top { display: grid; grid-template-columns: 1fr 210px; align-items: stretch; border: 1px solid #111; margin-bottom: 0; }
        .print-title { display: flex; align-items: center; justify-content: center; min-height: 54px; font-size: 20px; font-weight: 700; }
        .print-approval { width: 210px; border-collapse: collapse; table-layout: fixed; font-size: 11px; }
        .print-approval th, .print-approval td { border-left: 1px solid #111; border-bottom: 1px solid #111; text-align: center; height: 26px; }
        .print-approval tr:last-child td { border-bottom: 0; }
        .print-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12px; }
        .print-table th, .print-table td { border: 1px solid #111; padding: 3px 5px; height: 23px; vertical-align: middle; overflow: hidden; white-space: nowrap; }
        .print-table th { background: #c69700; font-weight: 700; text-align: center; }
        .print-table td:nth-child(4), .print-table td:nth-child(5) { text-align: center; }
        .customer-col { width: 19%; } .product-col { width: 20%; } .color-col { width: 17%; }
        .quantity-col { width: 11%; } .credit-col { width: 13%; } .farm-col { width: 11%; } .note-col { width: 19%; }
        @media print {
          :global(body *) { visibility: hidden !important; }
          .sales-defect-page .printOnly, .sales-defect-page .printOnly * { visibility: visible !important; }
          .sales-defect-page .printOnly { display: block !important; position: absolute; left: 0; top: 0; width: 100%; }
          :global(body) { margin: 0 !important; background: #fff !important; }
          .print-form { width: 190mm; margin: 0 auto; }
          .print-table th { background: #c69700 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
      </div>
    </Layout>
  );
}
