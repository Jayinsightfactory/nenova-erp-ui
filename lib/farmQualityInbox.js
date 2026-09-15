import {createHash} from 'node:crypto';
import {qualitySourceCoverage,qualityWeek} from './farmQuality.js';
import {canUseDefectIncoming,canUseDefectSales,canUseDefectSupport} from './salesDefectDeductionCore.js';

const id=value=>String(value??'').toLowerCase();
const positive=value=>Number.isSafeInteger(Number(value))&&Number(value)>0;
const sorted=values=>[...new Set(values)].sort((a,b)=>typeof a==='number'?a-b:String(a).localeCompare(String(b)));
const bit=value=>value===true||value===1;
export const inboxError=(code,message,details)=>Object.assign(new Error(message),{code,details});

// Union only actual source membership. Display filters never enter identity.
export function buildQualityInbox({scope,sources=[],signals=[],inboxes=[],links=[],cases=[]}){
 const year=scope.year,fullScope={...scope,from:1,to:53};
 const sourceMap=new Map();for(const row of sources)if(Number(row.OrderYear)===year&&positive(row.DeductionKey)&&!sourceMap.has(Number(row.DeductionKey)))sourceMap.set(Number(row.DeductionKey),row);
 const ownInboxes=inboxes.filter(r=>Number(r.OrderYear)===year),inboxMap=new Map(ownInboxes.map(r=>[id(r.InboxKey),r]));
 const ownCases=cases.filter(r=>Number(r.OrderYear)===year),ownLinks=links.filter(r=>Number(r.OrderYear)===year&&inboxMap.has(id(r.InboxKey))&&positive(r.SourceKey));
 const parent=new Map();const root=k=>{if(!parent.has(k))parent.set(k,k);if(parent.get(k)!==k)parent.set(k,root(parent.get(k)));return parent.get(k);};
 const join=keys=>{if(!keys.length)return;const first=root(keys[0]);for(const k of keys)parent.set(root(k),first);};
 const usableSignals=signals.map(s=>({...s,sourceKeys:sorted((s.sourceKeys||[]).map(Number).filter(k=>sourceMap.has(k)))})).filter(s=>s.sourceKeys.length);
 for(const s of usableSignals)join(s.sourceKeys);
 for(const inbox of ownInboxes)join([...ownLinks.filter(l=>id(l.InboxKey)===id(inbox.InboxKey)).map(l=>Number(l.SourceKey)),...ownCases.filter(c=>id(c.InboxKey)===id(inbox.InboxKey)).map(c=>Number(c.SourceKey)).filter(positive)]);
 for(const c of ownCases)if(positive(c.SourceKey))root(Number(c.SourceKey));
 const components=new Map();for(const key of parent.keys()){const r=root(key);if(!components.has(r))components.set(r,[]);components.get(r).push(key);}
 const safeRows=new Map(qualitySourceCoverage([...sourceMap.values()],fullScope).rows.map(r=>[r.sourceKey,r]));
 const items=[];
 for(const membership of components.values()){
  const sourceKeys=sorted(membership),keySet=new Set(sourceKeys),componentLinks=ownLinks.filter(l=>keySet.has(Number(l.SourceKey)));
  const componentCases=ownCases.filter(c=>keySet.has(Number(c.SourceKey))||componentLinks.some(l=>id(l.InboxKey)===id(c.InboxKey)));
  const inboxKeys=sorted([...componentLinks.map(l=>id(l.InboxKey)),...componentCases.map(c=>id(c.InboxKey)).filter(k=>inboxMap.has(k))]);
  const patterns=usableSignals.filter(s=>s.sourceKeys.some(k=>keySet.has(k))),detected=new Set(patterns.flatMap(s=>s.sourceKeys));
  const linked=new Set([...componentLinks.map(l=>Number(l.SourceKey)),...componentCases.map(c=>Number(c.SourceKey))]),newSourceKeys=sourceKeys.filter(k=>detected.has(k)&&!linked.has(k));
  const publicSources=sourceKeys.map(k=>{
   const raw=sourceMap.get(k),safe=safeRows.get(k);
   return {...(safe||{sourceKey:k,orderYear:year,orderWeek:String(raw?.OrderWeek||'차수 미상'),prodKey:Number(raw?.ProdKey)||null,productName:raw?.ProductName||raw?.ProdName||'품목 미상',farmName:raw?.FarmName||'농장 미지정',customerName:raw?.CustName||'업체 미지정',quantity:null,unit:raw?.SourceUnit||'미지정',eligible:false,reasons:['삭제되었거나 현재 원본 없음'],rangeStatus:'UNKNOWN_WEEK'}),isNew:newSourceKeys.includes(k),historical:!detected.has(k)};
  });
  for(const row of publicSources)row.flowerName=String(sourceMap.get(row.sourceKey)?.FlowerName||'').trim();
  const publicCases=componentCases.map(c=>({caseKey:id(c.CaseKey),title:c.Title,status:c.Status,version:Number(c.Version),eventCount:Number(c.EventCount||0),recentEvents:(c.RecentEvents||[]).map(e=>({EventKey:String(e.EventKey),EventNo:e.EventNo,Kind:e.Kind,Body:e.Body,AuthorName:e.AuthorName,Department:e.Department,CreatedAt:e.CreatedAt}))})).sort((a,b)=>a.caseKey.localeCompare(b.caseKey));
  const allExcluded=inboxKeys.length>0&&inboxKeys.every(k=>bit(inboxMap.get(k).Excluded));
  // Exclusion covers the reviewed membership at ExcludedAt. A later explicit
  // acknowledgement must not hide newly linked evidence behind that old audit.
  const linkedAfterExclusion=componentLinks.some(l=>{const owner=inboxMap.get(id(l.InboxKey));return bit(owner?.Excluded)&&owner.ExcludedAt&&l.LinkedAt&&new Date(l.LinkedAt).getTime()>new Date(owner.ExcludedAt).getTime();});
  const excluded=allExcluded&&newSourceKeys.length===0&&!linkedAfterExclusion;
  const reviewReasons=sorted(patterns.flatMap(s=>s.reviewReasons||[]));if(allExcluded&&newSourceKeys.length)reviewReasons.push('제외 이후 새 원본');
  const totals=new Map();for(const r of publicSources)if(!r.historical&&Number.isFinite(r.quantity))totals.set(r.unit,(totals.get(r.unit)||0)+r.quantity);
  const weeks=publicSources.map(r=>qualityWeek(r.orderWeek)).filter(Boolean);
  const revision=createHash('sha256').update(JSON.stringify({year,sourceKeys,sources:publicSources,patterns:patterns.map(s=>[s.kind,sorted(s.sourceKeys)]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),inboxes:inboxKeys.map(k=>[k,inboxMap.get(k).Version,bit(inboxMap.get(k).Excluded),inboxMap.get(k).ExclusionReason]),cases:publicCases.map(c=>[c.caseKey,c.version,c.status])})).digest('hex');
  items.push({key:inboxKeys.length===1?inboxKeys[0]:inboxKeys.length?`composite:${inboxKeys.join(':')}`:`v1:${year}:${sourceKeys[0]}`,revision,orderYear:year,inboxKeys,caseKeys:publicCases.map(c=>c.caseKey),virtual:inboxKeys.length===0,needsFeedback:!excluded&&(patterns.length>0||publicCases.length>0),excluded,exclusionReason:inboxKeys.map(k=>inboxMap.get(k).ExclusionReason).filter(Boolean).join(' / '),sourceKeys,newSourceKeys,sourceCount:sourceKeys.length,patternKinds:sorted(patterns.map(s=>s.kind)),firstWeek:weeks.length?Math.min(...weeks):null,lastWeek:weeks.length?Math.max(...weeks):null,quantitiesByUnit:[...totals].sort(([a],[b])=>a.localeCompare(b)).map(([unit,quantity])=>({unit,quantity})),sourceReviewRequired:reviewReasons.length>0,sourceReviewReasons:reviewReasons,suspectedRecurrence:newSourceKeys.length>0&&publicCases.some(c=>['CLOSED','OBSERVING'].includes(c.status)),conflict:publicCases.length>1?'MULTIPLE_HISTORIES':null,cases:publicCases,sources:publicSources,capabilities:{canComment:!excluded,canManage:!excluded,canExclude:!excluded,canRestore:inboxKeys.some(k=>bit(inboxMap.get(k).Excluded))},exclusionScopes:inboxKeys.map(k=>({inboxKey:k,version:Number(inboxMap.get(k).Version),excluded:bit(inboxMap.get(k).Excluded),reason:inboxMap.get(k).ExclusionReason||'',caseKeys:componentCases.filter(c=>id(c.InboxKey)===k).map(c=>id(c.CaseKey)).sort()}))});
 }
 items.sort((a,b)=>(b.lastWeek||0)-(a.lastWeek||0)||a.key.localeCompare(b.key));
 return {items,counts:{total:items.length,active:items.filter(i=>!i.excluded).length,excluded:items.filter(i=>i.excluded).length,detectedSourceCount:new Set(usableSignals.flatMap(s=>s.sourceKeys)).size}};
}

export function resolveQualityInboxTarget(args){
 const {target={},scope,cases=[]}=args,{items}=buildQualityInbox(args);
 const anchor=Number(target.anchorSourceKey);
 const component=items.find(i=>i.sourceKeys.includes(anchor));
 if(!positive(anchor)||!component)throw inboxError('INBOX_NOT_FOUND','피드백 원본을 다시 선택하세요.');
 if(target.revision!==component.revision)throw inboxError('INBOX_STALE','원본 또는 이력이 변경되었습니다. 새 내용을 확인하세요.',{inbox:component});
 if(target.inboxKey&&!component.inboxKeys.includes(id(target.inboxKey)))throw inboxError('INBOX_NOT_FOUND','선택한 인박스 범위가 다릅니다.');
 if(component.caseKeys.length>1&&!target.caseKey)throw inboxError('INBOX_TARGET_REQUIRED','기록할 이력을 선택하세요.',{inbox:component});
 const caseKey=target.caseKey?id(target.caseKey):component.caseKeys[0];
 if(caseKey&&!component.caseKeys.includes(caseKey))throw inboxError('INBOX_NOT_FOUND','선택한 이력이 이 원본에 속하지 않습니다.');
 const targetCase=cases.find(c=>Number(c.OrderYear)===scope.year&&id(c.CaseKey)===caseKey)||null;
 if(target.inboxKey&&targetCase?.InboxKey&&id(targetCase.InboxKey)!==id(target.inboxKey))throw inboxError('INBOX_TARGET_REQUIRED','선택한 인박스의 이력을 선택하세요.');
 const owned=new Set((args.links||[]).filter(l=>Number(l.OrderYear)===scope.year).map(l=>Number(l.SourceKey)));
 return {component,targetCase,newSourceKeys:component.sourceKeys.filter(k=>!owned.has(k)&&(args.sources||[]).some(r=>Number(r.OrderYear)===scope.year&&Number(r.DeductionKey)===k)),expectedRevision:component.revision};
}

export function qualityInboxMutationPolicy({action,user,item,reason,kind}){
 const manage=canUseDefectIncoming(user);
 if(!user?.userId||user.accountActive===false||![canUseDefectIncoming,canUseDefectSales,canUseDefectSupport].some(fn=>fn(user)))throw inboxError('INBOX_FORBIDDEN','영업·수입 업무 권한이 필요합니다.');
 if(['exclude','restore'].includes(action)){
  if(!manage)throw inboxError('INBOX_FORBIDDEN','제외·복원은 수입부 권한이 필요합니다.');
  if(typeof reason!=='string'||!reason.trim()||reason.trim().length>1000)throw inboxError('INBOX_INVALID','제외·복원 사유를 1~1000자로 입력하세요.');
  return {action,kind:action==='exclude'?'EXCLUDE':'RESTORE',reason:reason.trim(),manage};
 }
 if(action!=='event')throw inboxError('INBOX_INVALID','작업 종류를 확인하세요.');
 if(item?.excluded)throw inboxError('INBOX_INVALID','제외된 피드백을 먼저 복원하세요.');
 if(kind!=='COMMENT'&&!manage)throw inboxError('INBOX_FORBIDDEN','요청·답변은 수입부 권한이 필요합니다.');
 return {action,kind,manage};
}
