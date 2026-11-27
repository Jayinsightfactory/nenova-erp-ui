// components/vision/BoxVisionStep3ResultsPanel.js
// [3단계] 최종 결과표 (업체별 품목·수량·Bill 번호 · 입고 차수 결과표 + 보조탭 A/B)

import Link from 'next/link';
import styles from '../../styles/BoxVisionInspector.module.css';

const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');

export default function BoxVisionStep3ResultsPanel({
  setCurrentStep,
  handleStartNewWork,
  handleOpenNewTabWork,
  totals,
  totalStemsSum,
  allReconciledMatch,
  bill,
  selectedCustomerFilter,
  setSelectedCustomerFilter,
  analysisData,
  filteredCustomerItemRows,
  activeStep3SubTab,
  setActiveStep3SubTab,
  billOrderWeekLedger,
  billSearchQuery,
  setBillSearchQuery,
  liveBillLookupResults,
  linkedDefectKeys,
  handleAttachDefectPhoto,
}) {
  return (
    <div data-testid="wizard-step-3-panel">
      {/* 상단 이동 & 새 작업 액션 바 */}
      <div
        className={styles.stepFooterBar}
        style={{ marginTop: 0, marginBottom: 12 }}
        data-testid="step3-top-nav-bar"
      >
        <div className={styles.sampleChips}>
          <button
            type="button"
            className={styles.btnSecondary}
            data-testid="step3-back-step2-btn"
            onClick={() => setCurrentStep(2)}
          >
            ← 2단계(사진/박스 수정)로 돌아가기
          </button>
          <button
            type="button"
            className={styles.btnSecondary}
            data-testid="step3-back-step1-btn"
            onClick={() => setCurrentStep(1)}
          >
            새 사진 묶음 올리기 (1단계)
          </button>
        </div>
        <div className={styles.sampleChips}>
          <button
            type="button"
            className={styles.btnNewWork}
            data-testid="step3-new-work-reset-btn"
            onClick={() => handleStartNewWork(true)}
          >
            + 새 작업 (초기화 후 1단계로)
          </button>
          <button
            type="button"
            className={styles.btnSecondary}
            data-testid="step3-new-tab-work-btn"
            onClick={handleOpenNewTabWork}
          >
            새 탭에서 새 작업 열기
          </button>
        </div>
      </div>

      {/* 1. 상단 핵심 요약 바 (4개 숫자 타일 + 업체 필터 칩) */}
      <div className={styles.kpiStrip} data-testid="box-vision-kpi-strip">
        <div className={styles.kpiCard}>
          <div className={styles.kpiTitle}>총 출고 박스 / 본수</div>
          <div className={styles.kpiValue} data-testid="kpi-counted-boxes">
            {fmt(totals.countedBoxes)}박스 / {fmt(totalStemsSum)}본
          </div>
          <div className={styles.kpiSub}>
            사진 {fmt(totals.photoCount)}장 통합 (중복 {fmt(totals.duplicateBoxes)}박스 제외)
          </div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiTitle}>전산 출고 대조 상태</div>
          <div className={styles.kpiValue} data-testid="kpi-customer-item-count">
            {allReconciledMatch ? '전산 100% 일치' : `${fmt(totals.itemLineCount)}품목 대조`}
          </div>
          <div className={styles.kpiSub}>
            {fmt(totals.customerCount)}개 업체 · {fmt(totals.itemLineCount)}개 품목 라인
          </div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiTitle}>확인된 Bill 번호 수</div>
          <div className={styles.kpiValue} data-testid="kpi-bill-orderweek">
            Bill {fmt(totals.billCount || 1)}건
          </div>
          <div className={styles.kpiSub}>
            주 Bill #{bill.invoiceNo || '1222993'} (AWB {bill.awbNo || '180-9162-6441'})
          </div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiTitle}>입고 차수</div>
          <div className={styles.kpiValue}>
            {(totals.distinctOrderWeeks || ['47-02']).map((w) => `${w}차`).join(' / ')}
          </div>
          <div className={styles.kpiSub}>
            {bill.primaryFarm || 'Holex'} ({bill.countryName || '네덜란드'}) 입고분
          </div>
        </div>
      </div>

      {/* 2. 메인 표: [업체별 × 품목별 × 수량 × Bill 번호 × 입고 차수 체크표] (핵심 7열) */}
      <section className={styles.panelCard} data-testid="box-vision-reconcile-panel">
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>
            업체별 × 품목별 × 수량 × Bill 번호 × 입고 차수 결과표
          </h2>
          <div className={styles.sampleChips} data-testid="step3-customer-filter-chips">
            <button
              type="button"
              data-testid="customer-filter-chip-ALL"
              className={selectedCustomerFilter === 'ALL' ? styles.sampleChipActive : styles.sampleChip}
              onClick={() => setSelectedCustomerFilter('ALL')}
            >
              전체 업체 보기 ({fmt(totals.countedBoxes)}박스)
            </button>
            {(analysisData?.customerTotals || []).map((ct) => {
              const isChipActive = String(selectedCustomerFilter) === String(ct.custKey);
              return (
                <button
                  key={ct.custKey || ct.custName}
                  type="button"
                  data-testid={`customer-filter-chip-${ct.custKey}`}
                  className={isChipActive ? styles.sampleChipActive : styles.sampleChip}
                  onClick={() =>
                    setSelectedCustomerFilter(isChipActive ? 'ALL' : ct.custKey)
                  }
                >
                  {ct.custName} ({fmt(ct.totalBoxes)}박스)
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.dataTable} data-testid="box-vision-reconcile-table">
            <thead>
              <tr>
                <th>업체명</th>
                <th>품목명(규격)</th>
                <th className={styles.numCell}>사진 수량(박스/본수)</th>
                <th className={styles.numCell}>전산 출고량</th>
                <th>대조 상태</th>
                <th>Bill 번호 (AWB)</th>
                <th>Bill 기준 입고 차수 (농장)</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomerItemRows.map((row) => (
                <tr key={row.groupKey} data-testid={`reconcile-row-${row.custKey}-${row.prodKey}`}>
                  <td>
                    <strong>{row.custName}</strong>
                    <div style={{ fontSize: 12.5, color: '#475569' }}>
                      {row.custCode} ({row.photoAppearanceLabel})
                    </div>
                  </td>
                  <td>
                    <strong>{row.prodName}</strong>
                    <div style={{ fontSize: 12.5, color: '#334155' }}>
                      {row.flowerName} · 규격: {(row.boxSpecs || []).join(', ') || '표준'}
                    </div>
                  </td>
                  <td className={styles.numCell}>
                    <strong>{fmt(row.photoBoxCount)}박스</strong> /{' '}
                    <strong>
                      {fmt(row.photoTotalQty)}
                      {row.unit}
                    </strong>
                    {row.photoTotalStems !== row.photoTotalQty ? (
                      <div style={{ fontSize: 12.5, color: '#334155' }}>({fmt(row.photoTotalStems)}본)</div>
                    ) : null}
                  </td>
                  <td className={styles.numCell}>
                    <strong>{fmt(row.erpBoxQty)}박스</strong> / {fmt(row.erpOutQty)}
                    {row.unit}
                  </td>
                  <td>
                    <span className={row.reconcileStatus === 'MATCH' ? styles.badgeMatch : styles.badgeWarn}>
                      {row.inspectionBadge}
                    </span>
                  </td>
                  <td>
                    <strong>Bill #{row.invoiceNo}</strong>
                    <div style={{ fontSize: 12.5, color: '#475569' }}>AWB {row.awbNo}</div>
                  </td>
                  <td>
                    <span
                      className={styles.badgeMatch}
                      data-testid={`bill-check-badge-${row.custKey}-${row.prodKey}`}
                    >
                      {row.orderWeekLabel || `${row.orderYear}년 ${row.orderWeek}차 입고`}
                    </span>
                    <span style={{ fontSize: 12.5, color: '#0f172a', marginLeft: 6 }}>
                      ({row.farmName} · {row.countryName})
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3. 하단 보조 탭 */}
      <div className={styles.subTabBar} data-testid="step3-subtab-bar">
        <button
          type="button"
          data-testid="step3-subtab-bill"
          className={activeStep3SubTab === 'BILL_LEDGER' ? styles.subTabBtnActive : styles.subTabBtn}
          onClick={() =>
            setActiveStep3SubTab(activeStep3SubTab === 'BILL_LEDGER' ? 'CLOSED' : 'BILL_LEDGER')
          }
        >
          보조탭 A. Bill 번호별 입고 차수 요약 & Bill 번호 직접 조회기
        </button>
        <button
          type="button"
          data-testid="step3-subtab-defect-color"
          className={activeStep3SubTab === 'DEFECT_AND_COLOR' ? styles.subTabBtnActive : styles.subTabBtn}
          onClick={() =>
            setActiveStep3SubTab(
              activeStep3SubTab === 'DEFECT_AND_COLOR' ? 'CLOSED' : 'DEFECT_AND_COLOR'
            )
          }
        >
          보조탭 B. 불량차감 사진 매칭 ({fmt((analysisData?.matchedDefects || []).length)}건) & 농장 박스 색상 사전
        </button>
      </div>

      {activeStep3SubTab === 'BILL_LEDGER' && (
        <section className={styles.panelCard} data-testid="box-vision-bill-orderweek-panel">
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>
              Bill 번호별 입고 차수 요약 및 실시간 Bill 조회기
            </h2>
            <span className={styles.badgeMatch}>{analysisData?.mixedOrderWeekNotice}</span>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.dataTable} data-testid="box-vision-bill-ledger-table">
              <thead>
                <tr>
                  <th>Bill 번호</th>
                  <th>AWB 송장번호</th>
                  <th>Bill 기준 입고 차수</th>
                  <th>입고 농장 (국가)</th>
                  <th>해당 업체</th>
                  <th className={styles.numCell}>사진 검출 박스 / 입고량</th>
                  <th>확인 상태</th>
                </tr>
              </thead>
              <tbody>
                {billOrderWeekLedger.map((bRow) => (
                  <tr key={bRow.invoiceNo} data-testid={`bill-ledger-row-${bRow.invoiceNo}`}>
                    <td>
                      <strong>Bill #{bRow.invoiceNo}</strong>
                    </td>
                    <td>AWB {bRow.awbNo}</td>
                    <td>
                      <span className={bRow.orderWeek === '47-02' ? styles.badgeMatch : styles.badgeWarn}>
                        {bRow.orderWeekLabel}
                      </span>
                    </td>
                    <td>
                      <strong>{bRow.farmName}</strong> ({bRow.countryName})
                    </td>
                    <td>{(bRow.customerNames || []).join(' · ')}</td>
                    <td className={styles.numCell}>
                      <strong>{fmt(bRow.totalDetectedBoxes)}박스</strong> / 입고 {fmt(bRow.totalInboundBoxes)}박스
                    </td>
                    <td>
                      <span className={bRow.totalDetectedBoxes > 0 ? styles.badgeMatch : styles.badgeNeutral}>
                        {bRow.checkStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.lookupBox} data-testid="box-vision-bill-lookup-box">
            <div className={styles.batchRow} style={{ marginBottom: 6 }}>
              <label htmlFor="bill-orderweek-lookup-input" style={{ fontWeight: 700, fontSize: 13.5 }}>
                Bill 번호 / AWB / 오더번호 직접 조회:
              </label>
              <div className={styles.routeInputGroup}>
                <input
                  id="bill-orderweek-lookup-input"
                  type="text"
                  className={styles.textInput}
                  data-testid="bill-orderweek-lookup-input"
                  value={billSearchQuery}
                  onChange={(e) => setBillSearchQuery(e.target.value)}
                  placeholder="예: 1222993, 180-9162-6441, 2026YY-055, 201693, 2494510"
                />
                {['1222993', '2026YY-055', '201693', '201694', '2494510'].map((kw) => (
                  <button
                    key={kw}
                    type="button"
                    data-testid={`bill-quick-query-${kw}`}
                    className={billSearchQuery === kw ? styles.sampleChipActive : styles.sampleChip}
                    onClick={() => setBillSearchQuery(billSearchQuery === kw ? '' : kw)}
                  >
                    #{kw}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ fontSize: 13, color: '#0f172a' }} data-testid="bill-orderweek-lookup-result">
              {liveBillLookupResults.map((res) => (
                <div key={`lookup-${res.invoiceNo}`} style={{ marginTop: 4 }}>
                  <span className={styles.badgeMatch}>조회 결과</span>{' '}
                  <strong>Bill #{res.invoiceNo}</strong> (AWB <strong>{res.awbNo}</strong>) →{' '}
                  <strong>{res.orderWeekLabel}</strong> · <strong>{res.farmName} ({res.countryName})</strong> · 거래처:{' '}
                  {(res.distributedCustomers || []).join(', ')}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {activeStep3SubTab === 'DEFECT_AND_COLOR' && (
        <div data-testid="step3-defect-and-color-wrap">
          <section className={styles.panelCard} data-testid="box-vision-defect-panel">
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>
                영업수입불량차감 불량품목 사진 매칭 및 농장/Bill/차수 반영
              </h2>
              <Link href="/sales/defect-deductions?year=2026&week=47" className={styles.btnSecondary}>
                영업수입불량차감 화면 열기
              </Link>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.dataTable} data-testid="box-vision-defect-table">
                <thead>
                  <tr>
                    <th>차감번호</th>
                    <th>업체명 · 차수</th>
                    <th>불량 품목명 · 수량</th>
                    <th>매칭 농장 · Bill</th>
                    <th>판독 근거</th>
                    <th>반영</th>
                  </tr>
                </thead>
                <tbody>
                  {(analysisData?.matchedDefects || []).map((defect) => {
                    const linked = linkedDefectKeys[defect.deductionKey];
                    return (
                      <tr key={defect.deductionKey}>
                        <td>
                          <strong>#{defect.deductionKey}</strong>
                        </td>
                        <td>
                          <strong>{defect.custName}</strong> ({defect.appliedOrderWeek}차)
                        </td>
                        <td>
                          <strong>{defect.prodName}</strong> ({fmt(defect.quantity)} {defect.sourceUnit})
                        </td>
                        <td>
                          <strong>{defect.farmName}</strong> · Bill #{defect.invoiceNo}
                        </td>
                        <td style={{ fontSize: 12.5 }}>{defect.matchReason}</td>
                        <td>
                          {linked ? (
                            <span
                              className={styles.badgeMatch}
                              data-testid={`defect-linked-badge-${defect.deductionKey}`}
                            >
                              반영됨 ({linked.linkedAt})
                            </span>
                          ) : (
                            <button
                              type="button"
                              className={styles.btnPrimary}
                              data-testid={`defect-attach-btn-${defect.deductionKey}`}
                              onClick={() => handleAttachDefectPhoto(defect)}
                            >
                              사진·농장/차수 반영
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.panelCard} data-testid="box-vision-farm-profile-panel">
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>농장별 박스 색상 및 라벨 3단계 판별 사전</h2>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>박스 외형 · 색상</th>
                    <th>확정 농장 (국가)</th>
                    <th>판별 근거</th>
                  </tr>
                </thead>
                <tbody>
                  {(analysisData?.farmBoxProfiles || []).map((prof) => (
                    <tr key={prof.profileId}>
                      <td>
                        <strong>{prof.colorLabel}</strong>
                      </td>
                      <td>
                        <span className={styles.badgeMatch}>
                          {prof.primaryFarm} ({prof.countryName})
                        </span>
                      </td>
                      <td style={{ fontSize: 12.5 }}>{prof.disambiguationRule}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* 하단 이동 & 새 작업 액션 바 */}
      <div className={styles.stepFooterBar} data-testid="step3-bottom-nav-bar">
        <div className={styles.sampleChips}>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={() => setCurrentStep(2)}
          >
            ← 2단계(사진/박스 수정)로 돌아가기
          </button>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={() => setCurrentStep(1)}
          >
            새 사진 묶음 올리기 (1단계)
          </button>
        </div>
        <div className={styles.sampleChips}>
          <button
            type="button"
            className={styles.btnNewWork}
            onClick={() => handleStartNewWork(true)}
          >
            + 새 작업 (초기화 후 다시 작업)
          </button>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={handleOpenNewTabWork}
          >
            새 탭에서 새 작업 열기
          </button>
        </div>
      </div>
    </div>
  );
}
