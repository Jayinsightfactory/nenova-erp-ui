// Saved calculation cache is not an accounting confirmation. Reads never refresh it.
const fmtAt = iso => iso ? new Date(iso).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false}) : '-';
export default function ProfitReportSnapshotBanner({snapshot,busy=false,onRefresh}) {
  if(!snapshot || snapshot.state==='disabled') return null;
  const stored=snapshot.servedFrom==='snapshot';
  return <div data-testid={stored?'profit-snapshot-stored':'profit-snapshot-live'}
    style={{background:'#ecfdf5',border:'1px solid #86efac',borderRadius:8,padding:'8px 12px',marginBottom:8,fontSize:12.5,display:'flex',gap:10,flexWrap:'wrap'}}>
    <span>{snapshot.templateDuty?<><b>관세 보완 적용</b>{stored?<> · 저장 v{snapshot.versionNo} · {fmtAt(snapshot.savedAt)}</>:null} · {snapshot.templateDuty.label} · 세율·원가 미확인 항목의 수익률은 보류됩니다.</>:stored?<><b>저장된 계산본</b> · {fmtAt(snapshot.savedAt)} · v{snapshot.versionNo} · 조회 시 재계산하지 않습니다. 회계 확정과 다릅니다.</>
      :<><b>현재 원천으로 계산</b> · 조회 결과를 자동 저장하지 않습니다.</>}</span>
    <button type="button" onClick={onRefresh} disabled={busy} style={{marginLeft:'auto'}}
      title="현재 원천으로 다시 계산하여 웹 계산본의 새 버전을 저장합니다. ERP 원장·수기값·확정본은 변경하지 않습니다.">
      {busy?'계산본 준비 중…':'계산본 생성·갱신'}</button>
  </div>;
}
