import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import seedMapping from '../../data/china-hf-codes.json';
import { apiGet } from '../../lib/useApi';
import { buildChinaOrderReport } from '../../lib/chinaOrderDownload';
import { normalizeHfMapping, parseChinaHfWorkbook, matchChinaHfCode } from '../../lib/chinaHfCodes';
import { buildChinaOrderWorkbook } from '../../lib/chinaOrderWorkbook';

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

function productIdentity(row) {
  return `${row.prodKey ?? ''}\u0000${row.unit ?? ''}`;
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
      setCenter(nextCenter);
      setAvailableCycles(result.availableCycles);
      setReport({ ...result, ...reportModel });
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

  const annotatedRows = useMemo(() => {
    if (!report || !mapping) return [];
    const token = query.trim().toLocaleLowerCase('ko-KR');
    return report.rows.map(row => ({ ...row, hf: matchChinaHfCode(row, mapping, report.products || []) }))
      .filter(row => !token || `${row.prodCode || ''} ${row.prodName || ''} ${row.hf?.hfCode || ''}`.toLocaleLowerCase('ko-KR').includes(token))
      .filter(row => statusFilter === 'all' || row.hf.status === statusFilter);
  }, [report, mapping, query, statusFilter]);

  const visibleReport = useMemo(() => {
    if (!report) return null;
    const identities = new Set(annotatedRows.map(row => productIdentity(row)));
    const byUnit = new Map();
    annotatedRows.forEach(row => {
      if (!byUnit.has(row.unit)) byUnit.set(row.unit, { unit: row.unit, quantities: {}, total: 0 });
      const target = byUnit.get(row.unit);
      for (const cycle of report.cycles) target.quantities[cycle.key] = Number(target.quantities[cycle.key] || 0) + Number(row.quantities?.[cycle.key] || 0);
      target.total += Number(row.total || 0);
    });
    return {
      ...report,
      rows: annotatedRows,
      orders: report.orders.filter(order => identities.has(productIdentity(order))),
      totals: [...byUnit.values()],
    };
  }, [report, annotatedRows]);

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
    if (!visibleReport || !visibleReport.rows.length || !isReportCurrent || loading || uploading || downloading) return;
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
      anchor.download = `중국_발주현황_${report.scope.year}-${report.scope.majorWeek}.xlsx`;
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
        </div>
        <div className="file-controls">
          <div className="mapping-source"><b>HF 사전</b><span title={mappingFileName}>{mappingFileName}</span><small>{matchedCount}개 HF CODE · {userId ? `${userId} 사용자 브라우저 전용` : '인증 확인 중'}</small></div>
          <label className={`upload-button ${busy || !userId || Boolean(authError) ? 'disabled' : ''}`}>HF 엑셀 업로드<input ref={fileRef} type="file" accept=".xlsx" aria-label="HF 엑셀 업로드" disabled={busy || !userId || Boolean(authError)} onChange={event => uploadMapping(event.target.files?.[0])} /></label>
          <button className="secondary" type="button" disabled={busy || !userId || Boolean(authError)} onClick={restoreSeed}>기본 사전 복원</button>
          <button className="download" type="button" disabled={busy || !visibleReport?.rows.length || !isReportCurrent} onClick={download}>{downloading ? '엑셀 생성 중…' : '엑셀 다운로드'}</button>
        </div>
      </section>

      {authError && <div className="message error" role="alert">{authError}</div>}
      {error && <div className="message error" role="alert">{error}</div>}
      {actionError && <div className="message error" role="alert">{actionError}</div>}
      {mappingWarning && <div className="message warning" role="status">{mappingWarning}</div>}
      {notice && !error && <div className="message info" role="status">{notice}</div>}

      <section className="summary" aria-label="조회 상태">
        <div className="summary-title"><span className="summary-kicker">조회 결과</span><strong>{reportCenter ? cycleLabel(reportCenter) : '실제 차수 달력으로 조회합니다'}</strong><small>{report?.queriedAt ? `조회 ${new Date(report.queriedAt).toLocaleString('ko-KR')}` : '기본 중심차수는 한국 현재일에 해당하는 실제 목요일 업무차수입니다.'}</small>{report && !isReportCurrent && <small className="scope-dirty" role="status">중심 차수가 변경됐습니다. 조회를 눌러 결과를 갱신하세요. 이전 결과는 다운로드할 수 없습니다.</small>}</div>
        {report && <div className="summary-stats"><div><b>{report.rows.length.toLocaleString('ko-KR')}</b><span>품목</span></div><div><b>{report.orders.length.toLocaleString('ko-KR')}</b><span>세부 주문행</span></div><div><b>{report.cycles.length}</b><span>표시 차수</span></div></div>}
        <div className="filter-controls"><label className="search">품목·HF 검색<input aria-label="품목명 또는 HF CODE 검색" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="품목명, 품목코드, HF CODE" disabled={!report || busy} /></label><label>매칭 상태<select aria-label="HF 매칭 상태 필터" value={statusFilter} onChange={event => setStatusFilter(event.target.value)} disabled={!report || busy}><option value="all">전체 상태</option><option value="matched">일치</option><option value="review">검토</option><option value="missing">미매칭</option><option value="conflict">충돌</option></select></label></div>
      </section>

      {loading && <div className="state-card loading" role="status"><span className="spinner" /><b>실제 차수 달력과 중국 주문등록 수량을 조회하고 있습니다.</b><span>이전 조회 결과는 내보내기에 사용되지 않습니다.</span></div>}
      {!loading && !authReady && <div className="state-card" role="status">로그인 사용자 확인 중…</div>}
      {!loading && authReady && authError && <div className="state-card error-state">로그인 확인이 필요합니다.</div>}
      {!loading && authReady && !authError && error && <div className="state-card error-state" role="status"><b>조회 또는 작업을 완료하지 못했습니다.</b><span>{error}</span><button type="button" onClick={() => loadReport(center)}>다시 조회</button></div>}
      {!loading && authReady && !authError && !error && report && !annotatedRows.length && <div className="state-card empty" role="status"><b>{report.rows.length ? '조건에 맞는 품목이 없습니다.' : '선택한 조회 범위에 중국 주문등록 수량이 없습니다.'}</b><span>{report.rows.length ? '검색어 또는 매칭 상태 필터를 바꿔 보세요.' : '주문등록 수량(OutQuantity) 기준이며 출고·입고·재고 수량은 포함하지 않습니다.'}</span></div>}

      {!loading && !error && visibleReport && annotatedRows.length > 0 && <div className="table-frame">
        <table className="orders-table">
          <colgroup><col className="product-col" /><col className="hf-col" /><col className="unit-col" />{visibleReport.cycles.map(cycle => <col key={cycle.key} className="qty-col" />)}<col className="total-col" /></colgroup>
          <thead><tr><th className="sticky-product" scope="col">품목명 · 품목코드</th><th scope="col">HF CODE</th><th scope="col">단위</th>{visibleReport.cycles.map(cycle => <th className={`qty-heading ${cycle.offset === 0 ? 'center-cycle' : ''}`} key={cycle.key} scope="col"><span>{cycle.majorWeek}차</span><small>{cycle.year}</small></th>)}<th className="total-heading" scope="col">합계</th></tr></thead>
          <tbody>
            {annotatedRows.map((row, index) => <tr key={`${row.prodKey}:${row.unit}`}>
              <th className="sticky-product product-cell" scope="row"><strong title={row.prodName}>{row.prodName}</strong><small title={row.prodCode}>{row.prodCode || `품목 ${row.prodKey}`}</small></th>
              <td className="hf-cell"><span className={`hf-code ${row.hf.status}`} title={row.hf.label || row.hf.status}>{row.hf.hfCode || '—'}</span><small className={`match-state ${row.hf.status}`}>{statusName(row.hf.status)}{row.hf.reviewStatus ? ` · ${row.hf.reviewStatus}` : ''}</small></td>
              <td className="unit-cell">{row.unit || '—'}</td>
              {visibleReport.cycles.map(cycle => <td className={`quantity-cell ${cycle.offset === 0 ? 'center-cycle' : ''}`} key={cycle.key}><span>{quantity(row.quantities?.[cycle.key])}</span></td>)}
              <td className="total-cell">{quantity(row.total)}</td>
            </tr>)}
          </tbody>
          <tfoot>{visibleReport.totals.map((total, index) => <tr key={total.unit || index}><th className="sticky-product" scope="row">단위 합계</th><td>—</td><td className="unit-cell">{total.unit || '—'}</td>{visibleReport.cycles.map(cycle => <td className={`quantity-cell ${cycle.offset === 0 ? 'center-cycle' : ''}`} key={cycle.key}><span>{quantity(total.quantities?.[cycle.key])}</span></td>)}<td className="total-cell">{quantity(total.total)}</td></tr>)}</tfoot>
        </table>
      </div>}
      <footer className="page-foot"><span>기본 사전: {seedMapping.sourceFile} · HF CODE {seed.rows.filter(row => String(row.hfCode || '').trim()).length}개 · 원본 Check/No match 검토상태 유지, 빈 HF에 후보 코드를 대신 넣지 않습니다.</span><span>엑셀: 발주현황 · 업체별발주(CL 코드 포함) · 주문상세 · 조회기준 / 전산 Customer.OrderCode 조회</span></footer>
    </main>
    <style jsx>{`
      .china-order-page{--ink:#14243a;--muted:#61738a;--line:#d6dfeb;--blue:#174a85;--navy:#102d53;min-width:0;padding:14px 18px 20px;background:#edf2f8;color:var(--ink);font-size:14px;}
      .hero{min-height:84px;padding:15px 20px;display:flex;justify-content:space-between;align-items:center;gap:16px;color:#fff;border-radius:7px;background:linear-gradient(110deg,#102847 0%,#174a85 65%,#1f6591 100%);box-shadow:0 3px 10px #173a631c;}
      .eyebrow{font-size:10px;font-weight:800;letter-spacing:.14em;color:#a8d8ff}.hero h1{margin:3px 0;font-size:22px;line-height:1.15;font-weight:850}.hero p{margin:0;color:#d2dfef;font-size:12px}.hero-badge{display:flex;align-items:center;gap:8px;padding:9px 12px;border:1px solid #ffffff38;border-radius:5px;background:#ffffff12;font-size:13px;font-weight:800;white-space:nowrap}.hero-badge i{padding-left:9px;border-left:1px solid #ffffff45;color:#d2dfef;font-size:11px;font-style:normal;font-weight:500}.live-dot{width:8px;height:8px;border-radius:50%;background:#4ee0a2;box-shadow:0 0 0 4px #4ee0a229}
      .control-panel{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:9px;padding:10px 12px;background:#fff;border:1px solid var(--line);border-radius:6px;box-shadow:0 1px 3px #132b4710}.cycle-controls,.file-controls{display:flex;align-items:end;gap:7px;min-width:0}.cycle-controls label,.filter-controls label{display:flex;flex-direction:column;gap:3px;color:#64758b;font-size:10px;font-weight:800}.cycle-controls select,.filter-controls select,.search input{height:34px;padding:0 9px;border:1px solid #bdc9d8;border-radius:4px;background:#fff;color:#1a2b42;font-size:13px}.cycle-controls label:first-child select{width:94px;font-weight:800}.cycle-controls label:nth-child(2) select{width:190px;font-weight:700}.cycle-controls button,.file-controls button,.upload-button{height:34px;padding:0 12px;border:1px solid #c7d2df;border-radius:4px;background:#fff;color:#24415f;font-size:12px;font-weight:800;cursor:pointer;white-space:nowrap}.cycle-controls button.step{width:34px;padding:0;font-size:21px;line-height:1}.cycle-controls button.primary{padding:0 19px;border-color:#15599c;background:#15599c;color:#fff}.file-controls{align-items:center;gap:7px}.mapping-source{display:flex;max-width:290px;flex-direction:column;gap:1px;margin-right:4px}.mapping-source b{font-size:11px;color:#314a67}.mapping-source span{overflow:hidden;color:#34465e;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.mapping-source small{font-size:10px;color:var(--muted)}.upload-button{display:flex;align-items:center;background:#edf5fd;color:#174a85}.upload-button input{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;clip-path:inset(50%)}.upload-button:focus-within{outline:3px solid #9fcaff}.file-controls button.download{border-color:#13734a;background:#13734a;color:#fff}.file-controls button:disabled,.cycle-controls button:disabled,.upload-button.disabled{opacity:.52;cursor:not-allowed}
      .message{margin-top:8px;padding:8px 11px;border:1px solid;border-radius:4px;font-size:12px}.message.error{border-color:#e8b6b1;background:#fff1ef;color:#8f2119}.message.warning{border-color:#e8d18d;background:#fff9e9;color:#755600}.message.info{border-color:#c5d9f1;background:#f4f8ff;color:#315a86}
      .summary{display:flex;align-items:center;gap:18px;margin-top:9px;padding:9px 12px;background:#fff;border:1px solid var(--line);border-radius:6px}.summary-title{display:flex;min-width:290px;flex-direction:column;gap:1px}.summary-kicker{color:#69809a;font-size:10px;font-weight:800;letter-spacing:.04em}.summary-title strong{font-size:14px}.summary-title small{color:var(--muted);font-size:10px}.summary-title .scope-dirty{padding:3px 6px;border-radius:3px;background:#fff3d5;color:#805900;font-weight:800}.summary-stats{display:flex;gap:16px;padding-left:14px;border-left:1px solid #e2e8f0}.summary-stats div{display:flex;align-items:baseline;gap:5px}.summary-stats b{font-size:17px;color:#153e6b;font-variant-numeric:tabular-nums}.summary-stats span{color:var(--muted);font-size:10px}.filter-controls{display:flex;align-items:end;gap:7px;margin-left:auto}.search input{width:260px}.filter-controls select{min-width:116px}
      .state-card{min-height:132px;margin-top:10px;padding:24px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;border:1px solid var(--line);border-radius:6px;background:#fff;text-align:center;color:#42556e}.state-card b{color:#263a53;font-size:14px}.state-card span{font-size:12px;color:#697c91}.state-card.error-state{border-color:#e9c2bf;background:#fffaf9;color:#8f2119}.state-card button{margin-top:6px;padding:7px 15px;border:0;border-radius:4px;background:#174a85;color:white;font-weight:800;cursor:pointer}.spinner{width:25px;height:25px;border:3px solid #d4e1f0;border-top-color:#17599b;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
      .table-frame{margin-top:9px;min-width:0;overflow:visible;border:1px solid #c6d2e0;border-radius:5px;background:#fff}.orders-table{width:100%;table-layout:fixed;border-collapse:separate;border-spacing:0;font-size:12px}.product-col{width:390px}.hf-col{width:154px}.unit-col{width:65px}.qty-col{width:calc((100% - 699px)/7)}.total-col{width:90px}.orders-table th,.orders-table td{height:42px;padding:5px 8px;border-right:1px solid #e0e6ee;border-bottom:1px solid #e1e7ef;white-space:nowrap}.orders-table thead th{position:sticky;top:0;z-index:4;height:39px;background:#e8eef6;color:#2c4564;font-size:11px;font-weight:850;text-align:center}.orders-table thead th:first-child{text-align:left}.orders-table thead .qty-heading span,.orders-table thead .qty-heading small{display:block}.orders-table thead .qty-heading small{font-size:9px;font-weight:600;color:#718198}.orders-table .sticky-product{position:sticky;left:0;z-index:3;background:#fff}.orders-table thead .sticky-product{z-index:6;background:#e8eef6}.orders-table tbody tr:nth-child(even){background:#f7f9fc}.orders-table tbody tr:hover{background:#eaf3ff}.orders-table tbody tr:hover .sticky-product{background:#eaf3ff}.product-cell{text-align:left;font-weight:500}.product-cell strong{display:block;overflow:hidden;color:#1c2d43;font-size:12px;font-weight:750;text-overflow:ellipsis}.product-cell small{display:block;overflow:hidden;margin-top:2px;color:#728198;font-size:10px;text-overflow:ellipsis}.hf-cell{text-align:left}.hf-code{display:block;overflow:hidden;color:#183d69;font-size:12px;font-weight:900;text-overflow:ellipsis}.hf-code.missing,.hf-code.conflict{color:#9b382c}.match-state{display:block;overflow:hidden;color:#758399;font-size:9px;text-overflow:ellipsis}.match-state.review{color:#936514}.match-state.conflict{color:#a52e26}.unit-cell{text-align:center;color:#52647a}.quantity-cell{text-align:center;font-variant-numeric:tabular-nums}.quantity-cell span{display:block;color:#183d69;font-size:14px;font-weight:900;line-height:20px}.total-cell{text-align:center;color:#122f54;font-size:13px;font-weight:900;font-variant-numeric:tabular-nums}.total-heading{background:#dce8f5!important}.orders-table tfoot th,.orders-table tfoot td{position:sticky;bottom:0;z-index:2;height:37px;background:#e8eef6;font-weight:900;border-bottom:0}.orders-table tfoot .sticky-product{z-index:3;background:#e8eef6}.orders-table tfoot .quantity-cell span{font-size:13px}.page-foot{display:flex;justify-content:space-between;gap:10px;margin-top:7px;color:#738196;font-size:10px}
      .orders-table thead .qty-heading.center-cycle{background:#cfe0f4;color:#173e6a;box-shadow:inset 0 -2px #3b75b2}.orders-table tbody .quantity-cell.center-cycle{background:#f0f6fd}.orders-table tbody tr:hover .quantity-cell.center-cycle{background:#e3effd}.orders-table tfoot .quantity-cell.center-cycle{background:#dce8f5}
      @media(max-width:1300px){.control-panel{align-items:flex-start;flex-direction:column}.summary{flex-wrap:wrap}.filter-controls{margin-left:auto}.table-frame{overflow-x:auto}.orders-table{min-width:1280px}.orders-table .sticky-product{left:0}}
      @media(max-width:760px){.china-order-page{padding:8px}.hero{align-items:flex-start;flex-direction:column}.hero-badge{white-space:normal}.cycle-controls,.file-controls{width:100%;flex-wrap:wrap}.cycle-controls label:nth-child(2){flex:1}.cycle-controls label:nth-child(2) select{width:100%}.file-controls{align-items:stretch}.mapping-source{max-width:none;width:100%}.summary-title{min-width:100%}.summary-stats{padding-left:0;border:0}.filter-controls{width:100%;margin:0}.filter-controls .search{flex:1}.search input{width:100%}.page-foot{flex-direction:column}}
    `}</style>
  </>;
}
