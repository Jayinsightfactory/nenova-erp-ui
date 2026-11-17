// Pure parsing/matching policy. Chat headings never select the ERP year/week.
export const FARM_SHEET = '농장분배_검증';
export const farmTextKey = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s·_*☆★※△()（）.,\-]/g, '');
const PRODUCT_ALIASES = {
  문라이트: 'moonlight', 몬디알: 'mondial', 몬디알화이트: 'mondialwhite', 핑크몬디알: 'pinkmondial',
  플라야블랑카: 'playablanca', 퀵샌드: 'quicksand', 오션송: 'oceansong',
  비스윗:'besweet', 프리덤:'freedom', 만달라:'mandala', 로라:'lola', 카르페디엠:'carpediem', 카하라:'kahala',
  코랄리프:'coralreef', 롤리팝화이트블루:'lollipopwhiteblue', 실란토이:'silantoi', 틴티드블루:'tintedblue', 모멘텀:'momentum',
  캔들라이트: 'candlelight', 하츠: 'hearts', 핫츠: 'hearts',
};
const FARM_ALIASES = {
  에스페:'esperance', 시르카시아:'circasia', 밀라그로:'milagro',
  나투: 'natuflora', 아유라: 'ayura', 키쿠얄: 'kikuyal', 티바: 'tiba',
  엘리떼: 'elite', 엘리테: 'elite', 인보스: 'invos', 마티나: 'matina',
  다플로르: 'daflor', 다플로러: 'daflor', 바리에타: 'varieta', 발로레스: 'valores',
};
const FARM_NAME_VARIANTS = {
  elite: ['theeliteflowers'],
  tiba: ['florestiba'],
  varieta: ['varietta'],
};
export function farmNameMatches(label, candidate) {
  const key = farmTextKey(label);
  const alias = FARM_ALIASES[key] || key;
  const exactNames = FARM_NAME_VARIANTS[alias] || [];
  return [candidate.FarmName, candidate.FarmCode].some(value => {
    const name = farmTextKey(value);
    return name === key || name === alias || exactNames.includes(name) || (alias.length >= 4 && name.startsWith(alias));
  });
}
function productIdentity(value) {
  let text = String(value || '').normalize('NFKC').toLowerCase().replace(/^(?:장미|rose|카네이션|carnation)\s*\/\s*/,'').replace(/(\d+)\s*cm/gi, '$1').replace(/^(carpe diem \d+) orange bicolor$/i,'$1');
  for (const [name, alias] of Object.entries(PRODUCT_ALIASES).sort((a,b) => b[0].length-a[0].length)) text = text.replaceAll(name, alias);
  return farmTextKey(text.replace(/^(rose|carnation)\s*/i, ''));
}
export function parseFarmText(text) {
  const entries = [], errors = [];
  let customer = '', family = '', pending = '', lineNo = 0, startLine = 0;
  function consume(line, at) {
    const match = line.match(/^(.+?)\s*(\d+(?:\.\d+)?)\s*(단|박스|송이|box|bunch|stem)?\s*[（(]([^()]*)[）)]\s*$/i);
    if (!match || !customer) { errors.push(`${at}행: 업체(-업체명), 품목 수량(농장 수량) 형식을 확인하세요: ${line}`); return; }
    const farms = [];
    for (const part of match[4].split(/[,，/]/).map(s=>s.trim()).filter(Boolean)) {
      let m = part.match(/^(.+?)\s*(\d+(?:\.\d+)?)\s*(단|박스|송이)?$/);
      if (m) farms.push({ name:m[1].trim(), quantity:Number(m[2]), unit:m[3] || match[3] || '' });
      else {
        m = part.match(/^(\d+(?:\.\d+)?)\s*(단|박스|송이)?\s+(.+)$/);
        farms.push(m ? {name:m[3].trim(),quantity:Number(m[1]),unit:m[2] || match[3] || ''} : {name:part,quantity:null,unit:match[3] || ''});
      }
    }
    if (!farms.length) errors.push(`${at}행: 농장이 비어 있습니다.`);
    if (farms.length === 1 && farms[0].quantity == null) farms[0].quantity = Number(match[2]);
    if (farms.some(f=>f.quantity == null || !(f.quantity > 0))) errors.push(`${at}행: 각 농장 수량을 양수로 지정하세요.`);
    entries.push({id:`line-${at}`,line:at,customer,product:match[1].trim(),quantity:Number(match[2]),unit:match[3] || '',family,farms});
  }
  for (const raw of String(text || '').replace(/\r/g,'').split('\n')) {
    lineNo++;
    const line = raw.trim();
    if (!line) continue;
    if (/농장\s*분배\s*$/.test(line) && !/^[-－–]/.test(line) && (!/^[*＊]/.test(line) || /^[*＊]\s*(장미|카네이션)\s*농장\s*분배$/.test(line))) {
      if (pending) {consume(pending,startLine);pending='';}
      family = /카네이션/.test(line) ? 'carnation' : /장미/.test(line) ? 'rose' : '';
      continue;
    }
    if (/^[-－–*＊]\s*\S/.test(line)) {
      if (pending) {consume(pending,startLine);pending='';}
      customer=line.replace(/^[-－–*＊]\s*/,'').replace(/\s*농장\s*분배\s*$/,'').trim(); continue;
    }
    if (!pending) startLine=lineNo;
    pending += (pending ? ' ' : '') + line;
    if (/[)）]\s*$/.test(pending)) {consume(pending,startLine);pending='';}
  }
  if (pending) consume(pending,startLine);
  return {entries,errors};
}
export function matchFarmEntry(entry, rows, override) {
  const eligible = rows.filter(r=>!r.missingFromExcel && r.cells?.some(c=>c!=='엑셀누락'));
  if (override) return eligible.find(r=>r.key===override) || null;
  const literal=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/\s/g,'');
  const labels=row=>[row.custName,row.orderCode,...(row.sourceCustomerLabels||[])].filter(Boolean);
  const named=eligible.filter(row=>labels(row).some(label=>literal(label)===literal(entry.customer)));
  const customer = farmTextKey(entry.customer);
  const candidates = (named.length?named:eligible).filter(r=>{
    if (entry.family && r.productFamily && r.productFamily !== entry.family) return false;
    if(named.length)return true;
    const names = labels(r).map(farmTextKey).filter(Boolean);
    return names.some(n=>n===customer || (customer.length>=2 && n.includes(customer) && !/선출고|재고|보유/.test(n)));
  });
  const product = productIdentity(entry.product);
  const identities = row => [row.productLabel,row.prodName,row.displayName].filter(Boolean).map(productIdentity);
  // 규격이 없는 장미 메모는 50cm. 규격 없이 등록한 품종도 같은 표기 그대로 연결한다.
  if (!/\d/.test(product) && (!entry.family || entry.family === 'rose')) {
    const standard = candidates.filter(row => row.productFamily === 'rose' && identities(row).includes(product+'50'));
    if (standard.length) return standard.length === 1 ? standard[0] : null;
  }
  const exact = candidates.filter(row => identities(row).includes(product));
  const positive = exact.filter(row => row.uploadQty > 0 || row.currentOutQty > 0);
  const choices = positive.length ? positive : exact;
  return choices.length === 1 ? choices[0] : null;
}
export function assignmentsKey(rows) {
  const sums = new Map();
  for (const row of rows || []) {
    const key = Number(row.farmKey ?? row.FarmKey);
    sums.set(key,(sums.get(key)||0)+Number(row.shipmentQuantity ?? row.ShipmentQuantity));
  }
  return JSON.stringify([...sums].filter(([,q])=>q!==0).sort((a,b)=>a[0]-b[0]).map(([k,q])=>[k,Math.round(q*1e6)/1e6]));
}
export function assertFarmSnapshot(current, before, target) {
  const actual = assignmentsKey(current);
  if (actual !== assignmentsKey(before) && actual !== assignmentsKey(target)) {
    throw Object.assign(new Error('농장분배가 검증 이후 변경됐습니다. 다시 검증하세요.'), {statusCode:409,code:'FARM_IMPORT_STALE'});
  }
}
export function assertFarmOnlyPreserved(before, after) {
  for (const key of ['orderMasterRow','orderDetailRow','shipmentMasterRow','shipmentDetailRow','shipmentDateRows']) {
    const clean=value=>{
      const copy=JSON.parse(JSON.stringify(value ?? null));
      if(key==='shipmentDetailRow' && copy) delete copy.Descr;
      return JSON.stringify(copy);
    };
    if(clean(before[key])!==clean(after[key])) throw new Error(`농장만 변경 중 ${key}가 바뀌어 전체 롤백합니다.`);
  }
}
export function readFarmSheet(XLSX, workbook) {
  const sheet = workbook.Sheets[FARM_SHEET];
  if (!sheet) return [];
  const data = XLSX.utils.sheet_to_json(sheet,{header:1,defval:''});
  if (data[0]?.[0] !== 'NENOVA_FARM_V1') throw new Error('농장분배 검증 시트 형식을 확인하세요.');
  const entries = new Map();
  for (const [index,line] of data.slice(2).entries()) {
    if (!line.some(v=>v!=='')) continue;
    const [customer,product,quantity,unit,farm,farmQty,family] = line;
    const key=JSON.stringify([customer,product,unit,family]);
    if (!entries.has(key)) entries.set(key,{id:`sheet-${index+3}`,customer:String(customer),product:String(product),quantity:Number(quantity),unit:String(unit),family:String(family),farms:[]});
    const entry=entries.get(key);
    if (entry.quantity!==Number(quantity)) throw new Error('같은 농장분배 품목의 총수량이 서로 다릅니다.');
    if (!farm || !(Number(farmQty)>0)) throw new Error(`농장분배 시트 ${index+3}행의 농장·수량을 확인하세요.`);
    entry.farms.push({name:String(farm),quantity:Number(farmQty),unit:String(unit)});
  }
  return [...entries.values()];
}
