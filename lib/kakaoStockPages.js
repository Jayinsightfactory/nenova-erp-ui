import {calculateLedger,validLedgerWeek,normalizeName} from './kakaoStockLedger.js';

export const stockPageScope=(pageId,week)=>JSON.stringify([pageId,week]);
export function stockPageDocuments(items=[]) {
  const latest=new Map();
  for(const item of items){
    try {
      const data=JSON.parse(item.FilterData);
      if(![1,2].includes(data.version)||!validLedgerWeek(data.week)||typeof data.title!=='string'||typeof data.base!=='string'||!Array.isArray(data.events))continue;
      if(data.version===2&&(!data.pageId||typeof data.pageId!=='string'))continue;
      calculateLedger(data.base,data.events);
      const pageId=data.version===2?data.pageId:`legacy:${normalizeName(data.title)}`;
      const document={...data,pageId,item};
      const key=stockPageScope(pageId,data.week),previous=latest.get(key);
      if(!previous||Number(item.FavoriteKey)>Number(previous.item.FavoriteKey))latest.set(key,document);
    }catch{/* Invalid historical snapshots remain available in the saved list. */}
  }
  return [...latest.values()].sort((a,b)=>Number(b.item.FavoriteKey)-Number(a.item.FavoriteKey));
}
export function stockPageTabs(documents,current){
  const pages=new Map();
  for(const doc of documents)if(!pages.has(doc.pageId))pages.set(doc.pageId,{pageId:doc.pageId,title:doc.title});
  pages.set(current.pageId,{pageId:current.pageId,title:current.title});
  return [...pages.values()];
}
