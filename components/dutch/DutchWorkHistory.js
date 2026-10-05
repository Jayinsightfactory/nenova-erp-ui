export default function DutchWorkHistory({ name, onName, hasWork, busy, saving, reviewing, notice, error, onSave, onReview, open, onToggle, items, loading, cursor, onMore, onRestore }) {
  return <section className="work-panel" aria-label="작업 저장 및 업로드">
    <div className="work-actions">
      <input aria-label="작업 저장 이름" maxLength={160} value={name} onChange={event => onName(event.target.value)} placeholder="저장 이름 (미입력 시 파일명·차수)" disabled={busy}/>
      <button disabled={!hasWork || busy} onClick={onSave}>{saving ? '저장·불러오기 중…' : '작업 저장'}</button>
      <button aria-expanded={open} onClick={onToggle} disabled={busy}>저장 이력·불러오기</button>
      <button className="primary" disabled={!hasWork || busy || reviewing} onClick={onReview}>{reviewing ? '현재 DB 검증 중…' : '작업 완료·업로드 검토'}</button>
    </div>
    <p>① 원본·단가·매칭 편집 → ② 작업 저장 → ③ 업로드 검토 → ④ 변경값 확인 후 주문·분배 적용. 저장본 불러오기는 ERP를 변경하지 않습니다.</p>
    {notice && <div className="notice" role="status">{notice}</div>}
    {error && <div className="error" role="alert">{error}</div>}
    {open && <div className="history">
      <h2>내 작업 저장 이력 <small>저장마다 별도 기록 · ERP 적용 완료 이력과 구분</small></h2>
      {!items.length && !loading && <p>저장된 작업이 없습니다.</p>}
      <div className="history-table"><table><thead><tr><th>연도·차수</th><th>작업 이름 / 원본 파일</th><th>저장 시각</th><th>저장자</th><th>작업 행</th><th>상태</th><th>불러오기</th></tr></thead><tbody>
        {items.map(item => <tr key={item.id}><td>{item.orderYear} / {item.orderWeek}</td><td><b>{item.name}</b><small>{item.fileName}</small></td><td>{new Date(item.savedAt).toLocaleString('ko-KR')}</td><td>{item.savedBy}</td><td>{item.entryCount}</td><td>작업본 저장</td><td><button disabled={busy} onClick={() => onRestore(item.id)} aria-label={`${item.name} 불러오기`}>불러오기</button></td></tr>)}
      </tbody></table></div>
      {loading && <p role="status">이력 조회 중…</p>}
      {cursor && <button disabled={busy || loading} onClick={onMore}>이전 저장 이력 더 보기</button>}
    </div>}
    <style jsx>{`.work-panel{background:white;border:1px solid #b7cbe3;padding:10px;margin-top:8px;border-radius:5px;color:#17365b}.work-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.work-actions input{min-width:180px;flex:1;max-width:380px;border:1px solid #aabdd4;padding:8px;border-radius:4px}.work-panel button{padding:8px 12px;border:1px solid #aabdd4;background:#f4f8fd;color:#17365b;border-radius:4px;font-weight:700;cursor:pointer}.work-panel button:disabled{opacity:.5;cursor:not-allowed}.work-actions .primary{margin-left:auto;background:#147c46;border-color:#147c46;color:white}.work-panel p{font-size:12px;margin:7px 0 0;color:#52677e}.notice,.error{font-size:12px;padding:8px;margin-top:6px;background:#eaf7f0}.error{background:#fff1ee;color:#a12316}.history{margin-top:10px;border-top:1px solid #d5e0ef;padding-top:10px}.history h2{font-size:14px;margin:0 0 7px}.history small{font-size:11px;color:#617188;font-weight:normal}.history-table{max-height:250px;overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px}th{background:#e9f0f8;position:sticky;top:0;text-align:left}th,td{padding:7px 9px;border-bottom:1px solid #dde5ef;white-space:nowrap}td small{display:block}td:nth-child(2){white-space:normal;min-width:180px;max-width:500px;overflow-wrap:anywhere}@media(max-width:760px){.work-actions input{width:100%;max-width:none;flex-basis:100%}.work-actions .primary{margin-left:0}.history h2 small{display:block;margin-top:4px}}`}</style>
  </section>;
}
