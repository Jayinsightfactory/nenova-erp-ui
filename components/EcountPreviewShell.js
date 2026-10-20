// The application shell deliberately excludes replay/activity collectors.
export default function EcountPreviewShell({ children, popup, lookup }) {
  return <div data-ui-shell="ecount-preview" style={{minHeight:'100vh',background:'#fff'}}>
    {!lookup&&<header {...(popup ? {'data-ui-popupbar':true} : {'data-ui-topbar':true})} style={{position:'absolute',right:12,top:36,zIndex:2}}>
      <button data-ui-back-button onClick={() => window.dispatchEvent(new Event('nenova:menu-back-request', {cancelable:true}))} style={{border:'1px solid #ccd3db',background:'#fff',color:'#304c6b',padding:'5px 10px',fontSize:13}}>← 이전</button>
    </header>}
    <main>{children}</main>
  </div>;
}
