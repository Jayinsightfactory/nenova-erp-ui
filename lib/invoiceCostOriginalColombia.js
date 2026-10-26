import { createHash } from 'node:crypto';
import content from './invoiceCostTemplates/colombia-42-1-content.json' with { type: 'json' };

const HASH = '49b27a9fba6dfd69f7dd30b314dd72f565db3f1027a309ea23f7fe81006cc5dc';
const groups = ['ROSE', 'CARNATION', 'ALSTROMERIA', 'RUSCUS', 'HYDRANGEA'];
const xml = value => String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' }[c]));
const rowOf = ref => Number(ref.match(/\d+$/)[0]);

// An editable ORIGINAL-DEFAULT calculation, deliberately separate from approved amounts.
// No SQL, receipt mutation or approval. Only called after checkedRows has validated the snapshot.
export function originalColombiaCostSheet({ document, revision, snapshot, rows, template }) {
  const { assetHash, ...payload } = content;
  if (assetHash !== HASH || createHash('sha256').update(JSON.stringify(payload)).digest('hex') !== HASH
      || content.sourceHash !== template.sourceHash) throw new Error('Unverified Colombia content asset');
  const cells = new Map();
  const put = (ref, value) => cells.set(ref, { value });
  const formula = (ref, f, value) => cells.set(ref, { formula: f, value });
  Object.entries(content.labels).forEach(([ref, value]) => put(ref, value));
  Object.entries(content.defaults).forEach(([ref, value]) => put(ref, value));
  const input = snapshot.input, settings = new Map(input.lineInputs.map(line => [line.lineId, line]));
  const test = input.exchangeRateType === 'TEST_ONLY' || /TEST_ONLY/i.test(`${input.costSourceId || ''} ${input.estimateSource || ''}`);
  put('B1', `COLOMBIA ${document.orderYear}/${document.orderWeek} 원본 양식 계산${test ? ' · TEST_ONLY' : ''}`);
  put('B2', '기본 통관비는 원본 가정값(미승인)입니다. 승인 원가와 다를 수 있으며 ERP에는 반영되지 않습니다.');
  put('B3', '42-1 기준. 이번 입고·환율·운임 적용. 판매가 직접 입력. R열은 원본 표기 15%와 달리 /0.77 수식 유지.');
  put('C5', `${document.orderYear}/${document.orderWeek}`);
  put('C7', input.exchangeRateKRW); put('C8', document.reviewedMetadata.gw); put('E8', document.reviewedMetadata.cw);
  const quantities = rows.map(({ cost }) => {
    const s = settings.get(cost.lineId);
    return cost.quantity === 0 ? 0 : cost.quantity * (cost.unit === 'STEM' ? 1 : cost.unit === 'BUNCH' ? s.stemsPerBunch : s.stemsPerBunch * s.bunchesPerBox);
  });
  const last = 14 + rows.length, totalQty = quantities.reduce((a,b) => a+b,0);
  const freight = rows.reduce((n,row) => n + row.cost.componentAmounts.freightNative, 0);
  put('C9', input.costGroups.filter(g => g.quantity > 0).length);
  formula('C10', `SUM(E15:E${last})`, totalQty);
  formula('C6', `SUMPRODUCT(E15:E${last},F15:F${last})`, rows.reduce((n,row) => n+row.cost.componentAmounts.goodsNative,0));
  // Aggregate approved freight has no verified document/rate breakup. Never invent one.
  put('C11', freight); put('D11', '서류'); put('E11', '내역 없음'); put('G11', '합계 C11 적용'); put('E9', '내역 없음');
  const gw = document.reviewedMetadata.gw;
  formula('P6', content.formulas.P6, gw * 460);
  formula('P8', content.formulas.P8, input.costGroups.filter(g => g.quantity > 0).length * 10000);
  const customs = gw * 460 + content.defaults.P7 + content.defaults.P9 + content.defaults.R6 + input.costGroups.filter(g => g.quantity > 0).length * 10000;
  formula('P10', content.formulas.P10, customs);
  put('O5', '그외 통관비 · 원본 기본값(미승인)');
  put('AK3', '승인 통관비 KRW'); put('AL3', rows.reduce((n,row) => n+row.cost.componentAmounts.customsKRW,0));
  put('AK4', '승인 원가 합계 KRW'); put('AL4', revision.totalCostKRW);
  ['품목', '원본 kg/박스', '원본 CBM계수'].forEach((v,i) => put(`${['AK','AL','AM'][i]}6`,v));
  const totalGW = input.costGroups.reduce((n,g) => n+g.grossWeightKg,0), totalCW = input.costGroups.reduce((n,g) => n+g.volumeWeightKg,0);
  const allocated = new Map();
  groups.forEach((id, i) => {
    const r = 8+i, s = 7+i, group = input.costGroups.find(g => g.groupId === id);
    const boxes = group?.boxQuantity ?? 0, q = group?.quantity ?? 0;
    put(`AC${r}`, boxes); put(`AH${r}`, boxes);
    formula(`L${s}`,`SUMIF($W$15:$W$${last},J${s},$E$15:$E$${last})`,q);
    if (group && boxes > 0) { put(`AB${r}`,group.grossWeightKg/boxes); put(`AG${r}`,group.volumeWeightKg/boxes); }
    put(`AK${s}`,id); put(`AL${s}`,content.defaults[`AB${r}`]); put(`AM${s}`,content.defaults[`AG${r}`]);
    const gs = (group?.grossWeightKg ?? 0)/totalGW, cs = (group?.volumeWeightKg ?? 0)/totalCW;
    const fs = document.reviewedMetadata.gw === document.reviewedMetadata.cw ? gs : cs;
    formula(`AD${r}`, `IF(AC${r}=0,0,AB${r}*AC${r}/SUMPRODUCT($AB$8:$AB$12,$AC$8:$AC$12))`,gs);
    formula(`AI${r}`, `IF(AH${r}=0,0,AG${r}*AH${r}/SUMPRODUCT($AG$8:$AG$12,$AH$8:$AH$12))`,cs);
    formula(`K${s}`, `IF($C$8=$E$8,$C$11*AD${r},$C$11*AI${r})`,freight*fs);
    formula(`M${s}`, `IF(L${s}=0,0,K${s}/L${s})`,q ? freight*fs/q : 0);
    formula(`T${s}`, `$P$10*AD${r}`,customs*gs);
    formula(`U${s}`, `IF(L${s}=0,0,T${s}/L${s})`,q ? customs*gs/q : 0);
    allocated.set(id, { row:s, freight:q ? freight*fs/q : 0, customs:q ? customs*gs/q : 0 });
  });
  formula('AD13','SUM(AD8:AD12)',1); formula('AI13','SUM(AI8:AI12)',1);
  formula('U13',`SUBTOTAL(9,U15:U${last})`,0); formula('V13',`SUBTOTAL(9,V15:V${last})`,0);
  formula('T13','IF(U13=0,"",V13/U13)','');
  put('W14','원가 그룹');
  let total = 0;
  rows.forEach(({ source, cost },i) => {
    const r = 15+i, q = quantities[i], s = settings.get(cost.lineId), group = allocated.get(s.groupId);
    if (!group) throw new Error('Unknown Colombia cost group');
    const fob = q ? cost.componentAmounts.goodsNative/q : 0;
    const cnf = fob+group.freight, won = cnf*input.exchangeRateKRW;
    const tariff = won*s.tariffRate, arrival = won+tariff+group.customs;
    put(`A${r}`,document.reviewedMetadata.farmName || document.invoiceNo);
    put(`B${r}`,source.originalName); put(`E${r}`,q); put(`F${r}`,fob); put(`N${r}`,s.stemsPerBunch); put(`W${r}`,s.groupId);
    formula(`G${r}`,`IF(E${r}=0,0,$M$${group.row})`,q ? group.freight : 0);
    formula(`H${r}`,`F${r}+G${r}`,q ? cnf : 0); formula(`I${r}`,`E${r}*H${r}`,q*cnf);
    formula(`J${r}`,`H${r}*$C$7`,q ? won : 0);
    formula(`K${r}`,`J${r}*${s.tariffRate}`,q ? tariff : 0);
    formula(`L${r}`,`IF(E${r}=0,0,$U$${group.row})`,q ? group.customs : 0);
    formula(`M${r}`,`J${r}+K${r}+L${r}`,q ? arrival : 0);
    formula(`O${r}`,`M${r}*N${r}`,q ? arrival*s.stemsPerBunch : 0);
    formula(`P${r}`,`IF(Q${r}="","",Q${r}/1.1)`,'');
    formula(`R${r}`,`O${r}/0.77`,q ? arrival*s.stemsPerBunch/0.77 : 0);
    formula(`S${r}`,`IF(P${r}="","",P${r}-O${r})`,'');
    formula(`T${r}`,`IF(OR(P${r}="",P${r}=0),"",S${r}/P${r})`,'');
    formula(`U${r}`,`IF(P${r}="","",P${r}*E${r}/N${r})`,'');
    formula(`V${r}`,`IF(S${r}="","",E${r}*S${r}/N${r})`,'');
    total += q*arrival;
  });
  put('AK12','원본 기본값 계산합계');
  formula('AL12',`SUMPRODUCT(E15:E${last},M15:M${last})`,total);
  put('AK13','승인 합계와 차이'); formula('AL13','AL12-AL4',total-revision.totalCostKRW);
  const styles = new Map(template.rows.flatMap(row => row.cells.map(cell => [cell.ref,cell.style])));
  // Empty styled cells are part of the template too (including editable selling prices).
  for (const row of template.rows) for (const cell of row.cells) {
    if (rowOf(cell.ref)<=last && !cells.has(cell.ref)) cells.set(cell.ref,{value:undefined});
  }
  const byRow = new Map();
  for (const [ref, cell] of cells) {
    if (typeof cell.value === 'number' && !Number.isFinite(cell.value)) throw new Error(`Invalid original template value: ${ref}`);
    const r = rowOf(ref), style = styles.get(ref) ?? styles.get(ref.replace(/\d+$/,'15')) ?? '0';
    const attrs = `r="${ref}" s="${style}"`, numeric = typeof cell.value === 'number';
    const data = cell.value === undefined ? `<c ${attrs}/>` : cell.formula ? `<c ${attrs}${numeric ? '' : ' t="str"'}><f>${xml(cell.formula)}</f><v>${xml(cell.value)}</v></c>`
      : numeric ? `<c ${attrs}><v>${cell.value}</v></c>` : `<c ${attrs} t="inlineStr"><is><t xml:space="preserve">${xml(cell.value)}</t></is></c>`;
    const entries = byRow.get(r) || []; entries.push({ref,data}); byRow.set(r,entries);
  }
  const originalRows = new Map(template.rows.map(row => [Number(row.attrs.match(/\br="(\d+)"/)[1]),row.attrs]));
  const sheetData = [...byRow].sort(([a],[b])=>a-b).map(([r,entries])=> {
    let attrs = originalRows.get(r) || `r="${r}" ht="24" customHeight="1"`;
    if ([2,3].includes(r)) attrs = `r="${r}" ht="30" customHeight="1"`;
    entries.sort((a,b)=>a.ref.replace(/\d+/,'').length-b.ref.replace(/\d+/,'').length || a.ref.localeCompare(b.ref));
    return `<row ${attrs}>${entries.map(e=>e.data).join('')}</row>`;
  }).join('');
  const merges = template.merges.filter(ref => ref.split(':').every(c=>rowOf(c)<=last) && !/[A-Z]+[23](?::|$)/.test(ref));
  for (let r=15;r<=last;r++) if (!merges.includes(`B${r}:D${r}`)) merges.push(`B${r}:D${r}`);
  merges.push('B2:V2','B3:V3');
  const cols = template.cols.replace(/(<col min="23" max="23" width=")[^"]+/, (_, prefix) => `${prefix}18`);
  const views = '<sheetViews><sheetView tabSelected="1" topLeftCell="A1" workbookViewId="0"><selection activeCell="A1" sqref="A1"/></sheetView></sheetViews>';
  return `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:AM${last}"/>${views}${template.sheetFormatPr}${cols}<sheetData>${sheetData}</sheetData><mergeCells count="${merges.length}">${merges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells>${template.print}</worksheet>`;
}
