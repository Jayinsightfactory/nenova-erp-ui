import { createHash } from 'node:crypto';
import { isFreightItem } from './freightCalc.js';
import { classifyColombiaAllocCategory } from './colombiaFlowerClassification.js';
import { nativeLineId } from './nativeReceiptCost.js';

// 기존 입고(WarehouseMaster/Detail)의 같은 연도·차수 콜롬비아 농장 전체를 공동 AWB 계산 입력으로 묶는다.
// 읽기 전용(SELECT). 입고·재고·승인 원가는 바꾸지 않는다. 품종 분류는 "추천"만 제공하고 확정은 사용자가 한다.
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (message, statusCode = 422) => { throw Object.assign(new Error(message), { statusCode }); };
const GROUP_BY_CATEGORY = { '콜롬비아 장미': 'ROSE', '콜롬비아 카네이션': 'CARNATION', '콜롬비아 알스트로': 'ALSTROMERIA', '콜롬비아 루스커스': 'RUSCUS' };
const HYDRANGEA = /수국|hydrangea/i;
export const NATIVE_SHARED_SCOPES = Object.freeze({ MAIN: '콜카장(수국 제외)', HYDRANGEA: '수국' });
const unit = value => ({ 송이: 'STEM', 단: 'BUNCH', 박스: 'BOX', STEM: 'STEM', BUNCH: 'BUNCH', BOX: 'BOX' })[String(value ?? '').trim().toUpperCase()] || '';

/** 추천 품종(확정 아님). 분류 근거가 없으면 빈 문자열 → 사용자가 직접 선택해야 한다. */
export function suggestGroup(flowerName, prodName) {
  if (HYDRANGEA.test(`${flowerName || ''} ${prodName || ''}`)) return 'HYDRANGEA';
  return GROUP_BY_CATEGORY[classifyColombiaAllocCategory(flowerName, prodName)] || '';
}

export async function prepareNativeShared({ queryFn, types, request }) {
  const { orderYear, orderWeek, scope } = request || {};
  const awb = typeof request?.awb === 'string' ? request.awb.replace(/[\s-]/g, '') : '';
  if (typeof orderYear !== 'string' || !/^\d{4}$/.test(orderYear) || typeof orderWeek !== 'string' || !/^\d{2}-\d{2}$/.test(orderWeek)
    || !/^\d{11}$/.test(awb) || !NATIVE_SHARED_SCOPES[scope]) fail('연도·세부차수·AWB 번호(11자리)·계산 범위를 확인하세요.', 400);
  const type = (name, ...args) => typeof types[name] === 'function' ? types[name](...args) : types[name];
  const result = await queryFn(`/* native-shared-cost:readonly-source */ SELECT TOP (3001)
    wm.WarehouseKey,wm.FarmName,wm.InvoiceNo,CONVERT(varchar(10),wm.InputDate,23) AS InputDate,
    wd.WdetailKey,wd.ProdKey,wd.SteamOf1Bunch,wd.SteamOf1Box,wd.BoxQuantity,wd.BunchQuantity,wd.SteamQuantity,wd.OutQuantity,wd.UPrice,wd.TPrice,
    p.ProdName,p.CounName,p.FlowerName,p.OutUnit
    FROM dbo.WarehouseMaster wm
    JOIN dbo.WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
    LEFT JOIN dbo.Product p ON p.ProdKey=wd.ProdKey
    WHERE wm.OrderYear=@orderYear AND wm.OrderWeek=@orderWeek AND ISNULL(wm.isDeleted,0)=0
      AND wm.WarehouseKey IN (SELECT wm2.WarehouseKey FROM dbo.WarehouseMaster wm2
        JOIN dbo.WarehouseDetail wd2 ON wd2.WarehouseKey=wm2.WarehouseKey JOIN dbo.Product p2 ON p2.ProdKey=wd2.ProdKey
        WHERE wm2.OrderYear=@orderYear AND wm2.OrderWeek=@orderWeek AND ISNULL(wm2.isDeleted,0)=0 AND p2.CounName LIKE N'%콜롬비아%')
    ORDER BY wm.WarehouseKey,wd.WdetailKey`, {
    orderYear: { type: type('NVarChar', 4), value: orderYear }, orderWeek: { type: type('NVarChar', 5), value: orderWeek } });
  const raw = result?.recordset || [];
  if (!raw.length) fail('선택한 연도·차수에 콜롬비아 입고가 없습니다.', 404);
  if (raw.length > 3000) fail('입고 행이 너무 많아 계산할 수 없습니다.');

  const byWarehouse = new Map();
  for (const row of raw) byWarehouse.set(row.WarehouseKey, [...(byWarehouse.get(row.WarehouseKey) || []), row]);
  const members = [], documents = [], receiptLines = [], issues = [], excluded = [];
  for (const [warehouseKey, rows] of byWarehouse) {
    const hasName = row => Boolean(String(row.ProdName ?? '').trim());
    // 운송료 행과 품목 정보가 없는 행은 상품이 아니므로 계산에서 빼되, 조용히 버리지 않고 화면에 알린다.
    const goods = rows.filter(row => hasName(row) && !isFreightItem(row.ProdName));
    const inScope = () => (scope === 'HYDRANGEA') === goods.every(row => suggestGroup(row.FlowerName, row.ProdName) === 'HYDRANGEA');
    const skipped = rows.filter(row => !goods.includes(row)).map(row => ({ warehouseKey, farmName: String(rows[0].FarmName || '').trim(), invoiceNo: String(rows[0].InvoiceNo || '').trim(),
      wdetailKey: row.WdetailKey, name: hasName(row) ? String(row.ProdName).trim() : '(전산 품목 미연결)', stems: row.SteamQuantity, amount: row.TPrice,
      reason: hasName(row) ? '운송료 행(상품 아님)' : '전산 품목과 연결되지 않은 행(입고 매칭 누락)' }));
    if (!goods.length) continue;
    if (inScope()) excluded.push(...skipped);
    if (goods.some(row => !String(row.CounName || '').includes('콜롬비아')))
      fail(`입고 #${warehouseKey}: 콜롬비아가 아닌 품목이 섞여 있어 공동 계산에서 제외할 수 없습니다. 입고 내용을 확인하세요.`);
    const suggestions = goods.map(row => suggestGroup(row.FlowerName, row.ProdName));
    const hydrangeaOnly = suggestions.every(group => group === 'HYDRANGEA');
    if (suggestions.some(group => group === 'HYDRANGEA') && !hydrangeaOnly)
      fail(`입고 #${warehouseKey}(${rows[0].FarmName}): 수국과 다른 품종이 한 입고에 섞여 있습니다. 입고 내용을 확인하세요.`);
    if ((scope === 'HYDRANGEA') !== hydrangeaOnly) continue;
    const head = rows[0];
    if (!String(head.FarmName || '').trim() || !String(head.InvoiceNo || '').trim())
      fail(`입고 #${warehouseKey}: 농장명 또는 송장번호가 비어 있습니다.`);
    const memberLines = goods.map((row, index) => {
      const lineId = nativeLineId([warehouseKey, row.WdetailKey]);
      const stems = row.SteamQuantity;
      return { lineId, lineNo: index + 1, wdetailKey: row.WdetailKey, prodKey: row.ProdKey, originalName: row.ProdName,
        flowerName: row.FlowerName,
        // 단당 송이수는 입고 상세값을 쓰고, 없으면 단·송이 수량에서 구한다. 둘 다 없으면 비워 둔다(임의 값 금지).
        stemsPerBunch: row.SteamOf1Bunch > 0 ? row.SteamOf1Bunch : (row.BunchQuantity > 0 && stems > 0 ? stems / row.BunchQuantity : null),
        stemsPerBox: row.SteamOf1Box > 0 ? row.SteamOf1Box : null, boxQuantity: row.BoxQuantity, bunchQuantity: row.BunchQuantity, stemQuantity: stems,
        outQuantity: row.OutQuantity, outUnit: row.OutUnit, unitPrice: row.UPrice, lineAmount: row.TPrice,
        // 기존 입고의 콜롬비아 단가는 송이 기준(송이수×단가=금액)이다. 맞지 않는 행은 계산 단계에서 차단된다.
        currency: 'USD', priceUnit: '송이' };
    });
    const sourceHash = hash(rows);
    const reviewedMetadata = { country: 'CO', transportMode: 'AIR', awb, farmName: String(head.FarmName).trim(), inputDate: head.InputDate };
    documents.push({ documentId: `native-${warehouseKey}`, revision: 1, sourceHash, orderYear, orderWeek, invoiceNo: String(head.InvoiceNo).trim(),
      reviewedMetadata, receiptLines: memberLines, lines: memberLines });
    receiptLines.push(...memberLines);
    members.push({ documentId: `native-${warehouseKey}`, warehouseKey, revision: 1, sourceHash, orderYear, orderWeek, awb, currency: 'USD', country: 'CO',
      farmName: reviewedMetadata.farmName, invoiceNo: String(head.InvoiceNo).trim(),
      // suggestedGroupId는 화면 추천용일 뿐 계산에는 쓰이지 않는다(groupId는 사용자가 확정).
      lineInputs: memberLines.map((line, i) => ({ lineId: line.lineId, tariffRate: 0, stemsPerBunch: line.stemsPerBunch,
        bunchesPerBox: line.stemsPerBunch > 0 && line.stemsPerBox > 0 ? line.stemsPerBox / line.stemsPerBunch : null, groupId: '', suggestedGroupId: suggestions[i] })),
      rows: memberLines.map(line => ({ ...line, receiptQuantity: line.outQuantity, receiptUnit: unit(line.outUnit), actualQuantity: line.stemQuantity, unit: 'STEM' })) });
  }
  if (!members.length) fail(`${NATIVE_SHARED_SCOPES[scope]} 범위에 해당하는 콜롬비아 입고가 없습니다.`, 404);
  if (receiptLines.length > 1000) fail('공동 계산은 최대 1000개 품목 행을 지원합니다.');
  // 사용자가 확정한 품종 분류를 반영한다. 다른 범위의 행 분류가 섞이면 계산 단계에서 차단된다.
  const chosen = new Map((Array.isArray(request.lineInputs) ? request.lineInputs : []).map(entry => [entry?.lineId, entry]));
  for (const member of members) member.lineInputs = member.lineInputs.map(entry => ({ ...entry, ...(chosen.get(entry.lineId) ? { groupId: chosen.get(entry.lineId).groupId || '' } : {}) }));
  const manifest = { orderYear, orderWeek, awb, currency: 'USD', members: members.map(({ documentId, revision, sourceHash }) => ({ documentId, revision, sourceHash })) };
  const baselineDigest = hash({ manifest, scope, receiptLines, excluded });
  return { manifest, members, documents, receiptLines, baselineDigest, issues, excluded };
}
