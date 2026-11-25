import { useEffect, useRef } from 'react';
import { downloadPurchaseOrderWorkbook } from '../lib/dailyStaffPurchaseOrderWorkbook';
import styles from './FarmWeekBoard.module.css';

const fmtNum = value => Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 3 });

export default function DailyOrderSheetModal({
  open,
  onClose,
  triggerRef,
  data,
  loading,
  error,
  onSelectStaff,
  onSelectScope,
}) {
  const downloadBtnRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const focusTimer = setTimeout(() => {
      downloadBtnRef.current?.focus();
    }, 0);
    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      triggerRef?.current?.focus?.();
    };
  }, [open, onClose, triggerRef]);

  if (!open) return null;

  const sheet = data?.sheet || null;
  const isAdmin = Boolean(data?.isAdmin);
  const staffOptions = data?.staffOptions || [];
  const showDirectToggle =
    !isAdmin &&
    Number(data?.totalMatchCount || 0) > 0 &&
    Number(data?.directMatchCount || 0) > 0 &&
    Number(data?.directMatchCount || 0) < Number(data?.totalMatchCount || 0);

  function handleDownload() {
    if (!sheet || !sheet.detailRows?.length) return;
    downloadPurchaseOrderWorkbook(sheet);
  }

  return (
    <div
      className={styles.modalBackdrop}
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={styles.modalDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-po-modal-title"
      >
        <header className={styles.modalHeader}>
          <div className={styles.modalTitleGroup}>
            <div className={styles.modalPurposeTag}>[핵심 목적 · 당일 전산·웹 주문등록 전체 차수 원장 대조 및 발주서 즉시 추출]</div>
            <h2 id="daily-po-modal-title">
              화훼 발주 내역서
              {data?.selectedStaffName ? ` · ${data.selectedStaffName}` : ''}
            </h2>
            <p className={styles.modalMeta}>
              기준일 {data?.date || sheet?.dateText || '-'} (KST 당일 등록 전 차수 통합)
              {sheet ? (
                <>
                  {' · '}거래처 <strong>{fmtNum(sheet.customerCount)}곳</strong>
                  {' · '}품목 <strong>{fmtNum(sheet.itemCount)}건</strong>
                  {' · '}단순 수량 합계 <strong>{fmtNum(sheet.totalQty)}</strong>
                  {sheet.includedWeeks?.length > 0 ? (
                    <>
                      {' · '}포함 차수 <strong>{sheet.includedWeeks.join(', ')}</strong>
                    </>
                  ) : null}
                </>
              ) : null}
            </p>
          </div>
          <div className={styles.modalActions}>
            <button
              ref={downloadBtnRef}
              type="button"
              className={styles.downloadBtn}
              onClick={handleDownload}
              disabled={loading || !sheet?.detailRows?.length}
            >
              엑셀 다운로드 (.xlsx)
            </button>
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
            >
              닫기 (Esc)
            </button>
          </div>
        </header>

        {isAdmin && staffOptions.length > 0 && (
          <div className={styles.modalControlBar} role="group" aria-label="관리자 담당자별 내역 전환">
            <span className={styles.modalControlLabel}>담당자 선택</span>
            <div className={styles.modalChipList}>
              {staffOptions.map(option => (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={data?.selectedStaffKey === option.key}
                  onClick={() => onSelectStaff?.(option.key)}
                  disabled={loading}
                >
                  {option.name} ({fmtNum(option.count)}건)
                </button>
              ))}
            </div>
          </div>
        )}

        {showDirectToggle && (
          <div className={styles.modalControlBar} role="group" aria-label="조회 범위 선택">
            <span className={styles.modalControlLabel}>조회 기준</span>
            <div className={styles.modalChipList}>
              <button
                type="button"
                aria-pressed={data?.selectedScope !== 'direct'}
                onClick={() => onSelectScope?.('all')}
                disabled={loading}
              >
                내 담당 전체 ({fmtNum(data.totalMatchCount)}건)
              </button>
              <button
                type="button"
                aria-pressed={data?.selectedScope === 'direct'}
                onClick={() => onSelectScope?.('direct')}
                disabled={loading}
              >
                본인 직접입력분 ({fmtNum(data.directMatchCount)}건)
              </button>
            </div>
          </div>
        )}

        <div className={styles.modalBody}>
          {loading ? (
            <p role="status" className={styles.modalStatus}>당일 주문등록 내역을 불러오는 중…</p>
          ) : error ? (
            <p role="alert" className={styles.error}>{error}</p>
          ) : !sheet || !sheet.detailRows.length ? (
            <p className={styles.modalStatus}>당일 등록된 주문 내역이 없습니다.</p>
          ) : (
            <>
              <div className={styles.sheetFilenameRow}>
                <span>엑셀 저장 파일명: <strong>{sheet.filename}</strong></span>
                <span>비고란에 각 주문 행의 발주 차수(예: 48-01차 / 기존비고)가 자동 표시됩니다.</span>
              </div>

              <section aria-label="화훼 발주 내역서 본표" className={styles.sheetSection}>
                <h3 className={styles.sheetSectionHeading}>화훼 발주 내역서 (본표)</h3>
                <div className={styles.modalTableWrap}>
                  <table className={styles.poTable}>
                    <thead>
                      <tr>
                        <th style={{ width: 58 }}>No.</th>
                        <th style={{ width: 190 }}>거래처</th>
                        <th style={{ width: 130 }}>품목(대분류)</th>
                        <th>상세품종 / 규격</th>
                        <th style={{ width: 96 }}>수량</th>
                        <th style={{ width: 84 }}>단위</th>
                        <th style={{ width: 210 }}>비고</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sheet.detailRows.map(row => (
                        <tr key={row.no} className={row.isNewCustomer && row.no > 1 ? styles.poGroupRow : ''}>
                          <td className={styles.poCenter}>{row.no}</td>
                          <td className={row.customerDisplay ? styles.poBold : styles.poMuted} title={row.custName}>
                            {row.customerDisplay}
                          </td>
                          <td className={row.categoryDisplay ? styles.poBold : styles.poMuted} title={row.category}>
                            {row.categoryDisplay}
                          </td>
                          <td>{row.detailDisplay}</td>
                          <td className={styles.poRight}>{fmtNum(row.qty)}</td>
                          <td className={styles.poCenter}>{row.unit}</td>
                          <td>{row.remark}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={4}>{sheet.detailTotalRow.labelA}</td>
                        <td className={styles.poRight}>{fmtNum(sheet.detailTotalRow.totalQty)}</td>
                        <td className={styles.poCenter}>{sheet.detailTotalRow.countLabelF}</td>
                        <td>{sheet.detailTotalRow.noteG}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>

              <section aria-label="거래처별 발주 요약" className={styles.sheetSection}>
                <h3 className={styles.sheetSectionHeading}>거래처별 발주 요약</h3>
                <div className={styles.modalTableWrap}>
                  <table className={styles.poTable}>
                    <thead>
                      <tr>
                        <th style={{ width: 210 }}>거래처</th>
                        <th style={{ width: 105 }}>품목 건수</th>
                        <th style={{ width: 130 }}>단순 수량 합계</th>
                        <th>주요 발주 내역 요약</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sheet.customerSummaryRows.map(item => (
                        <tr key={item.custName}>
                          <td className={styles.poBold}>{item.custName}</td>
                          <td className={styles.poRight}>{fmtNum(item.itemCount)}</td>
                          <td className={styles.poRight}>{fmtNum(item.totalQty)}</td>
                          <td>{item.summaryText}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>{sheet.customerSummaryTotalRow.labelA}</td>
                        <td className={styles.poRight}>{fmtNum(sheet.customerSummaryTotalRow.totalCount)}</td>
                        <td className={styles.poRight}>{fmtNum(sheet.customerSummaryTotalRow.totalQty)}</td>
                        <td>{sheet.customerSummaryTotalRow.customerCountLabel}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
