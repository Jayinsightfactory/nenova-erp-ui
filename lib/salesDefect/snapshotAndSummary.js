import { query, sql } from '../db.js';
import {
  normalizeDeductionRow,
  deductionManagerIdentity,
  normalizeDefectUnit,
} from '../salesDefectDeductionCore.js';
import { autoSourceStateFromRow } from '../salesDefectAutoSource.js';
import { text } from './lookupAndMatching.js';

export function registrationQuantity(row) {
  const claim = Number(row.Quantity ?? row.quantity ?? 0);
  const estimate = Number(row.EstimateQuantity ?? row.estimateQuantity ?? claim);
  if (!(row.IsCarryoverLedger ?? row.isCarryoverLedger)) return estimate;
  const remaining = Number(row.RemainingQuantity ?? row.remainingQuantity ?? claim);
  return Math.min(remaining, estimate);
}

export function buildBaseDefectSnapshot(row) {
  const manager = deductionManagerIdentity(row);
  const autoSource = autoSourceStateFromRow(row);
  return {
    deductionKey: Number(row.DeductionKey || row.deductionKey || 0),
    orderYear: Number(row.OrderYear || row.orderYear || 0),
    orderWeek: String(row.OrderWeek || row.orderWeek || ''),
    appliedOrderYear: row.AppliedOrderYear == null ? null : Number(row.AppliedOrderYear),
    appliedOrderWeek: row.AppliedOrderWeek == null ? '' : String(row.AppliedOrderWeek),
    appliedShipmentKey: row.AppliedShipmentKey == null ? null : Number(row.AppliedShipmentKey),
    appliedCostSourceYear: row.AppliedCostSourceYear == null ? null : Number(row.AppliedCostSourceYear),
    appliedCostSourceWeek: row.AppliedCostSourceWeek == null ? '' : String(row.AppliedCostSourceWeek),
    isCarryover: Boolean(
      row.AppliedOrderYear && row.AppliedOrderWeek
      && (Number(row.OrderYear) !== Number(row.AppliedOrderYear)
        || String(row.OrderWeek) !== String(row.AppliedOrderWeek)),
    ),
    custKey: row.CustKey == null ? null : Number(row.CustKey),
    customerName: row.CurrentCustName ?? row.CustName ?? row.customerName ?? '',
    originalCustomerName: row.CustName ?? row.originalCustomerName ?? row.customerName ?? '',
    customerAlias: row.CurrentCustomerDescr ?? row.CustomerAlias ?? row.customerAlias ?? '',
    matchedCustomerName: row.MatchedCustomerName ?? row.CurrentCustName ?? row.CustName ?? '',
    prodKey: row.ProdKey == null ? null : Number(row.ProdKey),
    productName: row.CurrentFlowerName ?? row.ProdName ?? row.productName ?? '',
    matchedProductName: row.MatchedProductName ?? row.CurrentDisplayName ?? row.CurrentProdName ?? row.ProdName ?? '',
    matchedProductDbName: row.MatchedProductDbName ?? row.CurrentProdName ?? row.ProdName ?? '',
    countryName: row.CountryName ?? row.CurrentCounName ?? row.CounName ?? '',
    matchedFlowerName: row.MatchedFlowerName ?? row.CurrentFlowerName ?? row.FlowerName ?? '',
    colorName: row.ColorName ?? row.colorName ?? '',
    estimateQuantity: row.EstimateQuantity == null ? null : Number(row.EstimateQuantity),
    quantity: Number(row.Quantity || row.quantity || 0),
    isCarryoverLedger: Boolean(row.IsCarryoverLedger ?? row.isCarryoverLedger),
    originalQuantity: Number(row.OriginalQuantity ?? row.originalQuantity ?? row.Quantity ?? row.quantity ?? 0),
    remainingQuantity: Number(row.RemainingQuantity ?? row.remainingQuantity ?? row.Quantity ?? row.quantity ?? 0),
    sourceUnit: normalizeDefectUnit(row.SourceUnit ?? row.sourceUnit)
      || String(row.SourceUnit ?? row.sourceUnit ?? ''),
    creditApplied: Boolean(row.CreditApplied ?? row.creditApplied),
    farmKey: row.FarmKey == null ? null : Number(row.FarmKey),
    farmName: row.FarmName ?? row.farmName ?? '',
    note: row.Note ?? row.note ?? '',
    sourceFileName: row.SourceFileName ?? row.sourceFileName ?? '',
    autoSourceExcluded: autoSource.excluded,
    autoSourceEvidence: autoSource.evidence,
    manualHeld: Boolean(row.ManualHeld ?? row.manualHeld),
    manualHoldHistoryKey: Number(row.ManualHoldHistoryKey ?? row.manualHoldHistoryKey ?? 0),
    rejectedAutoSource: Boolean(row.RejectedAutoSource ?? row.rejectedAutoSource),
    missingLinkedEstimate: Boolean(row.MissingLinkedEstimate ?? row.missingLinkedEstimate),
    incompleteAutoSource: Boolean(row.IncompleteAutoSource ?? row.incompleteAutoSource),
    sourceUnitReview: Boolean(row.SourceUnitReview ?? row.sourceUnitReview),
    permanentOmitted: Boolean(row.PermanentOmitted ?? row.permanentOmitted),
    sourceFactReview: Boolean(row.SourceFactReview ?? row.sourceFactReview),
    manualSourceConfirmed: Boolean(row.ManualSourceConfirmed ?? row.manualSourceConfirmed),
    deductionType: row.DeductionType ?? row.deductionType ?? '불량차감',
    estimateKey: row.EstimateKey == null ? null : Number(row.EstimateKey),
    verifiedLinkedEstimate: row.LinkedEstimateKey == null ? null : {
      estimateKey: row.LinkedEstimateKey,
      year: row.LinkedEstimateYear,
      week: row.LinkedEstimateWeek,
      custKey: row.LinkedEstimateCustKey,
      prodKey: row.LinkedEstimateProdKey,
      quantity: row.LinkedEstimateQuantity,
    },
    estimateCost: row.EstimateCost == null ? null : Number(row.EstimateCost),
    rowVersionNo: Number(row.RowVersionNo ?? row.rowVersionNo ?? 0),
    estimateDtm: row.EstimateDtm || null,
    status: row.Status ?? row.status ?? 'DRAFT',
    importConfirmed: Boolean(row.ImportConfirmed ?? row.importConfirmed),
    importConfirmedBy: row.ImportConfirmedBy ?? row.importConfirmedBy ?? '',
    importConfirmedByName: row.ImportConfirmedByName ?? row.importConfirmedByName ?? '',
    importConfirmedAt: row.ImportConfirmedAt || row.importConfirmedAt || null,
    importReviewRequired: Boolean(row.ImportReviewRequired ?? row.importReviewRequired),
    managerId: manager.id,
    managerName: manager.name,
    needsReview: !(Number(row.CustKey || row.custKey) > 0)
      || !(Number(row.ProdKey || row.prodKey) > 0)
      || !(Number(row.Quantity || row.quantity) > 0),
    isDeleted: Boolean(row.IsDeleted ?? row.isDeleted),
  };
}

export function changeSummary(before, after, action) {
  if (action === 'PERIOD_CORRECT') {
    return `차수 정정: ${before.orderYear}년 ${before.orderWeek}차 → ${after.orderYear}년 ${after.orderWeek}차 · ${after.correctionReason}`;
  }
  if (action === 'MANUAL_COMPLETE') {
    return `수동처리완료: 수기 처리로 원장만 완료 표시 · 적용 ${after?.appliedOrderYear || ''}년 ${after?.appliedOrderWeek || ''}차 · 견적서 미생성`;
  }
  const productMatchLabel = (row) => [
    row?.countryName,
    row?.matchedFlowerName || row?.productName,
    row?.matchedProductDbName || row?.matchedProductName,
  ].filter(Boolean).join(' ') || '-';
  if (!before) {
    const created = [`${action}: 신규 행 ${after.customerName || '(거래처 미매칭)'} / ${after.productName || '(품목 미매칭)'} ${after.quantity || 0}${after.sourceUnit || ''}`];
    if (after.custKey) created.push(`거래처 매칭 ${after.customerName || '-'} (#${after.custKey})`);
    if (after.prodKey) {
      created.push(`품목 매칭 ${productMatchLabel(after)} (#${after.prodKey})`);
      if (after.matchedProductDbName) created.push(`전산 품명 ${after.matchedProductDbName}`);
    }
    return created.join(', ');
  }
  const changes = [];
  if (before.customerName !== after.customerName || Number(before.custKey || 0) !== Number(after.custKey || 0)) {
    changes.push(`거래처 매칭 ${before.customerName || '-'} (#${before.custKey || '-'} ) → ${after.customerName || '-'} (#${after.custKey || '-'} )`);
  }
  if (before.productName !== after.productName || Number(before.prodKey || 0) !== Number(after.prodKey || 0)) {
    changes.push(`품목 매칭 ${productMatchLabel(before)} (#${before.prodKey || '-'} ) → ${productMatchLabel(after)} (#${after.prodKey || '-'} )`);
  }
  if (before.colorName !== after.colorName) changes.push(`품명 ${before.colorName || '-'} → ${after.colorName || '-'}`);
  if (Number(before.quantity || 0) !== Number(after.quantity || 0)) changes.push(`수량 ${before.quantity || 0} → ${after.quantity || 0}`);
  if (before.creditApplied !== after.creditApplied) changes.push(`크레딧 ${before.creditApplied ? '체크' : '미체크'} → ${after.creditApplied ? '체크' : '미체크'}`);
  if (before.farmName !== after.farmName) changes.push(`농장 ${before.farmName || '-'} → ${after.farmName || '-'}`);
  if (before.note !== after.note) changes.push('비고 변경');
  if (before.importReviewRequired !== after.importReviewRequired) changes.push(`보완 필요 ${after.importReviewRequired ? '체크' : '해제'}`);
  if (before.importConfirmed !== after.importConfirmed) changes.push(`수입부 확정 ${after.importConfirmed ? '확정' : '재확인 필요'}`);
  if (before.status !== after.status) changes.push(`상태 ${before.status} → ${after.status}`);
  return changes.length ? `${action}: ${changes.join(', ')}` : `${action}: 변경 없음`;
}

export function rowParams(row, { year, week, user, owner = null, sourceFileName = '' } = {}) {
  const item = normalizeDeductionRow(row);
  const ownerId = text(owner?.id || user?.userId || user?.userName, 100);
  const ownerName = text(owner?.name || user?.userName || ownerId, 100);
  return {
    year: { type: sql.Int, value: Number(year) },
    week: { type: sql.NVarChar, value: String(Number(week)) },
    ck: { type: sql.Int, value: item.custKey },
    cn: { type: sql.NVarChar, value: item.customerName },
    pk: { type: sql.Int, value: item.prodKey },
    pn: { type: sql.NVarChar, value: item.productName },
    color: { type: sql.NVarChar, value: item.colorName },
    qty: { type: sql.Decimal(18, 4), value: item.quantity },
    estimateQty: { type: sql.Decimal(18, 4), value: item.estimateQuantity },
    unit: { type: sql.NVarChar, value: normalizeDefectUnit(item.sourceUnit || item.unit || '') || '단' },
    credit: { type: sql.Bit, value: item.creditApplied },
    fk: { type: sql.Int, value: item.farmKey },
    fn: { type: sql.NVarChar, value: item.farmName },
    note: { type: sql.NVarChar, value: item.note },
    reviewRequired: { type: sql.Bit, value: item.importReviewRequired },
    dtype: { type: sql.NVarChar, value: item.deductionType || '불량차감' },
    file: { type: sql.NVarChar, value: text(sourceFileName || item.sourceFileName, 300) },
    owner: { type: sql.NVarChar, value: ownerId },
    ownerName: { type: sql.NVarChar, value: ownerName },
    by: { type: sql.NVarChar, value: text(user?.userId, 100) },
    byName: { type: sql.NVarChar, value: text(user?.userName, 100) },
  };
}

export async function queryEstimateTypeCode(typeText, q = query) {
  const result = await q(
    `SELECT TOP 1 DetailCode
       FROM CodeInfo
      WHERE Category=N'EstimateType'
        AND (DetailCode=@type OR Descr2=@type OR Descr=@type)
      ORDER BY CASE WHEN DetailCode=@type THEN 0 ELSE 1 END`,
    { type: { type: sql.NVarChar, value: text(typeText, 50) || '불량차감' } },
  );
  return result.recordset[0]?.DetailCode || text(typeText, 50) || '불량차감';
}

export async function queryEstimatePreview(q, estimateKey) {
  if (!estimateKey) return null;
  const result = await q(
    `SELECT TOP 1 e.EstimateKey, e.EstimateType, e.EstimateDtm, e.ProdKey,
            e.Unit, e.Quantity, e.Cost, e.Amount, e.Vat, e.Descr, e.ShipmentKey,
            p.ProdName, p.DisplayName, p.FlowerName
       FROM Estimate e
       LEFT JOIN Product p ON p.ProdKey=e.ProdKey
      WHERE e.EstimateKey=@ek`,
    { ek: { type: sql.Int, value: Number(estimateKey) } },
  );
  return result.recordset[0] || null;
}

export async function loadProductPreview(q, prodKey) {
  if (!prodKey) return null;
  const result = await q(
    `SELECT TOP 1 ProdKey, ProdName, DisplayName, FlowerName, CounName, EstUnit, OutUnit
       FROM Product
      WHERE ProdKey=@pk AND ISNULL(isDeleted,0)=0`,
    { pk: { type: sql.Int, value: Number(prodKey) } },
  );
  return result.recordset[0] || null;
}
