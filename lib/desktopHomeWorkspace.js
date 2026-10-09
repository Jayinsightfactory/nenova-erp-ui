import {readPersonalHome,mutatePersonalHome,personalHomeTasks,homeDate,kstHomeDate} from './personalHomeStore.js';
import {canUseDefectIncoming,canUseDefectSales,canUseDefectSupport} from './salesDefectDeductionCore.js';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const clean=value=>String(value||'').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,300);
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
    result.guidance=(data.items||[]).filter(i=>UUID.test(i.id)&&i.status==='CURRENT').map(i=>{
      const key=sourceKey('guidance',i.id,i.updatedAt);return {id:i.id,title:clean(i.title),summary:'업무 지침이 갱신되었습니다.',updatedAt:i.updatedAt,href:'/operations-knowledge?itemId='+encodeURIComponent(i.id),sourceKey:key,unread:!record.reads[key],isRecent:recent(i.updatedAt),isNew:recent(i.updatedAt)&&!record.reads[key],priority:i.priority};
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
          return {id:c.CaseKey,title:clean(c.Title||c.ProductName||'농장 피드백'),summary:clean(c.Status),updatedAt:c.UpdatedAt,href:`/sales/farm-quality?year=${orderYear}&caseKey=${encodeURIComponent(c.CaseKey)}`,sourceKey:key,unread:!record.reads[key],isRecent:recent(c.UpdatedAt),isNew:recent(c.UpdatedAt)&&!record.reads[key],priority:'NORMAL',orderYear,orderWeek};
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
