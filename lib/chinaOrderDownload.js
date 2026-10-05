// Read-only order report. ERP calendar identity is authoritative, not ISO week numbers.
const DAY = 86400000;
export class ChinaOrderValidationError extends Error {
  constructor(message) { super(message); this.name='ChinaOrderValidationError'; }
}
const text = value => String(value ?? '').trim();
const dateKey = value => {
  const s = value instanceof Date ? value.toISOString().slice(0,10) : text(value).slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(`${s}T00:00:00Z`)) || new Date(`${s}T00:00:00Z`).toISOString().slice(0,10) !== s) throw new ChinaOrderValidationError('전산 달력 날짜를 확인하세요.');
  return s;
};
const shift = (value, days) => new Date(new Date(`${value}T00:00:00Z`).getTime()+days*DAY).toISOString().slice(0,10);
export function normalizeChinaCenter(input = {}) {
  const hasYear = input.year !== undefined, hasWeek = input.majorWeek !== undefined;
  if (!hasYear && !hasWeek) return null;
  if (!hasYear || !hasWeek || Array.isArray(input.year) || Array.isArray(input.majorWeek)) throw new ChinaOrderValidationError('연도와 중심차수를 함께 선택하세요.');
  const year = text(input.year), week = text(input.majorWeek);
  if (!/^\d{4}$/.test(year) || Number(year)<2020 || Number(year)>2099 || !/^\d{1,2}$/.test(week) || Number(week)<1 || Number(week)>53) throw new ChinaOrderValidationError('연도(2020~2099)와 중심차수(1~53)를 확인하세요.');
  return {year:Number(year),majorWeek:week.padStart(2,'0')};
}
export function buildChinaCycleCatalog(periodRows) {
  const keys = new Set(), dates = new Set();
  return periodRows.filter(r => Number(r.WeekDay)===5).map(r => {
    const key = text(r.OrderYearWeek);
    if (!/^\d{6}$/.test(key) || Number(key.slice(4))<1 || Number(key.slice(4))>53) throw new ChinaOrderValidationError('전산 달력 차수키를 확인하세요.');
    const startDate=dateKey(r.BaseYmd);
    if (new Date(`${startDate}T00:00:00Z`).getUTCDay()!==4 || keys.has(key) || dates.has(startDate)) throw new ChinaOrderValidationError('전산 목요일 달력이 중복되거나 잘못되었습니다.');
    keys.add(key);dates.add(startDate);
    return {key,year:Number(key.slice(0,4)),majorWeek:key.slice(4),startDate,endDate:shift(startDate,6)};
  }).sort((a,b)=>a.startDate.localeCompare(b.startDate));
}
export function selectChinaCycles(catalog, center, today) {
  const index = center ? catalog.findIndex(c=>c.year===center.year&&c.majorWeek===center.majorWeek)
    : catalog.findIndex(c=>c.startDate<=dateKey(today)&&c.endDate>=dateKey(today));
  if (index<3 || index+3>=catalog.length) throw new ChinaOrderValidationError('중심차수 앞뒤 3개씩의 실제 전산 달력이 없습니다. 다른 차수를 선택하거나 달력을 확인하세요.');
  const cycles=catalog.slice(index-3,index+4).map((c,i)=>({...c,offset:i-3}));
  if (cycles.some((c,i)=>i>0&&c.startDate!==shift(cycles[i-1].startDate,7))) throw new ChinaOrderValidationError('7개 차수 사이에 누락된 전산 달력이 있습니다.');
  return {scope:{year:cycles[3].year,majorWeek:cycles[3].majorWeek},cycles};
}
export function normalizeChinaUnit(value) {
  const unit=text(value), upper=unit.toUpperCase();
  if (['박스','BOX'].includes(upper)) return '박스';
  if (['단','BUNCH'].includes(upper)) return '단';
  if (['송이','STEM','STEAM'].includes(upper)) return '송이';
  throw new ChinaOrderValidationError('주문 품목 출고단위가 누락되었거나 박스·단·송이로 식별되지 않습니다. 품목정보를 확인하세요.');
}
export function compareChinaSubweeks(a,b){
  const number=Number(a.slice(3,5))-Number(b.slice(3,5));
  const aa=a.slice(5),bb=b.slice(5);
  return number || (aa===bb?0:aa<bb?-1:1);
}
export function buildChinaOrderReport(response) {
  if (response?.success!==true || response.readOnly!==true || !Array.isArray(response.cycles) || response.cycles.length!==7 || !Array.isArray(response.orders)) throw new ChinaOrderValidationError('정상 조회된 7개 차수 자료가 필요합니다.');
  const cycles=response.cycles, keys=new Set(cycles.map(c=>c.key));
  if(keys.size!==7)throw new ChinaOrderValidationError('조회 차수가 중복되었습니다.');
  const rows = new Map(), totals = new Map(), orders=[];
  for(const source of response.orders) {
    if(text(source.country)!=='중국')continue;
    const week=text(source.orderWeek), major=week.match(/^(\d{2})-\d{2}[A-Za-z]?$/)?.[1];
    const key=`${Number(source.orderYear)}${major||''}`;
    if(!keys.has(key))continue;
    const quantity=Number(source.quantity);
    if(!Number.isFinite(quantity))throw new ChinaOrderValidationError('주문 수량이 올바르지 않습니다.');
    if(quantity<=0)continue;
    const prodKey=Number(source.prodKey),custKey=Number(source.custKey);
    if(!Number.isSafeInteger(prodKey)||prodKey<=0||!Number.isSafeInteger(custKey)||custKey<=0)throw new ChinaOrderValidationError('주문 업체·품목 식별자가 올바르지 않습니다.');
    const unit=normalizeChinaUnit(source.unit);
    orders.push({...source,orderYear:Number(source.orderYear),orderWeek:week,custKey,custOrderCode:text(source.custOrderCode),prodKey,unit,quantity});
  }
  // Derive dimensions before any UI filter. Keep every actual subweek, not just 01/02.
  const weeksByCycle=new Map(cycles.map(c=>[c.key,new Set()]));
  for(const order of orders)weeksByCycle.get(`${order.orderYear}${order.orderWeek.slice(0,2)}`).add(order.orderWeek);
  const columns=cycles.flatMap(cycle=>{
    const weeks=[...weeksByCycle.get(cycle.key)].sort(compareChinaSubweeks);
    const base={cycleKey:cycle.key,year:cycle.year,majorWeek:cycle.majorWeek,offset:cycle.offset};
    return weeks.length ? weeks.map(week=>({...base,key:`${cycle.year}/${week}`,orderWeek:week,label:week,empty:false}))
      : [{...base,key:`${cycle.key}/empty`,orderWeek:null,label:'주문 없음',empty:true}];
  });
  const emptyQuantities=()=>Object.fromEntries(columns.map(c=>[c.key,0]));
  for(const source of orders){
    const {prodKey,unit,quantity}=source, rowKey=`${prodKey}|${unit}`;
    const key=`${source.orderYear}/${source.orderWeek}`;
    let row=rows.get(rowKey);
    if(!row){row={prodKey,prodCode:text(source.prodCode),prodName:text(source.prodName),country:'중국',flower:text(source.flower),unit,quantities:emptyQuantities(),total:0};rows.set(rowKey,row);}
    if(row.prodCode!==text(source.prodCode)||row.prodName!==text(source.prodName))throw new ChinaOrderValidationError('같은 품목키의 이름·코드가 다릅니다. 다시 조회하세요.');
    row.quantities[key]+=quantity; row.total+=quantity;
    if(!totals.has(unit))totals.set(unit,{unit,quantities:emptyQuantities(),total:0});
    totals.get(unit).quantities[key]+=quantity;totals.get(unit).total+=quantity;
  }
  return {scope:response.scope,cycles,columns,products:response.products||[],rows:[...rows.values()].sort((a,b)=>a.flower.localeCompare(b.flower,'ko')||a.prodName.localeCompare(b.prodName,'ko')||a.prodKey-b.prodKey),orders,totals:[...totals.values()],queriedAt:response.queriedAt,warnings:response.warnings||[]};
}
// Seven main cycles are a selection range. This view/export contains exactly one real subweek.
export function selectChinaOrderSubweek(report,columnKey,customerRowKeys=null){
  const column=report?.columns?.find(c=>c.key===columnKey&&!c.empty);
  if(!column)throw new ChinaOrderValidationError('조회 범위의 실제 세부차수를 선택하세요.');
  if(customerRowKeys!==null&&!(customerRowKeys instanceof Set))throw new ChinaOrderValidationError('업체·품목 선택 조건을 확인하세요.');
  const identity=o=>`${o.custKey}|${o.prodKey}|${o.unit}`;
  const orders=report.orders.filter(o=>o.orderYear===column.year&&o.orderWeek===column.orderWeek
    &&(customerRowKeys===null||customerRowKeys.has(identity(o))));
  const selected=buildChinaOrderReport({...report,success:true,readOnly:true,orders});
  const preserveDimensions=rows=>rows.map(row=>({...row,quantities:Object.fromEntries(report.columns.map(c=>[c.key,Number(row.quantities[c.key]||0)]))}));
  const customerRows=new Map();
  for(const order of orders){
    const rowKey=identity(order),current=customerRows.get(rowKey);
    if(current){
      if(current.custName!==text(order.custName)||current.custOrderCode!==text(order.custOrderCode))throw new ChinaOrderValidationError('같은 업체키의 업체명·CL 코드가 다릅니다. 다시 조회하세요.');
      current.quantity+=order.quantity;
    }else customerRows.set(rowKey,{rowKey,custKey:order.custKey,custName:text(order.custName),custOrderCode:text(order.custOrderCode),prodKey:order.prodKey,prodCode:text(order.prodCode),prodName:text(order.prodName),country:order.country,flower:text(order.flower),unit:order.unit,quantity:order.quantity});
  }
  return {...selected,columns:report.columns,selectedColumnKey:columnKey,
    rows:preserveDimensions(selected.rows),totals:preserveDimensions(selected.totals),
    customerRows:[...customerRows.values()].sort((a,b)=>a.custName.localeCompare(b.custName,'ko')||a.custKey-b.custKey||a.prodName.localeCompare(b.prodName,'ko')||a.prodKey-b.prodKey||a.unit.localeCompare(b.unit,'ko'))};
}
export function buildChinaOrdersSql(cycles) {
  if(!Array.isArray(cycles)||cycles.length!==7)throw new ChinaOrderValidationError('7차수 범위가 필요합니다.');
  const where=cycles.map((_,i)=>`(v.OrderYear=@year${i} AND v.OrderWeek LIKE @week${i})`).join(' OR ');
  return `SELECT TOP (100001) v.OrderYear,v.OrderWeek,v.CustKey,v.CustName,c.OrderCode AS CustOrderCode,v.ProdKey,
    p.ProdCode,p.ProdName,p.FlowerName,p.CounName,p.OutUnit,p.BunchOf1Box,p.SteamOf1Box,SUM(v.OutQuantity) AS OutQuantity
    FROM ViewOrder v JOIN Product p ON p.ProdKey=v.ProdKey AND p.isDeleted=0
    JOIN Customer c ON c.CustKey=v.CustKey AND c.isDeleted=0
    WHERE v.CounName=N'중국' AND p.CounName=N'중국' AND v.OutQuantity>0 AND (${where})
    GROUP BY v.OrderYear,v.OrderWeek,v.CustKey,v.CustName,c.OrderCode,v.ProdKey,p.ProdCode,p.ProdName,p.FlowerName,p.CounName,p.OutUnit,p.BunchOf1Box,p.SteamOf1Box
    ORDER BY v.OrderYear,v.OrderWeek,v.ProdKey,v.CustKey`;
}
export function buildChinaHiddenOrdersSql(cycles) {
  const where=cycles.map((_,i)=>`(om.OrderYear=@year${i} AND om.OrderWeek LIKE @week${i})`).join(' OR ');
  return `SELECT COUNT_BIG(*) AS HiddenCount FROM OrderMaster om
    JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND od.isDeleted=0
    JOIN Product p ON p.ProdKey=od.ProdKey AND p.isDeleted=0 AND p.CounName=N'중국'
    WHERE om.isDeleted=0 AND od.OutQuantity>0 AND (${where})
      AND NOT EXISTS(SELECT 1 FROM ViewOrder v WHERE v.OrderDetailKey=od.OrderDetailKey)`;
}
