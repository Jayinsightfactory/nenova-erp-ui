import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import seedMapping from '../../data/china-hf-codes.json';
import { apiGet } from '../../lib/useApi';
import { buildChinaOrderReport, selectChinaOrderSubweek } from '../../lib/chinaOrderDownload';
import { normalizeHfMapping, parseChinaHfWorkbook, matchChinaHfCode } from '../../lib/chinaHfCodes';
import { buildChinaOrderWorkbook } from '../../lib/chinaOrderWorkbook';
import { buildChinaOrderCustomerMatrix } from '../../lib/chinaOrderCustomerMatrix';

const STORAGE_PREFIX = 'nenova.china-order-download.hf.v1:';
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function cycleValue(cycle) {
  return `${cycle.year}:${cycle.majorWeek}`;
}

function cycleLabel(cycle) {
  if (!cycle) return '';
  return `${cycle.year}년 ${cycle.majorWeek}차 (${cycle.startDate} ~ ${cycle.endDate})`;
}

function quantity(value) {
  const number = Number(value || 0);
  return number.toLocaleString('ko-KR', { maximumFractionDigits: 3 });
}

function mappingRows(mapping) {
  return Array.isArray(mapping?.rows) ? mapping.rows : [];
}

function statusName(status) {
  return ({ matched: '일치', review: '검토', missing: '미매칭', conflict: '충돌' })[status] || '미매칭';
}

export default function ChinaOrderDownloadPage() {
  const [userId, setUserId] = useState('');
  const [authReady, setAuthReady] = useState(false);
  const [center, setCenter] = useState(null);
  const [availableCycles, setAvailableCycles] = useState([]);
  const [report, setReport] = useState(null);
  const [selectedColumnKey, setSelectedColumnKey] = useState('');
  const [mapping, setMapping] = useState(null);
  const [mappingFileName, setMappingFileName] = useState(seedMapping.sourceFile || '기본 HF 사전');
  const [mappingWarning, setMappingWarning] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const requestId = useRef(0);
  const uploadId = useRef(0);
  const downloadId = useRef(0);
  const fileRef = useRef(null);

  const storageKey = userId ? `${STORAGE_PREFIX}${encodeURIComponent(userId)}` : '';
  const seed = useMemo(() => normalizeHfMapping(seedMapping), []);

  const loadReport = useCallback(async (selected = null) => {
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    setActionError('');
    setNotice('');
    setReport(null);
    setSelectedColumnKey('');
    try {
      // 기본 업무차수는 서버의 실제 PeriodDay 달력으로 결정한다. 명시 이동에만 둘 다 보낸다.
      const params = selected ? { year: selected.year, majorWeek: selected.majorWeek } : {};
      const result = await apiGet('/api/stats/china-order-download', params);
      if (id !== requestId.current) return;
      if (!result?.success || result.readOnly !== true) throw new Error(result?.error || '읽기 전용 주문 현황 응답을 확인할 수 없습니다.');
      if (!result.scope || !Array.isArray(result.cycles) || !Array.isArray(result.availableCycles) || !Array.isArray(result.orders)) {
        throw new Error('주문 현황 응답 형식이 올바르지 않습니다.');
      }
      if (selected && (Number(result.scope.year) !== Number(selected.year)
        || String(result.scope.majorWeek).padStart(2, '0') !== String(selected.majorWeek).padStart(2, '0'))) {
        throw new Error('요청한 중심 차수와 조회 결과가 다릅니다. 결과를 내보내지 않았습니다.');
      }
      const nextCenter = { year: result.scope.year, majorWeek: result.scope.majorWeek };
      const reportModel = buildChinaOrderReport(result);
      const defaultSubweek = reportModel.columns.find(column => !column.empty && column.offset === 0)
        || reportModel.columns.filter(column => !column.empty).sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset))[0];
      setCenter(nextCenter);
      setAvailableCycles(result.availableCycles);
      setReport({ ...result, ...reportModel });
      setSelectedColumnKey(defaultSubweek?.key || '');
      if (result.warnings?.length) setNotice(result.warnings.join(' · '));
    } catch (loadError) {
      if (id === requestId.current) {
        setCenter(selected);
        setError(loadError.message || '중국 주문 현황 조회에 실패했습니다.');
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function authenticateAndLoad() {
      try {
        const result = await apiGet('/api/auth/me');
        if (!active) return;
        const id = String(result?.user?.userId || '').trim();
        if (!id) throw new Error('로그인 사용자 정보를 확인할 수 없습니다.');
        setUserId(id);
        let saved = null;
        let nextMapping = normalizeHfMapping(seedMapping);
        let nextMappingFileName = seedMapping.sourceFile || '기본 HF 사전';
        try {
          const raw = localStorage.getItem(`${STORAGE_PREFIX}${encodeURIComponent(id)}`);
          if (raw) {
            saved = JSON.parse(raw);
            nextMapping = normalizeHfMapping(saved.mapping || saved);
            if (saved.sourceFile) nextMappingFileName = saved.sourceFile;
          }
        } catch {
          setMappingWarning('저장된 HF 사전을 읽거나 검증하지 못해 기본 사전을 사용합니다.');
          nextMapping = normalizeHfMapping(seedMapping);
          nextMappingFileName = seedMapping.sourceFile || '기본 HF 사전';
        }
        if (!active) return;
        setMapping(nextMapping);
        setMappingFileName(nextMappingFileName);
        setAuthReady(true);
        await loadReport();
      } catch (authFailure) {
        if (active) {
          setAuthError(authFailure.message || '사용자 인증 정보를 불러오지 못했습니다.');
          setAuthReady(true);
        }
      }
    }
    authenticateAndLoad();
    return () => {
      active = false;
      requestId.current += 1;
      uploadId.current += 1;
      downloadId.current += 1;
    };
  }, [loadReport]);

  const actualColumns = useMemo(() => (report?.columns || []).filter(column => !column.empty), [report]);
  const selectedColumn = actualColumns.find(column => column.key === selectedColumnKey) || null;
  const selectedReport = useMemo(() => {
    if (!report || !selectedColumn) return null;
    return selectChinaOrderSubweek(report, selectedColumn.key);
  }, [report, selectedColumn]);

  const annotatedRows = useMemo(() => {
    if (!selectedReport || !mapping) return [];
    const token = query.trim().toLocaleLowerCase('ko-KR');
    return selectedReport.customerRows.map(row => ({ ...row, hf: matchChinaHfCode(row, mapping, report.products || []) }))
      .filter(row => !token || `${row.custName || ''} ${row.custOrderCode || ''} ${row.prodCode || ''} ${row.prodName || ''} ${row.hf?.hfCode || ''} ${row.unit || ''}`.toLocaleLowerCase('ko-KR').includes(token))
      .filter(row => statusFilter === 'all' || row.hf.status === statusFilter);
  }, [selectedReport, report, mapping, query, statusFilter]);

  const visibleReport = useMemo(() => {
    if (!report || !selectedColumn) return null;
    return selectChinaOrderSubweek(report, selectedColumn.key, new Set(annotatedRows.map(row => row.rowKey)));
  }, [report, selectedColumn, annotatedRows]);

  const customerMatrix = useMemo(() => {
    if (!visibleReport || !mapping) return null;
    const matrix = buildChinaOrderCustomerMatrix(visibleReport);
    return { ...matrix, rows: matrix.rows.map(row => ({ ...row, hf: matchChinaHfCode(row, mapping, report.products || []) })) };
  }, [visibleReport, mapping, report]);

  async function persistMapping(nextMapping, sourceFile, message) {
    setMapping(nextMapping);
    setMappingFileName(sourceFile);
    setMappingWarning('');
    setNotice(message);
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ mapping: nextMapping, sourceFile }));
    } catch {
      setMappingWarning('브라우저 저장 공간이 부족해 이번 화면에서만 적용했습니다. 새로고침하면 유지되지 않습니다.');
      setNotice('HF 사전은 현재 화면에 적용됐지만 브라우저 저장은 되지 않았습니다.');
    }
  }

  async function uploadMapping(file) {
    const id = ++uploadId.current;
    if (!file) return;
    setNotice('');
    setActionError('');
    if (file.size > MAX_UPLOAD_BYTES) {
      setActionError('HF 엑셀은 5MiB 이하 파일만 업로드할 수 있습니다. 기존 사전은 그대로 유지했습니다.');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setUploading(true);
    try {
      const parsed = await parseChinaHfWorkbook(await file.arrayBuffer(), file.name);
      if (id !== uploadId.current) return;
      const next = normalizeHfMapping(parsed);
      await persistMapping(next, file.name, `HF 사전 적용: ${file.name} · 브라우저의 ${userId} 사용자 전용`);
    } catch (uploadError) {
      if (id === uploadId.current) setActionError(`${uploadError.message || 'HF 엑셀을 읽지 못했습니다.'} 기존 사전은 그대로 유지했습니다.`);
    } finally {
      if (id === uploadId.current) setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function restoreSeed() {
    const id = ++uploadId.current;
    setUploading(true);
    setActionError('');
    try {
      const next = normalizeHfMapping(seedMapping);
      if (id === uploadId.current) await persistMapping(next, seedMapping.sourceFile || '기본 HF 사전', '기본 HF 사전을 복원했습니다.');
    } finally {
      if (id === uploadId.current) setUploading(false);
    }
  }

  function moveCenter(delta) {
    if (!center || !availableCycles.length || loading) return;
    const index = availableCycles.findIndex(cycle => cycle.year === center.year && cycle.majorWeek === center.majorWeek);
    const next = availableCycles[index + delta];
    if (next) loadReport(next);
  }

  async function download() {
    if (!visibleReport || !selectedColumn || !visibleReport.rows.length || !isReportCurrent || loading || uploading || downloading) return;
    const id = ++downloadId.current;
    setDownloading(true);
    setActionError('');
    try {
      const workbook = await buildChinaOrderWorkbook(visibleReport, mapping);
      if (id !== downloadId.current) return;
      const bytes = await workbook.xlsx.writeBuffer();
      if (id !== downloadId.current) return;
      const url = URL.createObjectURL(new Blob([bytes], { type: XLSX_MIME }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `중국_발주현황_${selectedColumn.year}-${selectedColumn.orderWeek}.xlsx`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (downloadError) {
      if (id === downloadId.current) setActionError(downloadError.message || '엑셀 다운로드를 만들지 못했습니다.');
    } finally {
      if (id === downloadId.current) setDownloading(false);
    }
  }

  const years = [...new Set(availableCycles.map(cycle => cycle.year))].sort((a, b) => a - b);
  const centerOptions = availableCycles.filter(cycle => !center || cycle.year === center.year);
  const matchedCount = mappingRows(mapping).filter(row => String(row.hfCode || '').trim()).length;
  const busy = loading || uploading || downloading || !authReady;
  const reportCenter = report?.cycles?.[3] || null;
  const isReportCurrent = Boolean(report && center
    && Number(report.scope.year) === Number(center.year)
    && String(report.scope.majorWeek).padStart(2, '0') === String(center.majorWeek).padStart(2, '0'));

  return <>
    <Head><title>중국 발주 현황 다운로드 - Nenova</title></Head>
    <main className="china-order-page">
      <header className="hero">
        <div><div className="eyebrow">READ-ONLY · CHINA ORDER REGISTER</div><h1>중국 발주 현황</h1><p>주문등록 수량 기준 · 실제 전산 차수 달력 · HF CODE 브라우저 사전</p></div>
        <div className="hero-badge"><span className="live-dot" />ERP 조회 전용 <i>주문·출고·재고 변경 없음</i></div>
      </header>

      <section className="control-panel" aria-label="조회 및 파일 작업">
        <div className="cycle-controls">
          <label>연도<select aria-label="연도" value={center?.year ?? ''} disabled={busy || !years.length} onChange={event => {
            const year = Number(event.target.value);
            const first = availableCycles.find(cycle => cycle.year === year);
            if (first) setCenter({ year, majorWeek: first.majorWeek });
          }}>{years.map(year => <option key={year} value={year}>{year}년</option>)}</select></label>
          <label>중심 대차수<select aria-label="중심 대차수" value={center ? cycleValue(center) : ''} disabled={busy || !centerOptions.length} onChange={event => {
            const chosen = availableCycles.find(cycle => cycleValue(cycle) === event.target.value);
            if (chosen) setCenter({ year: chosen.year, majorWeek: chosen.majorWeek });
          }}>{centerOptions.map(cycle => <option key={cycle.key} value={cycleValue(cycle)}>{cycle.majorWeek}차 · {cycle.startDate}</option>)}</select></label>
          <button className="step" type="button" aria-label="이전 실제 차수" disabled={busy} onClick={() => moveCenter(-1)}>‹</button>
          <button className="step" type="button" aria-label="다음 실제 차수" disabled={busy} onClick={() => moveCenter(1)}>›</button>
          <button className="primary" type="button" disabled={busy || !center} onClick={() => loadReport(center)}>{loading ? '조회 중…' : '조회'}</button>
          <label>세부차수<select aria-label="세부차수" value={selectedColumnKey} disabled={busy || !actualColumns.length} onChange={event => setSelectedColumnKey(event.target.value)}>
            {actualColumns.map(column => <option key={column.key} value={column.key}>{column.year}년 {column.orderWeek}</option>)}
          </select></label>
        </div>
        <div className="file-controls">
          <div className="mapping-source"><b>HF 사전</b><span title={mappingFileName}>{mappingFileName}</span><small>{matchedCount}개 HF CODE · {userId ? `${userId} 사용자 브라우저 전용` : '인증 확인 중'}</small></div>
          <label className={`upload-button ${busy || !userId || Boolean(authError) ? 'disabled' : ''}`}>HF 엑셀 업로드<input ref={fileRef} type="file" accept=".xlsx" aria-label="HF 엑셀 업로드" disabled={busy || !userId || Boolean(authError)} onChange={event => uploadMapping(event.target.files?.[0])} /></label>
          <button className="secondary" type="button" disabled={busy || !userId || Boolean(authError)} onClick={restoreSeed}>기본 사전 복원</button>
          <button className="download" type="button" disabled={busy || !selectedColumn || !visibleReport?.rows.length || !isReportCurrent} onClick={download}>{downloading ? '엑셀 생성 중…' : '엑셀 다운로드'}</button>
        </div>
      </section>

      {authError && <div className="message error" role="alert">{authError}</div>}
      {error && <div className="message error" role="alert">{error}</div>}
      {actionError && <div className="message error" role="alert">{actionError}</div>}
      {mappingWarning && <div className="message warning" role="status">{mappingWarning}</div>}
      {notice && !error && <div className="message info" role="status">{notice}</div>}

      <section className="summary" aria-label="조회 상태">
        <div className="summary-title"><span className="summary-kicker">선택 조회 결과</span><strong>{selectedColumn ? `${selectedColumn.year}년 ${selectedColumn.orderWeek} 주문등록` : reportCenter ? `${cycleLabel(reportCenter)} · 실제 세부차수 선택` : '실제 차수 달력으로 조회합니다'}</strong><small>{report?.queriedAt ? `조회 ${new Date(report.queriedAt).toLocaleString('ko-KR')}` : '7개 메인차수 범위에서 실제 주문이 있는 세부차수를 선택합니다.'}</small>{report && !isReportCurrent && <small className="scope-dirty" role="status">중심 차수가 변경됐습니다. 조회를 눌러 결과를 갱신하세요. 이전 결과는 다운로드할 수 없습니다.</small>}</div>
        {customerMatrix && <div className="summary-stats"><div><b>{customerMatrix.rows.length.toLocaleString('ko-KR')}</b><span>표시 품목</span></div><div><b>{customerMatrix.customers.length.toLocaleString('ko-KR')}</b><span>표시 업체</span></div></div>}
        <div className="filter-controls"><label className="search">업체·품목·HF 검색<input aria-label="업체명, CL 코드, 품목명 또는 HF CODE 검색" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="업체명, CL 코드, 품목, HF CODE" disabled={!report || busy} /></label><label>매칭 상태<select aria-label="HF 매칭 상태 필터" value={statusFilter} onChange={event => setStatusFilter(event.target.value)} disabled={!report || busy}><option value="all">전체 상태</option><option value="matched">일치</option><option value="review">검토</option><option value="missing">미매칭</option><option value="conflict">충돌</option></select></label></div>
      </section>

      {loading && <div className="state-card loading" role="status"><span className="spinner" /><b>실제 차수 달력과 중국 주문등록 수량을 조회하고 있습니다.</b><span>이전 조회 결과는 내보내기에 사용되지 않습니다.</span></div>}
      {!loading && !authReady && <div className="state-card" role="status">로그인 사용자 확인 중…</div>}
      {!loading && authReady && authError && <div className="state-card error-state">로그인 확인이 필요합니다.</div>}
      {!loading && authReady && !authError && error && <div className="state-card error-state" role="status"><b>조회 또는 작업을 완료하지 못했습니다.</b><span>{error}</span><button type="button" onClick={() => loadReport(center)}>다시 조회</button></div>}
      {!loading && authReady && !authError && !error && report && !actualColumns.length && <div className="state-card empty" role="status"><b>선택 범위에 주문이 있는 세부차수가 없습니다.</b><span>7개 메인차수 선택 범위에 중국 주문등록 수량(OutQuantity)이 없습니다.</span></div>}
      {!loading && authReady && !authError && !error && selectedReport && !annotatedRows.length && <div className="state-card empty" role="status"><b>{selectedReport.customerRows.length ? '조건에 맞는 업체·품목이 없습니다.' : '선택한 세부차수에 중국 주문등록 수량이 없습니다.'}</b><span>{selectedReport.customerRows.length ? '검색어 또는 매칭 상태 필터를 바꿔 보세요.' : '주문등록 수량(OutQuantity) 기준이며 출고·입고·재고 수량은 포함하지 않습니다.'}</span></div>}

      {!loading && !error && customerMatrix && customerMatrix.rows.length > 0 && <div className="matrix-section">
        <div className="matrix-caption"><b>품목(HF 코드) × 업체(CL 번호)</b><span>{query.trim() || statusFilter !== 'all' ? '현재 필터에 포함된 주문의 합계입니다.' : '선택 세부차수의 전체 주문 합계입니다.'} · 단위별 별도 합산 · 좌우로 스크롤하여 업체 비교</span></div>
        <div className="table-frame" tabIndex={0} role="region" aria-label="품목별 업체 수량표 가로 세로 스크롤">
        <table className="orders-table" data-selected-subweek={visibleReport.selectedColumnKey}>
          <colgroup><col className="product-col" /><col className="unit-col" /><col className="total-col" />{customerMatrix.customers.map(customer => <col key={customer.custKey} className="customer-col" />)}</colgroup>
          <thead><tr><th scope="col" className="fixed-product">품목명 (HF 코드)</th><th scope="col" className="fixed-unit">단위</th><th scope="col" className="fixed-total" data-column-key={visibleReport.selectedColumnKey}>총수량</th>{customerMatrix.customers.map(customer => <th key={customer.custKey} scope="col" className="customer-header" data-cust-key={customer.custKey} title={`${customer.custName} (${customer.custOrderCode || 'CL 미등록'})`}><span>{customer.custName || '업체명 미등록'}</span><strong>({customer.custOrderCode || 'CL 미등록'})</strong></th>)}</tr></thead>
          <tbody>
            {customerMatrix.rows.map(row => <tr key={row.rowKey} data-row-key={row.rowKey}>
              <th scope="row" className="product-cell fixed-product" title={`${row.prodName} (${row.hf.hfCode || 'HF 미매칭'}) · ${row.hf.label}`}><span className="product-label"><span className="product-name">{row.prodName}</span><strong className={`hf-inline ${row.hf.status}`}>({row.hf.hfCode || 'HF 미매칭'})</strong></span>{row.hf.status !== 'matched' && <small className={`match-state ${row.hf.status}`}>{statusName(row.hf.status)}{row.hf.reviewStatus ? ` · ${row.hf.reviewStatus}` : ''}</small>}</th>
              <td className="unit-cell fixed-unit">{row.unit || '—'}</td>
              <td className="quantity-cell total-cell fixed-total" data-quantity={row.total}><span>{quantity(row.total)}</span></td>
              {customerMatrix.customers.map(customer => <td key={customer.custKey} className="quantity-cell" data-cust-key={customer.custKey} data-quantity={row.quantities[String(customer.custKey)]} title={`${customer.custName} (${customer.custOrderCode || 'CL 미등록'}) · ${row.prodName} · ${quantity(row.quantities[String(customer.custKey)])}${row.unit}`}><span>{row.quantities[String(customer.custKey)] === 0 ? '—' : quantity(row.quantities[String(customer.custKey)])}</span></td>)}
            </tr>)}
          </tbody>
          <tfoot>{customerMatrix.totals.map(total => <tr key={total.unit} data-unit-total={total.unit}><th scope="row" className="fixed-product">{total.unit || '—'} 합계</th><td className="fixed-unit">{total.unit}</td><td className="quantity-cell total-cell fixed-total" data-quantity={total.total}><span>{quantity(total.total)}</span></td>{customerMatrix.customers.map(customer => <td key={customer.custKey} className="quantity-cell" data-cust-key={customer.custKey} data-quantity={total.quantities[String(customer.custKey)]}><span>{total.quantities[String(customer.custKey)] === 0 ? '—' : quantity(total.quantities[String(customer.custKey)])}</span></td>)}</tr>)}</tfoot>
        </table>
        </div>
      </div>}
      <footer className="page-foot"><span>기본 사전: {seedMapping.sourceFile} · HF CODE {seed.rows.filter(row => String(row.hfCode || '').trim()).length}개 · 원본 Check/No match 검토상태 유지, 빈 HF에 후보 코드를 대신 넣지 않습니다.</span><span>엑셀 첫 시트: 품목별업체수량 · 기존 발주현황/업체별발주/주문상세/조회기준도 포함</span></footer>
    </main>
    <style jsx>{`
      .china-order-page{--ink:#14243a;--muted:#61738a;--line:#d6dfeb;--blue:#174a85;--navy:#102d53;min-width:0;padding:14px 18px 20px;background:#edf2f8;color:var(--ink);font-size:14px;}
      .hero{min-height:84px;padding:15px 20px;display:flex;justify-content:space-between;align-items:center;gap:16px;color:#fff;border-radius:7px;background:linear-gradient(110deg,#102847 0%,#174a85 65%,#1f6591 100%);box-shadow:0 3px 10px #173a631c;}
      .eyebrow{font-size:10px;font-weight:800;letter-spacing:.14em;color:#a8d8ff}.hero h1{margin:3px 0;font-size:22px;line-height:1.15;font-weight:850}.hero p{margin:0;color:#d2dfef;font-size:12px}.hero-badge{display:flex;align-items:center;gap:8px;padding:9px 12px;border:1px solid #ffffff38;border-radius:5px;background:#ffffff12;font-size:13px;font-weight:800;white-space:nowrap}.hero-badge i{padding-left:9px;border-left:1px solid #ffffff45;color:#d2dfef;font-size:11px;font-style:normal;font-weight:500}.live-dot{width:8px;height:8px;border-radius:50%;background:#4ee0a2;box-shadow:0 0 0 4px #4ee0a229}
      .control-panel{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:9px;padding:10px 12px;background:#fff;border:1px solid var(--line);border-radius:6px;box-shadow:0 1px 3px #132b4710}.cycle-controls,.file-controls{display:flex;align-items:end;gap:7px;min-width:0}.cycle-controls label,.filter-controls label{display:flex;flex-direction:column;gap:3px;color:#64758b;font-size:10px;font-weight:800}.cycle-controls select,.filter-controls select,.search input{height:34px;padding:0 9px;border:1px solid #bdc9d8;border-radius:4px;background:#fff;color:#1a2b42;font-size:13px}.cycle-controls label:first-child select{width:94px;font-weight:800}.cycle-controls label:nth-child(2) select{width:190px;font-weight:700}.cycle-controls label:nth-of-type(3) select{width:170px;font-weight:700}.cycle-controls button,.file-controls button,.upload-button{height:34px;padding:0 12px;border:1px solid #c7d2df;border-radius:4px;background:#fff;color:#24415f;font-size:12px;font-weight:800;cursor:pointer;white-space:nowrap}.cycle-controls button.step{width:34px;padding:0;font-size:21px;line-height:1}.cycle-controls button.primary{padding:0 19px;border-color:#15599c;background:#15599c;color:#fff}.file-controls{align-items:center;gap:7px}.mapping-source{display:flex;max-width:290px;flex-direction:column;gap:1px;margin-right:4px}.mapping-source b{font-size:11px;color:#314a67}.mapping-source span{overflow:hidden;color:#34465e;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.mapping-source small{font-size:10px;color:var(--muted)}.upload-button{display:flex;align-items:center;background:#edf5fd;color:#174a85}.upload-button input{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;clip-path:inset(50%)}.upload-button:focus-within{outline:3px solid #9fcaff}.file-controls button.download{border-color:#13734a;background:#13734a;color:#fff}.file-controls button:disabled,.cycle-controls button:disabled,.upload-button.disabled{opacity:.52;cursor:not-allowed}
      .message{margin-top:8px;padding:8px 11px;border:1px solid;border-radius:4px;font-size:12px}.message.error{border-color:#e8b6b1;background:#fff1ef;color:#8f2119}.message.warning{border-color:#e8d18d;background:#fff9e9;color:#755600}.message.info{border-color:#c5d9f1;background:#f4f8ff;color:#315a86}
      .summary{display:flex;align-items:center;gap:18px;margin-top:9px;padding:9px 12px;background:#fff;border:1px solid var(--line);border-radius:6px}.summary-title{display:flex;min-width:290px;flex-direction:column;gap:1px}.summary-kicker{color:#69809a;font-size:10px;font-weight:800;letter-spacing:.04em}.summary-title strong{font-size:14px}.summary-title small{color:var(--muted);font-size:10px}.summary-title .scope-dirty{padding:3px 6px;border-radius:3px;background:#fff3d5;color:#805900;font-weight:800}.summary-stats{display:flex;gap:16px;padding-left:14px;border-left:1px solid #e2e8f0}.summary-stats div{display:flex;align-items:baseline;gap:5px}.summary-stats b{font-size:17px;color:#153e6b;font-variant-numeric:tabular-nums}.summary-stats span{color:var(--muted);font-size:10px}.filter-controls{display:flex;align-items:end;gap:7px;margin-left:auto}.search input{width:260px}.filter-controls select{min-width:116px}
      .state-card{min-height:132px;margin-top:10px;padding:24px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;border:1px solid var(--line);border-radius:6px;background:#fff;text-align:center;color:#42556e}.state-card b{color:#263a53;font-size:14px}.state-card span{font-size:12px;color:#697c91}.state-card.error-state{border-color:#e9c2bf;background:#fffaf9;color:#8f2119}.state-card button{margin-top:6px;padding:7px 15px;border:0;border-radius:4px;background:#174a85;color:white;font-weight:800;cursor:pointer}.spinner{width:25px;height:25px;border:3px solid #d4e1f0;border-top-color:#17599b;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
      .table-frame{min-width:0;max-width:100%;border:1px solid #c6d2e0;border-radius:5px;background:#fff}.orders-table{border-collapse:separate;border-spacing:0;font-size:12px}.orders-table th,.orders-table td{border-right:1px solid #e0e6ee;border-bottom:1px solid #e1e7ef;white-space:nowrap}.orders-table thead th{position:sticky;top:0;background:#e8eef6;color:#2c4564;font-size:12px;font-weight:850;text-align:center}.product-cell{text-align:left;font-weight:500}.match-state{display:block;overflow:hidden;color:#758399;text-overflow:ellipsis}.match-state.review{color:#936514}.match-state.conflict{color:#a52e26}.unit-cell{text-align:center;color:#52647a}.quantity-cell{text-align:center;font-variant-numeric:tabular-nums}.quantity-cell span{display:block;color:#183d69;font-size:14px;font-weight:900;line-height:20px}.orders-table tfoot th,.orders-table tfoot td{color:#173e6a;font-weight:900;border-bottom:0}.page-foot{display:flex;justify-content:space-between;gap:10px;margin-top:7px;color:#738196;font-size:10px}
      .matrix-section{margin-top:9px}.matrix-caption{display:flex;align-items:center;gap:14px;padding:6px 2px;font-size:12px}.matrix-caption b{color:#173e6a}.matrix-caption span{color:#61738a}.table-frame{margin-top:0;max-height:calc(100dvh - 410px);min-height:240px;overflow:auto;overscroll-behavior:contain;outline-offset:2px}.orders-table{--product-width:420px;--unit-width:62px;--total-width:98px;width:max-content;table-layout:fixed}.product-col{width:420px}.unit-col{width:62px}.total-col{width:98px}.customer-col{width:146px}.orders-table th,.orders-table td{height:34px;padding:4px 8px;box-sizing:border-box}.orders-table thead th{height:76px;vertical-align:middle;z-index:5}.customer-header{min-width:146px;max-width:146px;white-space:normal!important;overflow-wrap:anywhere}.customer-header span{display:block;line-height:17px;font-size:12px}.customer-header strong{display:block;margin-top:3px;font-size:13px;color:#173e6a}.orders-table tbody tr{background:#fff}.orders-table tbody tr:nth-child(even){background:#f7f9fc}.orders-table tbody tr:hover{background:#eaf3ff}.fixed-product,.fixed-unit,.fixed-total{position:sticky;z-index:2;background:inherit}.fixed-product{left:0;width:var(--product-width);min-width:var(--product-width);max-width:var(--product-width)}.fixed-unit{left:var(--product-width);width:var(--unit-width);min-width:var(--unit-width)}.fixed-total{left:calc(var(--product-width) + var(--unit-width));width:var(--total-width);min-width:var(--total-width);box-shadow:3px 0 4px #173e6a15;border-right:2px solid #b3c6dd!important}.orders-table thead .fixed-product,.orders-table thead .fixed-unit,.orders-table thead .fixed-total{z-index:8;background:#e8eef6}.product-cell{overflow:hidden;color:#1c2d43;font-size:13px;font-weight:600}.product-label{display:flex;align-items:baseline;gap:5px;min-width:0}.product-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.product-cell .hf-inline{flex-shrink:0;display:inline;color:#174a85;font-size:12px;font-weight:800}.product-cell .hf-inline.missing,.product-cell .hf-inline.conflict{color:#9b382c}.product-cell .match-state{margin-top:1px;font-size:10px;line-height:12px}.quantity-cell{min-width:146px}.quantity-cell.fixed-total{min-width:var(--total-width)}.quantity-cell span{line-height:20px}.total-cell span{font-size:15px;color:#123961}.orders-table tbody .total-cell{background:#edf4fc}.orders-table tbody tr:hover .total-cell{background:#dbeafb}.orders-table tfoot th,.orders-table tfoot td{height:36px;background:#e8eef6}.orders-table tfoot .fixed-unit{text-align:center}.matrix-caption span{font-size:11px}
      @media(max-width:1300px){.control-panel{align-items:flex-start;flex-direction:column}.cycle-controls{flex-wrap:wrap}.cycle-controls label:nth-of-type(2){flex:0 1 190px}.cycle-controls label:nth-of-type(3) select{width:190px}.summary{flex-wrap:wrap}.filter-controls{margin-left:auto}.table-frame{max-height:calc(100dvh - 370px)}.orders-table{--product-width:340px}.product-col{width:340px}}
      @media(max-width:760px){.china-order-page{padding:8px}.hero{align-items:flex-start;flex-direction:column}.hero-badge{white-space:normal}.cycle-controls,.file-controls{width:100%;flex-wrap:wrap}.cycle-controls label:nth-child(2){flex:1}.cycle-controls label:nth-child(2) select{width:100%}.cycle-controls label:nth-of-type(3){flex:1}.cycle-controls label:nth-of-type(3) select{width:100%}.file-controls{align-items:stretch}.mapping-source{max-width:none;width:100%}.summary-title{min-width:100%}.summary-stats{padding-left:0;border:0}.filter-controls{width:100%;margin:0}.filter-controls .search{flex:1}.search input{width:100%}.page-foot{flex-direction:column}.matrix-caption{align-items:flex-start;flex-direction:column;gap:3px}.orders-table{--product-width:220px;--unit-width:48px;--total-width:84px}.product-col{width:220px}.unit-col{width:48px}.total-col{width:84px}.table-frame{max-height:500px}}
    `}</style>
  </>;
}
