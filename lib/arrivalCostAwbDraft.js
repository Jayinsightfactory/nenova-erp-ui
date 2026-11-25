const membership=a=>a.members.map(m=>m.warehouseKey).sort((a,b)=>a-b).join(',');
// A re-keyed AWB must not erase typed costs. Changed memberships never inherit
// conflicting inputs or a confirmed expense scope silently.
export function reconcileAwbDraft(inputs,oldAwbs,newAwbs){
 const next={...inputs},conflicts=[];
 for(const group of newAwbs){const same=oldAwbs.find(a=>membership(a)===membership(group));
  if(same&&inputs[same.awb]){next[group.awb]={...inputs[same.awb]};continue;}
  if(inputs[group.awb])continue;
  const sources=oldAwbs.filter(a=>a.members.some(m=>group.members.some(n=>n.warehouseKey===m.warehouseKey))).filter(a=>inputs[a.awb]);
  if(!sources.length)continue;const draft={};
  for(const key of new Set(sources.flatMap(a=>Object.keys(inputs[a.awb])))){const values=sources.map(a=>inputs[a.awb][key]);if(values.every(v=>JSON.stringify(v)===JSON.stringify(values[0])))draft[key]=values[0];else{draft[key]=key==='fullBoxCounts'?{}:'';conflicts.push({awb:group.awb,key,values});}}
  draft.fullBoxCounts={};next[group.awb]=draft;
 }
 return {inputs:next,conflicts};
}
export function remapAwbPools(pools,oldAwbs,newAwbs){return pools.map(pool=>{let changed=false;const targets=[...new Set(pool.awbs.flatMap(key=>{const old=oldAwbs.find(a=>a.awb===key);if(!old)return [key];const groups=newAwbs.filter(a=>a.members.some(m=>old.members.some(n=>n.warehouseKey===m.warehouseKey)));if(groups.length!==1||groups[0].awb!==key||membership(groups[0])!==membership(old))changed=true;return groups.map(a=>a.awb);} ))];return {...pool,awbs:targets,confirmed:changed?false:pool.confirmed};});}
