// 영업수입불량차감 — 원본 양식 업로드/수정/이력/견적서관리 일괄 등록

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../../components/Layout';
import { apiDelete, apiGet, apiPost } from '../../lib/useApi';
import { parseJsonResponse } from '../../lib/parseJsonResponse';
import { getCurrentWeek } from '../../lib/useWeekInput';
import { getStatementProductName } from '../../lib/estimatePrintFormats';
import { lookupSelectionDelta, mergeSavedDeductionRows, partitionSelectedDeductionRows } from '../../lib/salesDefectDeductionCore';

const fmt = (n) => Number(n || 0).toLocaleString();
const usageLabel = (item) => {
  const count = Number(item?.UsageCount ?? item?.usageCount ?? 0);
  return count > 0 ? ` · 사용 ${fmt(count)}회` : '';
};
const UNIT_OPTIONS = [
  { value: '단', label: '단' },
  { value: '박스', label: '박스' },
  { value: '스팀(대)', label: '스팀' },
];
const emptyRow = () => ({
  deductionKey: null,
  customerName: '', custKey: null,
  productName: '', prodKey: null,
  colorName: '', quantity: '', sourceUnit: '단', unit: '단',
  matchedProductName: '', matchedProductDbName: '',
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
  const [currentUser, setCurrentUser] = useState(null);
  const [showManagerEditor, setShowManagerEditor] = useState(false);
  const [managerEditId, setManagerEditId] = useState('');
  const [managerEditName, setManagerEditName] = useState('');
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
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookupActiveIndex, setLookupActiveIndex] = useState(-1);
  const [preflight, setPreflight] = useState({});
  const fileRef = useRef(null);
  const searchTimer = useRef(null);
  const preflightTimer = useRef(null);

  useEffect(() => {
    apiGet('/api/auth/me').then((data) => {
      const user = data.user || null;
      setCurrentUser(user);
      setManager(user?.userId || user?.userName || '');
    }).catch(() => { /* 페이지 조회가 인증된 상태면 목록 API가 최종 확인한다. */ });
  }, []);

  const load = useCallback(async (managerOverride = manager, { preserveRows = false } = {}) => {
    if (!year || !week) return;
    const managerFilter = managerOverride == null ? manager : managerOverride;
    setLoading(true);
    setError('');
    try {
      const data = await apiGet('/api/sales/defect-deductions', { year, week, manager: managerFilter, history: '1' });
      if (!preserveRows) setRows(data.rows || []);
      setHistory(data.history || []);
      setManagerOptions(data.managerOptions || []);
      setSelected(new Set());
      setPreflight({});
      return data;
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [year, week, manager]);

  useEffect(() => { load(); }, [load]);

  const visibleManagerOptions = useMemo(() => {
    const normalizeName = (value) => String(value || '').toLowerCase().replace(/\s+/g, '').trim();
    const map = new Map();
    const names = new Set();
    (managerOptions || []).forEach((item) => {
      const nameKey = normalizeName(item.managerName || item.managerId);
      if (!nameKey || names.has(nameKey)) return;
      names.add(nameKey);
      map.set(String(item.managerId), item);
    });
    const userId = String(currentUser?.userId || '').trim();
    const userName = String(currentUser?.userName || userId).trim();
    const userNameKey = normalizeName(userName);
    if (userId && !map.has(userId) && !names.has(userNameKey)) {
      map.set(userId, { managerId: userId, managerName: userName });
    }
    return [...map.values()];
  }, [managerOptions, currentUser]);

  useEffect(() => {
    clearTimeout(preflightTimer.current);
    const eligible = rows.map((row, index) => ({ row, index }))
      .filter(({ row }) => Number(row.custKey) > 0 && Number(row.prodKey) > 0 && Number(row.quantity) > 0);
    if (!eligible.length || !year || !week) {
      setPreflight({});
      return undefined;
    }
    preflightTimer.current = setTimeout(async () => {
      try {
        const result = await apiPost('/api/sales/defect-deductions', {
          action: 'preflight', year, week, rows: eligible.map(({ row }) => row),
        });
        const next = {};
        (result.rows || []).forEach((item, i) => {
          const target = eligible[i];
          if (target) next[target.row.deductionKey || `row:${target.index}`] = item;
        });
        setPreflight(next);
      } catch {
        // 저장/등록 시 재검증하므로 자동 미리보기 실패가 입력을 막지는 않는다.
      }
    }, 250);
    return () => clearTimeout(preflightTimer.current);
  }, [rows, year, week]);

  const updateRow = (index, patch) => {
    setRows((current) => current.map((row, i) => i === index ? { ...row, ...patch } : row));
  };

  const changeText = (index, field, value) => {
    const reset = field === 'customerName'
      ? { custKey: null, customerSuggestions: [] }
      : field === 'productName' || field === 'colorName'
        ? { prodKey: null, productSuggestions: [], estimateCost: null, matchedProductName: '', matchedProductDbName: '' }
        : field === 'farmName' ? { farmKey: null } : {};
    updateRow(index, { [field]: value, ...reset, status: 'DRAFT' });
    setPreflight((current) => {
      const next = { ...current };
      const key = rows[index]?.deductionKey || `row:${index}`;
      delete next[key];
      return next;
    });
  };

  const fetchLookup = (index, kind, term) => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        const data = await apiGet('/api/sales/defect-deductions', { view: 'lookups', kind, q: term });
        const items = kind === 'customer' ? (data.customers || []) : kind === 'product' ? (data.products || []) : (data.farms || []);
        setLookup(items);
        setLookupActiveIndex(items.length ? 0 : -1);
      } catch (e) { setError(e.message); }
    }, 120);
  };

  const openLookup = (index, kind, term) => {
    const value = String(term || '').trim();
    setActiveSearch({ index, kind });
    setLookupQuery(value);
    setLookupActiveIndex(-1);
    fetchLookup(index, kind, value);
  };

  const runLookup = (index, kind, explicitTerm = '') => {
    const row = rows[index] || {};
    const term = kind === 'customer'
      ? row.customerName
      : kind === 'product'
        ? (explicitTerm || `${row.productName || ''} ${row.colorName || ''}`).trim()
        : row.farmName;
    openLookup(index, kind, term);
  };

  const searchLookup = () => {
    if (!activeSearch) return;
    fetchLookup(activeSearch.index, activeSearch.kind, lookupQuery.trim());
  };

  const focusField = (index, field) => {
    window.setTimeout(() => {
      const target = document.querySelector(`[data-defect-field="${field}-${index}"]`);
      target?.focus();
      target?.select?.();
    }, 0);
  };

  const chooseActiveLookup = () => {
    if (!lookup.length) return false;
    const index = lookupActiveIndex >= 0 && lookupActiveIndex < lookup.length ? lookupActiveIndex : 0;
    chooseLookup(lookup[index]);
    return true;
  };

  const moveLookupSelection = (direction) => {
    if (!lookup.length) return;
    setLookupActiveIndex((current) => {
      const start = current < 0 ? (direction > 0 ? -1 : 0) : current;
      return (start + direction + lookup.length) % lookup.length;
    });
  };

  const handleLookupKeyDown = (event, index, kind, term, nextField) => {
    const lookupDelta = lookupSelectionDelta(event.key);
    if (lookupDelta) {
      event.preventDefault();
      if (!activeSearch || activeSearch.index !== index || activeSearch.kind !== kind) {
        openLookup(index, kind, term);
      } else {
        moveLookupSelection(lookupDelta);
      }
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!activeSearch || activeSearch.index !== index || activeSearch.kind !== kind) {
        openLookup(index, kind, term);
      } else if (chooseActiveLookup()) {
        if (nextField) focusField(index, nextField);
      }
    }
  };

  const handleLookupChange = (index, kind, field, value) => {
    changeText(index, field, value);
    if (String(value || '').trim()) openLookup(index, kind, value);
    else if (activeSearch?.index === index && activeSearch?.kind === kind) {
      setLookup([]);
      setActiveSearch(null);
      setLookupActiveIndex(-1);
    }
  };

  const chooseLookup = (item) => {
    if (!activeSearch) return;
    const { index, kind } = activeSearch;
    const row = rows[index] || {};
    if (kind === 'customer') {
      updateRow(index, { customerName: item.CustName, custKey: Number(item.CustKey), customerSuggestions: [] });
    } else if (kind === 'product') {
      const selectedDisplayName = item.DisplayName || item.ProdName || row.colorName || '';
      updateRow(index, {
        productName: item.FlowerName || row.productName || '',
        colorName: getStatementProductName({ ProdName: selectedDisplayName }) || selectedDisplayName,
        prodKey: Number(item.ProdKey),
        matchedProductName: item.DisplayName || item.ProdName || '',
        matchedProductDbName: item.ProdName || '',
        unit: item.EstUnit || item.OutUnit || '',
        productSuggestions: [],
      });
    } else {
      updateRow(index, { farmName: item.FarmName, farmKey: Number(item.FarmKey) || null });
    }
    setLookup([]);
    setActiveSearch(null);
    setLookupQuery('');
    setLookupActiveIndex(-1);
    if (kind === 'customer' || kind === 'product') {
      setMessage('검색 매칭을 선택했습니다. 저장 버튼을 눌러 전산 매칭값과 매칭 이력을 확정하세요.');
    }
    if (kind === 'customer') focusField(index, 'productName');
    else if (kind === 'product') focusField(index, 'colorName');
  };

  const chooseProductSuggestion = (index, item) => {
    const row = rows[index] || {};
    const displayName = item.displayName || item.prodName || row.colorName || '';
    updateRow(index, {
      productName: item.flowerName || row.productName || '',
      colorName: getStatementProductName({ ProdName: displayName }) || displayName,
      prodKey: Number(item.prodKey),
      matchedProductName: displayName,
      matchedProductDbName: item.prodName || '',
      unit: item.outUnit || row.unit || row.sourceUnit || '',
      productSuggestions: [],
    });
    setMessage('DB 품목 매칭을 선택했습니다. 저장 버튼을 눌러 전산 매칭값과 매칭 이력을 확정하세요.');
  };

  const addRow = () => setRows((current) => [...current, emptyRow()]);

  const addRelatedRow = (index, keepProduct) => {
    const source = rows[index];
    if (!source) return;
    const next = {
      ...emptyRow(),
      customerName: source.customerName || '',
      custKey: source.custKey || null,
      matchedCustomerName: source.matchedCustomerName || source.customerName || '',
      farmName: source.farmName || '',
      farmKey: source.farmKey || null,
      ...(keepProduct ? {
        productName: source.productName || '',
        colorName: source.colorName || '',
        prodKey: source.prodKey || null,
        matchedProductName: source.matchedProductName || '',
        matchedProductDbName: source.matchedProductDbName || '',
        sourceUnit: source.sourceUnit || source.unit || '',
        unit: source.unit || source.sourceUnit || '',
      } : {}),
    };
    setRows((current) => {
      const copy = [...current];
      copy.splice(index + 1, 0, next);
      return copy;
    });
  };

  const saveManager = async () => {
    const name = managerEditName.trim();
    if (!name) { setError('담당자 이름을 입력하세요.'); return; }
    setSaving(true); setError('');
    try {
      const data = await apiPost('/api/sales/defect-deductions', {
        action: 'manager-save', managerId: managerEditId, managerName: name,
      });
      setManagerOptions(data.managerOptions || []);
      setManagerEditId('');
      setManagerEditName('');
      setMessage('담당자 목록을 저장했습니다.');
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

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
      const submittedRows = rows;
      const selectedManager = visibleManagerOptions.find((item) => String(item.managerId) === String(manager));
      const data = await apiPost('/api/sales/defect-deductions', {
        action: 'save', year, week, rows: submittedRows,
        managerId: manager,
        managerName: selectedManager?.managerName || '',
        sourceFileName: rows.find((r) => r.sourceFileName)?.sourceFileName || '',
      });
      const savedRows = data.rows || [];
      setRows((current) => mergeSavedDeductionRows(current, savedRows, submittedRows));
      setSelected(new Set());
      setMessage(`${data.saved || 0}건 저장 완료. 이제 견적서관리 등록을 진행할 수 있습니다.`);
      // 이력/담당자 목록은 갱신하되, 저장 직후 현재 화면의 행을 조회 결과로 덮어쓰지 않는다.
      await load(manager, { preserveRows: true });
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const rematch = async () => {
    if (!rows.length) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const data = await apiPost('/api/sales/defect-deductions', {
        action: 'rematch', year, week, rows,
      });
      setRows(data.rows || []);
      const matched = (data.rows || []).filter((row) => row.custKey && row.prodKey).length;
      const needsReview = (data.rows || []).filter((row) => row.needsReview).length;
      setMessage(`공통 매칭 엔진으로 재분석했습니다. 매칭 ${matched}건 · 확인 필요 ${needsReview}건 · 결과를 반영하려면 저장하세요.`);
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
      const reviewUrl = `/sales/defect-deduction-register-review?year=${encodeURIComponent(year)}&week=${encodeURIComponent(week)}&ids=${encodeURIComponent(ids.join(','))}&type=${encodeURIComponent(deductionType)}`;
      const reviewWindow = window.open(reviewUrl, 'nenovaDefectDeductionRegisterReview', 'width=1500,height=900,resizable=yes,scrollbars=yes');
      if (!reviewWindow) throw new Error('검토창이 차단되었습니다. 브라우저의 팝업 허용 후 다시 시도하세요.');
      setMessage('견적서 등록 검토창을 열었습니다. 기존값과 적용값을 확인한 뒤 등록하세요.');
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  useEffect(() => {
    const onMessage = (event) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'sales-defect-register-complete') return;
      setMessage(`${event.data.registered || 0}건 견적서 등록 적용 완료. 원장을 다시 불러와 검증했습니다.`);
      load();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [load]);

  const remove = async () => {
    const selectedRows = partitionSelectedDeductionRows(rows, selected);
    const ids = selectedRows.storedKeys;
    if (!ids.length) {
      if (!selectedRows.unsavedIndexes.length) { setError('삭제할 행을 선택하세요.'); return; }
      if (!window.confirm('선택한 미저장 입력행을 화면에서 삭제할까요?')) return;
      setRows((current) => current.filter((_, index) => !selected.has(index)));
      setSelected(new Set());
      setMessage(`${selectedRows.unsavedIndexes.length}건의 미저장 입력행을 삭제했습니다.`);
      setError('');
      return;
    }
    const unsavedMessage = selectedRows.unsavedIndexes.length
      ? `\n미저장 입력행 ${selectedRows.unsavedIndexes.length}건도 함께 화면에서 제거됩니다.`
      : '';
    if (!window.confirm(`선택한 저장 원장 ${ids.length}건과 연결된 견적서 차감행을 삭제하고 이력으로 남길까요?${unsavedMessage}`)) return;
    setSaving(true); setError('');
    try {
      await apiDelete('/api/sales/defect-deductions', { year, week, ids });
      setMessage(`저장 원장 ${ids.length}건 삭제 처리 완료. 변경 이력은 보존되었습니다.`);
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
          <label>담당자 <select className="input" style={{ minWidth: 150 }} value={manager} onChange={(e) => setManager(e.target.value)}><option value="">전체</option>{visibleManagerOptions.map((item) => <option key={item.managerId} value={item.managerId}>{item.managerName}</option>)}</select></label>
          <button className="btn" onClick={() => setShowManagerEditor((value) => !value)}>담당자 추가/수정</button>
          <label>견적서 등록 구분 <select className="input" value={deductionType} onChange={(e) => setDeductionType(e.target.value)}><option>불량차감</option><option>검역차감</option></select></label>
          <button className="btn btn-primary" onClick={load} disabled={loading}>조회</button>
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={saving}>엑셀 업로드</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(e) => upload(e.target.files?.[0])} />
          <button className="btn" onClick={addRow}>빈 행 추가</button>
          <button className="btn" onClick={rematch} disabled={saving || !rows.length}>미매칭 재매칭</button>
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
        {showManagerEditor && <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 8, paddingTop: 8, borderTop: '1px solid #e2e8f0' }}>
          <span style={{ fontWeight: 700 }}>담당자 관리</span>
          <select className="input" value={managerEditId} onChange={(e) => {
            const id = e.target.value;
            const option = visibleManagerOptions.find((item) => String(item.managerId) === id);
            setManagerEditId(id);
            setManagerEditName(option?.managerName || '');
          }}>
            <option value="">새 담당자</option>
            {visibleManagerOptions.map((item) => <option key={`edit-${item.managerId}`} value={item.managerId}>{item.managerName}</option>)}
          </select>
          <input className="input" value={managerEditName} placeholder="담당자 이름" onChange={(e) => setManagerEditName(e.target.value)} />
          <button className="btn btn-primary" onClick={saveManager} disabled={saving}>저장</button>
          <button className="btn" onClick={() => { setManagerEditId(''); setManagerEditName(''); }}>새로 입력</button>
        </div>}
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
      <div className="card defect-grid-card">
        <div className="defect-grid-scroll">
        <table className="data-table defect-grid" style={{ minWidth: 1558, fontSize: 13, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 58 }} /><col style={{ width: 42 }} /><col style={{ width: 82 }} />
            <col style={{ width: 185 }} /><col style={{ width: 175 }} /><col style={{ width: 225 }} />
            <col style={{ width: 145 }} /><col style={{ width: 62 }} /><col style={{ width: 170 }} />
            <col style={{ width: 160 }} /><col style={{ width: 130 }} /><col style={{ width: 146 }} />
          </colgroup>
          <thead><tr>
            <th className="defect-header defect-select-cell">
              <label className="defect-select-hit" title="전체 선택">
                <input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleAll} />
              </label>
            </th>
            <th className="defect-header">No</th><th className="defect-header">담당자</th><th className="defect-header">거래처</th><th className="defect-header">품종</th><th className="defect-header">품명</th><th className="defect-header">차감수량</th><th className="defect-header">크레딧</th><th className="defect-header">농장</th><th className="defect-header">비고</th><th className="defect-header">이전/최근 분배단가</th><th className="defect-header">견적서관리 등록</th>
          </tr></thead>
          <tbody>
            {rows.map((row, index) => {
              const pf = row.deductionKey ? preflight[row.deductionKey] : null;
              return <tr className="defect-row" key={row.deductionKey || `new-${index}`} style={{ background: row.status === 'REGISTERED' ? '#f0fdf4' : row.needsReview ? '#fff7ed' : undefined }}>
                <td className="defect-select-cell">
                  <label className="defect-select-hit" title={`${index + 1}번 행 선택`}>
                    <input type="checkbox" checked={selected.has(index)} onChange={() => toggle(index)} />
                  </label>
                </td>
                <td>{index + 1}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{row.managerName || '-'}</td>
                <td>
                 <div className="lookup-inline">
                    <input data-defect-field={`customer-${index}`} className="input cell" value={valueOf(row, 'customerName')} onChange={(e) => handleLookupChange(index, 'customer', 'customerName', e.target.value)} onKeyDown={(e) => handleLookupKeyDown(e, index, 'customer', e.currentTarget.value, 'productName')} />
                    <button tabIndex={-1} className="btn btn-xs lookup-btn" onClick={() => runLookup(index, 'customer')}>검색</button>
                  </div>
                  <div className={row.custKey ? 'match-ok' : 'match-warn'}>{row.custKey ? `✓ 전산 거래처 ${row.matchedCustomerName || row.customerName}` : '미매칭: 전산 거래처 선택 필요'}</div>
                  <div style={{ display: 'flex', gap: 3, marginTop: 3, flexWrap: 'wrap' }}>
                    <button tabIndex={-1} className="btn btn-xs" onClick={() => addRelatedRow(index, false)}>동일업체 추가</button>
                    <button tabIndex={-1} className="btn btn-xs" onClick={() => addRelatedRow(index, true)}>동일업체·품종 추가</button>
                  </div>
                </td>
                <td>
                  <div className="lookup-inline">
                    <input data-defect-field={`productName-${index}`} className="input cell" value={valueOf(row, 'productName')} onChange={(e) => handleLookupChange(index, 'product', 'productName', e.target.value)} onKeyDown={(e) => handleLookupKeyDown(e, index, 'product', `${e.currentTarget.value} ${row.colorName || ''}`.trim(), 'colorName')} />
                    <button tabIndex={-1} className="btn btn-xs lookup-btn" onClick={() => runLookup(index, 'product', row.productName)}>품종</button>
                  </div>
                  <div className={row.prodKey ? 'match-ok' : 'match-warn'}>{row.prodKey ? `✓ 품종·품명 매칭 ${row.matchedProductName || row.productName} (#${row.prodKey})` : '미매칭: 품종·품명 매칭 필요'}</div>
                  {!row.prodKey && (row.productSuggestions || []).length > 0 && (
                    <div className="defect-inline-suggestions">
                      {(row.productSuggestions || []).slice(0, 3).map((item) => <button
                        key={item.prodKey}
                        type="button"
                        tabIndex={-1}
                        className="defect-inline-suggestion"
                        title={`DB 후보 ${item.score}점${usageLabel(item)}`}
                        onClick={() => chooseProductSuggestion(index, item)}>
                        {item.counName ? `${item.counName} ` : ''}{item.displayName || item.prodName}
                      </button>)}
                    </div>
                  )}
                </td>
                <td>
                  <div className="lookup-inline">
                    <input data-defect-field={`colorName-${index}`} className="input cell" value={valueOf(row, 'colorName')} onChange={(e) => handleLookupChange(index, 'product', 'colorName', e.target.value)} onKeyDown={(e) => handleLookupKeyDown(e, index, 'product', `${row.productName || ''} ${e.currentTarget.value}`.trim(), 'quantity')} />
                    <button tabIndex={-1} className="btn btn-xs lookup-btn" onClick={() => runLookup(index, 'product', row.colorName)}>품명</button>
                  </div>
                </td>
                <td>
                  <input className="input cell qty" type="number" min="0" value={valueOf(row, 'quantity')} onChange={(e) => changeText(index, 'quantity', e.target.value)} />
                  <div style={{ display: 'flex', gap: 2, marginTop: 3 }}>
                    {UNIT_OPTIONS.map((unit) => <button tabIndex={-1} key={unit.value} type="button" className={`btn btn-xs ${String(row.sourceUnit || row.unit || '단') === unit.value ? 'btn-primary' : ''}`} onClick={() => updateRow(index, { sourceUnit: unit.value, unit: unit.value })}>{unit.label}</button>)}
                  </div>
                </td>
                <td style={{ textAlign: 'center' }}><input type="checkbox" checked={!!row.creditApplied} onChange={(e) => updateRow(index, { creditApplied: e.target.checked })} /></td>
                <td>
                  <div className="lookup-inline">
                    <input className="input cell" value={valueOf(row, 'farmName')} onChange={(e) => changeText(index, 'farmName', e.target.value)} />
                    <button tabIndex={-1} className="btn btn-xs lookup-btn" onClick={() => runLookup(index, 'farm')}>검색</button>
                  </div>
                </td>
                <td>
                  <input className="input cell" value={valueOf(row, 'note')} onChange={(e) => changeText(index, 'note', e.target.value)} />
                  {row.matchedProductDbName && <div className="web-meta">전산 품명: {row.matchedProductDbName}</div>}
                  {pf?.cost > 0 && <div className="web-meta">분배단가: {fmt(pf.cost)}원 ({pf.costOrderWeek || '이전차수'})</div>}
                </td>
                <td style={{ whiteSpace: 'nowrap', color: pf?.error ? '#b91c1c' : '#334155' }}>
                  {row.estimateCost ? `${fmt(row.estimateCost)}원` : pf?.cost ? `${fmt(pf.cost)}원${pf.costOrderWeek ? ` (${pf.costOrderWeek})` : ''}` : pf?.error ? '확인 필요' : '자동 조회 대기'}
                  {pf?.error && <div style={{ fontSize: 10 }}>{pf.error}</div>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}><span style={{ color: row.status === 'REGISTERED' ? '#166534' : '#64748b' }}>{statusText(row)}</span></td>
              </tr>;
            })}
            {!rows.length && <tr><td colSpan="12" style={{ textAlign: 'center', padding: 30, color: '#64748b' }}>엑셀을 업로드하거나 빈 행을 추가하세요.</td></tr>}
          </tbody>
        </table>
        </div>
        {activeSearch && <div className="defect-lookup-panel">
          <div className="defect-lookup-title">
            {activeSearch.kind === 'customer' ? '거래처 검색 결과' : activeSearch.kind === 'product' ? '품종·품명 검색 결과' : '농장 검색 결과'}
            <span>행 {activeSearch.index + 1} 선택</span>
          </div>
          <div className="defect-lookup-search">
            <input className="input" value={lookupQuery} onChange={(e) => { setLookupQuery(e.target.value); fetchLookup(activeSearch.index, activeSearch.kind, e.target.value); }} onKeyDown={(e) => { const delta = lookupSelectionDelta(e.key); if (delta) { e.preventDefault(); moveLookupSelection(delta); } else if (e.key === 'Enter') { e.preventDefault(); chooseActiveLookup(); } }} placeholder="검색어를 직접 입력하세요" />
            <button className="btn btn-primary" onClick={searchLookup}>검색</button>
          </div>
          <div className="defect-lookup-options">
            {lookup.map((item, i) => <button key={i} tabIndex={-1} className={`defect-lookup-option ${lookupActiveIndex === i ? 'is-active' : ''}`} aria-selected={lookupActiveIndex === i} onMouseEnter={() => setLookupActiveIndex(i)} onClick={() => chooseLookup(item)}>
              {activeSearch.kind === 'customer'
                ? `${item.CustName} (${item.CustKey})${usageLabel(item)}`
                : activeSearch.kind === 'product'
                  ? `${item.DisplayName || item.ProdName} · ${item.CounName || ''} ${item.FlowerName || ''}${usageLabel(item)}`
                  : item.FarmName}
            </button>)}
            {!lookup.length && <div className="defect-lookup-empty">관련 전산 후보가 없습니다. 검색어를 줄여 다시 검색하거나, 전산 마스터 등록 여부를 확인하세요.</div>}
          </div>
        </div>}
      </div>
      </div>

      <div className="printOnly print-form" aria-hidden="true">
        <div className="print-top">
          <div className="print-title">{year}년 ( {week} )차 차감 내역</div>
            <table className="print-approval"><tbody><tr><th>담당자</th><th>차장</th><th>이사</th></tr><tr><td>{currentUser?.userName || ''}</td><td></td><td></td></tr></tbody></table>
        </div>
        <table className="print-table">
          <colgroup><col className="customer-col" /><col className="product-col" /><col className="color-col" /><col className="quantity-col" /><col className="credit-col" /><col className="farm-col" /><col className="note-col" /></colgroup>
          <thead><tr><th>거래처</th><th>품종</th><th>품명</th><th>차감수량</th><th>크레딧(수입부)</th><th>농장</th><th>비고</th></tr></thead>
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
        .sales-defect-page { width: 100%; min-width: 0; }
        .defect-grid-card { padding: 0; overflow: visible; position: relative; min-height: 0; }
        .defect-grid-scroll { max-height: calc(100vh - 250px); overflow: auto; }
        .defect-grid { width: 100%; border-collapse: separate; border-spacing: 0; }
        .defect-header { position: sticky; top: 0; z-index: 4; background: var(--header-bg); box-shadow: 0 1px 0 var(--border2); }
        .defect-row td { min-height: 58px; padding: 5px 6px; vertical-align: top; border-bottom: 1px solid var(--border); }
        .defect-select-cell { width: 58px; min-width: 58px; padding: 3px !important; text-align: center; vertical-align: middle !important; }
        .defect-select-hit { display: inline-flex; width: 46px; height: 42px; align-items: center; justify-content: center; cursor: pointer; }
        .defect-select-hit input[type="checkbox"] { width: 22px; height: 22px; margin: 0; cursor: pointer; accent-color: #2563eb; }
        .cell { min-width: 100px; width: 100%; min-height: 30px; box-sizing: border-box; font-size: 13px; }
        .lookup-inline { display: flex; align-items: center; gap: 4px; width: 100%; }
        .lookup-inline .cell { flex: 1 1 auto; min-width: 0; }
        .lookup-btn { flex: 0 0 auto; white-space: nowrap; }
        .qty { width: 65px; min-width: 65px; }
        .unit { width: 62px; min-width: 62px; }
        .btn-xs { padding: 4px 7px; font-size: 12px; }
        td { position: relative; vertical-align: middle; }
        .match-ok, .match-warn { font-size: 11px; line-height: 17px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .match-ok { color: #166534; }
        .match-warn { color: #b45309; }
        .defect-inline-suggestions { display: flex; gap: 3px; flex-wrap: wrap; margin-top: 3px; }
        .defect-inline-suggestion { border: 1px solid #93c5fd; background: #eff6ff; color: #1e3a8a; border-radius: 3px; padding: 2px 5px; font-size: 10px; cursor: pointer; text-align: left; }
        .web-meta { color: #475569; font-size: 10px; line-height: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .defect-lookup-panel { border-top: 1px solid #64748b; background: #fff; padding: 8px 10px; }
        .defect-lookup-title { display: flex; align-items: center; justify-content: space-between; font-weight: 700; font-size: 13px; color: #1e3a8a; margin-bottom: 6px; }
        .defect-lookup-title span { color: #64748b; font-size: 11px; font-weight: 400; }
        .defect-lookup-search { display: flex; gap: 6px; margin-bottom: 7px; }
        .defect-lookup-search .input { flex: 1; min-width: 0; min-height: 30px; font-size: 13px; }
        .defect-lookup-options { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 5px; max-height: min(360px, 42vh); overflow: auto; }
        .defect-lookup-option { min-height: 34px; padding: 6px 9px; text-align: left; border: 1px solid #cbd5e1; background: #f8fafc; color: #0f172a; cursor: pointer; font-size: 13px; }
        .defect-lookup-option.is-active { background: #dbeafe; border-color: #2563eb; box-shadow: inset 3px 0 0 #2563eb; }
        .defect-lookup-option:hover { background: #dbeafe; border-color: #60a5fa; }
        .defect-lookup-empty { padding: 10px; color: #b45309; background: #fffbeb; border: 1px solid #fde68a; }
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
