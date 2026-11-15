'use strict';
// 아침 브리핑(읽기 전용). 홈 화면은 CSP 로 서버를 직접 부르지 못하므로 메인 쪽에서 GET /api/briefing 한 번만 부르고,
// 화면에는 검증·길이 제한을 거친 카드만 넘긴다. 카드 숫자·권한은 서버(lib/morningBriefing.js)가 정한 그대로다.
const {ORIGIN}=require('./policy.cjs');
const STATUS=new Set(['red','amber','green','gray']);
const clean=(value,max)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):'';
function projectBriefing(data){
  if(!data||data.success!==true||!Array.isArray(data.cards)||data.cards.length>20)throw Error('아침 브리핑 형식을 확인하세요.');
  const cards=data.cards.map(card=>{
    const status=STATUS.has(card?.status)?card.status:'gray',href=clean(card?.href,200);
    return {id:clean(card?.id,40),title:clean(card?.title,60),status,statusLabel:clean(card?.statusLabel,20)||'확인 못 함',headline:clean(card?.headline,120),
      lines:(Array.isArray(card?.lines)?card.lines:[]).slice(0,8).map(line=>clean(line,200)).filter(Boolean),more:Number.isSafeInteger(card?.more)&&card.more>0?card.more:0,
      // 같은 사이트 안의 화면 경로만 허용한다(외부 주소·프로토콜 금지).
      href:/^\/(?!\/)[\w\-./?=&%]*$/.test(href)?href:'',linkLabel:clean(card?.linkLabel,40),unavailable:card?.unavailable===true||!STATUS.has(card?.status)};
  }).filter(card=>card.id&&card.title);
  const tally={red:0,amber:0,green:0,gray:0};for(const card of cards)tally[card.status]++;
  // 전체 색은 서버 말을 믿지 않고 카드에서 다시 센다(카드가 걸러졌을 때 요약만 초록으로 남지 않게).
  // 불러오지 못한 카드가 하나라도 있으면 초록으로 두지 않는다.
  const overall=!cards.length||tally.gray===cards.length?'gray':tally.red?'red':tally.amber?'amber':cards.some(card=>card.unavailable)?'gray':'green';
  return {today:/^\d{4}-\d{2}-\d{2}$/.test(data.today)?data.today:'',summary:clean(data.summary,80)||'불러온 항목이 없습니다',overall,tally,cards,
    generatedAt:Number.isFinite(Date.parse(data.generatedAt))?new Date(data.generatedAt).toISOString():null};
}
async function morningBriefing({owner,fetch,isCurrent,onUnauthorized}){
  if(!owner||!isCurrent())throw Error('로그인이 필요합니다.');
  const response=await fetch(ORIGIN+'/api/briefing',{method:'GET',credentials:'include',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!isCurrent())throw Error('계정이 변경되었습니다.');
  if(response.status===401){onUnauthorized?.();throw Error('로그인을 다시 확인하세요.');}
  if(response.status===404)throw Error('웹 서버에 아침 브리핑이 아직 반영되지 않았습니다.');
  if(!response.ok)throw Error(`아침 브리핑을 불러오지 못했습니다. (${response.status})`);
  const raw=await response.text();if(!isCurrent())throw Error('계정이 변경되었습니다.');if(raw.length>512*1024)throw Error('아침 브리핑 응답이 너무 큽니다.');
  let data;try{data=JSON.parse(raw);}catch{throw Error('아침 브리핑 응답을 확인하세요.');}
  if(data.ownerId&&data.ownerId!==owner)throw Error('계정이 변경되었습니다.');
  return {success:true,ownerId:owner,...projectBriefing(data)};
}
module.exports={morningBriefing,projectBriefing};
