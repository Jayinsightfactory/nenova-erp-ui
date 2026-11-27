// 영업지원 수동단가 입력 모달 · 불량 목록 수정 모달 · 견적서 불량차감 미리보기 모달
import DefectCostLookup from '../DefectCostLookup';

export function DefectManualCostModal({
  manualCostModal,
  manualCostSaving,
  manualCostValue,
  setManualCostValue,
  manualCostInputRef,
  error,
  printQuantity,
  onClose,
  onSave,
  onLookupSaved,
  onBusy,
}) {
  if (!manualCostModal) return null;
  return (
    <div className="support-manual-cost-modal" role="presentation" onMouseDown={() => { if (!manualCostSaving) onClose(); }}>
      <section className="support-manual-cost-card" role="dialog" aria-modal="true" aria-labelledby="support-manual-cost-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="support-manual-cost-head">
          <div><strong id="support-manual-cost-title">불량차감 단가 확인·입력</strong><span>{manualCostModal.year}년 {manualCostModal.week}차 · 웹 수동단가만 저장</span></div>
          <button type="button" className="btn btn-xs" onClick={onClose} disabled={manualCostSaving}>닫기</button>
        </div>
        <div className="support-manual-cost-body">
          <dl className="support-manual-cost-summary">
            <div><dt>거래처</dt><dd>{manualCostModal.row.customerName || '-'}{manualCostModal.row.custKey ? ` (#${manualCostModal.row.custKey})` : ''}</dd></div>
            <div><dt>품목</dt><dd>{manualCostModal.row.matchedProductDbName || manualCostModal.row.matchedProductName || manualCostModal.row.colorName || manualCostModal.row.productName || '-'}{manualCostModal.row.prodKey ? ` (#${manualCostModal.row.prodKey})` : ''}</dd></div>
            <div><dt>수량 / 단위</dt><dd>{printQuantity(manualCostModal.row) || '-'} / {manualCostModal.row.sourceUnit || manualCostModal.row.unit || '-'}</dd></div>
            <div><dt>단가 기준</dt><dd>전산 견적 단위 {manualCostModal.row.distributionCostUnit || '-'}당 금액</dd></div>
          </dl>
          <DefectCostLookup
            row={manualCostModal.row}
            year={manualCostModal.year}
            week={manualCostModal.week}
            disabled={manualCostSaving}
            onBusy={onBusy}
            onSaved={onLookupSaved}
          />
          <label className="support-manual-cost-label" htmlFor="support-manual-cost-input">불량차감 단가(부가세 포함, 원)</label>
          <input
            ref={manualCostInputRef}
            id="support-manual-cost-input"
            className="input"
            inputMode="decimal"
            type="text"
            value={manualCostValue}
            onChange={(event) => setManualCostValue(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onSave(false); } }}
            placeholder="예: 12000 또는 12000.5000"
            disabled={manualCostSaving}
            aria-describedby="support-manual-cost-help"
          />
          <div id="support-manual-cost-help" className="support-manual-cost-help">0보다 큰 숫자, 소수점 이하 최대 4자리</div>
          {error && <p role="alert" style={{ color: '#b91c1c', margin: '8px 0 0' }}>{error}</p>}
        </div>
        <div className="support-manual-cost-actions">
          {manualCostModal.hasExisting && (
            <button type="button" className="btn" onClick={() => onSave(true)} disabled={manualCostSaving}>
              {manualCostSaving ? '저장중…' : '자동 단가로 돌아가기'}
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose} disabled={manualCostSaving}>취소</button>
          <button type="button" className="btn btn-primary" onClick={() => onSave(false)} disabled={manualCostSaving}>
            {manualCostSaving ? '저장중…' : '저장'}
          </button>
        </div>
      </section>
      <style jsx>{`
        .support-manual-cost-modal { position: fixed; z-index: 2147483002; inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(15, 23, 42, .42); font-family: 'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', '맑은 고딕', 'Segoe UI', sans-serif; }
        .support-manual-cost-card { width: min(500px, 100%); border: 1px solid #0f766e; border-radius: 8px; background: #fff; box-shadow: 0 18px 48px rgba(15, 23, 42, .32); }
        .support-manual-cost-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 11px 13px; border-bottom: 1px solid #99f6e4; background: #f0fdfa; }
        .support-manual-cost-head strong, .support-manual-cost-head span { display: block; }
        .support-manual-cost-head strong { color: #115e59; font-size: 14px; }
        .support-manual-cost-head span { margin-top: 2px; color: #64748b; font-size: 11px; }
        .support-manual-cost-body { padding: 14px; }
        .support-manual-cost-summary { display: grid; gap: 6px; margin: 0 0 14px; }
        .support-manual-cost-summary div { display: grid; grid-template-columns: 88px 1fr; gap: 8px; font-size: 13px; }
        .support-manual-cost-summary dt { color: #64748b; font-weight: 700; }
        .support-manual-cost-summary dd { margin: 0; color: #0f172a; overflow-wrap: anywhere; }
        .support-manual-cost-label { display: block; margin-bottom: 5px; color: #0f172a; font-weight: 700; font-size: 13px; }
        .support-manual-cost-help { margin-top: 4px; color: #64748b; font-size: 11px; }
        .support-manual-cost-actions { display: flex; align-items: center; gap: 6px; padding: 10px 13px; border-top: 1px solid #e2e8f0; }
        .btn-xs { padding: 4px 7px; font-size: 12px; }
      `}</style>
    </div>
  );
}

export function DefectManagementEditModal({
  managementEdit,
  setManagementEdit,
  managementCandidates,
  setManagementCandidates,
  managementBusy,
  managementLoading,
  error,
  onSearch,
  onSave,
  onClose,
}) {
  if (!managementEdit) return null;
  return (
    <div className="support-estimate-preview-modal" role="presentation">
      <section className="support-estimate-preview-card" role="dialog" aria-modal="true" aria-label="불량 목록 수정" style={{ padding: 16 }}>
        <h3>불량 목록 수정 · #{managementEdit.row.deductionKey}</h3>
        {error && <p role="alert" style={{ color: '#b91c1c', whiteSpace: 'pre-wrap' }}>{error}</p>}
        <p>{managementEdit.row.orderYear}년 {managementEdit.row.orderWeek}차 · {managementEdit.row.customerName} · {managementEdit.row.matchedProductDbName || managementEdit.row.productName}</p>
        {managementEdit.noteOnly ? (
          <p role="status">견적 연결 또는 처리 이력이 있어 비고만 수정할 수 있습니다. 업체·품목·수량·단위와 실제 견적서는 보존됩니다.</p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select
                aria-label="수정 검색 대상"
                value={managementEdit.kind}
                disabled={managementBusy}
                onChange={(e) => { setManagementEdit({ ...managementEdit, kind: e.target.value }); setManagementCandidates([]); }}
              >
                <option value="customer">업체</option>
                <option value="product">품목</option>
              </select>
              <input
                aria-label="수정 업체 품목 검색"
                value={managementEdit.query}
                disabled={managementBusy}
                onChange={(e) => setManagementEdit({ ...managementEdit, query: e.target.value })}
              />
              <button type="button" className="btn" disabled={managementBusy} onClick={onSearch}>검색</button>
            </div>
            <div style={{ maxHeight: 180, overflow: 'auto' }}>
              {managementCandidates.map((item) => (
                <button
                  type="button"
                  className="btn"
                  key={item.CustKey || item.ProdKey}
                  disabled={managementBusy}
                  onClick={() => {
                    const changes = managementEdit.kind === 'customer'
                      ? { custKey: item.CustKey, customerName: item.CustName }
                      : { prodKey: item.ProdKey, productName: item.FlowerName || item.ProdName };
                    setManagementEdit({ ...managementEdit, changes: { ...managementEdit.changes, ...changes } });
                    setManagementCandidates([]);
                  }}
                >
                  {item.CustName || `${item.CounName || ''} ${item.ProdName || ''}`}
                </button>
              ))}
            </div>
            <p>업체: {managementEdit.changes.customerName} · 품목: {managementEdit.changes.productName}</p>
            <label>
              수량{' '}
              <input
                aria-label="수정 수량"
                type="number"
                min="0.001"
                step="any"
                disabled={managementBusy}
                value={managementEdit.changes.quantity}
                onChange={(e) => setManagementEdit({ ...managementEdit, changes: { ...managementEdit.changes, quantity: e.target.value } })}
              />
            </label>
            <label>
              단위{' '}
              <select
                aria-label="수정 단위"
                disabled={managementBusy}
                value={managementEdit.changes.sourceUnit}
                onChange={(e) => setManagementEdit({ ...managementEdit, changes: { ...managementEdit.changes, sourceUnit: e.target.value } })}
              >
                {[...new Set([managementEdit.changes.sourceUnit, '단', '박스', '스팀(대)'])].filter(Boolean).map((unit) => (
                  <option key={unit}>{unit}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <label style={{ display: 'block', margin: '12px 0' }}>
          비고{' '}
          <textarea
            aria-label="수정 비고"
            rows="3"
            style={{ width: '100%' }}
            disabled={managementBusy}
            value={managementEdit.changes.note}
            onChange={(e) => setManagementEdit({ ...managementEdit, changes: { ...managementEdit.changes, note: e.target.value } })}
          />
        </label>
        <button type="button" className="btn btn-primary" disabled={managementLoading} onClick={onSave}>목록 수정 저장</button>{' '}
        <button type="button" className="btn" disabled={managementBusy} onClick={onClose}>닫기</button>
        <p>원본 파일과 담당자·변경 이력은 보존됩니다.</p>
      </section>
      <style jsx>{`
        .support-estimate-preview-modal { position: fixed; z-index: 2147483001; inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(15, 23, 42, .42); font-family: 'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', '맑은 고딕', 'Segoe UI', sans-serif; }
        .support-estimate-preview-card { width: min(680px, 100%); max-height: min(520px, calc(100vh - 32px)); overflow: auto; border: 1px solid #f59e0b; border-radius: 8px; background: #fff; box-shadow: 0 18px 48px rgba(15, 23, 42, .32); }
      `}</style>
    </div>
  );
}

export function DefectEstimatePreviewModal({
  estimatePreview,
  fmt,
  emptyTitle,
  onClose,
}) {
  if (!estimatePreview) return null;
  return (
    <div className="support-estimate-preview-modal" role="presentation" onMouseDown={onClose}>
      <section className="support-estimate-preview-card" role="dialog" aria-modal="true" aria-labelledby="support-estimate-preview-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="support-estimate-preview-head">
          <div>
            <strong id="support-estimate-preview-title">{estimatePreview.title}</strong>
            <span>{estimatePreview.subtitle} · 불량차감 항목만 표시</span>
          </div>
          <button type="button" className="btn btn-xs" aria-label="불량차감 미리보기 닫기" onClick={onClose}>닫기</button>
        </div>
        {estimatePreview.rows.length ? (
          <table className="support-estimate-preview-table">
            <thead>
              <tr><th>견적키</th><th>상태</th><th>품목</th><th>수량</th><th>단가</th><th>공급가액</th></tr>
            </thead>
            <tbody>
              {estimatePreview.rows.map((item, index) => (
                <tr key={item.estimateKey || index} className={item.current ? 'is-current' : ''}>
                  <td>#{item.estimateKey || '-'}</td>
                  <td>{item.statusLabel}</td>
                  <td>{item.productName}{item.unit ? ` (${item.unit})` : ''}</td>
                  <td className="num">{fmt(item.quantity)}</td>
                  <td className="num">{fmt(item.cost)}원</td>
                  <td className="num">{fmt(item.amount)}원</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="support-estimate-preview-empty" role="status">
            <strong>{estimatePreview.mode === 'manual' ? '수기 처리완료' : emptyTitle}</strong>
            <p>{estimatePreview.mode === 'manual' ? '수기 처리된 항목으로 견적서 원장이 생성되지 않았습니다.' : '이 불량차감 항목은 현재 차수 견적서에 아직 등록되지 않았습니다.'}</p>
            {estimatePreview.previousScopeLabel && <p>{estimatePreview.previousScopeLabel}</p>}
          </div>
        )}
      </section>
      <style jsx>{`
        .support-estimate-preview-modal { position: fixed; z-index: 2147483001; inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(15, 23, 42, .42); font-family: 'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', '맑은 고딕', 'Segoe UI', sans-serif; }
        .support-estimate-preview-card { width: min(680px, 100%); max-height: min(520px, calc(100vh - 32px)); overflow: auto; border: 1px solid #f59e0b; border-radius: 8px; background: #fff; box-shadow: 0 18px 48px rgba(15, 23, 42, .32); }
        .support-estimate-preview-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 11px 13px; border-bottom: 1px solid #fde68a; background: #fffbeb; }
        .support-estimate-preview-head strong { display: block; color: #92400e; font-size: 14px; }
        .support-estimate-preview-head span { display: block; margin-top: 2px; color: #64748b; font-size: 11px; }
        .support-estimate-preview-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .support-estimate-preview-table th, .support-estimate-preview-table td { padding: 8px 9px; border-bottom: 1px solid #fde68a; text-align: left; }
        .support-estimate-preview-table th { position: sticky; top: 0; background: #f8fafc; color: #475569; font-size: 11px; white-space: nowrap; }
        .support-estimate-preview-table .num { text-align: right; font-variant-numeric: tabular-nums; color: #9a3412; white-space: nowrap; }
        .support-estimate-preview-table tr.is-current { background: #fef3c7; }
        .support-estimate-preview-empty { padding: 28px 18px; color: #475569; text-align: center; }
        .support-estimate-preview-empty strong { display: block; color: #92400e; font-size: 14px; }
        .support-estimate-preview-empty p { margin: 8px 0 0; font-size: 12px; }
        .btn-xs { padding: 4px 7px; font-size: 12px; }
      `}</style>
    </div>
  );
}
