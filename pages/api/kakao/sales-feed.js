import { withAuth } from '../../../lib/auth';
import { periodBounds } from '../../../lib/distributionSalesInbox';

function validAfterKey(value) {
  return typeof value==='string'&&value.length<=512&&!/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

export default withAuth(async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({error:'조회만 가능합니다.'});
  const token=process.env.NENOVA_SALES_READ_TOKEN;
  const roomId=process.env.NENOVA_SALES_ROOM_ID;
  if(!token || !roomId) return res.status(503).json({error:'영업방 자동 연결 설정이 아직 완료되지 않았습니다. 우선 대화 파일을 올려 작업할 수 있습니다.',code:'SALES_FEED_NOT_CONFIGURED'});
  let bounds;
  try { bounds=periodBounds(String(req.query.from||''),String(req.query.to||'')); }
  catch(e) { return res.status(400).json({error:e.message}); }
  const afterKey=req.query.afterKey??'';
  if(!validAfterKey(afterKey)) return res.status(400).json({error:'대화 조회 위치가 올바르지 않습니다.'});
  const url=new URL('https://mindmap-viewer-production-adb2.up.railway.app/api/kakao/nenova-sales-feed');
  Object.entries({...bounds,afterKey,limit:'200'}).forEach(([k,v])=>url.searchParams.set(k,v));
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),15000);
  try {
    const upstream=await fetch(url,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal,redirect:'error'});
    if(!upstream.ok) return res.status(502).json({error:'영업방 원문 서버에 연결하지 못했습니다. 기존 목록은 유지됩니다.',code:'SALES_FEED_UPSTREAM'});
    const data=await upstream.json();
    if(data.ok!==true||!Array.isArray(data.messages)||data.messages.length>200||typeof data.hasMore!=='boolean'||(data.nextAfterKey!==null&&!validAfterKey(data.nextAfterKey))||(data.hasMore&&(!validAfterKey(data.nextAfterKey)||data.nextAfterKey===''))) throw new Error('contract');
    if(data.messages.some(r=>r.chatroom!=='영업방'||r.chat_id!==roomId||r.source!=='nenovakakao'||!r.external_message_id)) throw new Error('scope');
    return res.json({ok:true,messages:data.messages,hasMore:data.hasMore,nextAfterKey:data.nextAfterKey});
  } catch { return res.status(502).json({error:'영업방 대화를 확인하지 못했습니다. 잠시 후 다시 불러오세요. 기존 목록은 유지됩니다.'}); }
  finally { clearTimeout(timer); }
});
