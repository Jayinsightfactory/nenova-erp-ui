// 브라우저/단위 테스트에서도 사용할 수 있는 영업수입불량차감 순수 규칙.

export function normalizeParentWeek(value) {
  const match = String(value ?? '').trim().match(/^(?:\d{4}-)?(\d{1,2})(?:-\d{1,2})?$/);
  if (!match) return null;
  const week = Number(match[1]);
  return Number.isInteger(week) && week >= 1 && week <= 53 ? week : null;
}

export function normalizeYear(value) {
  const year = Number(String(value ?? '').trim());
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : null;
}

export function previousParentScope(year, week) {
  const y = Number(year);
  const w = Number(week);
  if (w <= 1) return { year: y - 1, week: 52 };
  return { year: y, week: w - 1 };
}

/** 저장 원장의 입력 담당자 식별자/표시명을 일관되게 선택한다. */
export function deductionManagerIdentity(row = {}) {
  const firstText = (...values) => values
    .map((value) => String(value ?? '').trim())
    .find(Boolean) || '';
  const id = firstText(row.CreatedBy, row.createdBy, row.UpdatedBy, row.updatedBy);
  const name = firstText(row.CreatedByName, row.createdByName, row.UpdatedByName, row.updatedByName, id);
  return { id, name: name || id };
}

export function normalizeUnit(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/박스|box/i.test(text)) return '박스';
  if (/단|bunch/i.test(text)) return '단';
  if (/대|스팀|steam|stem|송이/i.test(text)) return '스팀(대)';
  return text;
}

function text(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function numberValue(value) {
  const n = Number(String(value ?? '').replace(/,/g, '').replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function normalizeDeductionRow(row = {}) {
  return {
    deductionKey: Number(row.deductionKey || row.DeductionKey || 0) || null,
    customerName: text(row.customerName ?? row.CustName, 200),
    custKey: Number(row.custKey ?? row.CustKey) > 0 ? Number(row.custKey ?? row.CustKey) : null,
    productName: text(row.productName ?? row.prodName ?? row.ProdName, 300),
    prodKey: Number(row.prodKey ?? row.ProdKey) > 0 ? Number(row.prodKey ?? row.ProdKey) : null,
    colorName: text(row.colorName ?? row.ColorName, 200),
    quantity: Math.abs(numberValue(row.quantity ?? row.Quantity)),
    sourceUnit: text(row.sourceUnit ?? row.unit ?? row.SourceUnit, 30),
    creditApplied: Boolean(row.creditApplied ?? row.CreditApplied),
    farmName: text(row.farmName ?? row.FarmName, 200),
    farmKey: Number(row.farmKey ?? row.FarmKey) > 0 ? Number(row.farmKey ?? row.FarmKey) : null,
    note: text(row.note ?? row.Note, 1000),
    deductionType: text(row.deductionType ?? row.DeductionType, 50) || '불량차감',
    estimateKey: Number(row.estimateKey ?? row.EstimateKey) > 0 ? Number(row.estimateKey ?? row.EstimateKey) : null,
    sourceFileName: text(row.sourceFileName ?? row.SourceFileName, 300),
    status: text(row.status ?? row.Status, 20) || 'DRAFT',
  };
}

