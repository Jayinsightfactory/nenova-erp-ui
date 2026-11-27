import { createHash } from 'node:crypto';
import content from './invoiceCostTemplates/colombia-42-1-content.json' with { type: 'json' };
import { resolveColombiaStemsPerBunch } from './receiptOriginInheritance.js';
import { resolveCoCustomsComponents } from './coOriginalCostInputs.js';
import { formatCostSheetName } from './costMasterStore.js';

const HASH = '49b27a9fba6dfd69f7dd30b314dd72f565db3f1027a309ea23f7fe81006cc5dc';
const groups = ['ROSE', 'CARNATION', 'ALSTROMERIA', 'RUSCUS', 'HYDRANGEA'];
export const CO_GROUP_KO = Object.freeze({
  ROSE: '장미',
  CARNATION: '카네이션',
  ALSTROMERIA: '알스트로',
  RUSCUS: '루스커스',
  HYDRANGEA: '수국',
});
const xml = value => String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' }[c]));
const rowOf = ref => Number(ref.match(/\d+$/)[0]);

function colombiaTitleForGroups(costGroups = []) {
  const active = costGroups.filter(g => Number(g?.quantity) > 0).map(g => g.groupId);
  const hasHydrangea = active.includes('HYDRANGEA');
  const hasMain = active.some(id => id && id !== 'HYDRANGEA');
  if (hasHydrangea && !hasMain) return 'COLOMBIA                                    수국';
  if (hasMain && !hasHydrangea) return 'COLOMBIA                                    콜카장';
  return content.labels.B1;
}

// An editable ORIGINAL-DEFAULT calculation, deliberately separate from approved amounts.
// No SQL, receipt mutation or approval. Only called after checkedRows has validated the snapshot.
export function originalColombiaCostSheet({ document, revision, snapshot, rows, template }) {
  const { assetHash, ...payload } = content;
  if (assetHash !== HASH || createHash('sha256').update(JSON.stringify(payload)).digest('hex') !== HASH
      || content.sourceHash !== template.sourceHash) throw new Error('Unverified Colombia content asset');
  const cells = new Map();
  const put = (ref, value, styleOverride) => cells.set(ref, { value, ...(styleOverride ? { styleOverride } : {}) });
  const formula = (ref, f, value) => cells.set(ref, { formula: f, value });
  Object.entries(content.labels).forEach(([ref, value]) => put(ref, value));
  Object.entries(content.defaults).forEach(([ref, value]) => put(ref, value));
  const input = snapshot.input, settings = new Map(input.lineInputs.map(line => [line.lineId, line]));
  const fx = Number(input.exchangeRateKRW);
  const gw = Number(document.reviewedMetadata.gw);
  const cw = Number(document.reviewedMetadata.cw);
  put('B1', colombiaTitleForGroups(input.costGroups));
  put('C5', formatCostSheetName(document.orderWeek, `${document.orderYear}/${document.orderWeek}`));
  put('C7', fx); put('C8', gw); put('E8', cw);
  const effectiveStemsPerBunch = (s, source, detail, cost) => {
    if (typeof s?.stemsPerBunch === 'number' && Number.isFinite(s.stemsPerBunch) && s.stemsPerBunch > 0) return s.stemsPerBunch;
    return resolveColombiaStemsPerBunch({
      SteamOf1Bunch: detail?.stemsPerBunch ?? source?.stemsPerBunch,
      ProductSteamOf1Bunch: detail?.prodSteamOf1Bunch ?? source?.prodSteamOf1Bunch,
      BunchQuantity: detail?.bunchQuantity ?? source?.bunchQuantity,
      SteamQuantity: detail?.stemQuantity ?? source?.stemQuantity ?? cost?.priceBasisQuantity,
      OutUnit: detail?.outUnit ?? source?.outUnit,
      FlowerName: detail?.flowerName ?? source?.flowerName,
      ProdName: detail?.originalName ?? source?.originalName,
    }, s?.groupId);
  };
  const quantities = rows.map(({ source, detail, cost }) => {
    const s = settings.get(cost.lineId);
    const spb = effectiveStemsPerBunch(s, source, detail, cost);
    return cost.quantity === 0 ? 0 : cost.quantity * (cost.unit === 'STEM' ? 1 : cost.unit === 'BUNCH' ? spb : spb * s.bunchesPerBox);
  });
  const last = 14 + rows.length, totalQty = quantities.reduce((a,b) => a+b,0);
  const rawFreight = rows.reduce((n,row) => n + row.cost.componentAmounts.freightNative, 0);
  const freight = Number.isFinite(Number(input.freightAmount)) && Math.abs(rawFreight - Number(input.freightAmount)) < 1e-5
    ? Number(input.freightAmount)
    : rawFreight;
  let docFee = 0, freightOnly = freight;
  const inputDoc = input.docFeeUSD != null && input.docFeeUSD !== '' ? Number(input.docFeeUSD) : null;
  const inputAir = input.freightOnlyUSD != null && input.freightOnlyUSD !== '' ? Number(input.freightOnlyUSD) : null;
  if (inputDoc !== null && Number.isFinite(inputDoc) && inputDoc >= 0 && inputAir !== null && Number.isFinite(inputAir) && inputAir >= 0 && Math.abs((inputDoc + inputAir) - freight) <= 0.02) {
    docFee = inputDoc;
    freightOnly = freight - docFee;
  } else if (inputDoc !== null && Number.isFinite(inputDoc) && inputDoc >= 0 && inputDoc <= freight) {
    docFee = inputDoc;
    freightOnly = freight - docFee;
  } else if (inputAir !== null && Number.isFinite(inputAir) && inputAir >= 0 && inputAir <= freight) {
    freightOnly = inputAir;
    docFee = freight - freightOnly;
  }
  const ratePerCw = cw > 0 ? freightOnly / cw : 0;
  put('C9', input.costGroups.filter(g => g.quantity > 0).length);
  formula('C10', `SUM(E15:E${last})`, totalQty);
  formula('C6', `SUMPRODUCT(E15:E${last},F15:F${last})`, rows.reduce((n,row) => n+row.cost.componentAmounts.goodsNative,0));
  put('D9', 'Rate');
  // Style 61 is original 42-1 E11/G11 numeric format (0.00) with the exact same font/border/alignment as E9.
  put('E9', ratePerCw, '61');
  put('D11', '서류');
  put('E11', docFee);
  put('F11', '운송비');
  formula('G11', 'E9*E8', freightOnly);
  formula('C11', 'E11+G11', freight);
  const activeGroupCount = input.costGroups.filter(g => g.quantity > 0).length;
  const comp = resolveCoCustomsComponents(input.coCustomsOverrides);
  let customs;
  if (input.customsExplicitTotal === true && Number.isFinite(Number(input.customsTotalKRW))) {
    customs = Number(input.customsTotalKRW);
    ['P6', 'P7', 'P8', 'P9', 'R6', 'R7'].forEach(ref => cells.delete(ref));
    put('P10', customs);
    put('O5', '그외에 통관비');
  } else {
    formula('P6', comp.storagePerKg === 460 ? content.formulas.P6 : `C8*${comp.storagePerKg}`, gw * comp.storagePerKg);
    put('P7', comp.clearance);
    formula('P8', comp.inspectionPerGroup === 10000 ? content.formulas.P8 : `C9*${comp.inspectionPerGroup}`, activeGroupCount * comp.inspectionPerGroup);
    put('P9', comp.domestic);
    put('R6', comp.quarantine);
    if (comp.disinfection !== 0) put('R7', comp.disinfection);
    customs = gw * comp.storagePerKg + comp.clearance + activeGroupCount * comp.inspectionPerGroup + comp.domestic + comp.quarantine + comp.disinfection;
    formula('P10', content.formulas.P10, customs);
    put('O5', '그외에 통관비');
  }
  if (input.lineInputs.some(line => Number(line?.tariffRate) > 0)) put('K14', '관세');
  put('AL4', revision.totalCostKRW);
  const totalGW = input.costGroups.reduce((n,g) => n+g.grossWeightKg,0), totalCW = input.costGroups.reduce((n,g) => n+g.volumeWeightKg,0);
  const allocated = new Map();
  const allZeroBoxGroups = input.costGroups.every(g => !(Number(g?.fullBoxEquivalent ?? g?.boxQuantity) > 0));
  const stdGrossDenom = groups.reduce((s, id, i) => {
    const g = input.costGroups.find(x => x.groupId === id);
    return s + (g?.fullBoxEquivalent ?? g?.boxQuantity ?? 0) * content.defaults[`AB${8 + i}`];
  }, 0);
  const stdVolDenom = groups.reduce((s, id, i) => {
    const g = input.costGroups.find(x => x.groupId === id);
    return s + (g?.fullBoxEquivalent ?? g?.boxQuantity ?? 0) * content.defaults[`AG${8 + i}`];
  }, 0);
  const usesStandardCoeffs = stdGrossDenom > 0 && stdVolDenom > 0 && groups.every((id, i) => {
    const g = input.costGroups.find(x => x.groupId === id);
    const b = g?.fullBoxEquivalent ?? g?.boxQuantity ?? 0;
    const gs = totalGW > 0 ? (g?.grossWeightKg ?? 0) / totalGW : 0;
    const cs = totalCW > 0 ? (g?.volumeWeightKg ?? 0) / totalCW : 0;
    return Math.abs(gs - (b * content.defaults[`AB${8 + i}`]) / stdGrossDenom) < 1e-9
      && Math.abs(cs - (b * content.defaults[`AG${8 + i}`]) / stdVolDenom) < 1e-9;
  });
  groups.forEach((id, i) => {
    const r = 8+i, s = 7+i, group = input.costGroups.find(g => g.groupId === id);
    // 혼합 품종 공동 AWB는 원본의 FB 환산 박스수로 배분하므로 시트의 박스 수량도 같은 값을 써야 수식 재계산이 서버 계산과 같다.
    const boxes = group?.fullBoxEquivalent ?? group?.boxQuantity ?? 0, q = group?.quantity ?? 0;
    put(`AC${r}`, boxes); put(`AH${r}`, boxes);
    formula(`L${s}`,`SUMIF($B$15:$B$${last},"${CO_GROUP_KO[id]}",$E$15:$E$${last})`,q);
    if (!usesStandardCoeffs && group && boxes > 0) { put(`AB${r}`,group.grossWeightKg/boxes); put(`AG${r}`,group.volumeWeightKg/boxes); }
    const gs = (group?.grossWeightKg ?? 0)/totalGW, cs = (group?.volumeWeightKg ?? 0)/totalCW;
    const fs = gw === cw ? gs : cs;
    formula(`AD${r}`, allZeroBoxGroups ? `IF($C$10=0,0,L${s}/$C$10)` : `IF(AC${r}=0,0,AB${r}*AC${r}/SUMPRODUCT($AB$8:$AB$12,$AC$8:$AC$12))`, gs);
    formula(`AI${r}`, allZeroBoxGroups ? `IF($C$10=0,0,L${s}/$C$10)` : `IF(AH${r}=0,0,AG${r}*AH${r}/SUMPRODUCT($AG$8:$AG$12,$AH$8:$AH$12))`, cs);
    formula(`K${s}`, `IF($C$8=$E$8,$C$11*AD${r},$C$11*AI${r})`,freight*fs);
    formula(`M${s}`, `IF(L${s}=0,0,K${s}/L${s})`,q ? freight*fs/q : 0);
    formula(`T${s}`, `$P$10*AD${r}`,customs*gs);
    formula(`U${s}`, `IF(L${s}=0,0,T${s}/L${s})`,q ? customs*gs/q : 0);
    allocated.set(id, { row:s, freight:q ? freight*fs/q : 0, customs:q ? customs*gs/q : 0 });
  });
  formula('AD13','SUM(AD8:AD12)',1); formula('AI13','SUM(AI8:AI12)',1);
  formula('U13',`SUBTOTAL(9,U15:U${last})`,0); formula('V13',`SUBTOTAL(9,V15:V${last})`,0);
  formula('T13','IF(OR(U13="",U13=0),"",V13/U13)','');
  put('A14','농장','296');
  put('B14','품종','296');
  put('C14',content.labels.B14,'296');
  let total = 0;
  rows.forEach(({ source, detail, cost },i) => {
    const r = 15+i, q = quantities[i], s = settings.get(cost.lineId), group = allocated.get(s.groupId);
    if (!group) throw new Error('Unknown Colombia cost group');
    const spb = effectiveStemsPerBunch(s, source, detail, cost);
    if (typeof spb !== 'number' || !Number.isFinite(spb) || spb <= 0)
      throw Object.assign(new Error(`단당 송이수 확인이 필요합니다: ${source.originalName}`),{statusCode:422});
    const fob = q ? cost.componentAmounts.goodsNative/q : 0;
    const cnf = fob+group.freight, won = cnf*fx;
    const tariff = won*s.tariffRate, arrival = won+tariff+group.customs;
    // 공동 AWB는 행마다 농장이 다르다. 행별 농장을 우선하고 없을 때만 문서 단일 농장명을 쓴다.
    put(`A${r}`,source.farmName || cost.farmName || document.reviewedMetadata.farmName || document.invoiceNo,'276');
    // A열=농장, B열=품종(한글 필터), C:D열=Color Grade(품목명·공동 AWB의 "농장 · 품목" 접두어 제외).
    put(`B${r}`,CO_GROUP_KO[s.groupId] || s.groupId,'276');
    put(`C${r}`,detail?.originalName ?? source.originalName,'292');
    if (!cells.has(`D${r}`)) cells.set(`D${r}`, { value: undefined });
    put(`E${r}`,q); put(`F${r}`,fob); if(Number.isFinite(spb))put(`N${r}`,spb);
    formula(`G${r}`,`IF(E${r}=0,0,$M$${group.row})`,q ? group.freight : 0);
    formula(`H${r}`,`F${r}+G${r}`,q ? cnf : 0); formula(`I${r}`,`E${r}*H${r}`,q*cnf);
    formula(`J${r}`,`H${r}*$C$7`,q ? won : 0);
    formula(`K${r}`,`J${r}*${s.tariffRate}`,q ? tariff : 0);
    formula(`L${r}`,`IF(E${r}=0,0,$U$${group.row})`,q ? group.customs : 0);
    formula(`M${r}`,`J${r}+K${r}+L${r}`,q ? arrival : 0);
    formula(`O${r}`,`M${r}*N${r}`,q ? arrival*spb : 0);
    formula(`P${r}`,`IF(ISNUMBER(Q${r}),Q${r}/1.1,"")`,'');
    formula(`R${r}`,`O${r}/0.77`,q ? arrival*spb/0.77 : 0);
    formula(`S${r}`,`IF(ISNUMBER(P${r}),P${r}-O${r},"")`,'');
    formula(`T${r}`,`IF(OR(P${r}="",P${r}=0),"",S${r}/P${r})`,'');
    formula(`U${r}`,`IF(ISNUMBER(P${r}),P${r}*E${r}/N${r},"")`,'');
    formula(`V${r}`,`IF(ISNUMBER(S${r}),E${r}*S${r}/N${r},"")`,'');
    total += q*arrival;
  });
  formula('AL12',`SUMPRODUCT(E15:E${last},M15:M${last})`,total);
  formula('AL13','AL12-AL4',total-revision.totalCostKRW);
  const styles = new Map(template.rows.flatMap(row => row.cells.map(cell => [cell.ref,cell.style])));
  // Empty styled cells are part of the template too (including editable selling prices).
  for (const row of template.rows) for (const cell of row.cells) {
    if (rowOf(cell.ref)<=last && !cells.has(cell.ref)) cells.set(cell.ref,{value:undefined});
  }
  const byRow = new Map();
  for (const [ref, cell] of cells) {
    if (typeof cell.value === 'number' && !Number.isFinite(cell.value)) throw new Error(`Invalid original template value: ${ref}`);
    const r = rowOf(ref), style = cell.styleOverride ?? styles.get(ref) ?? styles.get(ref.replace(/\d+$/,'15')) ?? '0';
    const attrs = `r="${ref}" s="${style}"`, numeric = typeof cell.value === 'number';
    const data = cell.value === undefined ? `<c ${attrs}/>` : cell.formula ? `<c ${attrs}${numeric ? '' : ' t="str"'}><f>${xml(cell.formula)}</f><v>${xml(cell.value)}</v></c>`
      : numeric ? `<c ${attrs}><v>${cell.value}</v></c>` : `<c ${attrs} t="inlineStr"><is><t xml:space="preserve">${xml(cell.value)}</t></is></c>`;
    const entries = byRow.get(r) || []; entries.push({ref,data}); byRow.set(r,entries);
  }
  const originalRows = new Map(template.rows.map(row => [Number(row.attrs.match(/\br="(\d+)"/)[1]),row.attrs]));
  const sheetData = [...byRow].sort(([a],[b])=>a-b).map(([r,entries])=> {
    const attrs = originalRows.get(r) || `r="${r}" ht="24" customHeight="1"`;
    entries.sort((a,b)=>a.ref.replace(/\d+/,'').length-b.ref.replace(/\d+/,'').length || a.ref.localeCompare(b.ref));
    return `<row ${attrs}>${entries.map(e=>e.data).join('')}</row>`;
  }).join('');
  const merges = template.merges.filter(ref => ref !== 'B14:D14' && ref.split(':').every(c=>rowOf(c)<15));
  if (!merges.includes('C14:D14')) merges.push('C14:D14');
  for (let r=15;r<=last;r++) if (!merges.includes(`C${r}:D${r}`)) merges.push(`C${r}:D${r}`);
  const cols = template.cols
    .replace(/(<col min="3" max="3" width=")[^"]+/, (_, prefix) => `${prefix}24`)
    .replace(/(<col min="4" max="4" width=")[^"]+/, (_, prefix) => `${prefix}14`);
  const views = '<sheetViews><sheetView tabSelected="1" topLeftCell="A1" workbookViewId="0"><pane xSplit="4" ySplit="14" topLeftCell="E15" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="E15" sqref="E15"/></sheetView></sheetViews>';
  const autoFilter = `<autoFilter ref="A14:V${last}"/>`;
  return `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:AL${last}"/>${views}${template.sheetFormatPr}${cols}<sheetData>${sheetData}</sheetData>${autoFilter}<mergeCells count="${merges.length}">${merges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells>${template.print}</worksheet>`;
}
