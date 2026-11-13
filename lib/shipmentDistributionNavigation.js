// Display-only priorities. User-requested favorites win; names remain A-Z within each bucket.
const az=(a,b)=>String(a||'').localeCompare(String(b||''),'en',{sensitivity:'base',numeric:true});
export function distributionFamilyMatches(row,key=''){
 if(!key)return true;
 const parts=String(key).split('::');
 return parts.length===2&&!!parts[0]&&!!parts[1]&&String(row?.CounName||'').trim()===parts[0]&&String(row?.FlowerName||'').trim()===parts[1];
}
export function favoriteDistributionRows(rows=[],favoriteKeys=new Set()) {
 return [...rows].sort((a,b)=>Number(favoriteKeys.has(Number(b.ProdKey)))-Number(favoriteKeys.has(Number(a.ProdKey)))||az(a.ProdName,b.ProdName)||Number(a.ProdKey)-Number(b.ProdKey));
}
export function distributionNavigationGroups(rows=[],groupFavorites=[],favoriteKeys=new Set()) {
 const favorites=new Set(groupFavorites.map(f=>f.groupKey));const groups=new Map();
 for(const row of rows){const country=String(row.CounName||'기타').trim(),flower=String(row.FlowerName||'미분류').trim(),key=`${country}::${flower}`;
  if(!groups.has(key))groups.set(key,{key,country,flower,rows:[],favorite:favorites.has(key)});groups.get(key).rows.push(row);}
 return [...groups.values()].map(g=>({...g,rows:favoriteDistributionRows(g.rows,favoriteKeys),favoriteCount:g.rows.filter(p=>favoriteKeys.has(Number(p.ProdKey))).length}))
 .sort((a,b)=>(a.favorite?0:a.favoriteCount?1:2)-(b.favorite?0:b.favoriteCount?1:2)||az(a.country,b.country)||az(a.flower,b.flower));
}
export function buildDistributionDateLookup(rows=[]) {
 const products=new Map(),customers=new Map(),pairs=new Map(),all=new Set();
 const add=(map,key,date)=>{if(!map.has(key))map.set(key,new Set());map.get(key).add(date);};
 for(const row of rows){const date=/^\d{4}-\d{2}-\d{2}$/.test(String(row.ShipmentDate||''))?row.ShipmentDate:'';
  const p=Number(row.ProdKey),c=Number(row.CustKey);add(products,p,date);add(customers,c,date);add(pairs,`${c}|${p}`,date);if(date)all.add(date);}
 return {dates:[...all].sort(),matches(value,prodKey,custKey){if(!value)return true;
  const facts=prodKey!=null&&custKey!=null?pairs.get(`${Number(custKey)}|${Number(prodKey)}`):prodKey!=null?products.get(Number(prodKey)):customers.get(Number(custKey));
  return value==='undated'?(!facts||facts.has('')):!!facts?.has(value);}};
}
