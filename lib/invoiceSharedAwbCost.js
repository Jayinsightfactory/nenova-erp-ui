import { GROUPED_INVOICE_COST_FORMULAS, groupedInvoiceCostPreview } from './invoiceReceiptGroupedCost.js';
import { coCustomsInput } from './coOriginalCostInputs.js';

// Reference 43-1 AA8:AI12. These are allocation coefficients, NOT farm CW.
export const CO_AWB_GROUP_COEFFICIENTS = Object.freeze({
  ROSE: Object.freeze({ gross: 8, volume: 10 }),
  CARNATION: Object.freeze({ gross: 11, volume: 9 }),
  ALSTROMERIA: Object.freeze({ gross: 9.7, volume: 7 }),
  RUSCUS: Object.freeze({ gross: 8, volume: 9.6 }),
  HYDRANGEA: Object.freeze({ gross: 5.5, volume: 6.7 }),
});
const number = value => value == null || typeof value === 'boolean' || typeof value === 'object'
  || typeof value === 'string' && !value.trim() ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const round = value => Math.round(value * 1e6) / 1e6;
const awbKey = value => typeof value === 'string' ? value.replace(/[\s-]/g, '') : '';
const str = value => typeof value === 'string' ? value.trim() : '';
const invalid = (code, message) => { throw Object.assign(new Error(message), { code, statusCode: 422 }); };

/** Pure calculation. Callers must load and verify committed receipts server-side.
 * Members contain original normalized receipt rows (actualQuantity/unit). No
 * existing approved revision, warehouse header or input object is mutated.
 */
export function calculateSharedAwbCost({ manifest, members, input }) {
  if (!manifest || !/^\d{4}$/.test(manifest.orderYear) || !/^\d{2}-\d{2}$/.test(manifest.orderWeek)
    || !/^\d{11}$/.test(awbKey(manifest.awb)) || manifest.currency !== 'USD')
    invalid('AWB_SCOPE_INVALID', '공동 AWB의 연도·세부차수·AWB 번호·USD 통화를 확인하세요.');
  if (!Array.isArray(manifest.members) || !manifest.members.length || manifest.members.length > 100
    || !Array.isArray(members) || members.length !== manifest.members.length)
    invalid('AWB_MEMBERS_INCOMPLETE', '공동 AWB에 포함된 전체 농장 송장이 필요합니다.');
  const expected = new Map();
  for (const member of manifest.members) {
    if (!str(member.documentId) || expected.has(member.documentId) || !Number.isInteger(member.revision)
      || member.revision < 1 || !/^[a-f0-9]{64}$/i.test(member.sourceHash || ''))
      invalid('AWB_MANIFEST_INVALID', '송장 목록에 중복 또는 버전·원본 해시 누락이 있습니다.');
    expected.set(member.documentId, member);
  }
  const rows = [], lineInputs = [], origins = new Map(), groupTotals = new Map(), invoices = new Set();
  const seen = new Set();
  for (const member of members) {
    const target = expected.get(member.documentId);
    if (!target || seen.has(member.documentId)) invalid('AWB_MEMBER_DUPLICATE', '다른 송장 또는 중복 송장이 포함되어 있습니다.');
    seen.add(member.documentId);
    if (member.revision !== target.revision || member.sourceHash !== target.sourceHash)
      invalid('AWB_MEMBER_STALE', '송장 내용이 변경되었습니다. 공동 AWB 전체를 다시 조회하세요.');
    if (member.orderYear !== manifest.orderYear || member.orderWeek !== manifest.orderWeek
      || awbKey(member.awb) !== awbKey(manifest.awb) || member.currency !== manifest.currency || member.country !== 'CO')
      invalid('AWB_MEMBER_SCOPE_MISMATCH', '다른 연도·차수·AWB·국가·통화의 송장은 함께 계산할 수 없습니다.');
    const identity = `${str(member.farmName)}\u0000${str(member.invoiceNo)}`;
    if (!str(member.farmName) || !str(member.invoiceNo) || invoices.has(identity))
      invalid('AWB_INVOICE_DUPLICATE', '농장·인보이스가 누락되거나 같은 송장이 중복되었습니다.');
    invoices.add(identity);
    if (!Array.isArray(member.rows) || !member.rows.length || !Array.isArray(member.lineInputs))
      invalid('AWB_RECEIPT_REQUIRED', '전체 송장의 실제 입고 행과 품종 분류가 필요합니다.');
    const settings = new Map();
    for (const entry of member.lineInputs) {
      if (!str(entry.lineId) || settings.has(entry.lineId)) invalid('AWB_LINE_INPUT_DUPLICATE', '행별 분류가 중복되었습니다.');
      settings.set(entry.lineId, entry);
    }
    for (const row of member.rows) {
      const setting = settings.get(row.lineId);
      if (!setting || !CO_AWB_GROUP_COEFFICIENTS[setting.groupId])
        invalid('AWB_GROUP_REQUIRED', `${member.invoiceNo}: 품목의 품종 분류를 확인하세요.`);
      if (origins.has(row.lineId)) invalid('AWB_LINE_DUPLICATE', '같은 입고 행을 두 번 배분할 수 없습니다.');
      const qty = number(row.actualQuantity), boxes = number(row.boxQuantity), stems = number(row.stemQuantity);
      if (qty === null || qty < 0 || boxes === null || boxes < 0 || stems === null || stems < 0)
        invalid('AWB_QUANTITY_REQUIRED', `${member.invoiceNo}: 실제 박스·송이 수량을 확인하세요.`);
      const group = groupTotals.get(setting.groupId) || { groupId: setting.groupId, quantity: 0, boxQuantity: 0 };
      group.quantity += stems; group.boxQuantity += boxes; groupTotals.set(setting.groupId, group);
      rows.push({ ...row });
      // Old per-farm allocation values must never contaminate the whole-AWB basis.
      const { grossWeightKg, volumeWeightKg, allocationShare, ...clean } = setting;
      lineInputs.push(clean);
      origins.set(row.lineId, { documentId: member.documentId, farmName: member.farmName, invoiceNo: member.invoiceNo });
      settings.delete(row.lineId);
    }
    if (settings.size) invalid('AWB_LINE_OUT_OF_SCOPE', '다른 입고 행의 분류가 포함되어 있습니다.');
  }
  if (rows.length > 1000) invalid('AWB_TOO_MANY_LINES', '공동 AWB는 최대 1000개 품목 행을 지원합니다.');
  const gw = number(input?.gw), cw = number(input?.cw);
  if (!(gw > 0) || !(cw >= gw)) invalid('AWB_WEIGHT_REQUIRED', '공동 AWB 전체 GW·CW를 확인하세요. 농장별 CW는 필요하지 않습니다.');
  const groups = [...groupTotals.values()].sort((a,b) => a.groupId.localeCompare(b.groupId));
  // Mixed QB/HB/FB packing cannot use physical pieces as full-box equivalents.
  // A single variety cancels this factor; mixed varieties require source counts.
  const allocationBoxes = group => groups.length === 1 ? group.boxQuantity : number(input.fullBoxCounts?.[group.groupId]);
  if(groups.length>1&&groups.some(group=>!(allocationBoxes(group)>0)))
    invalid('AWB_FULL_BOX_COUNTS_REQUIRED', '혼합 품종 AWB는 원본의 품종별 FB 환산 박스수가 필요합니다. QB·HB 실물 박스수를 그대로 대입하지 않습니다.');
  const denominator = key => groups.reduce((sum, group) => sum + allocationBoxes(group) * CO_AWB_GROUP_COEFFICIENTS[group.groupId][key], 0);
  const grossDenominator = denominator('gross'), volumeDenominator = denominator('volume');
  if (!(grossDenominator > 0) || !(volumeDenominator > 0)) invalid('AWB_BOXES_REQUIRED', '공동 AWB의 전체 박스 수량을 확인하세요.');
  const costGroups = groups.map(group => ({ ...group,
    fullBoxEquivalent: allocationBoxes(group),
    grossWeightKg: gw * allocationBoxes(group) * CO_AWB_GROUP_COEFFICIENTS[group.groupId].gross / grossDenominator,
    volumeWeightKg: cw * allocationBoxes(group) * CO_AWB_GROUP_COEFFICIENTS[group.groupId].volume / volumeDenominator,
  }));
  const formula = GROUPED_INVOICE_COST_FORMULAS.CO_GROUP_42_1_V1;
  input = coCustomsInput(input, gw, groups.map(group=>group.groupId));
  const calculationInput = { formulaId: formula.formulaId, customsTotalKRW: input.customsTotalKRW, costGroups, lineInputs };
  const common = { formula, nativeCurrency: manifest.currency, freightCurrency: input.freightCurrency,
    exchangeRate: input.exchangeRate, effectiveFreightAmount: input.freightAmount, share: 1 };
  const issues = [];
  const result = groupedInvoiceCostPreview({ reviewedMetadata: { country: 'CO', transportMode: 'AIR', gw, cw } }, rows, calculationInput, common, issues);
  const lines = result.lines.map(line => ({ ...line, ...origins.get(line.lineId) }));
  const totals = keys => Object.fromEntries(keys.map(key => [key, round(lines.reduce((sum,line) => sum + (line.componentAmounts[key] || 0),0))]));
  return { status: issues.length ? 'BLOCKED' : 'CALCULATED', issues, lines, costGroups, lineInputs,
    manifest, allocationScope: 'SHARED_AWB', measuredFarmCwAvailable: false, appliedInput: input,
    totals: totals(['goodsNative','freightNative','goodsKRW','freightKRW','tariffKRW','customsKRW']),
    farms: members.map(member => ({ documentId: member.documentId, farmName: member.farmName, invoiceNo: member.invoiceNo,
      totalCostKRW: round(lines.filter(line => line.documentId === member.documentId).reduce((sum,line) => sum + line.totalCostKRW,0)) })),
  };
}
