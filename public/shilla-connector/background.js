import { collectReceipts } from './collector.js';
let busy=false;
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id || !sender.tab || !/^https:\/\/nenovaweb\.com\/raum\/shilla-analysis(?:[?#]|$)/.test(sender.url||'') || sender.frameId!==0) return false;
  if(message.action==='ping') {respond({success:true,version:'1.0.0'});return false;}
  if(message.action!=='receipts') return false;
  if(busy) {respond({success:false,error:'다른 입고 조회가 진행 중입니다.'});return false;}
  busy=true;
  (async()=>{
    try {
      const valid=value=>/^20\d{2}-\d{2}-\d{2}$/.test(value||'')&&new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)===value;
      if(!valid(message.from)||!valid(message.to)||message.from>message.to||message.from.slice(0,4)!==message.to.slice(0,4)) throw new Error('같은 연도 안의 입고기간을 지정하세요.');
      const tabs=await chrome.tabs.query({url:'https://www.shillasrm.com/*'});
      const candidates=tabs.filter(t=>new URL(t.url).pathname==='/afterLoginOK.do');
      if(candidates.length!==1) throw new Error(candidates.length?'신라 로그인 탭을 하나만 남겨주세요.':'같은 Chrome 프로필에서 신라에 로그인하고 입고실적을 여세요.');
      const results=await chrome.scripting.executeScript({target:{tabId:candidates[0].id},world:'MAIN',func:collectReceipts,args:[message.from,message.to]});
      const result=results[0]?.result;
      if(!result?.success) throw new Error(result?.error || '신라 조회 결과를 받지 못했습니다.');
      respond(result);
    } catch(error) {respond({success:false,error:error.message});}
    finally {busy=false;}
  })();
  return true;
});
