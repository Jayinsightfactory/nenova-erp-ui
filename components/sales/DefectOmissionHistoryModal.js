// 영업지원·미처리 탭 공통 누락 처리 내역 조회 및 취소 다이얼로그
export default function DefectOmissionHistoryModal({
  omissionRows,
  year,
  omissionBusy,
  onClose,
  onUndo,
}) {
  if (omissionRows === null) return null;
  return (
    <div
      role="dialog"
      aria-label="누락 처리 내역"
      style={{
        position: 'fixed',
        inset: '10%',
        zIndex: 10000,
        background: 'white',
        padding: 20,
        overflow: 'auto',
        border: '1px solid #999',
      }}
    >
      <h3>{year}년 누락 처리 내역</h3>
      <button type="button" onClick={onClose}>닫기</button>
      <table>
        <thead>
          <tr>
            <th>원차수</th>
            <th>업체</th>
            <th>품목</th>
            <th>수량</th>
            <th>처리일</th>
            <th>상태</th>
            <th>취소</th>
          </tr>
        </thead>
        <tbody>
          {omissionRows.map((r) => (
            <tr key={r.historyKey}>
              <td>{r.orderWeek}</td>
              <td>{r.customerName}</td>
              <td>{r.productName}</td>
              <td>{r.quantity}{r.sourceUnit}</td>
              <td>{String(r.changedAt).slice(0, 10)}</td>
              <td>{r.cancelled ? '취소됨' : '고정 제외'}</td>
              <td>
                <button type="button" disabled={omissionBusy || r.cancelled} onClick={() => onUndo(r)}>
                  누락 취소
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!omissionRows.length && <p>누락 처리 내역이 없습니다.</p>}
    </div>
  );
}
