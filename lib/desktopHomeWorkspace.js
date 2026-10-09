import {readPersonalHome,mutatePersonalHome,personalHomeTasks,homeDate,kstHomeDate} from './personalHomeStore.js';
import {canUseDefectIncoming,canUseDefectSales,canUseDefectSupport} from './salesDefectDeductionCore.js';
import {isKnowledgeId} from './operationsKnowledgeSchema.js';
import {QUALITY_STATUSES} from './farmQuality.js';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const clean=value=>String(value||'').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,300);
const body=value=>String(value||'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'').slice(0,4000);
const unique=values=>[...new Set(values.filter(Boolean))];
const excerpt=(value,max)=>value.length>max?value.slice(0,max-1)+'…':value;
const compactNames=(values,max)=>{let text='',count=0;for(const value of values){const next=text?text+', '+value:value;if(next.length>max)break;text=next;count++;}if(!count&&values.length){text=excerpt(values[0],max);count=1;}return text+(values.length>count?` 외 ${values.length-count}개`:'');};
function feedbackDetails(c,data,year) {
  const groups=(data.inbox?.items||[]).filter(i=>Number(i.orderYear)===year&&(i.caseKeys||[]).some(k=>String(k).toLowerCase()===String(c.CaseKey).toLowerCase()));
  const safeGroup=groups.length===1&&groups[0].caseKeys?.length===1&&groups[0].inboxKeys?.length===1&&String(groups[0].inboxKeys[0]).toLowerCase()===String(c.InboxKey||'').toLowerCase();
  const allGrouped=groups.flatMap(i=>i.sources||[]).filter(s=>Number(s.orderYear)===year);
  const grouped=safeGroup?allGrouped.filter(s=>!s.isNew):[];
  const rows=grouped.length?grouped:(data.coverage?.rows||[]).filter(s=>Number(s.orderYear)===year&&Number(s.sourceKey)===Number(c.SourceKey));
  const sources=[...new Map(rows.map(s=>[JSON.stringify([year,s.orderWeek||null,s.productName,s.farmName]),{orderYear:year,orderWeek:s.orderWeek||null,productName:body(s.productName),farmName:body(s.farmName)}])).values()];
  const events=(c.RecentEvents||[]).map(e=>({kind:clean(e.Kind),body:body(e.Body),createdAt:e.CreatedAt||null}));
  const original=(data.coverage?.rows||[]).find(s=>Number(s.orderYear)===year&&Number(s.sourceKey)===Number(c.SourceKey));
  const relatedSources=[...new Map(allGrouped.filter(s=>!safeGroup||s.isNew).map(s=>[JSON.stringify([year,s.orderWeek,s.productName,s.farmName]),{orderYear:year,orderWeek:s.orderWeek||null,productName:body(s.productName),farmName:body(s.farmName)}])).values()];
  const farms=unique(sources.map(s=>s.farmName)),products=unique(sources.map(s=>s.productName));
  return {farms:farms.length?farms:unique([body(c.FarmName)]),products:products.length?products:unique([body(c.ProductName)]),sources,relatedSources,caseFarm:body(original?.farmName||c.FarmName),caseProduct:body(original?.productName||c.ProductName),problem:body(c.Title),request:[...events].reverse().find(e=>e.kind==='REQUEST')?.body||'',latestBody:body(c.LatestBody)||events.at(-1)?.body||'',dueDate:c.DueDate||null,recentEvents:events};
}
const sourceKey=(source,id,revision)=>`${source}/${id}/${revision}`;
export function createHomeQualityCache(loader,clock=()=>Date.now()) {
  const cache=new Map();
  return async scope=>{
    const key=String(scope.year),existing=cache.get(key);
    if(existing&&(existing.pending||existing.until>clock()))return existing.value;
    const entry={pending:true,until:0,value:null};
    entry.value=Promise.resolve().then(()=>loader(scope)).then(value=>{entry.pending=false;entry.until=clock()+25000;entry.value=value;return value;}).catch(error=>{if(cache.get(key)===entry)cache.delete(key);throw error;});
    cache.set(key,entry);if(cache.size>4)for(const k of cache.keys()){if(k!==key&&!cache.get(k).pending){cache.delete(k);break;}}
    return entry.value;
  };
}
const cachedQuality=createHomeQualityCache(async scope=>(await import('./farmQualityStore.js')).loadQuality(scope));
export async function desktopHomeFeeds(user,record,{now=new Date(),readKnowledge,loadQuality}={}) {
  const result={guidance:[],feedback:[],feedErrors:{}};
  const cutoff=now.getTime()-7*86400000;
  const recent=value=>{const at=Date.parse(value);return Number.isFinite(at)&&at>=cutoff&&at<=now.getTime();};
  try {
    const read=readKnowledge||((await import('./operationsKnowledgeStore.js')).readKnowledge);
    const data=await read();
    result.guidance=(data.items||[]).filter(i=>isKnowledgeId(i.id)&&['CHECK','CURRENT'].includes(i.status)).map(i=>{
      const details={situation:body(i.situation),action:body(i.action),caution:body(i.caution),checklist:body(i.checklist),contact:body(i.contact),reviewDate:i.reviewDate||null};
      const key=sourceKey('guidance',i.id,i.updatedAt);return {id:i.id,title:clean(i.title),status:i.status,statusLabel:i.status==='CHECK'?'확인 필요':'현재 지침',details,summary:clean([details.situation,details.action].filter(Boolean).join(' · ')),updatedAt:i.updatedAt,href:'/operations-knowledge?itemId='+encodeURIComponent(i.id),sourceKey:key,unread:!record.reads[key],isRecent:recent(i.updatedAt),isNew:recent(i.updatedAt)&&!record.reads[key],priority:i.priority};
    }).sort((a,b)=>Number(b.priority==='IMPORTANT')-Number(a.priority==='IMPORTANT')||String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,20);
  } catch {result.feedErrors.guidance='업무 지침을 불러오지 못했습니다. 다시 확인하세요.';}
  if([canUseDefectIncoming,canUseDefectSales,canUseDefectSupport].some(fn=>fn(user))) {
    try {
      const load=loadQuality||cachedQuality;
      const year=Number(kstHomeDate(now).slice(0,4));const years=[year];if(year>2000&&Number(kstHomeDate(new Date(cutoff)).slice(0,4))<year)years.push(year-1);
      const loadYear=async orderYear=>{
        const data=await load({year:orderYear,from:1,to:53});
        return (data.cases||[]).filter(c=>UUID.test(c.CaseKey)&&Number(c.OrderYear)===orderYear).map(c=>{
          const original=(data.coverage?.rows||[]).find(row=>Number(row.sourceKey)===Number(c.SourceKey)&&Number(row.orderYear)===orderYear);
          const orderWeek=original?.orderWeek&&/^\d{1,2}(?:-\d{1,2})?$/.test(original.orderWeek)?original.orderWeek:null;
          const key=sourceKey('feedback',c.CaseKey,`${orderYear}-${c.Version||0}-${c.UpdatedAt}`);
          const details=feedbackDetails(c,data,orderYear);
          const summary=excerpt([compactNames(details.farms.length?details.farms:[details.caseFarm],55),compactNames(details.products.length?details.products:[details.caseProduct],120),excerpt(details.problem,70),excerpt(details.latestBody,70)].filter(Boolean).join(' · '),300);
          return {id:c.CaseKey,title:clean(c.Title||'농장 피드백'),status:clean(c.Status),statusLabel:QUALITY_STATUSES[c.Status]||clean(c.Status),details,summary:clean(summary),updatedAt:c.UpdatedAt,href:`/sales/farm-quality?year=${orderYear}&caseKey=${encodeURIComponent(c.CaseKey)}`,sourceKey:key,unread:!record.reads[key],isRecent:recent(c.UpdatedAt),isNew:recent(c.UpdatedAt)&&!record.reads[key],priority:'NORMAL',orderYear,orderWeek};
        });
      };
      const readYear=async value=>{try{return await loadYear(value);}catch{result.feedErrors.feedback='일부 연도의 수입부 피드백을 불러오지 못했습니다. 다시 확인하세요.';return [];}};
      const feeds=await Promise.all(years.map(readYear));
      // A new reporting year may have no cases yet. Look back exactly one year,
      // retaining each case's actual year; never imply these are current-year cases.
      if(!feeds.flat().length&&!result.feedErrors.feedback&&!years.includes(year-1)&&year>2000)feeds.push(await readYear(year-1));
      result.feedback=[...new Map(feeds.flat().map(i=>[i.sourceKey,i])).values()].sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))).slice(0,20);
    } catch {result.feedErrors.feedback='수입부 피드백을 불러오지 못했습니다. 다시 확인하세요.';}
  }
  const items=[...result.guidance,...result.feedback].sort((a,b)=>String(a.updatedAt||'').localeCompare(String(b.updatedAt||'')));
  for(const item of items){if(Buffer.byteLength(JSON.stringify(result),'utf8')<=1024*1024)break;item.details={};item.detailsTruncated=true;item.detailNotice='상세 내용이 커서 원문에서 전체 내용을 확인하세요.';}
  return result;
}
export async function desktopHomeWorkspace(user,query={},command=null,options={}) {
  if(!user?.userId||user.accountActive===false)throw Object.assign(new Error('로그인이 필요합니다.'),{statusCode:403});
  const now=options.now||new Date();const date=homeDate(query.date||command?.date||kstHomeDate(now));
  let record=await readPersonalHome(user.userId,options);let feeds=await desktopHomeFeeds(user,record,{...options,now});
  if(command){
    const readable=new Set([...feeds.guidance,...feeds.feedback].map(i=>i.sourceKey));
    record=await mutatePersonalHome(user.userId,command,{...options,now:()=>now,validateRead:key=>readable.has(key)});
    for(const list of [feeds.guidance,feeds.feedback])for(const item of list){item.unread=!record.reads[item.sourceKey];item.isNew=item.isRecent&&item.unread;}
  }
  return {success:true,schemaVersion:1,ownerId:user.userId,date,revision:record.revision,...personalHomeTasks(record,date,{offset:query.offset??0,limit:query.limit??200}),...feeds,syncedAt:now.toISOString()};
}
