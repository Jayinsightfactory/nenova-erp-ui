import { fmt } from '../../lib/shipmentDistributionPageHelpers.js';

export function DistributionSaveCompleteModal({ saveModal, closeSaveModal, saveModalConfirmRef }) {
  if (!saveModal) return null;
  return (
    <div className="modal-overlay" onClick={closeSaveModal}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="출고 분배 저장 완료" style={{ maxWidth: 380, textAlign: 'center' }}
        onClick={e => e.stopPropagation()} onKeyDown={event => {
          if (event.key === 'Tab') { event.preventDefault(); saveModalConfirmRef.current?.focus(); }
        }}>
        <div className="modal-header" style={{ background: '#E8F8E8', borderBottom: '2px solid #66BB66' }}>
          <span className="modal-title" style={{ color: '#006600' }}>✅ 출고 분배 저장 완료</span>
        </div>
        <div className="modal-body" style={{ padding: '20px 24px' }}>
          <div style={{ fontSize: 15, fontWeight: 'bold', marginBottom: 16, color: '#006600' }}>
            출고 분배가 저장되었습니다.
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 16 }}>
            <tbody>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 4px', color: 'var(--text3)', width: 100 }}>품목</td>
                <td style={{ padding: '6px 4px', fontWeight: 'bold' }}>{saveModal.prodName}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 4px', color: 'var(--text3)' }}>차수</td>
                <td style={{ padding: '6px 4px', fontWeight: 'bold', color: 'var(--blue)' }}>{saveModal.week}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 4px', color: 'var(--text3)' }}>변경 거래처 수</td>
                <td style={{ padding: '6px 4px', fontWeight: 'bold' }}>{saveModal.savedCount}개</td>
              </tr>
              <tr>
                <td style={{ padding: '6px 4px', color: 'var(--text3)' }}>총 출고수량</td>
                <td style={{ padding: '6px 4px', fontWeight: 'bold', color: 'var(--amber)' }}>{saveModal.totalQty.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
          <button ref={saveModalConfirmRef} className="btn btn-primary" style={{ width: '100%', height: 36, fontSize: 13 }}
            onClick={closeSaveModal}>확인</button>
        </div>
      </div>
    </div>
  );
}

export function DistributionSpProgressModal({ spModal, setSpModal }) {
  if (!spModal) return null;
  return (
    <div className="modal-overlay" onClick={() => !spModal.running && setSpModal(null)}>
      <div className="modal" style={{ maxWidth: 620 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header" style={{ background: spModal.failed ? '#FDECEC' : '#E8F8E8', borderBottom: `2px solid ${spModal.failed ? '#CC3333' : '#66BB66'}` }}>
          <span className="modal-title" style={{ color: spModal.failed ? '#AA0000' : '#006600' }}>
            {spModal.running ? '전산 출고분배 진행 중' : spModal.failed ? '전산 출고분배 중단' : '전산 출고분배 완료'}
          </span>
        </div>
        <div className="modal-body" style={{ padding: '18px 22px' }}>
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>{spModal.title}</div>
          {spModal.procedureName && (
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>실행 경로: dbo.{spModal.procedureName}</div>
          )}
          {spModal.before && spModal.after && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 14 }}>
              <thead>
                <tr style={{ background: '#F8FAFC' }}>
                  <th style={{ padding: 6, border: '1px solid var(--border)' }}>구분</th>
                  <th style={{ padding: 6, border: '1px solid var(--border)', textAlign: 'right' }}>품목</th>
                  <th style={{ padding: 6, border: '1px solid var(--border)', textAlign: 'right' }}>업체</th>
                  <th style={{ padding: 6, border: '1px solid var(--border)', textAlign: 'right' }}>출고합계</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: 6, border: '1px solid var(--border)' }}>분배 전</td>
                  <td style={{ padding: 6, border: '1px solid var(--border)', textAlign: 'right' }}>{fmt(spModal.before.productCount)}</td>
                  <td style={{ padding: 6, border: '1px solid var(--border)', textAlign: 'right' }}>{fmt(spModal.before.customerCount)}</td>
                  <td style={{ padding: 6, border: '1px solid var(--border)', textAlign: 'right' }}>{fmt(spModal.before.outQuantity)}</td>
                </tr>
                <tr>
                  <td style={{ padding: 6, border: '1px solid var(--border)' }}>분배 후</td>
                  <td style={{ padding: 6, border: '1px solid var(--border)', textAlign: 'right' }}>{fmt(spModal.after.productCount)}</td>
                  <td style={{ padding: 6, border: '1px solid var(--border)', textAlign: 'right' }}>{fmt(spModal.after.customerCount)}</td>
                  <td style={{ padding: 6, border: '1px solid var(--border)', textAlign: 'right', fontWeight: 800, color: 'var(--blue)' }}>{fmt(spModal.after.outQuantity)}</td>
                </tr>
              </tbody>
            </table>
          )}
          <div style={{ border: '1px solid var(--border)', borderRadius: 6, background: '#FAFAFA', padding: 10, maxHeight: 240, overflowY: 'auto', fontSize: 12, lineHeight: 1.7 }}>
            {(spModal.logs || []).map((line, i) => (
              <div key={i} style={{ color: line.startsWith('오류') ? 'var(--red)' : 'var(--text2)' }}>• {line}</div>
            ))}
          </div>
          <button className="btn btn-primary" style={{ width: '100%', height: 36, marginTop: 14 }} disabled={spModal.running} onClick={() => setSpModal(null)}>
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

export function DistributionHistoryModal({ showHistory, setShowHistory, week, historyData, t }) {
  if (!showHistory) return null;
  return (
    <div className="modal-overlay" onClick={() => setShowHistory(false)}>
      <div className="modal" style={{ maxWidth: 860 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">■ 출고 분배 내역 조회 — [{week}] 차수</span>
          <button className="btn btn-sm" onClick={() => setShowHistory(false)}>{t('닫기')}</button>
        </div>
        <div className="modal-body" style={{ padding: 0, maxHeight: '70vh', overflowY: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>변경일자</th><th>차수</th><th>거래처명</th>
                <th>국가</th><th>꽃</th><th>품목명</th>
                <th>변경유형</th><th>변경항목</th>
                <th style={{ textAlign: 'right' }}>기준값</th>
                <th style={{ textAlign: 'right' }}>변경값</th>
                <th>비고</th>
              </tr>
            </thead>
            <tbody>
              {historyData.length === 0
                ? <tr><td colSpan={11} style={{ textAlign: 'center', padding: 32, color: 'var(--text3)' }}>변경 내역 없음</td></tr>
                : historyData.map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{r.ChangeDtm}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontWeight: 'bold' }}>{r.week}</td>
                    <td>{r.CustName}</td>
                    <td>{r.country}</td>
                    <td>{r.flower}</td>
                    <td style={{ fontSize: 12 }}>{r.name}</td>
                    <td>
                      <span className={`badge ${r.type === '신규' ? 'badge-green' : r.type === '수정' ? 'badge-blue' : 'badge-red'}`}>
                        {r.type}
                      </span>
                    </td>
                    <td style={{ fontSize: 11 }}>{r.변경항목 || '수량'}</td>
                    <td className="num" style={{ color: 'var(--text3)' }}>{r.before}</td>
                    <td className="num" style={{ fontWeight: 'bold', color: r.type === '삭제' ? 'var(--red)' : r.type === '신규' ? 'var(--green)' : 'var(--blue)' }}>{r.after}</td>
                    <td style={{ fontSize: 11, color: 'var(--text3)' }}>{r.Descr || '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={() => setShowHistory(false)}>{t('닫기')}</button>
        </div>
      </div>
    </div>
  );
}
