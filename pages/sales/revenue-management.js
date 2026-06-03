import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../lib/useApi';
import { BASE_CUSTOMERS, COMPARE_WEEKS } from '../../lib/salesRevenueConfig';

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

// 비교표 초기 골격: 저장 데이터가 없어도 기본 업체 전체 행을 보여준다.
function scaffoldCustomers() {
  return BASE_CUSTOMERS.map(name => ({
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
  const [fetchYear, setFetchYear] = useState(String(currentYear));
  const [week, setWeek] = useState('24');
  const [dateFrom, setDateFrom] = useState(firstDayOfMonth);
  const [dateTo, setDateTo] = useState(today);
  const [years, setYears] = useState({
    y1: String(currentYear - 2),
    y2: String(currentYear - 1),
    y3: String(currentYear),
  });

  const [customers, setCustomers] = useState(scaffoldCustomers);
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

  // 저장된 Batch 기반 요약 로드 (이카운트 API 호출 없음)
  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiGet('/api/sales/revenue-summary', { channel, year: fetchYear, week });
      setCustomers(d.summary?.customers?.length ? d.summary.customers : scaffoldCustomers());
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

  // ECOUNT 판매현황 엑셀 업로드 → 자동 매칭 → 비교표 반영
  const uploadExcel = async (selected) => {
    const f = selected || file;
    if (!f) { setFetchMsg('먼저 ECOUNT 판매현황 엑셀 파일을 선택하세요.'); return; }
    if (!fetchYear || !week) { setFetchMsg('조회연도와 차수를 입력하세요.'); return; }
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
      if (d.summary) {
        setCustomers(d.summary.customers?.length ? d.summary.customers : scaffoldCustomers());
        setTotals(d.summary.totals || null);
        if (d.summary.weeks?.length) setWeeks(d.summary.weeks);
      }
      if (d.batch) setCurrentBatch(d.batch);
      setFetchMsg(d.message || '업로드 완료');
    } catch (e) {
      setFetchMsg(`업로드 오류: ${e.message}`);
    } finally {
      setFetching(false);
    }
  };

  // 매칭된 비교 결과를 엑셀로 다운로드 (쿠키 인증 → 같은 출처 새 탭)
  const downloadExport = () => {
    const qs = new URLSearchParams({ channel, y1: years.y1, y2: years.y2, y3: years.y3 }).toString();
    window.open(`/api/sales/revenue-export?${qs}`, '_blank');
  };

  const compareRows = useMemo(() => customers, [customers]);

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
        setCustomers(d.summary.customers?.length ? d.summary.customers : scaffoldCustomers());
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
          <option value="전체">전체</option>
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
        />
        <span className="filter-label">차</span>
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
          <button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={fetching}>
            {fetching ? '처리중...' : '이카운트 판매현황 엑셀 업로드'}
          </button>
          <button className="btn" onClick={downloadExport}>매칭결과 엑셀 다운로드</button>
          <button className="btn" onClick={loadSummary} disabled={loading}>저장본 새로고침</button>
        </div>
      </div>

      <div className="banner-warn" style={{ marginBottom: 6 }}>
        이카운트 OAPI에는 판매현황 조회 API가 없어, <b>이카운트 판매현황 화면에서 받은 엑셀을 업로드</b>하면 네노바웹 비교용 저장소에 보관·매칭합니다. 이카운트 원본에 쓰기/전송(push)은 하지 않습니다.
        업로드 시 선택한 <b>조회연도/차수/지점</b> 기준으로 저장되고, 같은 키로 다시 업로드하면 갱신됩니다.
        표는 업체 전체 행을 먼저 깔고 저장 데이터가 있는 업체만 금액을 채웁니다. 저장한 업체명 매칭은 다음 업로드부터 계속 자동 적용됩니다. 매칭 결과는 <b>매칭결과 엑셀 다운로드</b>로 내보낼 수 있습니다.
      </div>
      {fetchMsg && <div className={fetchMsg.includes('오류') || fetchMsg.includes('실패') ? 'banner-err' : 'banner-ok'} style={{ marginBottom: 6 }}>{fetchMsg}</div>}
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
              <button className="btn btn-primary" onClick={saveMapping} disabled={saving || !selectedSource} style={{ marginTop: 8 }}>
                {saving ? '저장중...' : '이 매칭 확정 저장'}
              </button>
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
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th rowSpan="2">업체 통용명</th>
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
                  <td className="name">{row.canonicalName}</td>
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
