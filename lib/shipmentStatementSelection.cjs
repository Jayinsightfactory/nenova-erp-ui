const FAVORITE_PAGE='shipment-statement-customers';
function nearbyWeeks(value){
 if(!['number','string'].includes(typeof value))return [];
 const week=Number(value);if(!Number.isInteger(week)||week<1||week>53)return [];
 return [-2,-1,0,1,2].map(n=>week+n).filter(n=>n>=1&&n<=53);
}
function customerFavoriteKeys(records=[]){
 const result=new Map();
 if(!Array.isArray(records))return result;
 for(const r of records){try{
  const data=JSON.parse(r.FilterData);if(!data||!['number','string'].includes(typeof data.custKey))continue;
  const key=Number(data.custKey),favoriteKey=Number(r.FavoriteKey);
  if(!Number.isSafeInteger(key)||key<=0||!Number.isSafeInteger(favoriteKey)||favoriteKey<=0)continue;
  if(!result.has(key))result.set(key,[]);result.get(key).push(favoriteKey);
 }catch{ /* A malformed or old favorite cannot inject a company into this week. */ }}
 return result;
}
function visibleCustomers(customers,manager,search,favorites){
 const term=String(search??'').trim().toLocaleLowerCase('ko');
 return customers.filter(c=>(!manager||c.Manager===manager)&&(!term||String(c.CustName).toLocaleLowerCase('ko').includes(term)))
  .sort((a,b)=>Number(favorites.has(Number(b.CustKey)))-Number(favorites.has(Number(a.CustKey)))||String(a.CustName).localeCompare(String(b.CustName),'ko')||Number(a.CustKey)-Number(b.CustKey));
}
function mergeRangeSelection(items,start,end,baseline=[]){
 const result=new Set(baseline),low=Math.min(start,end),high=Math.max(start,end);
 for(let i=low;i<=high;i++)if(items[i]?.id!==undefined)result.add(items[i].id);
 return [...result];
}
function toggleCategoryFilter(selected,key){
 const next=new Set(selected);if(next.has(key))next.delete(key);else next.add(key);return [...next];
}
function visibleRows(rows,categories,search){
 const selected=new Set(categories),term=String(search??'').toLocaleLowerCase('ko');
 return rows.filter(r=>(!selected.size||selected.has(r.category))&&`${r.name} ${r.country} ${r.flower}`.toLocaleLowerCase('ko').includes(term));
}
module.exports={FAVORITE_PAGE,nearbyWeeks,customerFavoriteKeys,visibleCustomers,mergeRangeSelection,toggleCategoryFilter,visibleRows};
