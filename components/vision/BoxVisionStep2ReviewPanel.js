// components/vision/BoxVisionStep2ReviewPanel.js
// [2단계] 미식별 · 지그재그 옆면 박스 확인 패널 (좌측 50% 캔버스 / 우측 50% 미식별 처리 카드)

import {
  buildUnreadableBoxSearchCandidates,
  CAMERA_ANGLE_OPTIONS,
  SEARCHABLE_PRODUCT_CATALOG,
} from '../../lib/boxVisionInspector';
import { CUSTOMER_OPTIONS } from '../../lib/boxVision/clientCanvasMeta';
import styles from '../../styles/BoxVisionInspector.module.css';

const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');

export default function BoxVisionStep2ReviewPanel({
  analyzedPhotos,
  activePhotoIndex,
  setActivePhotoIndex,
  currentPhoto,
  handlePhotoAngleChange,
  displayImageUrl,
  selectedBox,
  setSelectedBoxId,
  handleOpenSearchMatcher,
  toggleBoxInclusion,
  showSelectedBoxDetail,
  setShowSelectedBoxDetail,
  handleMarkBoxAsUnreadable,
  pendingQueue,
  confirmedNormalBoxesCount,
  totals,
  showConfirmedBoxesCollapse,
  setShowConfirmedBoxesCollapse,
  analysisData,
  handleBatchAutoDeduceZigzag,
  handleBatchPassAllUnreadable,
  activeMatcherBoxId,
  setActiveMatcherBoxId,
  matcherSearchQuery,
  setMatcherSearchQuery,
  matcherSelectedCandidate,
  setMatcherSelectedCandidate,
  matcherQtyPerBox,
  setMatcherQtyPerBox,
  matcherCustKey,
  setMatcherCustKey,
  handleConfirmZigzagDeductionSingle,
  handlePassUnreadableBox,
  handleConfirmSearchMatch,
  resolvedQueue,
  setCurrentStep,
}) {
  return (
    <div data-testid="wizard-step-2-panel">
      {/* 상단 심플 필름스트립 (1/N ~ N/N 사진 전환 + 촬영면 정면/좌/우 심플 버튼) */}
      <section className={styles.batchControlCard} data-testid="box-vision-filmstrip">
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <div className={styles.sampleChips}>
            <span style={{ fontWeight: 700, fontSize: 13.5, alignSelf: 'center', marginRight: 4 }}>
              묶음 사진 선택 ({fmt(analyzedPhotos.length)}장):
            </span>
            {analyzedPhotos.map((p, idx) => {
              const isCurr = idx === activePhotoIndex;
              return (
                <button
                  key={`step2-film-${p.sampleId}-${idx}`}
                  type="button"
                  className={isCurr ? styles.filmThumbActive : styles.filmThumb}
                  data-testid={`filmstrip-photo-${idx + 1}`}
                  onClick={() => setActivePhotoIndex(idx)}
                >
                  사진 {idx + 1}/{analyzedPhotos.length} ({p.countedBoxes}박스
                  {p.unreadablePendingBoxes > 0 ? ` · 확인 ${p.unreadablePendingBoxes}` : ''})
                </button>
              );
            })}
          </div>

          {currentPhoto && (
            <div className={styles.sampleChips}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: '#334155', alignSelf: 'center' }}>
                촬영면:
              </span>
              {CAMERA_ANGLE_OPTIONS.map((ang) => {
                const isAngleActive = (currentPhoto.cameraAngle || 'front') === ang.angleId;
                return (
                  <button
                    key={ang.angleId}
                    type="button"
                    data-testid={`photo-angle-btn-${ang.angleId}`}
                    className={isAngleActive ? styles.sampleChipActive : styles.sampleChip}
                    style={{ padding: '4px 9px', fontSize: 12.5 }}
                    onClick={() => handlePhotoAngleChange(currentPhoto.sampleId, ang.angleId)}
                  >
                    {ang.shortLabel}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <div className={styles.step2SplitGrid}>
        {/* 좌측(50%): 사진 캔버스 (깔끔한 번호 중심 오버레이: #1 신라·안시리움 40송이 또는 [#19 확인필요]) */}
        <section className={styles.panelCard} data-testid="box-vision-canvas-panel">
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>
              사진 {activePhotoIndex + 1}/{analyzedPhotos.length || 1} · {currentPhoto?.shortLabel || '사진 #1'}
            </h2>
            <span className={styles.badgeMatch}>
              유효 {currentPhoto?.countedBoxes || 0}박스 (확인필요 {currentPhoto?.unreadablePendingBoxes || 0}건)
            </span>
          </div>

          <div className={styles.canvasStage} data-testid="box-vision-stage">
            <div className={styles.scanBeam} aria-hidden="true" />
            <img
              src={displayImageUrl}
              alt={currentPhoto?.title || '창고 박스 스캔 이미지'}
              className={styles.stageImage}
            />
            {(currentPhoto?.boxes || []).map((box) => {
              const isSelected = selectedBox?.boxId === box.boxId;
              const isPendingUnreadable = Boolean(box.isPendingUnreadable);
              const isPassed = box.resolutionAction === 'passed';
              const isDup = box.status === 'DUPLICATE' || (box.status === 'EXCLUDED' && !isPassed);
              const isBg = box.status === 'BACKGROUND';

              const boxClass = [
                styles.boxOverlay,
                isSelected ? styles.boxOverlaySelected : '',
                isPendingUnreadable ? styles.boxOverlayUnreadable : '',
                isPassed ? styles.boxOverlayPassed : '',
                isDup ? styles.boxOverlayDuplicate : '',
                isBg ? styles.boxOverlayBackground : '',
              ]
                .filter(Boolean)
                .join(' ');

              const capsuleClass = [
                styles.boxCapsule,
                isPendingUnreadable ? styles.boxCapsuleUnreadable : '',
                isPassed ? styles.boxCapsulePassed : '',
                isDup ? styles.boxCapsuleDup : '',
                isBg ? styles.boxCapsuleBg : '',
              ]
                .filter(Boolean)
                .join(' ');

              const seqNum = box.countSeq || box.boxSeq;
              const shortCust = String(box.custName || '').replace(/호텔|농원|원예/g, '');
              const shortOverlayLabel = isPendingUnreadable
                ? `[#${seqNum} 확인필요]`
                : isPassed
                ? `[#${seqNum} 패스]`
                : isDup
                ? '[중복제외]'
                : isBg
                ? '[배경분리]'
                : `#${seqNum} ${shortCust}·${box.flowerName} ${box.qtyPerBox}${box.unit}`;

              return (
                <div
                  key={box.boxId}
                  role="button"
                  tabIndex={0}
                  data-testid={`canvas-box-${box.boxId}`}
                  className={boxClass}
                  style={{
                    left: `${box.bbox?.x ?? box.x ?? 0}%`,
                    top: `${box.bbox?.y ?? box.y ?? 0}%`,
                    width: `${box.bbox?.w ?? box.w ?? 20}%`,
                    height: `${box.bbox?.h ?? box.h ?? 15}%`,
                  }}
                  title={`#${seqNum} ${box.custName} | ${box.prodName} (${box.qtyPerBox}${box.unit}) | Bill #${box.invoiceNo} (${box.orderWeek}차)`}
                  onClick={() => {
                    setSelectedBoxId(box.boxId);
                    if (isPendingUnreadable) {
                      handleOpenSearchMatcher(box);
                    } else {
                      toggleBoxInclusion(box);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedBoxId(box.boxId);
                      if (isPendingUnreadable) {
                        handleOpenSearchMatcher(box);
                      } else {
                        toggleBoxInclusion(box);
                      }
                    }
                  }}
                >
                  <span className={capsuleClass}>{shortOverlayLabel}</span>
                </div>
              );
            })}
          </div>

          <div className={styles.formulaBar} data-testid="box-vision-formula-bar">
            <div>
              <span className={styles.formulaProgress}>
                [유효 {currentPhoto?.countedBoxes || 0}박스 / 전체 {(currentPhoto?.boxes || []).length}박스]
              </span>{' '}
              박스 번호를 클릭하면 포함/제외 또는 매칭 창이 열립니다.
            </div>
            {selectedBox && (
              <button
                type="button"
                className={styles.btnSecondary}
                style={{ padding: '3px 8px', fontSize: 12.5 }}
                onClick={() => setShowSelectedBoxDetail((prev) => !prev)}
              >
                {showSelectedBoxDetail ? '선택 박스 상세 닫기' : `선택 박스(#${selectedBox.countSeq || selectedBox.boxSeq}) 상세`}
              </button>
            )}
          </div>

          {showSelectedBoxDetail && selectedBox && (
            <div
              style={{
                marginTop: 8,
                padding: '8px 10px',
                background: '#f8fafc',
                border: '1px solid #cbd5e1',
                borderRadius: 5,
                fontSize: 12.5,
              }}
              data-testid="box-vision-selected-detail"
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div>
                  <strong>일련번호 {selectedBox.serialNo}</strong> · {selectedBox.custName} ({selectedBox.labelCode}) ·{' '}
                  <strong>{selectedBox.prodName}</strong> ({fmt(selectedBox.qtyPerBox)}
                  {selectedBox.unit}) · Bill #{selectedBox.invoiceNo} ({selectedBox.orderWeek}차)
                </div>
                {!selectedBox.isPendingUnreadable && (
                  <button
                    type="button"
                    className={styles.btnWarn}
                    style={{ padding: '3px 8px', fontSize: 12.5 }}
                    data-testid="mark-selected-box-unreadable-btn"
                    onClick={() => handleMarkBoxAsUnreadable(selectedBox, 'unreadable_both')}
                  >
                    미식별로 전환
                  </button>
                )}
              </div>
            </div>
          )}
        </section>

        {/* 우측(50%): 확인 필요한 박스 목록 (미식별 / 지그재그 옆면) 처리 카드 */}
        <section className={styles.unreadablePanelCard} data-testid="box-vision-unreadable-queue-panel">
          <div className={styles.panelHeader}>
            <div>
              <h2 className={styles.panelTitle}>
                확인 필요한 박스 목록 (미식별 / 지그재그 옆면: {fmt(pendingQueue.length)}건)
              </h2>
              <div style={{ fontSize: 12.5, color: '#78350f', marginTop: 2 }}>
                각 박스에 대해 <strong>[추천 품목 1클릭 확정]</strong> · <strong>[검색 매칭]</strong> · <strong>[패스]</strong> 중 하나만 선택하세요.
              </div>
            </div>
          </div>

          {/* 정상 판독 완료 박스 한 줄 요약 (접어두기) */}
          <div
            style={{
              background: '#ecfdf5',
              border: '1px solid #86efac',
              borderRadius: 5,
              padding: '8px 12px',
              marginBottom: 10,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              fontSize: 13,
              color: '#065f46',
            }}
            data-testid="step2-confirmed-summary-bar"
          >
            <div>
              <strong>정상 판독 {fmt(confirmedNormalBoxesCount)}박스 완료</strong>
              {totals.duplicateBoxes > 0 ? ` (중복 ${fmt(totals.duplicateBoxes)}박스 자동제외)` : ''}
            </div>
            <button
              type="button"
              className={styles.sampleChip}
              style={{ padding: '3px 8px', fontSize: 12.5 }}
              onClick={() => setShowConfirmedBoxesCollapse((prev) => !prev)}
            >
              {showConfirmedBoxesCollapse ? '정상 판독 내역 접기 ▲' : '정상 판독 내역 보기 ▼'}
            </button>
          </div>

          {showConfirmedBoxesCollapse && (
            <div
              style={{
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: 5,
                padding: '8px 10px',
                marginBottom: 10,
                fontSize: 12.5,
              }}
            >
              {(analysisData?.customerTotals || []).map((ct) => (
                <div key={ct.custKey || ct.custName} style={{ marginBottom: 4 }}>
                  <strong>{ct.custName}</strong>: {fmt(ct.itemKindCount)}품목 · {fmt(ct.totalBoxes)}박스 (Bill #
                  {(ct.invoiceNos || ['1222993']).join(',')} · {(ct.orderWeeks || ['47-02']).join(',')}차)
                </div>
              ))}
            </div>
          )}

          {/* 상단 원클릭 일괄 버튼 2개 */}
          {pendingQueue.length > 0 && (
            <div className={styles.sampleChips} style={{ marginBottom: 10 }}>
              <button
                type="button"
                className={styles.btnPrimary}
                data-testid="zigzag-batch-auto-deduce-btn"
                onClick={() => handleBatchAutoDeduceZigzag(true)}
              >
                지그재그 옆면 박스 → 전산 잔여 품목 자동 매칭 (일괄 {fmt(pendingQueue.length)}건)
              </button>
              <button
                type="button"
                className={styles.btnPass}
                data-testid="unreadable-batch-pass-exclude-btn"
                onClick={() => handleBatchPassAllUnreadable('exclude_count')}
              >
                남은 미식별 박스 전체 패스
              </button>
            </div>
          )}

          {/* 미식별 / 옆면 박스 카드 리스트 */}
          <div className={styles.unreadableQueueList}>
            {pendingQueue.length === 0 ? (
              <div
                style={{
                  background: '#ffffff',
                  border: '1px solid #86efac',
                  borderLeft: '4px solid #059669',
                  borderRadius: 6,
                  padding: '14px 16px',
                  color: '#065f46',
                  fontSize: 13.5,
                  fontWeight: 600,
                }}
                data-testid="step2-all-resolved-banner"
              >
                모든 미식별·옆면 박스 확인이 완료되었습니다. 우측 하단 버튼을 눌러 3단계 최종 결과표로 이동하세요.
              </div>
            ) : (
              pendingQueue.map((uBox) => {
                const isMatcherOpen = activeMatcherBoxId === uBox.boxId;
                const liveCandidates = buildUnreadableBoxSearchCandidates(uBox, {
                  allBoxes: analysisData?.allBoxes || [],
                  productCatalog: analysisData?.searchableProducts || SEARCHABLE_PRODUCT_CATALOG,
                  searchQuery: isMatcherOpen ? matcherSearchQuery : '',
                });
                const activeCandidate =
                  (isMatcherOpen && matcherSelectedCandidate) ||
                  liveCandidates[0] ||
                  (uBox.recommendedCandidates && uBox.recommendedCandidates[0]) ||
                  null;

                const isZigzag = uBox.boxFace === 'zigzag_side';
                const dedCand = uBox.deductionCandidate;
                const seqNum = uBox.countSeq || uBox.boxSeq;

                return (
                  <div
                    key={uBox.boxId}
                    className={styles.unreadableItemCard}
                    data-testid={`unreadable-queue-item-${uBox.boxId}`}
                  >
                    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 6 }}>
                      <div>
                        <span className={styles.badgeWarn} data-testid={`box-face-badge-${uBox.boxId}`}>
                          {isZigzag ? '지그재그 옆면' : '라벨 미식별'}
                        </span>{' '}
                        <strong>
                          #{seqNum} · {uBox.custName} (사진 #{uBox.photoNumber} · {uBox.boxSpec})
                        </strong>
                      </div>
                      <span className={styles.badgeNeutral}>
                        Bill #{uBox.invoiceNo} · {uBox.orderWeek}차
                      </span>
                    </div>

                    {dedCand && (
                      <div
                        style={{ fontSize: 13, color: '#0f766e', fontWeight: 600, marginTop: 5 }}
                        data-testid={`deduction-candidate-box-${uBox.boxId}`}
                      >
                        추천 품목: {dedCand.prodName} ({dedCand.flowerName}) · {fmt(dedCand.qtyPerBox)}
                        {dedCand.unit}
                        {dedCand.stemsPerBox ? ` (${fmt(dedCand.stemsPerBox)}본)` : ''}
                      </div>
                    )}

                    <div className={styles.unreadableActionRow}>
                      <div className={styles.sampleChips}>
                        {dedCand && (
                          <button
                            type="button"
                            className={styles.btnPrimary}
                            data-testid={`confirm-zigzag-deduction-btn-${uBox.boxId}`}
                            onClick={() => handleConfirmZigzagDeductionSingle(uBox)}
                          >
                            추천 품목 1클릭 확정 ({dedCand.prodName} {fmt(dedCand.qtyPerBox)}
                            {dedCand.unit})
                          </button>
                        )}
                        <button
                          type="button"
                          className={styles.btnSecondary}
                          data-testid={`open-search-matcher-btn-${uBox.boxId}`}
                          onClick={() => {
                            if (isMatcherOpen) {
                              setActiveMatcherBoxId(null);
                            } else {
                              handleOpenSearchMatcher(uBox);
                            }
                          }}
                        >
                          {isMatcherOpen ? '검색 매칭 닫기' : '검색 매칭'}
                        </button>
                        <button
                          type="button"
                          className={styles.btnPass}
                          data-testid={`pass-exclude-btn-${uBox.boxId}`}
                          onClick={() => handlePassUnreadableBox(uBox, 'exclude_count')}
                        >
                          패스 (카운트 제외)
                        </button>
                        <button
                          type="button"
                          className={styles.btnPass}
                          data-testid={`pass-keepbox-btn-${uBox.boxId}`}
                          onClick={() => handlePassUnreadableBox(uBox, 'keep_box_skip_item')}
                        >
                          패스 (박스 수만 유지)
                        </button>
                      </div>
                    </div>

                    {isMatcherOpen && (
                      <div
                        className={styles.searchMatcherDrawer}
                        data-testid={`search-matcher-drawer-${uBox.boxId}`}
                      >
                        <div className={styles.inlineFieldGroup} style={{ marginTop: 0 }}>
                          <input
                            id={`matcher-search-${uBox.boxId}`}
                            type="text"
                            className={styles.textInput}
                            data-testid={`matcher-search-input-${uBox.boxId}`}
                            value={matcherSearchQuery}
                            onChange={(e) => {
                              const val = e.target.value;
                              setMatcherSearchQuery(val);
                              const nextList = buildUnreadableBoxSearchCandidates(uBox, {
                                allBoxes: analysisData?.allBoxes || [],
                                productCatalog: analysisData?.searchableProducts || SEARCHABLE_PRODUCT_CATALOG,
                                searchQuery: val,
                              });
                              if (nextList[0]) {
                                setMatcherSelectedCandidate(nextList[0]);
                                setMatcherQtyPerBox(Number(nextList[0].suggestedQtyPerBox || 40));
                              }
                            }}
                            placeholder="품목명(카라, 튤립, 백합 등) 또는 본수(130, 200 등) 검색"
                          />
                        </div>

                        <div className={styles.inlineFieldGroup}>
                          <select
                            id={`matcher-prod-select-${uBox.boxId}`}
                            aria-label="매칭 품목 선택"
                            className={styles.selectInput}
                            data-testid={`matcher-prod-select-${uBox.boxId}`}
                            value={activeCandidate ? activeCandidate.prodKey : ''}
                            onChange={(e) => {
                              const pk = Number(e.target.value);
                              const found =
                                liveCandidates.find((c) => Number(c.prodKey) === pk) ||
                                (analysisData?.searchableProducts || SEARCHABLE_PRODUCT_CATALOG).find(
                                  (c) => Number(c.prodKey) === pk
                                );
                              if (found) {
                                setMatcherSelectedCandidate(found);
                                setMatcherQtyPerBox(Number(found.suggestedQtyPerBox || found.defaultQtyPerBox || 40));
                              }
                            }}
                          >
                            {liveCandidates.map((c) => (
                              <option key={`${c.candidateId}-opt`} value={c.prodKey}>
                                {c.prodName} ({c.flowerName} · 기본 {c.suggestedQtyPerBox}
                                {c.unit})
                              </option>
                            ))}
                          </select>

                          <input
                            id={`matcher-qty-input-${uBox.boxId}`}
                            aria-label="박스당 수량"
                            type="number"
                            min={1}
                            max={2000}
                            className={styles.numberInput}
                            data-testid={`matcher-qty-input-${uBox.boxId}`}
                            value={matcherQtyPerBox}
                            onChange={(e) => setMatcherQtyPerBox(Number(e.target.value || 0))}
                          />

                          <select
                            id={`matcher-cust-select-${uBox.boxId}`}
                            aria-label="업체 선택"
                            className={styles.selectInput}
                            data-testid={`matcher-cust-select-${uBox.boxId}`}
                            value={matcherCustKey}
                            onChange={(e) => setMatcherCustKey(Number(e.target.value))}
                          >
                            {CUSTOMER_OPTIONS.map((c) => (
                              <option key={c.custKey} value={c.custKey}>
                                {c.custName}
                              </option>
                            ))}
                          </select>

                          <button
                            type="button"
                            className={styles.btnPrimary}
                            data-testid={`confirm-search-match-btn-${uBox.boxId}`}
                            onClick={() => handleConfirmSearchMatch(uBox, activeCandidate)}
                          >
                            매칭 확정
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {resolvedQueue.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontWeight: 700, fontSize: 12.5, color: '#475569', marginBottom: 4 }}>
                  방금 처리한 박스 ({fmt(resolvedQueue.length)}건):
                </div>
                {resolvedQueue.map((rBox) => (
                  <div
                    key={`resolved-${rBox.boxId}`}
                    className={styles.unreadableItemCardResolved}
                    data-testid={`unreadable-resolved-item-${rBox.boxId}`}
                    style={{
                      marginBottom: 4,
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 6,
                      fontSize: 12.5,
                    }}
                  >
                    <div>
                      <span className={rBox.resolutionAction === 'passed' ? styles.badgeNeutral : styles.badgeMatch}>
                        {rBox.resolutionAction === 'passed' ? '패스됨' : '매칭완료'}
                      </span>{' '}
                      <strong>#{rBox.countSeq || rBox.boxSeq}</strong> · {rBox.custName} ·{' '}
                      <strong>{rBox.prodName}</strong> ({fmt(rBox.qtyPerBox)}
                      {rBox.unit})
                    </div>
                    <button
                      type="button"
                      className={styles.btnSecondary}
                      style={{ padding: '2px 8px', fontSize: 12.5 }}
                      data-testid={`rematch-box-btn-${rBox.boxId}`}
                      onClick={() =>
                        handleMarkBoxAsUnreadable(
                          rBox,
                          rBox.ocrStatus === 'confirmed' ? 'unreadable_both' : rBox.ocrStatus
                        )
                      }
                    >
                      다시 매칭
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={styles.stepFooterBar}>
            <button
              type="button"
              className={styles.btnSecondary}
              data-testid="step2-back-step1-btn"
              onClick={() => setCurrentStep(1)}
            >
              ← 1단계(사진 추가/변경)
            </button>
            <button
              type="button"
              className={styles.btnNextStep}
              data-testid="step2-next-step3-btn"
              onClick={() => setCurrentStep(3)}
            >
              확인 완료 → 3단계 최종 결과표 보기 →
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
