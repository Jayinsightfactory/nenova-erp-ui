import { createHash } from 'node:crypto';
import { isFreightItem } from './freightCalc.js';
import { classifyColombiaAllocCategory } from './colombiaFlowerClassification.js';
import { nativeLineId } from './nativeReceiptCost.js';
import { extractAwbReferenceFromReceipts, isBlankPlaceholderDetailRow } from './awbReferenceReceipt.js';
import { isOrphanWeightDetailRow } from './warehouseWeightRows.js';
import { coReceiptCostPrice } from './coOriginalCostInputs.js';
import {
  resolveInheritedRowCountries,
  isUnmappedPaidGoodsRow,
  resolveColombiaStemsPerBunch,
  resolveColombiaStemsPerBox,
} from './receiptOriginInheritance.js';

// 기존 입고(WarehouseMaster/Detail)의 같은 연도·차수 콜롬비아 농장 전체를 공동 AWB 계산 입력으로 묶는다.
// 읽기 전용(SELECT). 입고·재고·승인 원가는 바꾸지 않는다. 품종 분류는 "추천"만 제공하고 확정은 사용자가 한다.
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (message, statusCode = 422) => { throw Object.assign(new Error(message), { statusCode }); };
const GROUP_BY_CATEGORY = { '콜롬비아 장미': 'ROSE', '콜롬비아 카네이션': 'CARNATION', '콜롬비아 알스트로': 'ALSTROMERIA', '콜롬비아 루스커스': 'RUSCUS' };
const HYDRANGEA = /수국|hydrangea/i;
export const NATIVE_SHARED_SCOPES = Object.freeze({
  MAIN: '콜카장(수국 제외)',
  HYDRANGEA: '수국',
  ALL: '통합 5품종(콜카장+수국 혼적)',
});
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
  const result = await queryFn(`/* native-shared-cost:readonly-source */ SELECT TOP (10001)
    wm.WarehouseKey,wm.OrderYear,wm.OrderWeek,wm.OrderNo,wm.FarmName,wm.InvoiceNo,CONVERT(varchar(10),wm.InputDate,23) AS InputDate,
    wm.GrossWeight,wm.ChargeableWeight,
    wd.WdetailKey,wd.ProdKey,wd.SteamOf1Bunch,wd.SteamOf1Box,wd.BoxQuantity,wd.BunchQuantity,wd.SteamQuantity,wd.OutQuantity,wd.UPrice,wd.TPrice,
    p.ProdName,p.CounName,p.FlowerName,p.OutUnit,p.SteamOf1Bunch AS ProductSteamOf1Bunch,p.SteamOf1Box AS ProductSteamOf1Box
    FROM dbo.WarehouseMaster wm
    JOIN dbo.WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
    LEFT JOIN dbo.Product p ON p.ProdKey=wd.ProdKey
    WHERE wm.OrderYear=@orderYear AND wm.OrderWeek=@orderWeek AND ISNULL(wm.isDeleted,0)=0
    ORDER BY wm.WarehouseKey,wd.WdetailKey`, {
    orderYear: { type: type('NVarChar', 4), value: orderYear }, orderWeek: { type: type('NVarChar', 5), value: orderWeek } });
  const raw = result?.recordset || [];
  if (!raw.length) fail('선택한 연도·차수에 콜롬비아 입고가 없습니다.', 404);
  if (raw.length > 10000) fail('입고 행이 너무 많아 계산할 수 없습니다.');

  const { rowCountryOf } = resolveInheritedRowCountries(raw);
  const byWarehouse = new Map();
  for (const row of raw) byWarehouse.set(row.WarehouseKey, [...(byWarehouse.get(row.WarehouseKey) || []), row]);
  const members = [], documents = [], receiptLines = [], issues = [], excluded = [], unmappedPaidRows = [], warnings = [];
  let hasMainOnAwb = false, hasHydrangeaOnAwb = false;

  const matchesScope = (suggestions) => {
    const hydrangeaOnly = suggestions.every(group => group === 'HYDRANGEA');
    if (scope === 'ALL') return true;
    return (scope === 'HYDRANGEA') === hydrangeaOnly;
  };

  for (const [warehouseKey, rows] of byWarehouse) {
    const hasName = row => Boolean(String(row.ProdName ?? '').trim());
    // 운송료·중량·공란 행과 품목 미연결 행은 상품에서 분리하되, 유상 미연결 행은 별도 경고 목록으로 명시 노출한다.
    const goods = rows.filter(row => hasName(row) && !isFreightItem(row.ProdName) && !isOrphanWeightDetailRow(row) && !isBlankPlaceholderDetailRow(row));
    const goodsSuggestions = goods.map(row => suggestGroup(row.FlowerName, row.ProdName));
    const inScope = () => goods.length > 0 && matchesScope(goodsSuggestions);
    const nonPlaceholderSkipped = rows.filter(row => !goods.includes(row) && !isBlankPlaceholderDetailRow(row) && !isOrphanWeightDetailRow(row));
    const skipped = nonPlaceholderSkipped.map(row => {
      const unmappedPaid = isUnmappedPaidGoodsRow(row);
      return {
        warehouseKey,
        farmName: String(rows[0].FarmName || '').trim(),
        invoiceNo: String(rows[0].InvoiceNo || '').trim(),
        wdetailKey: row.WdetailKey,
        name: hasName(row) ? String(row.ProdName).trim() : '(전산 품목 미연결)',
        stems: row.SteamQuantity,
        amount: row.TPrice,
        ...(unmappedPaid ? { unmappedPaid: true } : {}),
        reason: hasName(row)
          ? '운송료 행(상품 아님)'
          : unmappedPaid
            ? '전산 품목 미매핑 유상 행(입고 매칭 누락 또는 수기 재등록 대조 필요)'
            : '전산 품목과 연결되지 않은 행(입고 매칭 누락)',
      };
    });
    if (!goods.length) continue;
    const headScope = rows[0], nativeAwb = String(headScope.OrderNo ?? '').replace(/[\s-]/g, '');
    if (!goods.some(r => rowCountryOf(r) === '콜롬비아') && nativeAwb !== awb) continue;
    if (rows.some(r => String(r.OrderYear) !== orderYear || r.OrderWeek !== orderWeek)) fail('조회된 입고의 연도·차수가 다릅니다.', 409);
    if (!/^\d{11}$/.test(nativeAwb)) { if (inScope()) fail(`입고 #${warehouseKey}: AWB가 미확인입니다. 차수 통합 원가에서 원문 근거를 배정하세요.`); continue; }
    if (nativeAwb !== awb) continue;

    if (goods.some(row => rowCountryOf(row) !== '콜롬비아'))
      fail(`입고 #${warehouseKey}: 콜롬비아가 아닌 품목이 섞여 있어 공동 계산에서 제외할 수 없습니다. 입고 내용을 확인하세요.`);

    const hydrangeaOnly = goodsSuggestions.every(group => group === 'HYDRANGEA');
    const hasHydrangea = goodsSuggestions.some(group => group === 'HYDRANGEA');
    if (hasHydrangea) hasHydrangeaOnAwb = true;
    if (!hydrangeaOnly) hasMainOnAwb = true;

    if (scope !== 'ALL' && hasHydrangea && !hydrangeaOnly)
      fail(`입고 #${warehouseKey}(${rows[0].FarmName}): 수국과 다른 품종이 한 입고에 섞여 있습니다. 통합 5품종(ALL) 범위로 계산하거나 입고 내용을 확인하세요.`);
    if (!matchesScope(goodsSuggestions)) continue;

    excluded.push(...skipped);
    for (const item of skipped) {
      if (item.unmappedPaid) unmappedPaidRows.push(item);
    }

    const head = rows[0];
    if (!String(head.FarmName || '').trim() || !String(head.InvoiceNo || '').trim())
      fail(`입고 #${warehouseKey}: 농장명 또는 송장번호가 비어 있습니다.`);
    const memberLines = goods.map((row, index) => {
      const lineId = nativeLineId([warehouseKey, row.WdetailKey]);
      const stems = row.SteamQuantity;
      const suggested = goodsSuggestions[index];
      return { lineId, lineNo: index + 1, wdetailKey: row.WdetailKey, prodKey: row.ProdKey, originalName: row.ProdName,
        flowerName: row.FlowerName,
        stemsPerBunch: resolveColombiaStemsPerBunch(row, suggested),
        stemsPerBox: resolveColombiaStemsPerBox(row), boxQuantity: row.BoxQuantity, bunchQuantity: row.BunchQuantity, stemQuantity: stems,
        outQuantity: row.OutQuantity, outUnit: row.OutUnit, unitPrice: row.UPrice, lineAmount: row.TPrice,
        // 기존 입고의 콜롬비아 단가는 송이 기준(송이수×단가=금액)이다. 4자리 반올림 오차만 coReceiptCostPrice로 보정하고 진짜 불일치는 차단한다.
        currency: 'USD', priceUnit: '송이' };
    }).map(coReceiptCostPrice);
    const sourceHash = hash(rows);
    const reviewedMetadata = { country: 'CO', transportMode: 'AIR', awb, farmName: String(head.FarmName).trim(), inputDate: head.InputDate };
    documents.push({ documentId: `native-${warehouseKey}`, revision: 1, sourceHash, orderYear, orderWeek, invoiceNo: String(head.InvoiceNo).trim(),
      reviewedMetadata, receiptLines: memberLines, lines: memberLines });
    receiptLines.push(...memberLines);
    members.push({ documentId: `native-${warehouseKey}`, warehouseKey, revision: 1, sourceHash, orderYear, orderWeek, awb, currency: 'USD', country: 'CO',
      farmName: reviewedMetadata.farmName, invoiceNo: String(head.InvoiceNo).trim(),
      // suggestedGroupId는 화면 추천용일 뿐 계산에는 쓰이지 않는다(groupId는 사용자가 확정).
      lineInputs: memberLines.map((line, i) => ({ lineId: line.lineId, tariffRate: 0, stemsPerBunch: line.stemsPerBunch,
        bunchesPerBox: line.stemsPerBunch > 0 && line.stemsPerBox > 0 ? line.stemsPerBox / line.stemsPerBunch : null, groupId: '', suggestedGroupId: goodsSuggestions[i] })),
      rows: memberLines.map(line => ({ ...line, receiptQuantity: line.outQuantity, receiptUnit: unit(line.outUnit), actualQuantity: line.stemQuantity, unit: 'STEM' })) });
  }
  if (!members.length) fail(`${NATIVE_SHARED_SCOPES[scope]} 범위에 해당하는 콜롬비아 입고가 없습니다.`, 404);
  if (receiptLines.length > 1000) fail('공동 계산은 최대 1000개 품목 행을 지원합니다.');

  // 원본 기준 지문은 사용자의 품종/단당송이 편집과 무관하게 원장 스냅샷에만 고정한다.
  const manifest = { orderYear, orderWeek, awb, currency: 'USD', members: members.map(({ documentId, revision, sourceHash }) => ({ documentId, revision, sourceHash })) };
  const baselineDigest = hash({ manifest, scope, receiptLines, excluded });

  // 사용자가 확정한 품종 분류 및 단당 송이수 보정값을 반영한다.
  const chosen = new Map((Array.isArray(request.lineInputs) ? request.lineInputs : []).map(entry => [entry?.lineId, entry]));
  const byReceiptLine = new Map(receiptLines.map(line => [line.lineId, line]));
  for (const member of members) {
    member.lineInputs = member.lineInputs.map(entry => {
      const override = chosen.get(entry.lineId);
      if (!override) return entry;
      const groupId = override.groupId || '';
      const rawLine = byReceiptLine.get(entry.lineId);
      const overrideSpb = override.stemsPerBunch != null && override.stemsPerBunch !== '' && Number(override.stemsPerBunch) > 0
        ? Number(override.stemsPerBunch)
        : null;
      const overrideTariff = override.tariffRate != null && override.tariffRate !== '' && Number.isFinite(Number(override.tariffRate)) && Number(override.tariffRate) >= 0
        ? Number(override.tariffRate)
        : entry.tariffRate;
      const stemsPerBunch = overrideSpb ?? entry.stemsPerBunch ?? resolveColombiaStemsPerBunch(rawLine, groupId);
      const bunchesPerBox = stemsPerBunch > 0 && rawLine?.stemsPerBox > 0 ? rawLine.stemsPerBox / stemsPerBunch : entry.bunchesPerBox;
      return { ...entry, groupId, stemsPerBunch, bunchesPerBox, tariffRate: overrideTariff };
    });
  }

  const mixedAwb = hasMainOnAwb && hasHydrangeaOnAwb;
  const recommendedScope = mixedAwb ? 'ALL' : hasHydrangeaOnAwb ? 'HYDRANGEA' : 'MAIN';
  const partialScopeOfMixedAwb = mixedAwb && scope !== 'ALL';
  const awbScopeSummary = { mixedAwb, hasMainOnAwb, hasHydrangeaOnAwb, recommendedScope, partialScopeOfMixedAwb };

  if (partialScopeOfMixedAwb) {
    warnings.push({
      code: 'MIXED_AWB_PARTIAL_SCOPE',
      message: '이 AWB에는 콜카장과 수국이 함께 입고되어 있습니다. 전체 중량·운임 2중 계상을 막기 위해 부분 범위에는 전체 AWB 중량·운임을 자동 대입하지 않습니다. 통합 5품종(ALL) 범위를 권장합니다.',
    });
  }
  if (unmappedPaidRows.length > 0) {
    warnings.push({
      code: 'UNMAPPED_PAID_GOODS_EXCLUDED',
      message: `전산 품목 미매핑 유상 행 ${unmappedPaidRows.length}건이 계산에서 제외되어 있습니다. 입고 매칭 누락 또는 수기 재등록 여부를 반드시 확인하세요.`,
    });
  }

  const fullAwbReference = extractAwbReferenceFromReceipts(raw, awb);
  return {
    manifest,
    members,
    documents,
    receiptLines,
    baselineDigest,
    issues,
    excluded,
    unmappedPaidRows,
    warnings,
    awbScopeSummary,
    ...(fullAwbReference && !partialScopeOfMixedAwb ? { awbReference: fullAwbReference } : {}),
    ...(fullAwbReference && partialScopeOfMixedAwb ? { mixedAwbReference: fullAwbReference } : {}),
  };
}
