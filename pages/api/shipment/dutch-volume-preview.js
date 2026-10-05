import { withAuth } from '../../../lib/auth';
import { buildImportPreview } from '../../../lib/shipmentImport';
import { normalizeDutchEntries, resolveDutchPairPolicy, issueDutchPlan, dutchError, dutchEstUnitConversionIssue, dutchComputedValueIssue } from '../../../lib/dutchVolumeDistribution';
import { readDutchScopeSnapshot, assertUniqueDutchLedger, findDutchFarmQtyBlockers, findDutchDateIntegrityBlockers } from '../../../lib/dutchVolumeDistributionSnapshot';
import { withTransaction } from '../../../lib/db';

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export async function previewDutchVolume(body, user, deps = {}) {
  const buildPreview = deps.buildPreview || buildImportPreview;
  const readSnapshot = deps.readSnapshot || readDutchScopeSnapshot;
  const transact = deps.withTransaction || withTransaction;
  const input = normalizeDutchEntries(body);
  const parsedRows = input.entries.map(entry => ({
    entryId: entry.id,
    sheetName: 'Dutch volume', rowNo: entry.index + 1, colNo: 1,
    customerLabel: entry.customer,
    productLabel: entry.product,
    productColor: entry.color,
    uploadQty: entry.quantity, excelQty: entry.quantity,
    outUnit: entry.unit, excelUnit: entry.unit,
    custKey: entry.custKey, prodKey: entry.prodKey,
    sourceType: 'dutch-volume',
    hasFinalDistributionDirective: true,
  }));
  const { preview, scoped, scope, snapshot, digest } = await transact(async (tQ) => {
    const previewInput = {
      parsedRows, rawWeek: input.week, rawYear: input.year,
      strictMatching: true, countryFilter: '네덜란드', queryFn: tQ,
    };
    const preview = await buildPreview(previewInput);
    const scoped = resolveDutchPairPolicy(preview.rows || [], input.entries);
    if (!preview.replacementCategories?.length) return { preview, scoped, scope: null, snapshot: null, digest: null };
    const scope = {
      year: input.year, week: input.week,
      categories: [...new Set(preview.replacementCategories)].sort(),
      pairs: scoped,
    };
    const { snapshot, digest } = await readSnapshot(tQ, scope, true);
    assertUniqueDutchLedger(snapshot);
    const confirmation = await buildPreview(previewInput);
    const relevant = result => JSON.stringify({
      categories: [...(result.replacementCategories || [])].sort(),
      rows: (result.rows || []).map(row => [row.key, row.orderQty, row.currentOutQty, row.uploadQty, row.fixBlocked, row.shipmentDateIssueCount]),
      unmatched: (result.unmatched || []).map(row => [row.entryId, row.reason]),
    });
    if (relevant(preview) !== relevant(confirmation)) {
      throw dutchError('PREVIEW_CHANGED', '미리보기를 읽는 동안 원장 상태가 변경되었습니다. 다시 검증하세요.', 409);
    }
    return { preview, scoped, scope, snapshot, digest };
  });
  const pairById = new Map();
  for (const row of scoped) for (const id of row.entryIds || []) pairById.set(String(id), row);
  const unmatchedById = new Map((preview.unmatched || []).map(row => [String(row.entryId), row]));
  const entryMatches = input.entries.map(entry => {
    const row = pairById.get(entry.id);
    const missing = unmatchedById.get(entry.id);
    return {
      id: entry.id,
      custKey: row?.custKey ?? null,
      prodKey: row?.prodKey ?? null,
      custName: row?.custName || '',
      prodName: row?.prodName || '',
      outUnit: row?.outUnit || '',
      estUnit: row?.estUnit || '',
      status: missing ? 'unmatched' : row ? 'matched' : 'unmatched',
      reason: missing?.reason || (!row ? '매칭 결과 없음' : ''),
    };
  });
  if (!preview.replacementCategories?.length) {
    return { ...preview, rows: scoped, entryMatches, planToken: null, blockers: ['네덜란드 국가·품종 범위가 비었습니다.'] };
  }
  const shipmentByPair = new Map(snapshot.shipments.map(row => [`${row.MasterCustKey}|${row.ProdKey}`, row]));
  const orderPairs = new Set(snapshot.orders.map(row => `${row.CustKey}|${row.ProdKey}`));
  const productByKey = new Map(snapshot.products.map(product => [Number(product.ProdKey), product]));
  const priceRows = scoped.map(row => {
    const existing = shipmentByPair.get(`${row.custKey}|${row.prodKey}`);
    const product = productByKey.get(Number(row.prodKey));
    const currentCost = existing ? Number(existing.Cost || 0) : null;
    const targetCost = row.unitPrice == null ? currentCost : row.unitPrice;
    const priceChanged = row.unitPrice != null && (currentCost == null || currentCost !== row.unitPrice);
    const needsShipmentApply = Math.abs(Number(row.uploadQty) - Number(row.currentOutQty)) > 0.0001;
    return {
      ...row,
      needsShipmentApply,
      sourceType: 'dutch-volume',
      currency: 'KRW', estUnit: product?.EstUnit || product?.OutUnit || row.outUnit,
      currentCost, targetCost, priceChanged,
      orderBeforeQty: row.orderQty,
      orderAfterQty: orderPairs.has(`${row.custKey}|${row.prodKey}`) ? row.orderQty : row.uploadQty > 0 ? row.uploadQty : 0,
    };
  });
  const pricedByEntry = new Map();
  for (const row of priceRows) for (const id of row.entryIds || []) pricedByEntry.set(String(id), row);
  for (const match of entryMatches) {
    const priced = pricedByEntry.get(String(match.id));
    if (priced) { match.outUnit = priced.outUnit; match.estUnit = priced.estUnit; }
  }
  const byPair = new Map(priceRows.map(row => [`${row.custKey}|${row.prodKey}`, row]));
  const applyRows = priceRows.filter(row => !row.fixBlocked && (row.needsShipmentApply || row.priceChanged || (row.uploadQty > 0 && row.orderQty <= 0)));
  const blockers = [];
  if ((preview.unmatched || []).length) blockers.push(`미매칭 ${preview.unmatched.length}건`);
  if ((preview.fixBlockedRows || []).length) blockers.push(`확정차단 ${preview.fixBlockedRows.length}건`);
  // An unmatched positive entry must never make the category look like a
  // complete replacement. Explicitly require every source entry to resolve.
  if (entryMatches.some(item => item.status !== 'matched')) blockers.push('입력 행의 업체·품목 연결이 완료되지 않았습니다.');
  for (const row of priceRows) {
    const issue = dutchEstUnitConversionIssue(productByKey.get(Number(row.prodKey)), row.uploadQty);
    if (issue) blockers.push(`${row.custName} / ${row.prodName}: ${issue}`);
    const computedIssue = dutchComputedValueIssue(productByKey.get(Number(row.prodKey)), row.uploadQty, row.targetCost);
    if (computedIssue) blockers.push(`${row.custName} / ${row.prodName}: ${computedIssue}`);
  }
  blockers.push(...findDutchFarmQtyBlockers(snapshot, priceRows));
  blockers.push(...findDutchDateIntegrityBlockers(snapshot, priceRows));
  if (!applyRows.length) blockers.push('변경할 주문·분배·단가가 없습니다.');
  const planToken = blockers.length ? null : issueDutchPlan({
    ...scope, rows: priceRows,
    scopeRows: priceRows,
    digest,
    sourceFileName: String(body?.sourceFileName || 'Dutch volume').slice(0, 200),
  }, user);
  return {
    ...preview,
    rows: priceRows,
    changedRows: priceRows.filter(row => row.needsShipmentApply || row.priceChanged),
    applyRows,
    entryMatches,
    blockers,
    planToken,
    scopeMode: 'CATEGORY_REPLACE', sourceMode: 'DUTCH_VOLUME_KRW', currency: 'KRW',
    replacementCategories: scope.categories,
  };
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  try {
    return res.status(200).json(await previewDutchVolume(req.body, req.user));
  } catch (error) {
    const status = error.statusCode || (error.code ? 400 : 500);
    return res.status(status).json({ success: false, code: error.code || 'PREVIEW_FAILED', error: error.message });
  }
}

export default withAuth(handler);
