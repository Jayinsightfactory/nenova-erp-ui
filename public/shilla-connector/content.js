// No persistent data, generic script execution, arbitrary URLs or credential access.
let pending = false;
const status=document.createElement('p');
status.id='nenova-shilla-connector-status';
status.textContent=`신라 브라우저 연결 v${chrome.runtime.getManifest().version}`;
status.style.cssText='position:fixed;right:12px;bottom:12px;z-index:1000;padding:6px 10px;background:#ecfdf5;color:#115e59;border:1px solid #99f6e4;border-radius:6px;font:12px sans-serif;pointer-events:none';
document.body.appendChild(status);
window.addEventListener('message',async event=>{
  const message=event.data;
  if(event.source!==window || event.origin!=='https://nenovaweb.com' || message?.type!=='NENOVA_SHILLA_REQUEST' || typeof message.id!=='string' || message.id.length>80) return;
  if(pending) return;
  pending=true;
  try {
    const result=await chrome.runtime.sendMessage({action:message.action,from:message.from,to:message.to});
    window.postMessage({type:'NENOVA_SHILLA_RESULT',id:message.id,...result},event.origin);
  } catch { window.postMessage({type:'NENOVA_SHILLA_RESULT',id:message.id,success:false,error:'연결 프로그램을 새로고침하고 다시 시도하세요.'},event.origin); }
  finally { pending=false; }
});
