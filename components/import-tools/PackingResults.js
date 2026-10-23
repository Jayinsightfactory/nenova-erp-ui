import React, { useEffect, useMemo, useRef, useState } from 'react';
import styles from '../../styles/ImportPacking.module.css';
import { packingMatchReview } from '../../lib/packingMatchReview';
import { effectivePackingMatchReview } from '../../lib/packingReceiptMatchState';

const hasValue = value => value !== null && value !== undefined && value !== '';
const STEM_QUANTITY_COUNTRIES = new Set(['NL', 'CO', 'EC', 'TH', 'AU', 'US', 'VN']);

function quantityUnit(country) {
  if (country === 'CN') return '단';
  return STEM_QUANTITY_COUNTRIES.has(country) ? '송이' : null;
}

function finiteNumber(value) {
  if (!hasValue(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value, maximumFractionDigits = 3) {
  const number = finiteNumber(value);
  return number === null
    ? '—'
    : number.toLocaleString('ko-KR', { maximumFractionDigits });
}

function sourceIssueText(requirement) {
  const labels = {
    SOURCE_VALUE_INVALID: requirement?.message || '수량·단가 수정 필요',
    PRICE_OR_AMOUNT_MISSING: '단가·금액 미확인',
    CARTON_NUMBER_WARNING: '박스 번호 확인',
    POSITIONED_EVIDENCE_UNAVAILABLE: '원문 위치 확인',
    SOURCE_ROW_CHANGED: '원문 행 변경됨',
    VERIFIED_BASELINE_UNAVAILABLE: '자동 검산 근거 없음 — 수량·단가를 원본과 대조해 주세요',
    SOURCE_REVIEW_UNAVAILABLE: '원문 확인 정보를 읽지 못했습니다 — 검토창에서 확인해 주세요',
    CARTON_AUDIT_UNAVAILABLE: '박스수 검산 근거 없음 — 원본 박스수를 확인해 주세요',
  };
  return (Array.isArray(requirement?.reasons) ? requirement.reasons : [])
    .map(reason => labels[reason] || '원문 확인 필요').join(' · ') || '원문 확인 필요';
}

function productSourceNeedsReview(product) { return product?.sourceReview?.required === true; }

function rowKey(excel, product, index) {
  return `${excel.name}::${hasValue(product.source_row) ? product.source_row : index}`;
}

function quantityText(product, country) {
  const value = finiteNumber(product.qty);
  if (value === null) return '수량 미확인';
  const unit = quantityUnit(country);
  return unit ? `${formatNumber(value)}${unit}` : `${formatNumber(value)} · 단위 미확인`;
}

function productName(product) {
  return String(product.matchedName || product.name || product.sourceName || '품목명 미상').trim() || '품목명 미상';
}

function sourceProductName(product) {
  return String(product.sourceName || product.matchingDescription || product.name || '품목명 미상').trim() || '품목명 미상';
}

function mismatchText(mismatch) {
  if (!mismatch || typeof mismatch !== 'object') return '인보이스 합계 불일치';
  const computed = finiteNumber(mismatch.computed);
  const expected = finiteNumber(mismatch.expected);
  if (computed === null || expected === null) return '인보이스 합계 불일치';
  const difference = computed - expected;
  return `패킹 리스트 ${formatNumber(computed, 2)} · 인보이스 ${formatNumber(expected, 2)} · 차이 ${difference > 0 ? '+' : ''}${formatNumber(difference, 2)}`;
}

function buildIssueSummary(excels, country, notes, truncated = false, erpProducts = [], receiptMatches = new Map()) {
  const lines = ['패킹 리스트 확인 필요 항목'];
  let issueCount = 0;

  excels.forEach((excel, excelIndex) => {
    const products = Array.isArray(excel.products) ? excel.products : [];
    const rowIssues = products
      .map((product, index) => ({ product, index, key: rowKey(excel, product, index), review: effectivePackingMatchReview(
        packingMatchReview(product, erpProducts, country), receiptMatches.get(`${excel.sourceInvoiceIdentity?.sourceInvoiceIndex ?? excelIndex}:${index}`)) }))
      .filter(item => item.review.needsReview || productSourceNeedsReview(item.product));
    const hasMismatch = Boolean(excel.totalMismatch);
    const isTruncated = Boolean(truncated || excel.wasTruncated || excel.truncated);
    if (!rowIssues.length && !hasMismatch && !isTruncated) return;

    lines.push('', excel.label || excel.name || '결과 파일');
    rowIssues.forEach(({ product, key, review }) => {
      const fallback = [review.needsReview ? review.label : '', productSourceNeedsReview(product) ? sourceIssueText(product.sourceReview) : ''].filter(Boolean).join(' · ');
      const reason = String(notes[key] || '').trim() || fallback;
      lines.push(`- ${productName(product)} · ${quantityText(product, country)} · 사유: ${reason}`);
      issueCount += 1;
    });
    if (hasMismatch) {
      lines.push(`- 합계 확인 · ${mismatchText(excel.totalMismatch)}`);
      issueCount += 1;
    }
    if (isTruncated) {
      lines.push('- 원본 확인 · PDF 분석 결과가 잘려 일부 인보이스가 누락되었을 수 있음');
      issueCount += 1;
    }
  });

  if (!issueCount) lines.push('', '확인할 문제가 없습니다.');
  return { text: lines.join('\n'), issueCount };
}

async function copyTextarea(textarea, statusNode) {
  const value = textarea.value;
  try {
    const clipboard = textarea.ownerDocument.defaultView?.navigator?.clipboard;
    if (!clipboard?.writeText) throw new Error('Clipboard API unavailable');
    await clipboard.writeText(value);
    statusNode.textContent = '복사했습니다.';
    return;
  } catch {
    textarea.focus();
    textarea.select();
    let copied = false;
    try { copied = textarea.ownerDocument.execCommand?.('copy') === true; } catch { copied = false; }
    statusNode.textContent = copied ? '복사했습니다.' : '텍스트가 선택되었습니다. Ctrl+C로 복사하세요.';
  }
}

function populateSummaryWindow(popup, summary, returnFocus) {
  const doc = popup.document;
  let focusReturned = false;
  const restoreFocus = () => {
    if (focusReturned) return;
    focusReturned = true;
    returnFocus?.();
  };
  const closePopup = () => {
    popup.close();
    restoreFocus();
  };
  doc.title = '패킹 리스트 이슈 요약';
  while (doc.body.firstChild) doc.body.removeChild(doc.body.firstChild);
  doc.body.style.margin = '0';
  doc.body.style.padding = '24px';
  doc.body.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  doc.body.style.color = '#172b4d';
  doc.body.style.background = '#f6f8fb';

  const heading = doc.createElement('h1');
  heading.textContent = '패킹 리스트 이슈 요약';
  heading.style.fontSize = '20px';
  heading.style.margin = '0 0 8px';
  const help = doc.createElement('p');
  help.textContent = '아래 내용을 복사해 카카오톡에 붙여 넣을 수 있습니다.';
  help.style.margin = '0 0 14px';
  help.style.color = '#526580';
  const textarea = doc.createElement('textarea');
  textarea.value = summary;
  textarea.setAttribute('aria-label', '복사할 이슈 요약');
  textarea.style.width = '100%';
  textarea.style.minHeight = '360px';
  textarea.style.padding = '14px';
  textarea.style.border = '1px solid #aebbd0';
  textarea.style.borderRadius = '8px';
  textarea.style.font = '14px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace';
  textarea.style.boxSizing = 'border-box';
  const actions = doc.createElement('div');
  actions.style.display = 'flex';
  actions.style.alignItems = 'center';
  actions.style.gap = '12px';
  actions.style.marginTop = '12px';
  const copyButton = doc.createElement('button');
  copyButton.type = 'button';
  copyButton.textContent = '클립보드에 복사';
  copyButton.style.padding = '9px 14px';
  copyButton.style.border = '1px solid #2457c5';
  copyButton.style.borderRadius = '7px';
  copyButton.style.background = '#2457c5';
  copyButton.style.color = '#fff';
  copyButton.style.fontWeight = '700';
  const closeButton = doc.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = '닫기';
  closeButton.style.padding = '9px 14px';
  closeButton.style.border = '1px solid #aebbd0';
  closeButton.style.borderRadius = '7px';
  closeButton.style.background = '#fff';
  closeButton.style.color = '#172b4d';
  closeButton.style.fontWeight = '700';
  const status = doc.createElement('span');
  status.setAttribute('role', 'status');
  status.style.color = '#176039';
  copyButton.addEventListener('click', () => copyTextarea(textarea, status));
  closeButton.addEventListener('click', closePopup);
  doc.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closePopup();
  });
  popup.addEventListener?.('beforeunload', restoreFocus, { once: true });
  actions.append(copyButton, closeButton, status);
  doc.body.append(heading, help, textarea, actions);
  textarea.focus();
  textarea.select();
  popup.focus();
}

export default function PackingResults({
  excels,
  country,
  blocked,
  onDownload,
  onMatch,
  mappingDisabled = false,
  truncated = false,
  erpProducts = [],
  receiptMatches = new Map(),
  previewOnly = false,
  onReviewSource,
}) {
  const [selected, setSelected] = useState(null);
  const [notes, setNotes] = useState({});
  const [dialogText, setDialogText] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [view, setView] = useState('REVIEW_REQUIRED');
  const filterButtonRef = useRef(null);
  const rowRefs = useRef({});
  const matchButtonRefs = useRef({});
  const summaryButtonRef = useRef(null);
  const dialogRef = useRef(null);
  const dialogTextareaRef = useRef(null);
  const safeExcels = Array.isArray(excels) ? excels : [];
  const summary = useMemo(() => buildIssueSummary(safeExcels, country, notes, truncated, erpProducts, receiptMatches), [safeExcels, country, notes, truncated, erpProducts, receiptMatches]);
  const reviewedExcels = safeExcels.map((excel, excelIndex) => ({ excel, rows: (Array.isArray(excel.products) ? excel.products : []).map((product, index) => ({ product, index, key: rowKey(excel, product, index), review: effectivePackingMatchReview(
    packingMatchReview(product, erpProducts, country), receiptMatches.get(`${excel.sourceInvoiceIdentity?.sourceInvoiceIndex ?? excelIndex}:${index}`)) })) }));
  const counts = reviewedExcels.flatMap(item => item.rows).reduce((result, row) => ({ ...result, [row.review.status]: (result[row.review.status] || 0) + 1 }), { EXACT: 0, MANUAL: 0, DOCUMENT: 0, REVIEW: 0, UNMATCHED: 0, ALLOCATION: 0 });
  useEffect(() => {
    if (counts.EXACT + counts.MANUAL + counts.DOCUMENT > 0 && counts.REVIEW + counts.UNMATCHED === 0) setView('ALL');
  }, [counts.EXACT, counts.MANUAL, counts.DOCUMENT, counts.REVIEW, counts.UNMATCHED]);
  const visibleKeys = reviewedExcels.flatMap(item => item.rows.filter(row => view === 'ALL' || row.review.needsReview || productSourceNeedsReview(row.product)).map(row => row.key));
  useEffect(() => {
    if (!selected?.rowKey || visibleKeys.includes(selected.rowKey)) return;
    setSelected(null);
    if (typeof document !== 'undefined' && (!document.activeElement || document.activeElement === document.body)) {
      const next = visibleKeys.map(key => matchButtonRefs.current[key]).find(node => node && !node.disabled);
      (next || filterButtonRef.current)?.focus();
    }
  }, [visibleKeys.join('\n'), selected?.rowKey]);

  const closeDialog = () => {
    setDialogText('');
    setCopyStatus('');
    setTimeout(() => summaryButtonRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (!dialogText || typeof window === 'undefined') return undefined;
    dialogTextareaRef.current?.focus();
    dialogTextareaRef.current?.select();
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key === 'Tab' && dialogRef.current) {
        const controls = [...dialogRef.current.querySelectorAll('button, textarea, input, select, [href], [tabindex]:not([tabindex="-1"])')]
          .filter(control => !control.disabled && control.getAttribute('aria-hidden') !== 'true');
        if (!controls.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dialogText]);

  const handleMatchArrow = (event, rowKeys, currentKey) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const enabledKeys = rowKeys.filter(key => matchButtonRefs.current[key] && !matchButtonRefs.current[key].disabled);
    const index = enabledKeys.indexOf(currentKey);
    if (index < 0 || enabledKeys.length < 2) return;
    const offset = event.key === 'ArrowDown' ? 1 : -1;
    const nextKey = enabledKeys[(index + offset + enabledKeys.length) % enabledKeys.length];
    matchButtonRefs.current[nextKey]?.focus();
  };

  const openSummary = () => {
    if (typeof window === 'undefined') return;
    const popup = window.open('', '_blank', 'popup=yes,width=720,height=720,resizable=yes,scrollbars=yes');
    if (!popup) {
      setDialogText(summary.text);
      setCopyStatus('팝업이 차단되어 이 화면에 요약을 열었습니다.');
      return;
    }
    populateSummaryWindow(popup, summary.text, () => summaryButtonRef.current?.focus());
  };

  return (
    <section className={styles.resultsSection} aria-label="생성된 패킹 리스트 결과" data-testid="packing-results">
      <div className={styles.resultsHeadingRow}>
        <div>
          <h3 className={styles.resultsHeading}>품목 매칭 확인</h3>
          <p className={styles.resultsHint}>원본 품명 옆 DB 품목을 선택하세요. 모두 매칭하면 다음 단계로 진행할 수 있습니다. 수량·단가 오류가 표시된 행만 「확인/수정 열기」에서 고치세요.</p>
        </div>
        <button ref={summaryButtonRef} type="button" onClick={openSummary} className={styles.summaryButton} data-testid="packing-results-copy-open">
          이슈 요약 새 창
          {summary.issueCount > 0 && <span className={styles.summaryCount}>{summary.issueCount}</span>}
        </button>
      </div>

      <div className={styles.matchReviewBar}>
        <p role="status">정확 {counts.EXACT} · 팀 공용 수동 {counts.MANUAL} · 문서 행 선택 {counts.DOCUMENT} · 유사 {counts.REVIEW} · 미매칭 {counts.UNMATCHED}
          {counts.ALLOCATION ? ` · 파일별 분류 대상 ${counts.ALLOCATION}행 (입고 문서에서 확인)` : counts.REVIEW + counts.UNMATCHED === 0 ? ' · 품목 매칭 완료 (수량·중량은 별도 확인)' : ` · 매칭 확인 ${counts.REVIEW + counts.UNMATCHED}건`}
          {(() => { const count = reviewedExcels.flatMap(item => item.rows).filter(row => productSourceNeedsReview(row.product)).length;
            return count ? ` · 원문 확인 ${count}건` : ''; })()}</p>
        <button ref={filterButtonRef} type="button" aria-pressed={view === 'ALL'} data-testid="packing-results-view-toggle" onClick={() => setView(current => current === 'ALL' ? 'REVIEW_REQUIRED' : 'ALL')}>
          {view === 'ALL' ? '확인 필요만 보기' : '전체 보기'}</button>
      </div>

      {reviewedExcels.map(({ excel, rows }, excelIndex) => {
        const products = Array.isArray(excel.products) ? excel.products : [];
        const include = {
          stemLength: products.some(product => hasValue(product.stemLength ?? product.stem_length)),
          boxes: products.some(product => hasValue(product.boxes)),
          stems: products.some(product => hasValue(product.stems)),
          unitPrice: products.some(product => hasValue(product.unitPrice)),
          lineAmount: products.some(product => hasValue(product.lineAmount)),
        };
        const rowIssues = rows.filter(item => item.review.needsReview || productSourceNeedsReview(item.product));
        const visibleRows = rows.filter(item => view === 'ALL' || item.review.needsReview || productSourceNeedsReview(item.product));
        const mismatch = excel.totalMismatch;
        const resultTruncated = Boolean(truncated || excel.wasTruncated || excel.truncated);
        const issueCount = rowIssues.length + (mismatch ? 1 : 0) + (resultTruncated ? 1 : 0);
        const rowKeys = visibleRows.map(item => item.key);
        const knownQuantities = products.map(product => finiteNumber(product.qty)).filter(value => value !== null);
        const quantityTotal = knownQuantities.reduce((sum, value) => sum + value, 0);
        const hasUnknownQuantity = knownQuantities.length !== products.length;
        const knownStems = products.map(product => finiteNumber(product.stems)).filter(value => value !== null);
        const stemTotal = knownStems.reduce((sum, value) => sum + value, 0);
        const unit = quantityUnit(country);
        const hasWeightMetadata = Object.prototype.hasOwnProperty.call(excel, 'grossWeight')
          || Object.prototype.hasOwnProperty.call(excel, 'chargeableWeight');
        const weightText = value => finiteNumber(value) === null ? '미확인' : `${formatNumber(value)}kg`;
        const excelSelected = selected?.excelName === excel.name && !selected.rowKey;
        const downloadBlocked = blocked(excel);

        return (
          <article key={excel.name || excelIndex} className={`${styles.resultCard}${excelSelected ? ` ${styles.resultCardSelected}` : ''}`}>
            <header className={styles.resultCardHeader}>
              <div>
                <div className={styles.resultTitleLine}>
                  <h4>{excel.label || excel.name}</h4>
                  {issueCount > 0 && <span className={styles.issueBadge}>확인 {issueCount}</span>}
                </div>
                <p>
                  {excel.name} · {products.length.toLocaleString('ko-KR')}행
                  {unit ? ` · ${country === 'CN' ? '단수' : '송이'} 합계 ${knownQuantities.length ? formatNumber(quantityTotal) : '미확인'}${unit}` : ' · 수량 합계 단위 미확인'}
                  {unit && hasUnknownQuantity ? ' · 수량 미확인 행 있음' : ''}
                  {country === 'CN' && knownStems.length ? ` · 송이 합계 ${formatNumber(stemTotal)}송이` : ''}
                  {hasWeightMetadata ? ` · GW ${weightText(excel.grossWeight)} · CW ${weightText(excel.chargeableWeight)}` : ''}
                </p>
              </div>
              {previewOnly ? <span style={{ display: 'inline-flex', alignItems: 'center', minHeight: 28, border: '1px solid #ccd6e5', borderRadius: 7, padding: '4px 9px', background: '#f4f7fb', color: '#526580', fontSize: 12, fontWeight: 600 }}>미리보기 · 다운로드 생성 안 됨</span> : <button
                type="button"
                onClick={() => { if (!downloadBlocked) onDownload(excel.name); }}
                disabled={downloadBlocked}
                className={styles.downloadButton}
              >
                {downloadBlocked ? '🔒 다운로드 차단' : '⬇ 다운로드'}
              </button>}
            </header>

            <div className={styles.resultWorkspace}>
              {visibleRows.length === 0 && <p className={styles.matchReviewEmpty} role="status">품목 매칭 완료 (수량·중량은 별도 확인). 완료된 품목은 전체 보기에서 확인하세요.</p>}
              <div className={styles.sheetScroll} role="region" aria-label={`${excel.label || excel.name} ${view === 'ALL' ? '전체 행' : '확인 필요 행'}`} tabIndex="0">
                <table className={styles.resultSheet} data-testid="packing-results-table" data-result-name={excel.name || ''}>
                  <colgroup>
                    <col className={styles.rowNumberColumn} />
                    <col className={styles.productColumn} />
                    {include.stemLength && <col className={styles.lengthColumn} />}
                    <col className={styles.matchDataColumn} />
                    {include.boxes && <col className={styles.boxesColumn} />}
                    <col className={styles.quantityColumn} />
                    {include.stems && <col className={styles.stemsColumn} />}
                    {include.unitPrice && <col className={styles.priceColumn} />}
                    {include.lineAmount && <col className={styles.amountColumn} />}
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col">No.</th>
                      <th scope="col">원문품목</th>
                      {include.stemLength && <th scope="col">길이</th>}
                      <th scope="col" className={styles.matchColumn}>DB 매칭·확인사항</th>
                      {include.boxes && <th scope="col" className={styles.numberCell}>박스</th>}
                      <th scope="col" className={styles.numberCell}>{country === 'CN' ? '단수' : unit || '수량'}</th>
                      {include.stems && <th scope="col" className={styles.numberCell}>송이</th>}
                      {include.unitPrice && <th scope="col" className={styles.numberCell}>단가</th>}
                      {include.lineAmount && <th scope="col" className={styles.numberCell}>금액</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map(({ product, index, review }) => {
                      const key = rowKey(excel, product, index);
                      const isSelected = selected?.rowKey === key;
                      const sourceName = sourceProductName(product);
                      const matchedProduct = review.prodKey == null ? null : erpProducts.find(item =>
                        Number(item.ProdKey) === Number(review.prodKey) && (!country || !item.country || item.country === country));
                      const matchedName = String(matchedProduct?.ProdName || '').trim();
                      const status = review.label;
                      const matchDisabled = typeof onMatch !== 'function' || mappingDisabled;
                      const openMatch = () => {
                        if (matchDisabled) return;
                        setSelected({ excelName: excel.name, rowKey: key });
                        onMatch(product, excel, index);
                      };
                      return (
                        <tr
                          key={key}
                          ref={node => { if (node) rowRefs.current[key] = node; else delete rowRefs.current[key]; }}
                          tabIndex="-1"
                          aria-selected={isSelected}
                          className={`${review.needsReview ? styles.unmatchedRow : ''}${isSelected ? ` ${styles.selectedRow}` : ''}`}
                        >
                          <td className={styles.rowNumber}>{index + 1}</td>
                          <td className={styles.productCell}>
                            <button
                              ref={node => { if (node) matchButtonRefs.current[key] = node; else delete matchButtonRefs.current[key]; }}
                              type="button"
                              className={styles.productMatchButton}
                              data-testid="packing-product-match"
                              title={sourceName}
                              aria-label={`${sourceName} 전산 품목 매칭`}
                              disabled={matchDisabled}
                              onClick={openMatch}
                              onFocus={() => setSelected({ excelName: excel.name, rowKey: key })}
                              onKeyDown={event => handleMatchArrow(event, rowKeys, key)}
                            >
                              {sourceName}
                            </button>
                          </td>
                          {include.stemLength && <td>{hasValue(product.stemLength ?? product.stem_length) ? (product.stemLength ?? product.stem_length) : '—'}</td>}
                          <td className={styles.matchCell}>
                            <div className={styles.matchSummary}>
                              {review.prodKey != null && <strong className={styles.matchTarget}>{matchedName || '전산 품목 정보 없음'}</strong>}
                              <div className={styles.matchActions}>
                                {review.needsReview
                                  ? <button type="button" className={`${styles.statusChip} ${styles.statusAction}`} data-testid="packing-result-status-match"
                                      aria-label={`${status}: ${sourceName} 전산 품목 확인`}
                                      disabled={matchDisabled} onClick={openMatch}>{status}</button>
                                  : <span className={`${styles.statusChip} ${['MANUAL', 'DOCUMENT'].includes(review.status) ? styles.statusAlias : styles.statusMatched}`}>{status}</span>}
                                {productSourceNeedsReview(product) && (
                                  <button type="button" className={`${styles.statusChip} ${styles.statusAction}`} data-testid="packing-result-source-review"
                                    aria-label={`${sourceName} 원문 확인: ${sourceIssueText(product.sourceReview)}`}
                                    onClick={() => onReviewSource?.(product, excel, index)}>
                                    {sourceIssueText(product.sourceReview)} · 확인/수정 열기
                                  </button>
                                )}
                                {review.needsReview && (
                                  <label className={styles.inlineNote}>
                                    <span>사유 메모 (이 화면만)</span>
                                    <input
                                      type="text"
                                      value={notes[key] || ''}
                                      onFocus={() => setSelected({ excelName: excel.name, rowKey: key })}
                                      onChange={event => setNotes(current => ({ ...current, [key]: event.target.value }))}
                                      placeholder="예: 품명 확인 필요"
                                      aria-label={`${sourceName} 미매칭 사유 메모`}
                                    />
                                  </label>
                                )}
                              </div>
                            </div>
                          </td>
                          {include.boxes && <td className={styles.numberCell}>{formatNumber(product.boxes)}</td>}
                          <td className={styles.numberCell}>{formatNumber(product.qty)}</td>
                          {include.stems && <td className={styles.numberCell}>{formatNumber(product.stems)}</td>}
                          {include.unitPrice && <td className={styles.numberCell}>{formatNumber(product.unitPrice, 3)}</td>}
                          {include.lineAmount && <td className={styles.numberCell}>{formatNumber(product.lineAmount, 2)}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {(mismatch || resultTruncated) && (
                <div className={styles.resultNotices} aria-label={`${excel.label || excel.name} 확인 알림`} data-testid="packing-results-issues" data-result-name={excel.name || ''}>
                  {mismatch && (
                    <div className={styles.invoiceNotice} role="status">
                      <strong>인보이스 합계 불일치</strong>
                      <span>{mismatchText(mismatch)}</span>
                    </div>
                  )}
                  {resultTruncated && (
                    <div className={styles.truncatedNotice} role="status">
                      <strong>분석 결과 잘림</strong>
                      <span>일부 인보이스가 누락되었을 수 있습니다.</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </article>
        );
      })}

      {dialogText && (
        <div className={styles.dialogBackdrop} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeDialog(); }}>
          <div ref={dialogRef} className={styles.summaryDialog} role="dialog" aria-modal="true" aria-labelledby="packing-summary-title" data-testid="packing-results-copy-dialog">
            <div className={styles.dialogHeader}>
              <div>
                <h3 id="packing-summary-title">패킹 리스트 이슈 요약</h3>
                <p>{copyStatus}</p>
              </div>
              <button type="button" onClick={closeDialog} aria-label="이슈 요약 닫기">✕</button>
            </div>
            <textarea ref={dialogTextareaRef} readOnly value={dialogText} aria-label="복사할 이슈 요약" />
            <div className={styles.dialogActions}>
              <span role="status">{copyStatus}</span>
              <button type="button" onClick={async () => {
                const status = { set textContent(value) { setCopyStatus(value); } };
                await copyTextarea(dialogTextareaRef.current, status);
              }}>클립보드에 복사</button>
              <button type="button" onClick={closeDialog}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export { buildIssueSummary, formatNumber };
