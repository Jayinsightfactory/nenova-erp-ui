// Saved Product links establish identity, never packaging.
const clean=v=>String(v??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const identity=r=>JSON.stringify([clean(r.name),clean(r.unit)]);
export function comparisonUnit(row,prodKey) {
  // Owner confirmed 2026-10-20: Shilla white Anthurium "단" means one stem.
  if(Number(prodKey)===181 && /안[시스]리움/.test(row.name) && ['단','송이','스팀','EA'].includes(clean(row.unit))) return '송이';
  return clean(row.unit);
}
export function buildAnalysisCatalog(db,excel) {
  const links=new Map(),issues=[];
  for(const row of db) {
    if(row.isCustom || !(Number(row.prodKey)>0) || !row.prodName) continue;
    const id=identity(row);
    if(!links.has(id)) links.set(id,new Map());
    links.get(id).set(Number(row.prodKey),row);
  }
  for(const [id,keys] of links) if(keys.size>1) issues.push(`저장 품목 연결 충돌: ${JSON.parse(id).join(' / ')}`);
  const enrich=rows=>rows.map(row=>{
    const candidates=links.get(identity(row));
    const linked=!row.isCustom && candidates?.size===1?[...candidates.values()][0]:null;
    const prodKey=linked?.prodKey??null,unit=comparisonUnit(row,prodKey);
    return {...row,originalUnit:row.unit,unit,prodKey,prodName:linked?.prodName||'',
      comparisonKey:linked&&unit?JSON.stringify(['product',Number(prodKey),unit]):identity(row)};
  });
  const d=enrich(db),x=enrich(excel),targets=new Map();
  for(const row of [...d,...x]) {
    if(!targets.has(row.comparisonKey)) targets.set(row.comparisonKey,{
      key:row.comparisonKey,name:row.name,unit:row.unit,prodKey:row.prodKey,prodName:row.prodName,aliases:[],
    });
    const target=targets.get(row.comparisonKey);
    if(!target.aliases.includes(row.name)) target.aliases.push(row.name);
  }
  return {db:d,excel:x,targets:[...targets.values()],issues};
}
const tokens=name=>clean(name).replace(/덴파래/g,'덴파레').replace(/안시리움/g,'안스리움')
  .replace(/([가-힣])([MLX]+)\b/g,'$1 $2').replace(/[·,()[\]/]/g,' ').split(/\s+/).filter(Boolean);
export function proposeReceiptMapping(group,targets) {
  if(!['','-'].includes(clean(group.spec))) return null;
  const source=tokens(group.name);
  const candidates=targets.filter(t=>t.prodKey && t.aliases.some(alias=>{
    const parts=tokens(alias);
    return parts.length>=2 && parts.every(p=>source.includes(p));
  }));
  if(candidates.length!==1) return null;
  const target=candidates[0];
  let factor=1,unitConfirmed=clean(group.unit)===clean(target.unit);
  let reason='기존 전산 연결 + 원문 품명 일치; 포장 단위 확인 필요';
  if(Number(target.prodKey)===181 && target.unit==='송이' && group.unit==='EA') {
    unitConfirmed=true;reason='사용자 확인: 안시리움 단 표기 = 송이 = 신라 EA (1:1)';
  } else if(['송이','스팀'].includes(target.unit) && group.unit==='EA') {
    unitConfirmed=true;reason='기존 전산 연결 + 개별 송이 단위';
  } else if(group.unit==='PK') {
    const pack=group.name.match(/\((\d+)EA\/PK\)/i),targetPack=target.unit.match(/^단[-*](\d+)(?:스팀|대)$/);
    if(pack&&targetPack) {
      factor=Number(pack[1])/Number(targetPack[1]);
      unitConfirmed=true;reason='기존 전산 연결 + 양쪽 원문 포장 수량';
    }
  }
  return {target:target.key,factor,unitConfirmed,reason};
}
