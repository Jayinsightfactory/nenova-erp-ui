export const PRODUCT_BULK_FIELDS = [
  {key:'BunchOf1Box',label:'1박스단수',max:1000000,scale:3},
  {key:'SteamOf1Bunch',label:'1단송이',max:1000000,scale:3},
  {key:'BoxWeight',label:'박스무게',max:9999999.999,scale:3},
  {key:'BoxCBM',label:'박스CBM',max:9999999.999,scale:3},
  {key:'TariffRate',label:'관세%',max:100,scale:2},
];
export const PRODUCT_BULK_SNAPSHOT = [...PRODUCT_BULK_FIELDS.map(f=>f.key),'SteamOf1Box'];
export function productSnapshot(row) {
  return Object.fromEntries(PRODUCT_BULK_SNAPSHOT.map(k=>[k,row[k] == null ? null : Number(row[k])]));
}
export function displayProductValue(key,value) {
  if(value == null)return '';
  return String(key==='TariffRate' ? Number((Number(value)*100).toFixed(2)) : Number(value));
}
export function parseProductInput(key,input) {
  const field=PRODUCT_BULK_FIELDS.find(f=>f.key===key);
  if(!field)throw Error('수정할 수 없는 항목입니다.');
  const text=String(input??'').trim();
  if(text==='')return undefined;
  if(!/^\d+(\.\d+)?$/.test(text))throw Error(`${field.label}: 0 이상의 숫자를 입력하세요.`);
  const n=Number(text);
  if(!Number.isFinite(n)||n>field.max||Math.abs(n*10**field.scale-Math.round(n*10**field.scale))>0.00001)
    throw Error(`${field.label}: 최대 ${field.max}, 소수 ${field.scale}자리까지 입력하세요.`);
  return key==='TariffRate'?Number((n/100).toFixed(4)):n;
}
export function rectangleCells(rows,range) {
  if(!range)return [];
  const [a,b]=range;
  const result=[];
  for(let r=Math.min(a.row,b.row);r<=Math.max(a.row,b.row)&&r<rows.length;r++)
    for(let c=Math.min(a.col,b.col);c<=Math.max(a.col,b.col)&&c<PRODUCT_BULK_FIELDS.length;c++)
      if(r>=0&&c>=0)result.push({prodKey:rows[r].ProdKey,key:PRODUCT_BULK_FIELDS[c].key});
  return result;
}
export function buildProductChanges(rows,drafts) {
  return rows.flatMap(row=>{
    const values={};
    for(const f of PRODUCT_BULK_FIELDS){
      const value=parseProductInput(f.key,drafts[row.ProdKey]?.[f.key]);
      if(value!==undefined && value!==row[f.key])values[f.key]=value;
    }
    if(Object.keys(values).length)productAfterValues(row,values);
    return Object.keys(values).length?[{prodKey:row.ProdKey,expected:productSnapshot(row),values}]:[];
  });
}
export function validateProductChanges(changes) {
  if(!Array.isArray(changes)||!changes.length||changes.length>500)throw Error('한 번에 1~500개 품목을 저장할 수 있습니다.');
  const seen=new Set();
  return changes.map(change=>{
    if(!Number.isSafeInteger(change?.prodKey)||change.prodKey<=0||seen.has(change.prodKey))throw Error('품목 번호가 잘못되었거나 중복되었습니다.');
    seen.add(change.prodKey);
    if(!change.expected||PRODUCT_BULK_SNAPSHOT.some(k=>!Object.hasOwn(change.expected,k)||(change.expected[k]!==null&&(typeof change.expected[k]!=='number'||!Number.isFinite(change.expected[k])))))throw Error('기존 품목값이 없습니다. 다시 조회하세요.');
    if(!change.values||!Object.keys(change.values).length)throw Error('변경값이 없습니다.');
    for(const [key,value]of Object.entries(change.values)){
      if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw Error('잘못된 변경값입니다.');
      if(key==='TariffRate'&&Math.abs(value*10000-Math.round(value*10000))>0.00001)throw Error('관세율 소수 자릿수를 확인하세요.');
      if(parseProductInput(key,displayProductValue(key,value))!==value)throw Error('변경값의 정밀도를 확인하세요.');
    }
    return {prodKey:change.prodKey,expected:productSnapshot(change.expected),values:{...change.values}};
  }).sort((a,b)=>a.prodKey-b.prodKey);
}
export function productAfterValues(current,values) {
  const after={...productSnapshot(current),...values};
  if(Object.hasOwn(values,'BunchOf1Box')||Object.hasOwn(values,'SteamOf1Bunch')){
    if(after.BunchOf1Box==null||after.SteamOf1Bunch==null)throw Error('1박스단수와 1단송이를 모두 확인하세요.');
    after.SteamOf1Box=Number((after.BunchOf1Box*after.SteamOf1Bunch).toFixed(6));
  }
  return after;
}
