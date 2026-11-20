// Display-only decomposition. Never changes its parent report or financial sources.
export const TRANSPORTS = Object.freeze([
  { id: 'sea', label: 'HUBFRESH · 배' },
  { id: 'air', label: 'Cloudland · 비행기' },
]);
const DIRECT_TRANSPORTS = [...TRANSPORTS, {id:'unassigned',label:'직접 귀속되지 않은 잔차'}];
export const TRANSPORT_AMOUNT_KEYS = Object.freeze(['N','L','O','AC','AJ','C','Q','S','P','T','G','E','F','H','I','J']);
export const finiteAmount = value => value == null || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
export function parseChinaTransportScope(year, major) {
  if (Array.isArray(year) || Array.isArray(major) || !/^[12]\d{3}$/.test(String(year)) || !/^(0?[1-9]|[1-4]\d|5[0-3])$/.test(String(major))) return null;
  return { orderYear: String(year), major: String(major).padStart(2, '0') };
}
export function chinaTransportFarm(farm) {
  const name = String(farm || '').trim().toUpperCase();
  return name === 'HUBFRESH' ? 'sea' : name === 'CLOUDLAND' ? 'air' : 'unassigned';
}
export function chinaTransportEligible(year,major) {
  const scope=parseChinaTransportScope(year,major);
  return !!scope && Number(scope.major)>=39;
}
const scoped = (row, scope) => String(row.orderYear) === scope.orderYear && String(row.orderWeek).split('-')[0].padStart(2,'0') === scope.major;
const blankShares = () => ({ sea: 0, air: 0, unassigned: 0 });

export function incomingTransportShares(incoming, scope) {
  const groups = new Map();
  for (const row of incoming.filter(row => scoped(row, scope))) {
    const key = String(row.prodKey), item = groups.get(key) || { qty: blankShares(), invalid: false, units: new Set() };
    const qty = finiteAmount(row.quantity);
    item.units.add(String(row.unit || ''));
    if (qty == null || qty < 0 || !row.unit) item.invalid = true;
    else item.qty[chinaTransportFarm(row.farm)] += qty;
    groups.set(key, item);
  }
  return new Map([...groups].map(([key,item]) => {
    const total = Object.values(item.qty).reduce((a,b)=>a+b,0);
    return [key, item.invalid || item.units.size !== 1 || total <= 0
      ? { sea:0, air:0, unassigned:1 }
      : Object.fromEntries(Object.entries(item.qty).map(([id,qty])=>[id,qty/total]))];
  }));
}

export function shipmentTransportShares(row, fallback) {
  const assignments = row.assignments || [];
  const qty = finiteAmount(row.quantity);
  if (!assignments.length) return { shares: fallback || { sea:0,air:0,unassigned:1 }, basis: fallback ? 'incoming_ratio' : 'no_incoming' };
  // A partial actual allocation stays partial; never invent the missing farm.
  const shares = blankShares();
  let sum = 0;
  for (const item of assignments) {
    const q = finiteAmount(item.quantity);
    if (!(qty > 0) || q == null || q < 0) return { shares:{sea:0,air:0,unassigned:1}, basis:'invalid_assignment' };
    shares[chinaTransportFarm(item.farm)] += q / qty;
    sum += q;
  }
  if (sum > qty + 1e-7) return { shares:{sea:0,air:0,unassigned:1}, basis:'invalid_assignment' };
  shares.unassigned += Math.max(0,1-sum/qty);
  return { shares, basis:'actual_farm' };
}

function buildDirectBreakdown(parent, evidence, scope) {
  if (!parseChinaTransportScope(scope?.orderYear, scope?.major) || evidence?.orderYear !== scope.orderYear || evidence?.major !== scope.major) throw Error('운송수단 근거의 연도·차수가 다릅니다.');
  const rows = DIRECT_TRANSPORTS.map(item => ({ ...item, calc:Object.fromEntries(TRANSPORT_AMOUNT_KEYS.map(key=>[key,0])) }));
  const byId = Object.fromEntries(rows.map(row=>[row.id,row]));
  const shares = incomingTransportShares(evidence.incoming || [],scope);
  const warnings = [...(evidence.warnings || [])], basisCounts = {};
  const add = (column, amount, allocation) => {
    if (finiteAmount(amount) == null) return;
    for (const id of ['sea','air']) byId[id].calc[column] += Number(amount) * allocation[id];
  };
  for (const item of (evidence.shipments || []).filter(row=>scoped(row,scope))) {
    const allocation = shipmentTransportShares(item,shares.get(String(item.prodKey)));
    basisCounts[allocation.basis] = (basisCounts[allocation.basis] || 0)+1;
    add('N',item.amount,allocation.shares);
  }
  for (const item of (evidence.incoming || []).filter(row=>scoped(row,scope))) {
    const id = chinaTransportFarm(item.farm);
    if (id !== 'unassigned' && finiteAmount(item.amount) != null) byId[id].calc.Q += Number(item.amount);
  }
  for (const item of (evidence.freight || []).filter(row=>scoped(row,scope))) {
    const id = chinaTransportFarm(item.farm);
    if (id !== 'unassigned' && finiteAmount(item.amount) != null) byId[id].calc.S += Number(item.amount);
  }
  for (const phase of ['begin','end']) {
    for (const item of evidence.inventory?.[phase]?.items || []) {
      add(phase === 'begin' ? 'E' : 'F',item.value,shares.get(String(item.prodKey)) || {sea:0,air:0,unassigned:1});
    }
  }
  if (basisCounts.invalid_assignment) warnings.push(`농장 배정 수량 확인 필요 ${basisCounts.invalid_assignment}건: 직접 귀속을 중단하고 공통 안분 근거를 확인합니다.`);
  const rate = finiteAmount(parent.R);
  for (const row of rows.slice(0,2)) {
    const c = row.calc;
    c.R=rate; c.C=c.N; c.P=rate==null?null:c.Q*rate; c.T=rate==null?null:c.S*rate;
    c.G=c.P==null||c.T==null?null:c.P+c.T;
    c.I=c.G==null?null:c.E+c.G+c.H-c.F; c.J=c.I==null?null:c.C-c.I;
  }
  const residuals = {};
  for (const key of TRANSPORT_AMOUNT_KEYS) {
    const total = finiteAmount(parent[key]);
    if (total == null) { for (const row of rows) row.calc[key]=null; continue; }
    if (rows.slice(0,2).some(row=>finiteAmount(row.calc[key])==null)) {
      for (const row of rows.slice(0,2)) row.calc[key]=0;
    }
    byId.unassigned.calc[key]=total-(byId.sea.calc[key]+byId.air.calc[key]);
    residuals[key]=byId.unassigned.calc[key];
  }
  for (const row of rows) {
    const c=row.calc;
    c.R=rate; c.K=c.C==null||c.C===0||c.J==null?null:c.J/c.C;
  }
  // Display rounding also conserves the visible parent total, not just floating-point values.
  for (const row of rows) row.display={...row.calc};
  for (const key of TRANSPORT_AMOUNT_KEYS) {
    const total=finiteAmount(parent[key]);
    if(total==null)continue;
    rows[0].display[key]=Math.round(rows[0].calc[key]);
    rows[1].display[key]=Math.round(rows[1].calc[key]);
    rows[2].display[key]=Math.round(total)-rows[0].display[key]-rows[1].display[key];
  }
  return { rows, residuals, basisCounts, warnings,
    note:'현재 원장 참고 · 실제 농장배정 우선, 미배정 출고와 재고는 동일 품목 당차 입고비율 안분(이월 농장 추적 안 함). 공통 비용·차감·저장본 차이는 미배정. 하위 이익률은 공통비 미배정 참고값입니다.' };
}

// Never add boxes, bunches and stems together. A mixed-unit total uses the same
// report-currency purchase amounts only when every source line is comparable.
export function chinaCommonAllocation(incoming,scope) {
  const rows=(incoming||[]).filter(row=>scoped(row,scope));
  const unavailable=reason=>({available:false,reason,shares:null});
  if(!rows.length)return unavailable('당차 중국 입고가 없어 두 농장으로 분해할 수 없습니다.');
  if(rows.some(row=>chinaTransportFarm(row.farm)==='unassigned'))return unavailable('HUBFRESH·Cloudland 외 농장 원천이 있어 분해할 수 없습니다.');
  const make=(key,kind,unit,label)=>{
    const totals={sea:0,air:0};
    for(const row of rows)totals[chinaTransportFarm(row.farm)]+=Number(row[key]);
    const total=totals.sea+totals.air;
    return total>0?{available:true,kind,unit,label,totals,total,shares:{sea:totals.sea/total,air:totals.air/total}}:null;
  };
  const units=new Set(rows.map(row=>String(row.unit||'').trim()));
  if(units.size===1&&['박스','단','송이'].includes([...units][0])&&rows.every(row=>finiteAmount(row.quantity)!=null&&Number(row.quantity)>=0)){
    const result=make('quantity','incoming_quantity',[...units][0],'당차 중국 전체 입고 수량');
    if(result)return result;
  }
  if(rows.every(row=>row.currency==='CNY'&&finiteAmount(row.amount)!=null&&Number(row.amount)>=0)){
    const result=make('amount','incoming_purchase_amount','CNY','단위 합산 불가 → 보고서 CNY 기준 당차 입고매입액');
    if(result)return result;
  }
  return unavailable('같은 단위의 입고 수량 또는 양쪽을 비교할 수 있는 CNY 매입액 근거가 부족합니다.');
}

export function buildChinaTransportBreakdown(parent,evidence,scope) {
  if(!chinaTransportEligible(scope?.orderYear,scope?.major))throw Error('중국 배·비행기 내역은 39차부터 제공합니다.');
  const direct=buildDirectBreakdown(parent,evidence,scope);
  const allocation=chinaCommonAllocation(evidence.incoming,scope);
  const rows=direct.rows.slice(0,2).map(row=>({...row,calc:{...row.calc},allocated:{}}));
  const unavailableColumns=[];
  for(const key of TRANSPORT_AMOUNT_KEYS){
    const total=finiteAmount(parent[key]),residual=direct.residuals[key];
    if(total==null){for(const row of rows)row.calc[key]=null;continue;}
    if(!allocation.available){
      // Without any safe common basis, do not manufacture a two-way comparison.
      unavailableColumns.push(key);for(const row of rows)row.calc[key]=null;continue;
    }
    rows[0].allocated[key]=residual*allocation.shares.sea;
    rows[1].allocated[key]=residual-rows[0].allocated[key];
    rows[0].calc[key]+=rows[0].allocated[key];
    rows[1].calc[key]=total-rows[0].calc[key];
  }
  for(const row of rows){
    row.calc.K=row.calc.C==null||row.calc.C===0||row.calc.J==null?null:row.calc.J/row.calc.C;
    row.display={...row.calc};
  }
  for(const key of TRANSPORT_AMOUNT_KEYS){
    const total=finiteAmount(parent[key]);
    if(total==null||unavailableColumns.includes(key))continue;
    rows[0].display[key]=Math.round(rows[0].calc[key]);
    rows[1].display[key]=Math.round(total)-rows[0].display[key];
  }
  return {...direct,rows,allocation,unavailableColumns,
    warnings:[...direct.warnings,...(!allocation.available?[allocation.reason]:[])],
    note:'실제 농장배정·품목별 당차 입고비율 우선. 직접 귀속 후 공통비·조정·저장본 차이는 표시한 전체 입고 기준으로 안분합니다. 이월 농장 추적이 아닌 참고 계산이며 중국 합계·이익률은 보존합니다.'};
}
