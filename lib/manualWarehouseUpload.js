export const manualWarehouseUnits = ['박스', '단', '송이'];
export const manualWarehouseMaxRows = 100;
const MANUAL_ALLOWED_USER_IDS = new Set(['nenovass2']);

export function isManualWarehouseAllowedAccount(user = {}) {
  const userId = String(user?.userId ?? user?.UserID ?? '').trim();
  if (!userId || user?.accountActive === false || user?.isDeleted === true) return false;
  return MANUAL_ALLOWED_USER_IDS.has(userId.toLowerCase());
}

const invalid = message => Object.assign(new Error(message), { statusCode: 400, code: 'WAREHOUSE_MANUAL_INVALID' });
const validNumber = value => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (!/^\d+(?:\.\d+)?$/.test(String(value).trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number <= 1e12 ? number : null;
};
const text = value => typeof value === 'string' ? value.trim() : '';
const present = value => value != null && String(value).trim() !== '';

export function manualWarehouseHeader(input) {
  const orderYear = text(input.orderYear);
  const orderWeek = text(input.orderWeek);
  const inputDate = text(input.inputDate);
  const farmName = text(input.farmName);
  const invoiceNo = text(input.invoiceNo);
  const awb = text(input.awb);
  const operationId = text(input.operationId);
  if (!/^20\d{2}$/.test(orderYear) || !/^(?:0[1-9]|[1-4]\d|5[0-3])-(?:0[1-9]|[1-9]\d)$/.test(orderWeek)) {
    throw invalid('연도와 세부차수를 입력하세요.');
  }
  if (Number(orderYear) < 2026) throw invalid('전산 재고 계산은 2026년 이전 입고를 등록할 수 없습니다.');
  const timestamp = new Date(inputDate + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inputDate) || !Number.isFinite(+timestamp) || timestamp.toISOString().slice(0, 10) !== inputDate) {
    throw invalid('실제 입고일을 정확히 입력하세요.');
  }
  if (!farmName || farmName.length > 100 || invoiceNo.length > 50 || awb.length > 50) {
    throw invalid('등록 농장과 50자 이하 인보이스·AWB를 확인하세요.');
  }
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(operationId)) {
    throw invalid('이 수기 입고의 요청 번호가 유효하지 않습니다.');
  }
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > manualWarehouseMaxRows) {
    throw invalid(`품목을 1개부터 ${manualWarehouseMaxRows}개까지 입력하세요.`);
  }
  return { orderYear, orderWeek, inputDate, farmName, invoiceNo, awb, operationId };
}

export function manualWarehouseLine(item, product) {
  const quantity = validNumber(item.quantity);
  const amount = validNumber(item.amount);
  const stemsPerBunch = validNumber(item.stemsPerBunch);
  const stemsPerBox = validNumber(item.stemsPerBox);
  const unit = item.quantityUnit;
  if (!manualWarehouseUnits.includes(unit) || quantity === null || quantity <= 0 ||
      (unit !== '박스' && !Number.isSafeInteger(quantity))) throw invalid('입고 수량과 단위를 확인하세요.');
  if (amount === null || !['total', 'perStem'].includes(item.amountMode)) throw invalid('송이당 단가 또는 행 금액을 입력하세요.');
  for (const [entered, parsed, label] of [[item.stemsPerBunch, stemsPerBunch, '단'], [item.stemsPerBox, stemsPerBox, '박스']]) {
    if (present(entered) && (!Number.isSafeInteger(parsed) || parsed <= 0)) throw invalid(`${label}당 송이 수는 양의 정수여야 합니다.`);
  }
  const outUnit = text(product.OutUnit);
  const estUnit = text(product.EstUnit);
  if (!manualWarehouseUnits.includes(outUnit) || !manualWarehouseUnits.includes(estUnit)) throw invalid('전산 출고·견적 단위를 확인하세요.');
  if (Number(item.prodKey) !== product.ProdKey || item.expectedOutUnit !== outUnit || item.expectedEstUnit !== estUnit) {
    throw invalid('선택한 품목 또는 전산 단위가 바뀌었습니다. 품목을 다시 선택하세요.');
  }
  const stems = unit === '송이' ? quantity : quantity * (unit === '단' ? stemsPerBunch : stemsPerBox);
  if (!Number.isSafeInteger(stems) || stems <= 0) throw invalid('송이 수량을 확인할 수 있도록 포장당 송이 수를 입력하세요.');
  const bunches = unit === '단' ? quantity : stemsPerBunch ? stems / stemsPerBunch : null;
  const boxes = unit === '박스' ? quantity : stemsPerBox ? stems / stemsPerBox : null;
  if (bunches != null && !Number.isSafeInteger(bunches)) throw invalid('송이·단 수량이 입력한 포장 규격과 맞지 않습니다.');
  const quantities = { 박스: boxes, 단: bunches, 송이: stems };
  if (!quantities[outUnit] || !quantities[estUnit]) throw invalid(`출고(${outUnit})·견적(${estUnit})에 필요한 포장당 송이 수를 입력하세요.`);
  const unitPrice = item.amountMode === 'perStem' ? amount : amount / stems;
  const totalPrice = item.amountMode === 'total' ? amount : amount * stems;
  if (totalPrice > 1e12 || Math.abs(stems * unitPrice - totalPrice) > 0.000001) throw invalid('송이당 단가와 행 금액의 범위를 확인하세요.');
  return { boxQty: boxes, bunchQty: bunches, steamQty: stems, steamOf1Box: stemsPerBox, steamOf1Bunch: stemsPerBunch,
    unitPrice, totalPrice, outUnit, estUnit, outQuantity: quantities[outUnit], estQuantity: quantities[estUnit] };
}
