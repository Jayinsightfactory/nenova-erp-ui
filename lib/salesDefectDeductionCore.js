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

/** 차수 입력값의 인접 대차수로 이동한다. 1차/52차 경계에서는 연도도 함께 이동한다. */
export function shiftParentWeek(year, week, direction) {
  const y = normalizeYear(year);
  const w = normalizeParentWeek(week);
  const delta = Number(direction) < 0 ? -1 : Number(direction) > 0 ? 1 : 0;
  if (!y || !w || !delta) return null;
  if (delta < 0 && w <= 1) return { year: y - 1, week: 52 };
  if (delta > 0 && w >= 52) return { year: y + 1, week: 1 };
  return { year: y, week: w + delta };
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

/** 로그인 ID와 차감 원장 담당자 표시명이 다를 때 동일 담당자로 조회한다. */
export function managerFilterForUser(value, user = {}) {
  const selected = String(value ?? '').trim();
  const userId = String(user?.userId ?? '').trim();
  const userName = String(user?.userName ?? '').trim();
  if (selected && userId && selected === userId && userName) return userName;
  return selected;
}

/** 견적서 등록 사전검증 결과에서 처리 가능한 행과 사유가 있는 행을 분리한다. */
export function partitionRegistrationPreflight(rows = []) {
  const source = Array.isArray(rows) ? rows : [];
  return {
    valid: source.filter((row) => Number(row?.deductionKey) > 0 && !row?.error),
    invalid: source.filter((row) => Number(row?.deductionKey) <= 0 || row?.error),
  };
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
    // 수입부 보완 필요는 해결 완료 전까지 일반 영업 저장으로 해제할 수 없다.
    importReviewRequired: Boolean(row.importReviewRequired ?? row.ImportReviewRequired),
    deductionType: text(row.deductionType ?? row.DeductionType, 50) || '불량차감',
    estimateKey: Number(row.estimateKey ?? row.EstimateKey) > 0 ? Number(row.estimateKey ?? row.EstimateKey) : null,
    sourceFileName: text(row.sourceFileName ?? row.SourceFileName, 300),
    status: text(row.status ?? row.Status, 20) || 'DRAFT',
  };
}

function hasDeductionContent(row = {}) {
  return Boolean(
    row.customerName || row.productName || row.colorName || row.quantity
    || row.custKey || row.prodKey,
  );
}

/**
 * 저장 API가 새 DeductionKey를 발급한 행을 저장 전 임시행과 교체한다.
 * 기존 키 행은 API 응답으로 갱신하고, 빈 입력행은 화면에 남긴다.
 */
export function mergeSavedDeductionRows(currentRows = [], savedRows = [], submittedRows = currentRows) {
  const submittedKeys = new Set(
    (submittedRows || []).map((row) => Number(row?.deductionKey)).filter(Boolean),
  );
  const savedByKey = new Map(
    (savedRows || [])
      .filter((row) => Number(row?.deductionKey))
      .map((row) => [Number(row.deductionKey), row]),
  );
  const newSubmittedIndexes = (submittedRows || [])
    .map((row, index) => (Number(row?.deductionKey) || !hasDeductionContent(row) ? null : index))
    .filter((index) => index != null);
  const newSavedRows = (savedRows || [])
    .filter((row) => Number(row?.deductionKey) && !submittedKeys.has(Number(row.deductionKey)));
  const newSavedByIndex = new Map(
    newSubmittedIndexes.map((index, position) => [index, newSavedRows[position]]),
  );

  const merged = (currentRows || []).map((row, index) => {
    const key = Number(row?.deductionKey);
    if (key) return savedByKey.get(key) || row;
    return newSavedByIndex.get(index) || row;
  });
  const present = new Set(merged.map((row) => Number(row?.deductionKey)).filter(Boolean));
  return [
    ...merged,
    ...(savedRows || []).filter((row) => {
      const key = Number(row?.deductionKey);
      return key && !present.has(key);
    }),
  ];
}

/** 선택 삭제에서 저장행과 아직 키가 없는 임시행을 분리한다. */
export function partitionSelectedDeductionRows(rows = [], selectedIndexes = []) {
  const indexes = [...selectedIndexes]
    .map((index) => Number(index))
    .filter((index) => Number.isInteger(index) && index >= 0 && index < rows.length);
  const selectedRows = indexes.map((index) => rows[index]).filter(Boolean);
  return {
    indexes,
    storedKeys: selectedRows.map((row) => Number(row.deductionKey)).filter((key) => key > 0),
    unsavedIndexes: indexes.filter((index) => !(Number(rows[index]?.deductionKey) > 0)),
  };
}

/** 가로로 배치된 검색 후보를 좌우 방향키로 순환 이동한다. */
export function lookupSelectionDelta(key) {
  if (key === 'ArrowRight' || key === 'ArrowDown') return 1;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return -1;
  return 0;
}

