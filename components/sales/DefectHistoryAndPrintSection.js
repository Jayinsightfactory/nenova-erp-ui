// 영업수입불량차감 수정이력 패널 · 담당자/차수정정 편집 바 · 인쇄 전용 양식
import { incomingOutputProductLabel } from '../../lib/incomingProductLabel.js';
import { incomingDefectPrintNote } from '../../lib/incomingDefectPrintNote.js';

export function DefectPeriodCorrectionSection({
  periodForm,
  setPeriodForm,
  selectedCount,
  year,
  week,
  saving,
  onApply,
}) {
  if (!periodForm) return null;
  return (
    <section aria-label="차수 정정" style={{ padding: 12, border: '1px solid #cbd5e1', marginTop: 8 }}>
      <p>선택 {selectedCount}건 · 현재 {year}년 {week}차. 저장번호·업체·품목·수량·담당자는 유지됩니다.</p>
      <label>
        정정할 연도-차수{' '}
        <input
          aria-label="정정할 연도-차수"
          placeholder="2026-40"
          value={periodForm.target}
          disabled={saving}
          onChange={(e) => setPeriodForm({ ...periodForm, target: e.target.value })}
        />
      </label>
      <label>
        정정 사유{' '}
        <input
          aria-label="정정 사유"
          maxLength={300}
          value={periodForm.reason}
          disabled={saving}
          onChange={(e) => setPeriodForm({ ...periodForm, reason: e.target.value })}
        />
      </label>
      <button className="btn btn-primary" onClick={onApply} disabled={saving || !selectedCount}>차수 정정 적용</button>
      <button className="btn" onClick={() => setPeriodForm(null)} disabled={saving}>취소</button>
    </section>
  );
}

export function DefectManagerEditorBar({
  showManagerEditor,
  visibleManagerOptions,
  managerEditId,
  setManagerEditId,
  managerEditName,
  setManagerEditName,
  saving,
  onSave,
}) {
  if (!showManagerEditor) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 8, paddingTop: 8, borderTop: '1px solid #e2e8f0' }}>
      <span style={{ fontWeight: 700 }}>담당자 관리</span>
      <select
        className="input"
        value={managerEditId}
        onChange={(e) => {
          const id = e.target.value;
          const option = visibleManagerOptions.find((item) => String(item.managerId) === id);
          setManagerEditId(id);
          setManagerEditName(option?.managerName || '');
        }}
      >
        <option value="">새 담당자</option>
        {visibleManagerOptions.map((item) => (
          <option key={`edit-${item.managerId}`} value={item.managerId}>{item.managerName}</option>
        ))}
      </select>
      <input
        className="input"
        value={managerEditName}
        placeholder="담당자 이름"
        onChange={(e) => setManagerEditName(e.target.value)}
      />
      <button className="btn btn-primary" onClick={onSave} disabled={saving}>저장</button>
      <button className="btn" onClick={() => { setManagerEditId(''); setManagerEditName(''); }}>새로 입력</button>
    </div>
  );
}

export function DefectHistoryPanel({
  showHistory,
  meaningfulHistory,
  matchingHistory,
  matchingHistoryText,
}) {
  if (!showHistory) return null;
  return (
    <div className="screenOnly">
      <div className="card" style={{ padding: 10, marginBottom: 10, maxHeight: 260, overflow: 'auto' }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>매칭·수정 이력 — 거래처/품목 매칭, 수량, 품명 변경내용</div>
        <table className="data-table" style={{ fontSize: 12 }}>
          <thead>
            <tr><th>일시</th><th>작업자</th><th>작업</th><th>변경내용</th></tr>
          </thead>
          <tbody>
            {meaningfulHistory.map((h) => (
              <tr key={h.HistoryKey}>
                <td>{String(h.ChangedAt || '').slice(0, 19)}</td>
                <td>{h.ChangedByName || h.ChangedBy}</td>
                <td>{h.ActionType}</td>
                <td>{h.ChangeSummary}</td>
              </tr>
            ))}
            {!meaningfulHistory.length && <tr><td colSpan="4">이력이 없습니다.</td></tr>}
          </tbody>
        </table>
        <div style={{ fontWeight: 700, margin: '12px 0 6px', color: '#1e3a8a' }}>품목·거래처 매칭 이력</div>
        <table className="data-table" style={{ fontSize: 12 }}>
          <thead>
            <tr><th>일시</th><th>작업자</th><th>매칭 변경내용</th></tr>
          </thead>
          <tbody>
            {matchingHistory.map((h) => (
              <tr key={`match-${h.HistoryKey}`}>
                <td>{String(h.ChangedAt || '').slice(0, 19)}</td>
                <td>{h.ChangedByName || h.ChangedBy}</td>
                <td>{matchingHistoryText(h)}</td>
              </tr>
            ))}
            {!matchingHistory.length && <tr><td colSpan="3">품목·거래처 매칭 이력이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      <style jsx>{`
        .screenOnly {
          font-family: 'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', '맑은 고딕', 'Segoe UI', sans-serif;
        }
      `}</style>
    </div>
  );
}

export function DefectPrintSheet({
  printSections,
  year,
  week,
  activeTab,
  printQuantity,
}) {
  return (
    <div className="printOnly print-form" aria-hidden="true">
      {printSections.map(({ manager, customerGroups }) => (
        <section className="manager-print-section" key={manager}>
          <div className="print-top">
            <div className="print-title">{year}년 ( {week} )차 차감 내역</div>
            <table className="print-approval">
              <tbody>
                <tr><th>담당자</th><th>차장</th><th>이사</th></tr>
                <tr><td>{manager}</td><td></td><td></td></tr>
              </tbody>
            </table>
          </div>
          <table className={`print-table ${activeTab === 'incoming' ? 'incoming-print' : ''}`}>
            <colgroup>
              <col className="customer-col" />
              {activeTab !== 'incoming' && <col className="product-col" />}
              <col className="color-col" />
              <col className="quantity-col" />
              <col className="credit-col" />
              <col className="farm-col" />
              <col className="note-col" />
            </colgroup>
            <thead>
              <tr>
                <th>거래처</th>
                {activeTab !== 'incoming' && <th>품종</th>}
                <th>품명</th>
                <th>{activeTab === 'incoming' ? '크레딧수량' : '차감수량'}</th>
                <th>{activeTab === 'incoming' ? '견적서수량' : '크레딧(수입부)'}</th>
                <th>농장</th>
                <th>비고</th>
              </tr>
            </thead>
            {customerGroups.map((items, groupIndex) => (
              <tbody key={groupIndex}>
                {items.map((row, index) => (
                  <tr key={`print-${index}`}>
                    <td>{activeTab === 'incoming' && index > 0 ? '' : row?.customerName || ''}</td>
                    {activeTab !== 'incoming' && <td>{row?.productName || ''}</td>}
                    <td>{activeTab === 'incoming' ? incomingOutputProductLabel(row) : row?.colorName || ''}</td>
                    <td>{activeTab !== 'incoming' || row?.creditApplied ? printQuantity(row) : ''}</td>
                    <td>{activeTab === 'incoming' ? printQuantity({ ...row, quantity: row.estimateQuantity ?? row.quantity }) : row?.creditApplied ? '✓' : ''}</td>
                    <td>{row?.farmName || ''}</td>
                    <td style={activeTab === 'incoming' && /kakao-defect:/i.test(row?.note) ? { whiteSpace: 'nowrap' } : undefined}>
                      {activeTab === 'incoming' ? incomingDefectPrintNote(row?.note, row?.managerName) : row?.note || ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </section>
      ))}
      <style jsx>{`
        .printOnly { display: none; }
        .manager-print-section + .manager-print-section { break-before: page; page-break-before: always; }
        .print-form { color: #111; background: #fff; font-family: Arial, sans-serif; }
        .print-top { display: grid; grid-template-columns: 1fr 210px; align-items: stretch; border: 1px solid #111; margin-bottom: 0; }
        .print-title { display: flex; align-items: center; justify-content: center; min-height: 54px; font-size: 20px; font-weight: 700; }
        .print-approval { width: 210px; border-collapse: collapse; table-layout: fixed; font-size: 11px; }
        .print-approval th, .print-approval td { border-left: 1px solid #111; border-bottom: 1px solid #111; text-align: center; height: 26px; }
        .print-approval tr:last-child td { border-bottom: 0; }
        .print-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12px; }
        .print-table th, .print-table td { border: 1px solid #111; padding: 3px 5px; height: 23px; vertical-align: middle; overflow: hidden; white-space: nowrap; }
        .incoming-print td { white-space: pre-wrap; overflow-wrap: anywhere; overflow: visible; height: auto; }
        .incoming-print tr { break-inside: avoid; }
        .incoming-print .customer-col { width: 16%; } .incoming-print .color-col { width: 34%; }
        .incoming-print .quantity-col { width: 10%; } .incoming-print .credit-col { width: 10%; }
        .incoming-print .farm-col { width: 20%; } .incoming-print .note-col { width: 16%; }
        .incoming-print td:nth-child(4), .incoming-print th:nth-child(4) { padding-inline: 1px; text-align: center; }
        .print-table th { background: #c69700; font-weight: 700; text-align: center; }
        .print-table td:nth-child(4), .print-table td:nth-child(5) { text-align: center; }
        .customer-col { width: 19%; } .product-col { width: 20%; } .color-col { width: 17%; }
        .quantity-col { width: 11%; } .credit-col { width: 13%; } .farm-col { width: 11%; } .note-col { width: 19%; }
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          :global(body:has(.sales-defect-page) *:not(:has(.print-form)):not(.print-form):not(.print-form *)) { display: none !important; }
          :global(html:has(.sales-defect-page)), :global(body *:has(.print-form)), :global(body:has(.print-form)) {
            display: block !important; position: static !important; height: auto !important; min-height: 0 !important;
            max-height: none !important; width: auto !important; overflow: visible !important; margin: 0 !important; padding: 0 !important;
          }
          :global(.sales-defect-page) .printOnly { display: block !important; position: static; width: 100%; }
          .print-table thead { display: table-header-group; }
          .print-table tr, .print-top, .incoming-print tbody { break-inside: avoid; }
          .print-form:has(.incoming-print) { color: #000; }
          .print-form .incoming-print th { background: #fff !important; color: #000; }
          .print-table th { background: #c69700 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}
