import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost, apiDelete } from '../../lib/useApi';
import { COMPARE_WEEKS, baseCustomersForChannel } from '../../lib/salesRevenueConfig';
import RevenueMappingModal from '../../components/sales/RevenueMappingModal';

const fmt = n => Number(n || 0).toLocaleString();

function firstDayOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function growth(current, previous) {
  if (!previous) return current ? '신규' : '';
  return `${(((current - previous) / previous) * 100).toFixed(1)}%`;
}

// summary.customers 행에서 (차수, 연도)의 합계 금액
function cellTotal(row, week, year) {
  return row?.weeks?.[week]?.[year]?.total || 0;
}

// 비교표 초기 골격: 저장 데이터가 없어도 기본 업체 전체 행을 보여준다. (채널별 base)
function scaffoldCustomers(channel = '양재동') {
  return baseCustomersForChannel(channel).map(name => ({
    canonicalName: name,
    isBase: true,
    weeks: {},
    sourceNames: [],
    status: '',
  }));
}

export default function SalesRevenueManagement() {
  const currentYear = new Date().getFullYear();
  const [channel, setChannel] = useState('양재동');
  const [managers, setManagers] = useState([]);   // 담당자 목록
  const [selMgr, setSelMgr] = useState('');        // 담당자 필터('' = 전체)
  const [fetchYear, setFetchYear] = useState(String(currentYear));
  const [week, setWeek] = useState('24');
  const [dateFrom, setDateFrom] = useState(firstDayOfMonth);
  const [dateTo, setDateTo] = useState(today);
  const [years, setYears] = useState({
    y1: String(currentYear - 2),
    y2: String(currentYear - 1),
    y3: String(currentYear),
  });

  const [customers, setCustomers] = useState(() => scaffoldCustomers('양재동'));
  const [totals, setTotals] = useState(null);
  const [currentBatch, setCurrentBatch] = useState({ meta: null, raw: [], review: [], totals: null });

  const [mappings, setMappings] = useState({});
  const [mappingErr, setMappingErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);

  const [selectedSource, setSelectedSource] = useState(null);
  const [custSearch, setCustSearch] = useState('');
  const [custResults, setCustResults] = useState([]);
  const [selectedCust, setSelectedCust] = useState(null);
  const [canonicalInput, setCanonicalInput] = useState('');
  const [msg, setMsg] = useState('');
  const [fetchMsg, setFetchMsg] = useState('');
  const searchTimer = useRef(null);
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [weeks, setWeeks] = useState(COMPARE_WEEKS);
  const [editing, setEditing] = useState(null); // { canonical, week, year }
  const [editVal, setEditVal] = useState('');
  const savedRef = useRef(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRows, setHistoryRows] = useState([]);
  const [pending, setPending] = useState(null);          // 업로드 미리보기(저장 전)
  const [dlMgr, setDlMgr] = useState('');                 // 다운로드 담당자('' = 전체)
  const [batchHistOpen, setBatchHistOpen] = useState(false);
  const [batchHist, setBatchHist] = useState([]);
  const [mappingListOpen, setMappingListOpen] = useState(false);

  // 차수별 비교표: 상단 가로 스크롤바 + 본문 스크롤 동기화
  const cmpTopRef = useRef(null);
  const cmpBodyRef = useRef(null);
  const cmpTblRef = useRef(null);
  const [cmpScrollW, setCmpScrollW] = useState(0);
  const syncFromTop = () => { if (cmpBodyRef.current && cmpTopRef.current) cmpBodyRef.current.scrollLeft = cmpTopRef.current.scrollLeft; };
  const syncFromBody = () => { if (cmpBodyRef.current && cmpTopRef.current) cmpTopRef.current.scrollLeft = cmpBodyRef.current.scrollLeft; };

  // 저장된 Batch 기반 요약 로드 (이카운트 API 호출 없음)
  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiGet('/api/sales/revenue-summary', { channel, year: fetchYear, week });
      setCustomers(d.summary?.customers?.length ? d.summary.customers : scaffoldCustomers(channel));
      setManagers(d.summary?.managers || []);
      setTotals(d.summary?.totals || null);
      if (d.summary?.weeks?.length) setWeeks(d.summary.weeks);
      setCurrentBatch(d.currentBatch || { meta: null, raw: [], review: [], totals: null });
    } catch (e) {
      setMappingErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [channel, fetchYear, week]);

  // 최초/조건 변경 시: 매핑 + 저장 요약만 로드 (이카운트 호출 금지)
  useEffect(() => {
    apiGet('/api/sales/revenue-customer-mappings')
      .then(d => setMappings(d.mappings || {}))
      .catch(e => setMappingErr(e.message));
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // 네노바 거래처 검색
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!custSearch.trim()) {
      setCustResults([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      apiGet('/api/customers/search', { q: custSearch })
        .then(d => setCustResults(d.customers || []))
        .catch(() => setCustResults([]));
    }, 250);
    return () => clearTimeout(searchTimer.current);
  }, [custSearch]);

  // ECOUNT 판매현황 엑셀 업로드 → 미리보기만(저장 X). 저장은 saveUpload 로 커밋.
  const uploadExcel = async (selected) => {
    const f = selected || file;
    if (!f) { setFetchMsg('먼저 ECOUNT 판매현황 엑셀 파일을 선택하세요.'); return; }
    setFetching(true);
    setFetchMsg('');
    try {
      const form = new FormData();
      form.append('file', f);
      form.append('salesYear', fetchYear);
      form.append('orderWeek', week);
      form.append('channel', channel);
      const res = await fetch('/api/sales/revenue-import-excel', { method: 'POST', credentials: 'include', body: form });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '업로드 실패');
      // 미리보기 — 아직 저장 안 됨
      setPending(d.pending ? { meta: d.pending.meta, rows: d.pending.rows, detected: d.detected, rawCount: d.rawCount, rawTotal: d.rawTotal, fileName: d.fileName } : null);
      if (d.batch) setCurrentBatch(d.batch);
      if (d.detected?.year) setFetchYear(d.detected.year);
      if (d.detected?.week) setWeek(d.detected.week);
      setFetchMsg(d.message || '미리보기 완료 — "저장"을 누르세요.');
    } catch (e) {
      setFetchMsg(`업로드 오류: ${e.message}`);
    } finally {
      setFetching(false);
    }
  };

  // 미리보기 → 실제 저장(커밋) + 이력
  const saveUpload = async () => {
    if (!pending?.meta || !pending?.rows?.length) { setFetchMsg('저장할 미리보기가 없습니다.'); return; }
    setSaving(true);
    setFetchMsg('');
    try {
      const d = await apiPost('/api/sales/revenue-save', { meta: pending.meta, rows: pending.rows });
      if (!d.success) throw new Error(d.error || '저장 실패');
      if (d.summary) {
        setCustomers(d.summary.customers?.length ? d.summary.customers : scaffoldCustomers(channel));
        setManagers(d.summary.managers || []);
        setTotals(d.summary.totals || null);
        if (d.summary.weeks?.length) setWeeks(d.summary.weeks);
      }
      if (d.batch) setCurrentBatch(d.batch);
      setPending(null);
      setFetchMsg(d.message || '저장 완료');
    } catch (e) {
      setFetchMsg(`저장 오류: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const cancelPending = () => { setPending(null); setCurrentBatch({ meta: null, raw: [], review: [], totals: null }); setFetchMsg('미리보기를 취소했습니다.'); };

  // 업로드 저장 이력 + 롤백
  const openBatchHist = async () => {
    setBatchHistOpen(true);
    try { const d = await apiGet('/api/sales/revenue-batch-history'); setBatchHist(d.history || []); }
    catch { setBatchHist([]); }
  };
  const rollbackBatch = async (id) => {
    if (!window.confirm('이 저장을 롤백할까요?\n저장 직전 상태로 되돌립니다(신규 저장이면 삭제).')) return;
    try {
      const d = await apiDelete('/api/sales/revenue-batch-history', { id });
      if (!d.success) throw new Error(d.error || '롤백 실패');
      const h = await apiGet('/api/sales/revenue-batch-history'); setBatchHist(h.history || []);
      loadSummary();
      setFetchMsg(d.message || '롤백 완료');
    } catch (e) { alert(`롤백 실패: ${e.message}`); }
  };

  // 매칭된 비교 결과를 엑셀로 다운로드 (쿠키 인증 → 같은 출처 새 탭). 담당자 선택 시 그 담당자만.
  const downloadExport = () => {
    const params = { channel, y1: years.y1, y2: years.y2, y3: years.y3 };
    if (dlMgr) params.manager = dlMgr;
    const qs = new URLSearchParams(params).toString();
    window.open(`/api/sales/revenue-export?${qs}`, '_blank');
  };

  const compareRows = useMemo(
    () => (selMgr ? customers.filter(c => (c.manager || '미지정') === selMgr) : customers),
    [customers, selMgr]
  );

  // 비교표 가로폭 측정 → 상단 가로 스크롤바 spacer 너비 동기화
  useEffect(() => {
    const measure = () => setCmpScrollW(cmpTblRef.current ? cmpTblRef.current.scrollWidth : 0);
    measure();
    const t = setTimeout(measure, 50); // 폰트/레이아웃 안정 후 재측정
    window.addEventListener('resize', measure);
    return () => { clearTimeout(t); window.removeEventListener('resize', measure); };
  }, [compareRows, weeks, years]);

  const kpi = useMemo(() => {
    const sel = week || '24';
    const acc = { y1: 0, y2: 0, y3: 0 };
    for (const row of customers) {
      acc.y1 += cellTotal(row, sel, years.y1);
      acc.y2 += cellTotal(row, sel, years.y2);
      acc.y3 += cellTotal(row, sel, years.y3);
    }
    return acc;
  }, [customers, week, years]);

  const reviewSources = currentBatch.review || [];

  const selectSource = (source) => {
    setSelectedSource(source);
    setCanonicalInput(source.canonicalName || '');
    setCustSearch(source.canonicalName || source.ecountName || '');
    setSelectedCust(null);
    setMsg('');
  };

  const selectCustomer = (cust) => {
    setSelectedCust(cust);
    setCustSearch(cust.CustName || '');
    setCanonicalInput(prev => prev || cust.CustName || '');
    setCustResults([]);
  };

  const saveMapping = async () => {
    if (!selectedSource) {
      setMsg('먼저 미매칭/후보 업체를 선택하세요.');
      return;
    }
    if (!canonicalInput.trim()) {
      setMsg('통용명을 입력하세요.');
      return;
    }
    setSaving(true);
    setMsg('');
    try {
      const data = await apiPost('/api/sales/revenue-customer-mappings', {
        ecountName: selectedSource.ecountName,
        canonicalName: canonicalInput.trim(),
        custKey: selectedCust?.CustKey || null,
        custName: selectedCust?.CustName || '',
        custArea: selectedCust?.CustArea || '',
      });
      setMappings(prev => ({ ...prev, [data.key]: data.mapping }));
      setSelectedSource(null);
      setSelectedCust(null);
      setCustSearch('');
      setCanonicalInput('');
      setMsg('매칭을 저장했습니다. 저장된 매핑은 이카운트 재조회 없이 즉시·계속 자동 적용됩니다.');
      // 저장 매핑을 반영해 요약/원본 패널 재계산 (이카운트 호출 없음)
      await loadSummary();
    } catch (e) {
      setMsg(`저장 오류: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  // ── 비교표 셀 직접 수정 ─────────────────────────────
  const getCell = (row, w, y) => row?.weeks?.[w]?.[y] || null;

  const startEdit = (canonical, w, y, cur) => {
    savedRef.current = false;
    setEditing({ canonical, week: w, year: y });
    setEditVal(cur ? String(cur) : '');
  };
  const cancelEdit = () => { savedRef.current = true; setEditing(null); setEditVal(''); };

  const saveCell = async (canonical, w, y, prev) => {
    if (savedRef.current) return;       // Enter+blur 중복 방지
    savedRef.current = true;
    setEditing(null);
    const amount = Number(String(editVal).replace(/[^\d.\-]/g, ''));
    if (!Number.isFinite(amount) || amount === Number(prev || 0)) return;
    try {
      const d = await apiPost('/api/sales/revenue-cell', {
        channel, canonicalName: canonical, week: w, year: y, amount, prev: prev ?? '',
      });
      if (d.summary) {
        setCustomers(d.summary.customers?.length ? d.summary.customers : scaffoldCustomers(channel));
        setManagers(d.summary.managers || []);
        setTotals(d.summary.totals || null);
        if (d.summary.weeks?.length) setWeeks(d.summary.weeks);
      }
      setFetchMsg(d.message || '셀을 수정했습니다.');
    } catch (e) {
      setFetchMsg(`셀 수정 오류: ${e.message}`);
    }
  };

  const openHistory = async () => {
    setHistoryOpen(true);
    try {
      const d = await apiGet('/api/sales/revenue-cell');
      setHistoryRows(d.history || []);
    } catch { setHistoryRows([]); }
  };

  const renderAmt = (row, w, y) => {
    const cell = getCell(row, w, y);
    const val = cell?.total || 0;
    const isEd = editing && editing.canonical === row.canonicalName && editing.week === w && editing.year === y;
    if (isEd) {
      return (
        <td style={{ padding: 0 }}>
          <input
            autoFocus
            className="filter-input"
            value={editVal}
            onChange={e => setEditVal(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') saveCell(row.canonicalName, w, y, val);
              else if (e.key === 'Escape') cancelEdit();
            }}
            onBlur={() => saveCell(row.canonicalName, w, y, val)}
            style={{ width: '100%', textAlign: 'right', boxSizing: 'border-box' }}
          />
        </td>
      );
    }
    const st = { textAlign: 'right', fontFamily: 'var(--mono)', cursor: 'pointer' };
    let title = '클릭하여 수정';
    if (cell?.source === 'manual') { st.fontWeight = 'bold'; st.background = '#FFF6DA'; title = `수동수정: ${cell.updatedBy || ''} ${(cell.updatedAt || '').slice(0, 16).replace('T', ' ')}`; }
    else if (cell?.source === 'ecount') { st.color = '#0A7A55'; title = 'ECOUNT 업로드'; }
    else if (cell?.source === 'history') { title = '과거 데이터(매출비교.xlsx)'; }
    if (cell?.conflict) st.background = '#FDE2E2';
    return (
      <td style={st} title={title} onClick={() => startEdit(row.canonicalName, w, y, val)}>
        {val ? fmt(val) : ''}
      </td>
    );
  };

  return (
    <div>
      <div className="filter-bar" style={{ flexWrap: 'wrap', gap: 6 }}>
        <span className="filter-label">지점</span>
        <select className="filter-select" value={channel} onChange={e => setChannel(e.target.value)}>
          <option value="양재동">양재동</option>
          <option value="지방">지방</option>
          <option value="전체">전체</option>
        </select>
        <span className="filter-label">담당자</span>
        <select className="filter-select" value={selMgr} onChange={e => setSelMgr(e.target.value)}>
          <option value="">전체</option>
          {managers.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <span className="filter-label">조회연도</span>
        <input
          className="filter-input"
          value={fetchYear}
          onChange={e => setFetchYear(e.target.value.replace(/[^\d]/g, '').slice(0, 4))}
          style={{ width: 58, textAlign: 'center' }}
        />
        <span className="filter-label">차수</span>
        <input
          className="filter-input"
          value={week}
          onChange={e => setWeek(e.target.value.replace(/[^\d]/g, '').slice(0, 2))}
          style={{ width: 46, textAlign: 'center' }}
          title="비교표 조회용. 업로드 시 차수는 파일 기간으로 자동 판정됩니다."
        />
        <span className="filter-label">차 <span style={{ color: 'var(--text3)', fontWeight: 400 }}>(업로드는 파일 기간으로 자동)</span></span>
        <span className="filter-label">기간</span>
        <input className="filter-input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <span style={{ color: 'var(--text3)' }}>~</span>
        <input className="filter-input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        <span className="filter-label">비교연도</span>
        {['y1', 'y2', 'y3'].map(key => (
          <input
            key={key}
            className="filter-input"
            value={years[key]}
            onChange={e => setYears(prev => ({ ...prev, [key]: e.target.value.replace(/[^\d]/g, '').slice(0, 4) }))}
            style={{ width: 58, textAlign: 'center' }}
          />
        ))}
        <div className="page-actions">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0] || null;
              setFile(f);
              if (f) uploadExcel(f);
            }}
          />
          <button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={fetching || saving}>
            {fetching ? '분석중...' : (pending ? '다른 파일 미리보기' : '이카운트 판매현황 엑셀 업로드')}
          </button>
          {pending && (
            <>
              <button className="btn btn-primary" style={{ background: '#16a34a', borderColor: '#16a34a' }} onClick={saveUpload} disabled={saving}>
                {saving ? '저장중...' : `💾 저장 (${pending.detected?.week}차 ${pending.rawCount}건)`}
              </button>
              <button className="btn" onClick={cancelPending} disabled={saving}>취소</button>
            </>
          )}
          <button className="btn" onClick={openBatchHist}>업로드 이력</button>
          <span className="filter-label" style={{ marginLeft: 8 }}>다운로드</span>
          <select className="filter-select" value={dlMgr} onChange={e => setDlMgr(e.target.value)} title="다운로드 범위 — 전체 또는 특정 담당자">
            <option value="">전체</option>
            {managers.map(m => <option key={m} value={m}>{m} 담당</option>)}
          </select>
          <button className="btn" onClick={downloadExport}>
            매칭결과 엑셀 다운로드{dlMgr ? ` (${dlMgr})` : ''}
          </button>
          <button className="btn" onClick={loadSummary} disabled={loading}>저장본 새로고침</button>
        </div>
      </div>

      <div className="banner-warn" style={{ marginBottom: 6 }}>
        이카운트 OAPI에는 판매현황 조회 API가 없어, <b>이카운트 판매현황 화면에서 받은 엑셀을 업로드</b>하면 네노바웹 비교용 저장소에 보관·매칭합니다. 이카운트 원본에 쓰기/전송(push)은 하지 않습니다.
        업로드하면 <b>파일 상단 조회기간(시작일)으로 연도·차수를 자동 판정</b>해 저장합니다(차수 수동선택 불필요). 지점은 선택값을 사용하고, 같은 (연도/차수/지점)으로 다시 업로드하면 갱신됩니다.
        표는 업체 전체 행을 먼저 깔고 저장 데이터가 있는 업체만 금액을 채웁니다. 저장한 업체명 매칭은 다음 업로드부터 계속 자동 적용됩니다. 매칭 결과는 <b>매칭결과 엑셀 다운로드</b>로 내보낼 수 있습니다.
      </div>
      {fetchMsg && <div className={fetchMsg.includes('오류') || fetchMsg.includes('실패') ? 'banner-err' : 'banner-ok'} style={{ marginBottom: 6 }}>{fetchMsg}</div>}
      {pending && (
        <div style={{ marginBottom: 6, padding: '8px 12px', border: '1px solid #f59e0b', background: '#fffbeb', borderRadius: 6, fontSize: 13, color: '#92400e', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <b>📋 미리보기 (아직 저장 안 됨)</b>
          <span>{pending.detected?.year}년 <b>{pending.detected?.week}차</b> / {pending.meta?.channel} · {fmt(pending.rawCount)}건 · 합계 {fmt(pending.rawTotal)} · {pending.fileName}</span>
          <button className="btn btn-primary" style={{ background: '#16a34a', borderColor: '#16a34a', marginLeft: 'auto' }} onClick={saveUpload} disabled={saving}>{saving ? '저장중...' : '💾 저장'}</button>
          <button className="btn" onClick={cancelPending} disabled={saving}>취소</button>
        </div>
      )}
      {currentBatch.meta && (
        <div className="banner-info" style={{ marginBottom: 6 }}>
          저장 Batch: {currentBatch.meta.salesYear}년 {currentBatch.meta.orderWeek}차 / {currentBatch.meta.channel} · {currentBatch.meta.rawCount}건 · 원본합계 {fmt(currentBatch.meta.rawTotal)} · 조회 {currentBatch.meta.fetchedDtm?.slice(0, 16).replace('T', ' ')} · {currentBatch.meta.fetchedBy || '-'} · endpoint {currentBatch.meta.ecountEndpoint || '-'}
        </div>
      )}
      {mappingErr && <div className="banner-err">로드 오류: {mappingErr}</div>}

      <div className="kpi-grid">
        <div className="kpi-card kpi-accent">
          <div className="kpi-label">{years.y1}년 {week}차 매출</div>
          <div className="kpi-value">{fmt(kpi.y1)}</div>
          <div className="kpi-sub">저장 Batch 기준</div>
        </div>
        <div className="kpi-card kpi-green">
          <div className="kpi-label">{years.y2}년 {week}차 매출</div>
          <div className="kpi-value">{fmt(kpi.y2)}</div>
          <div className="kpi-sub">저장 Batch 기준</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">{years.y3}년 {week}차 매출</div>
          <div className="kpi-value">{fmt(kpi.y3)}</div>
          <div className="kpi-sub">저장 Batch 기준</div>
        </div>
        <div className="kpi-card kpi-amber">
          <div className="kpi-label">미매칭 금액 / 건수</div>
          <div className="kpi-value">{fmt(totals?.unmatchedAmount)}</div>
          <div className="kpi-sub">미매칭 {totals?.unmatchedCount || 0} / 후보 {totals?.candidateCount || 0}건</div>
        </div>
      </div>

      <div style={styles.grid}>
        <section style={styles.panel}>
          <div style={styles.panelHead}>
            <strong>업체명 매칭 설정</strong>
            <span>한 번 저장하면 같은 이카운트 거래처명에 계속 적용</span>
          </div>
          <div style={styles.matchGrid}>
            <div>
              <div style={styles.subHead}>미매칭/후보 원본 거래처</div>
              <div style={styles.sourceList}>
                {reviewSources.length === 0 && (
                  <div style={styles.empty}>
                    {currentBatch.meta
                      ? '확인 필요한 업체가 없습니다.'
                      : '이카운트 API 조회 및 저장을 누르면 원본 거래처가 표시됩니다.'}
                  </div>
                )}
                {reviewSources.map(source => (
                  <button
                    key={source.ecountName}
                    type="button"
                    onClick={() => selectSource(source)}
                    style={{
                      ...styles.sourceButton,
                      borderColor: selectedSource?.ecountName === source.ecountName ? '#1166BB' : '#D0D0D0',
                      background: selectedSource?.ecountName === source.ecountName ? '#E8F0FF' : '#FFF',
                    }}
                  >
                    <b>{source.ecountName}</b>
                    <span>{fmt(source.amount)} / {source.status} / 후보 {source.canonicalName}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={styles.subHead}>검색 후 확정 저장</div>
              <label style={styles.label}>이카운트 거래처명</label>
              <input className="filter-input" value={selectedSource?.ecountName || ''} readOnly style={styles.fullInput} />
              <label style={styles.label}>통용명</label>
              <input
                className="filter-input"
                value={canonicalInput}
                onChange={e => setCanonicalInput(e.target.value)}
                placeholder="예: 미우, 미카엘, 송우"
                style={styles.fullInput}
              />
              <label style={styles.label}>네노바 거래처 검색</label>
              <input
                className="filter-input"
                value={custSearch}
                onChange={e => {
                  setCustSearch(e.target.value);
                  setSelectedCust(null);
                }}
                placeholder="업체명 검색"
                style={styles.fullInput}
              />
              {custResults.length > 0 && (
                <div style={styles.resultBox}>
                  {custResults.map(cust => (
                    <button key={cust.CustKey} type="button" onClick={() => selectCustomer(cust)} style={styles.resultButton}>
                      <b>{cust.CustName}</b>
                      <span>{cust.CustArea || '-'} / {cust.Manager || '-'}</span>
                    </button>
                  ))}
                </div>
              )}
              {selectedCust && (
                <div className="banner-info" style={{ marginTop: 6 }}>
                  선택: {selectedCust.CustName} / {selectedCust.CustArea || '-'}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={saveMapping} disabled={saving || !selectedSource}>
                  {saving ? '저장중...' : '이 매칭 확정 저장'}
                </button>
                <button className="btn" onClick={() => setMappingListOpen(true)}>
                  📋 매칭 내역 보기·수정
                </button>
              </div>
              {msg && <div className={msg.includes('오류') ? 'banner-err' : 'banner-ok'} style={{ marginTop: 8 }}>{msg}</div>}
            </div>
          </div>
        </section>

        <section style={styles.panel}>
          <div style={styles.panelHead}>
            <strong>이카운트 원본 매칭 상태</strong>
            <span>{currentBatch.meta ? `${currentBatch.meta.salesYear}년 ${currentBatch.meta.orderWeek}차 저장 원본` : '저장 원본 없음'}</span>
          </div>
          <div className="table-wrap" style={{ maxHeight: 310 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>원본 거래처명</th>
                  <th>품목명</th>
                  <th>통용명</th>
                  <th>합계</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {(currentBatch.raw || []).length === 0 && (
                  <tr><td colSpan="5" style={styles.empty}>저장된 원본이 없습니다. 이카운트 API 조회 및 저장을 누르세요.</td></tr>
                )}
                {(currentBatch.raw || []).map(row => (
                  <tr key={row.rawKey}>
                    <td>{row.ecountCustName}</td>
                    <td>{row.productName}</td>
                    <td>{row.canonicalName}</td>
                    <td style={styles.num}>{fmt(row.totalAmount)}</td>
                    <td>{row.mappingStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {currentBatch.totals && (
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>
              원본합계 {fmt(currentBatch.totals.rawTotal)} = 매칭 {fmt(currentBatch.totals.matchedAmount)} + 후보 {fmt(currentBatch.totals.candidateAmount)} + 미매칭 {fmt(currentBatch.totals.unmatchedAmount)}
            </div>
          )}
        </section>
      </div>

      <section style={styles.panel}>
        <div style={styles.panelHead}>
          <strong>차수별 매출 비교표</strong>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--text3)' }}>
              셀 클릭=직접수정 ·{' '}
              <span style={{ color: '#0A7A55' }}>ECOUNT</span> /{' '}
              <span style={{ background: '#FFF6DA', padding: '0 3px' }}>수동수정</span> / 과거(매출비교.xlsx)
            </span>
            <button className="btn" onClick={openHistory}>수정 이력</button>
          </span>
        </div>
        {/* 상단 가로 스크롤바 (본문과 동기화) */}
        <div className="cmp-scroll-top" ref={cmpTopRef} onScroll={syncFromTop}>
          <div style={{ width: cmpScrollW || 1, height: 1 }} />
        </div>
        <div className="table-wrap cmp-wrap" ref={cmpBodyRef} onScroll={syncFromBody}>
          <table className="tbl cmp-tbl" ref={cmpTblRef}>
            <thead>
              <tr>
                <th rowSpan="2" className="cmp-stick-col">업체 통용명</th>
                {weeks.map(w => <th key={w} colSpan="4" style={{ textAlign: 'center' }}>{w}차</th>)}
                <th rowSpan="2">원본 거래처명</th>
                <th rowSpan="2">매칭상태</th>
              </tr>
              <tr>
                {weeks.map(w => (
                  <FragmentHeaders key={w} years={years} />
                ))}
              </tr>
            </thead>
            <tbody>
              {compareRows.map(row => (
                <tr key={row.canonicalName}>
                  <td className="name cmp-stick-col">
                    {row.canonicalName}
                    {row.manager && row.manager !== '미지정' && (
                      <span style={{ marginLeft: 6, fontSize: 10, color: '#6b7280', fontWeight: 600 }}>· {row.manager}</span>
                    )}
                  </td>
                  {weeks.map(w => (
                    <Fragment key={w}>
                      {renderAmt(row, w, years.y1)}
                      {renderAmt(row, w, years.y2)}
                      {renderAmt(row, w, years.y3)}
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>
                        {growth(getCell(row, w, years.y3)?.total || 0, getCell(row, w, years.y2)?.total || 0)}
                      </td>
                    </Fragment>
                  ))}
                  <td>{(row.sourceNames || []).join(', ')}</td>
                  <td>{row.status || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <style jsx global>{`
        /* 영업매출 비교표 — 상단 가로 스크롤바 + 첫 열/차수 헤더 고정 */
        .cmp-scroll-top { overflow-x: auto; overflow-y: hidden; border: 1px solid var(--border2); border-bottom: none; }
        .cmp-wrap { max-height: 72vh; overflow: auto; }
        /* 차수 헤더 행: 전역 .tbl thead 가 이미 sticky top, 가로 스크롤 시 배경 유지 */
        .cmp-tbl thead th { background: var(--header-bg); }
        /* 업체 통용명(첫 열) 좌측 고정 */
        .cmp-tbl .cmp-stick-col { position: sticky; left: 0; border-right: 2px solid var(--border); }
        .cmp-tbl tbody td.cmp-stick-col { z-index: 1; background: #fff; }
        .cmp-tbl tbody tr:nth-child(even) td.cmp-stick-col { background: var(--row-alt); }
        .cmp-tbl tbody tr:hover td.cmp-stick-col { background: #E8F0FF; }
        /* 좌상단 코너(헤더 첫 열): top+left 둘 다 고정, 최상위 */
        .cmp-tbl thead th.cmp-stick-col { z-index: 4; }
      `}</style>

      <RevenueMappingModal
        open={mappingListOpen}
        onClose={() => setMappingListOpen(false)}
        onChanged={() => loadSummary()}
      />

      {historyOpen && (
        <div style={styles.modalBack} onClick={() => setHistoryOpen(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <div style={styles.panelHead}>
              <strong>매출 수정 이력</strong>
              <button className="btn" onClick={() => setHistoryOpen(false)}>닫기</button>
            </div>
            <div className="table-wrap" style={{ maxHeight: 420 }}>
              <table className="tbl">
                <thead>
                  <tr><th>일시</th><th>업체</th><th>차수</th><th>연도</th><th>이전</th><th>변경</th><th>수정자</th></tr>
                </thead>
                <tbody>
                  {historyRows.length === 0 && <tr><td colSpan="7" style={styles.empty}>수정 이력이 없습니다.</td></tr>}
                  {historyRows.map((h, i) => (
                    <tr key={i}>
                      <td>{(h.at || '').slice(0, 16).replace('T', ' ')}</td>
                      <td>{h.canonicalName}</td>
                      <td>{h.week}차</td>
                      <td>{h.year}</td>
                      <td style={styles.num}>{h.prev == null ? '' : fmt(h.prev)}</td>
                      <td style={styles.num}>{fmt(h.next)}</td>
                      <td>{h.by || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {batchHistOpen && (
        <div style={styles.modalBack} onMouseDown={e => { if (e.target === e.currentTarget) setBatchHistOpen(false); }}>
          <div style={styles.modal} onMouseDown={e => e.stopPropagation()}>
            <div style={styles.panelHead}>
              <strong>업로드 저장 이력 — 롤백 가능</strong>
              <button className="btn" onClick={() => setBatchHistOpen(false)}>닫기</button>
            </div>
            <div className="table-wrap" style={{ maxHeight: 440 }}>
              <table className="tbl">
                <thead>
                  <tr><th>저장일시</th><th>지점</th><th>차수</th><th>연도</th><th>파일</th><th>건수</th><th>합계</th><th>직전</th><th>저장자</th><th></th></tr>
                </thead>
                <tbody>
                  {batchHist.length === 0 && <tr><td colSpan="10" style={styles.empty}>저장 이력이 없습니다.</td></tr>}
                  {batchHist.map(h => (
                    <tr key={h.id}>
                      <td>{(h.ts || '').slice(0, 16).replace('T', ' ')}</td>
                      <td>{h.channel}</td>
                      <td>{h.orderWeek}차</td>
                      <td>{h.salesYear}</td>
                      <td title={h.fileName} style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.fileName || '-'}</td>
                      <td style={styles.num}>{fmt(h.rawCount)}</td>
                      <td style={styles.num}>{fmt(h.rawTotal)}</td>
                      <td style={styles.num}>{h.action === 'replace' ? `교체(이전 ${fmt(h.prevRawTotal)})` : '신규'}</td>
                      <td>{h.by || '-'}</td>
                      <td><button className="btn" style={{ color: '#c0392b', borderColor: '#f3b7b1' }} onClick={() => rollbackBatch(h.id)}>롤백</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text3)' }}>
              롤백 = 그 저장 직전 상태로 되돌립니다(신규 저장이면 해당 차수 저장본 삭제). 항목은 이력에서 제거됩니다.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FragmentHeaders({ years }) {
  return (
    <>
      <th>{years.y1}</th>
      <th>{years.y2}</th>
      <th>{years.y3}</th>
      <th>성장률</th>
    </>
  );
}

function Cells({ y1, y2, y3 }) {
  const valueStyle = { textAlign: 'right', fontFamily: 'var(--mono)' };
  return (
    <>
      <td style={valueStyle}>{y1 ? fmt(y1) : ''}</td>
      <td style={valueStyle}>{y2 ? fmt(y2) : ''}</td>
      <td style={valueStyle}>{y3 ? fmt(y3) : ''}</td>
      <td style={valueStyle}>{growth(y3, y2)}</td>
    </>
  );
}

const styles = {
  grid: {
    display: 'grid',
    gridTemplateColumns: '1.15fr 0.85fr',
    gap: 6,
    marginBottom: 6,
  },
  panel: {
    background: 'var(--surface)',
    border: '1px solid var(--border2)',
    padding: 8,
  },
  panelHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderBottom: '1px solid var(--border)',
    paddingBottom: 6,
    marginBottom: 8,
    fontSize: 12,
    color: 'var(--text1)',
  },
  matchGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
  },
  subHead: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  sourceList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    maxHeight: 260,
    overflow: 'auto',
  },
  sourceButton: {
    border: '1px solid #D0D0D0',
    padding: '6px 8px',
    textAlign: 'left',
    cursor: 'pointer',
    fontSize: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  label: {
    display: 'block',
    fontSize: 11,
    color: 'var(--text3)',
    margin: '6px 0 3px',
  },
  fullInput: {
    width: '100%',
    boxSizing: 'border-box',
  },
  resultBox: {
    border: '1px solid var(--border2)',
    marginTop: 4,
    maxHeight: 120,
    overflow: 'auto',
    background: '#FFF',
  },
  resultButton: {
    width: '100%',
    border: 0,
    borderBottom: '1px solid #EEE',
    background: '#FFF',
    padding: '5px 6px',
    textAlign: 'left',
    cursor: 'pointer',
    fontSize: 12,
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
  },
  empty: {
    fontSize: 12,
    color: 'var(--text3)',
    padding: 8,
    border: '1px solid var(--border)',
  },
  num: {
    textAlign: 'right',
    fontFamily: 'var(--mono)',
  },
  modalBack: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: 'var(--surface, #FFF)',
    border: '1px solid var(--border2)',
    padding: 10,
    width: 'min(760px, 92vw)',
    maxHeight: '80vh',
    overflow: 'auto',
  },
};
