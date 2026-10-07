import React, { useEffect, useMemo, useRef, useState } from 'react';
import styles from '../../styles/ImportPacking.module.css';

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
  return String(product.name || product.sourceName || '품목명 미상').trim() || '품목명 미상';
}

function mismatchText(mismatch) {
  if (!mismatch || typeof mismatch !== 'object') return '인보이스 합계 불일치';
  const computed = finiteNumber(mismatch.computed);
  const expected = finiteNumber(mismatch.expected);
  if (computed === null || expected === null) return '인보이스 합계 불일치';
  const difference = computed - expected;
  return `패킹 리스트 ${formatNumber(computed, 2)} · 인보이스 ${formatNumber(expected, 2)} · 차이 ${difference > 0 ? '+' : ''}${formatNumber(difference, 2)}`;
}

function buildIssueSummary(excels, country, notes, truncated = false) {
  const lines = ['패킹 리스트 확인 필요 항목'];
  let issueCount = 0;

  excels.forEach(excel => {
    const products = Array.isArray(excel.products) ? excel.products : [];
    const rowIssues = products
      .map((product, index) => ({ product, index, key: rowKey(excel, product, index) }))
      .filter(item => item.product.unmatched);
    const hasMismatch = Boolean(excel.totalMismatch);
    const isTruncated = Boolean(truncated || excel.wasTruncated || excel.truncated);
    if (!rowIssues.length && !hasMismatch && !isTruncated) return;

    lines.push('', excel.label || excel.name || '결과 파일');
    rowIssues.forEach(({ product, key }) => {
      const reason = String(notes[key] || '').trim() || '카탈로그 미매칭';
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

export default function PackingResults({ excels, country, blocked, onDownload, truncated = false }) {
  const [selected, setSelected] = useState(null);
  const [notes, setNotes] = useState({});
  const [dialogText, setDialogText] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const rowRefs = useRef({});
  const issueButtonRefs = useRef({});
  const summaryButtonRef = useRef(null);
  const dialogRef = useRef(null);
  const dialogTextareaRef = useRef(null);
  const safeExcels = Array.isArray(excels) ? excels : [];
  const summary = useMemo(() => buildIssueSummary(safeExcels, country, notes, truncated), [safeExcels, country, notes, truncated]);

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

  const selectIssue = (excelName, key = null, issueKey = key) => {
    setSelected({ excelName, rowKey: key, issueKey });
    if (!key) return;
    setTimeout(() => {
      const row = rowRefs.current[key];
      row?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, 0);
  };

  const handleIssueArrow = (event, issueKeys, currentKey) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const index = issueKeys.indexOf(currentKey);
    if (index < 0 || issueKeys.length < 2) return;
    const offset = event.key === 'ArrowDown' ? 1 : -1;
    const nextKey = issueKeys[(index + offset + issueKeys.length) % issueKeys.length];
    issueButtonRefs.current[nextKey]?.focus();
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
          <h3 className={styles.resultsHeading}>생성 결과</h3>
          <p className={styles.resultsHint}>전체 행을 확인하고 오른쪽 이슈를 선택하면 연결된 행이 강조됩니다.</p>
        </div>
        <button ref={summaryButtonRef} type="button" onClick={openSummary} className={styles.summaryButton} data-testid="packing-results-copy-open">
          이슈 요약 새 창
          {summary.issueCount > 0 && <span className={styles.summaryCount}>{summary.issueCount}</span>}
        </button>
      </div>

      {safeExcels.map((excel, excelIndex) => {
        const products = Array.isArray(excel.products) ? excel.products : [];
        const include = {
          sourceName: products.some(product => hasValue(product.sourceName)),
          stemLength: products.some(product => hasValue(product.stemLength ?? product.stem_length)),
          boxes: products.some(product => hasValue(product.boxes)),
          stems: products.some(product => hasValue(product.stems)),
          unitPrice: products.some(product => hasValue(product.unitPrice)),
          lineAmount: products.some(product => hasValue(product.lineAmount)),
        };
        const rowIssues = products
          .map((product, index) => ({ product, index, key: rowKey(excel, product, index) }))
          .filter(item => item.product.unmatched);
        const mismatch = excel.totalMismatch;
        const resultTruncated = Boolean(truncated || excel.wasTruncated || excel.truncated);
        const issueCount = rowIssues.length + (mismatch ? 1 : 0) + (resultTruncated ? 1 : 0);
        const mismatchIssueKey = `${excel.name}::total-mismatch`;
        const truncatedIssueKey = `${excel.name}::truncated`;
        const issueKeys = [
          ...rowIssues.map(item => item.key),
          ...(mismatch ? [mismatchIssueKey] : []),
          ...(resultTruncated ? [truncatedIssueKey] : []),
        ];
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
              <button
                type="button"
                onClick={() => { if (!downloadBlocked) onDownload(excel.name); }}
                disabled={downloadBlocked}
                className={styles.downloadButton}
              >
                {downloadBlocked ? '🔒 다운로드 차단' : '⬇ 다운로드'}
              </button>
            </header>

            <div className={styles.resultWorkspace}>
              <div className={styles.sheetScroll} role="region" aria-label={`${excel.label || excel.name} 전체 행`} tabIndex="0">
                <table className={styles.resultSheet} data-testid="packing-results-table" data-result-name={excel.name || ''}>
                  <thead>
                    <tr>
                      <th scope="col">No.</th>
                      {include.sourceName && <th scope="col">원문품목</th>}
                      <th scope="col">{include.sourceName ? '매칭품목' : '품목'}</th>
                      {include.stemLength && <th scope="col">길이</th>}
                      {include.boxes && <th scope="col" className={styles.numberCell}>박스</th>}
                      <th scope="col" className={styles.numberCell}>{country === 'CN' ? '단수' : unit || '수량'}</th>
                      {include.stems && <th scope="col" className={styles.numberCell}>송이</th>}
                      {include.unitPrice && <th scope="col" className={styles.numberCell}>단가</th>}
                      {include.lineAmount && <th scope="col" className={styles.numberCell}>금액</th>}
                      <th scope="col">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((product, index) => {
                      const key = rowKey(excel, product, index);
                      const isSelected = selected?.rowKey === key;
                      const status = product.unmatched ? '확인 필요' : product.viaAlias ? '별칭 매칭' : '자동 매칭';
                      return (
                        <tr
                          key={key}
                          ref={node => { if (node) rowRefs.current[key] = node; else delete rowRefs.current[key]; }}
                          tabIndex="-1"
                          aria-selected={isSelected}
                          className={`${product.unmatched ? styles.unmatchedRow : ''}${isSelected ? ` ${styles.selectedRow}` : ''}`}
                        >
                          <td className={styles.rowNumber}>{index + 1}</td>
                          {include.sourceName && <td>{hasValue(product.sourceName) ? product.sourceName : '—'}</td>}
                          <td className={styles.productCell}>{productName(product)}</td>
                          {include.stemLength && <td>{hasValue(product.stemLength ?? product.stem_length) ? (product.stemLength ?? product.stem_length) : '—'}</td>}
                          {include.boxes && <td className={styles.numberCell}>{formatNumber(product.boxes)}</td>}
                          <td className={styles.numberCell}>{formatNumber(product.qty)}</td>
                          {include.stems && <td className={styles.numberCell}>{formatNumber(product.stems)}</td>}
                          {include.unitPrice && <td className={styles.numberCell}>{formatNumber(product.unitPrice, 3)}</td>}
                          {include.lineAmount && <td className={styles.numberCell}>{formatNumber(product.lineAmount, 2)}</td>}
                          <td><span className={`${styles.statusChip} ${product.unmatched ? styles.statusIssue : product.viaAlias ? styles.statusAlias : styles.statusMatched}`}>{status}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <aside className={styles.issueSidebar} aria-label={`${excel.label || excel.name} 이슈`} data-testid="packing-results-issues" data-result-name={excel.name || ''}>
                <div className={styles.issueSidebarHeader}>
                  <strong>확인할 이슈</strong>
                  <span>{issueCount}</span>
                </div>
                {issueCount === 0 && <p className={styles.noIssues}>표시할 이슈가 없습니다.</p>}
                {rowIssues.map(({ product, index, key }) => (
                  <div key={key} className={`${styles.issueItem}${selected?.issueKey === key ? ` ${styles.issueItemSelected}` : ''}`}>
                    <button
                      ref={node => { if (node) issueButtonRefs.current[key] = node; else delete issueButtonRefs.current[key]; }}
                      type="button"
                      onClick={() => selectIssue(excel.name, key, key)}
                      onFocus={() => selectIssue(excel.name, key, key)}
                      onKeyDown={event => handleIssueArrow(event, issueKeys, key)}
                      className={styles.issueLink}
                    >
                      <span>행 {index + 1} · 미매칭</span>
                      <strong>{productName(product)}</strong>
                      <small>{quantityText(product, country)}</small>
                    </button>
                    <label className={styles.noteLabel}>
                      사유 메모 <span>(이 브라우저 화면에만 유지)</span>
                      <input
                        type="text"
                        value={notes[key] || ''}
                        onFocus={() => setSelected({ excelName: excel.name, rowKey: key, issueKey: key })}
                        onChange={event => setNotes(current => ({ ...current, [key]: event.target.value }))}
                        placeholder="예: 품명 확인 필요"
                      />
                    </label>
                  </div>
                ))}
                {mismatch && (
                  <button
                    ref={node => { if (node) issueButtonRefs.current[mismatchIssueKey] = node; else delete issueButtonRefs.current[mismatchIssueKey]; }}
                    type="button"
                    onClick={() => selectIssue(excel.name, null, mismatchIssueKey)}
                    onFocus={() => selectIssue(excel.name, null, mismatchIssueKey)}
                    onKeyDown={event => handleIssueArrow(event, issueKeys, mismatchIssueKey)}
                    className={`${styles.issueLink} ${styles.invoiceIssue}${selected?.issueKey === mismatchIssueKey ? ` ${styles.issueLinkSelected}` : ''}`}
                  >
                    <span>인보이스 합계 불일치</span>
                    <strong>{mismatchText(mismatch)}</strong>
                  </button>
                )}
                {resultTruncated && (
                  <button
                    ref={node => { if (node) issueButtonRefs.current[truncatedIssueKey] = node; else delete issueButtonRefs.current[truncatedIssueKey]; }}
                    type="button"
                    onClick={() => selectIssue(excel.name, null, truncatedIssueKey)}
                    onFocus={() => selectIssue(excel.name, null, truncatedIssueKey)}
                    onKeyDown={event => handleIssueArrow(event, issueKeys, truncatedIssueKey)}
                    className={`${styles.issueLink} ${styles.truncatedIssue}${selected?.issueKey === truncatedIssueKey ? ` ${styles.issueLinkSelected}` : ''}`}
                  >
                    <span>분석 결과 잘림</span>
                    <strong>일부 인보이스가 누락되었을 수 있습니다.</strong>
                  </button>
                )}
              </aside>
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
