// This shell intentionally mounts neither authentication nor replay/activity collectors.
export default function EcountPreviewShell({ children, popup }) {
  return <div data-ui-shell="ecount-preview" style={{minHeight:'100vh',background:'#f4f6fa'}}>
    <header {...(popup ? {'data-ui-popupbar':true} : {'data-ui-topbar':true})} style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:16,padding:'14px 24px',background:'#142b46',color:'#fff'}}>
      <strong>NENOVA <span style={{fontWeight:400,opacity:.75}}>ERP 개발 작업실</span></strong>
      <button data-ui-back-button onClick={() => window.dispatchEvent(new Event('nenova:menu-back-request', {cancelable:true}))} style={{border:'1px solid #8ca5bf',borderRadius:5,background:'transparent',color:'white',padding:'6px 10px'}}>← 탭 목록</button>
      <span style={{marginLeft:'auto',fontSize:13}}>DB 연결 없음 · 외부 API 호출 없음</span>
    </header>
    <main>{children}</main>
  </div>;
}
