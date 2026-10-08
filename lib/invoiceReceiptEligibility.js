// SELECT-only prerequisite for invoice receipts. This is NOT permission to commit.
// The writer must call it again inside its protected ERP transaction.
function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function normalizeInvoiceReceiptScope({ orderYear, orderWeek, prodKeys } = {}) {
  const year = String(orderYear ?? '');
  const week = String(orderWeek ?? '');
  if (!['string', 'number'].includes(typeof orderYear) || typeof orderWeek !== 'string'
    || !/^\d{4}$/.test(year) || !/^(0[1-9]|[1-4]\d|5[0-3])-(0[1-9]|[1-9]\d)$/.test(week)) {
    fail('INVOICE_RECEIPT_SCOPE_INVALID', '명시적인 연도와 세부차수(예: 2026 / 41-01)가 필요합니다.');
  }
  if (Number(year) < 2026) fail('NATIVE_RECEIPT_YEAR_BLOCKED', '전산 재고 계산은 2026년 이전 자료를 변경할 수 없습니다.');
  if (!Array.isArray(prodKeys) || !prodKeys.length || prodKeys.length > 1000
    || Array.from(prodKeys).some(key => !Number.isInteger(key) || key <= 0 || key > 2147483647)) {
    fail('INVOICE_RECEIPT_PRODUCTS_REQUIRED', '확인된 전산 품목키가 1~1000개 필요합니다.');
  }
  return { orderYear: year, orderWeek: week, orderYearWeek: year + week.replace('-', ''),
    prodKeys: [...new Set(prodKeys)].sort((a, b) => a - b) };
}

const phases = ['CURRENT_FIXED', 'PREVIOUS_UNFIXED', 'NEXT_FIXED'];
const messages = {
  CURRENT_FIXED: '현재 차수에 확정된 품목이 있습니다.',
  PREVIOUS_UNFIXED: '직전 재고 차수에 미확정 품목이 있습니다.',
  NEXT_FIXED: '다음 재고 차수에 확정된 품목이 있습니다.',
};

function validYearWeek(value) {
  return typeof value === 'string' && /^\d{4}(0[1-9]|[1-4]\d|5[0-3])(0[1-9]|[1-9]\d)$/.test(value);
}

/** Evaluates a complete SQL snapshot; no missing-recordset or error => zero fallback. */
export function evaluateInvoiceReceiptEligibility(input, snapshot) {
  const scope = normalizeInvoiceReceiptScope(input);
  if (!snapshot || !Array.isArray(snapshot.products) || !Array.isArray(snapshot.blockers)
    || !snapshot.bounds || snapshot.bounds.CurrentYearWeek !== scope.orderYearWeek) {
    fail('INVOICE_RECEIPT_SNAPSHOT_INVALID', '입고 가능 여부 조회 결과가 불완전합니다.');
  }
  const { PreviousYearWeek: previous, NextYearWeek: next } = snapshot.bounds;
  if (!(previous === null || (validYearWeek(previous) && previous < scope.orderYearWeek))
    || !(next === null || (validYearWeek(next) && next > scope.orderYearWeek))) {
    fail('INVOICE_RECEIPT_SNAPSHOT_INVALID', '전후 재고 차수 조회 결과가 올바르지 않습니다.');
  }
  const byKey = new Map();
  for (const product of snapshot.products) {
    if (!scope.prodKeys.includes(product.ProdKey) || byKey.has(product.ProdKey)) {
      fail('INVOICE_RECEIPT_SNAPSHOT_INVALID', '품목 조회 범위 또는 중복을 확인해야 합니다.');
    }
    byKey.set(product.ProdKey, product);
  }
  const unresolvedProducts = scope.prodKeys.filter(key => {
    const product = byKey.get(key);
    return !product || (product.isDeleted !== 0 && product.isDeleted !== false)
      || typeof product.CountryFlower !== 'string' || !product.CountryFlower.trim();
  });
  if (unresolvedProducts.length) {
    return { ...scope, canProceed: false, code: 'INVOICE_RECEIPT_PRODUCT_SCOPE_INVALID',
      unresolvedProducts, blockers: [], previousYearWeek: previous, nextYearWeek: next,
      message: '삭제·미존재 품목 또는 품종 분류가 없는 품목을 확인하세요.',
      erpWritePerformed: false };
  }
  const categories = [...new Set(snapshot.products.map(row => row.CountryFlower))];
  const expectedWeeks = { CURRENT_FIXED: scope.orderYearWeek, PREVIOUS_UNFIXED: previous, NEXT_FIXED: next };
  const blockers = snapshot.blockers.map(row => {
    if (!phases.includes(row.Phase) || row.OrderYearWeek !== expectedWeeks[row.Phase]
      || !validYearWeek(row.OrderYearWeek) || !categories.includes(row.CountryFlower)
      || !Number.isInteger(row.ProdKey) || row.ProdKey <= 0 || typeof row.ProdName !== 'string') {
      fail('INVOICE_RECEIPT_SNAPSHOT_INVALID', '확정 검사 결과의 품목·차수 범위를 확인해야 합니다.');
    }
    return { phase: row.Phase, orderYear: row.OrderYearWeek.slice(0, 4),
      orderWeek: `${row.OrderYearWeek.slice(4, 6)}-${row.OrderYearWeek.slice(6)}`,
      countryFlower: row.CountryFlower, prodKey: row.ProdKey, prodName: row.ProdName,
      message: messages[row.Phase] };
  }).sort((a, b) => phases.indexOf(a.phase) - phases.indexOf(b.phase)
    || a.countryFlower.localeCompare(b.countryFlower) || a.prodKey - b.prodKey);
  return { ...scope, canProceed: blockers.length === 0,
    code: blockers.length ? 'NATIVE_ELIGIBILITY_BLOCKED' : 'NATIVE_ELIGIBILITY_CLEAR',
    countryFlowers: categories, previousYearWeek: previous, nextYearWeek: next,
    unresolvedProducts: [], blockers, erpWritePerformed: false,
    message: blockers.length ? blockers[0].message : '확정 상태 사전검사를 통과했습니다. 저장 직전에 다시 검사합니다.' };
}

/** Bound values only. Local table variables freeze scope within this request. */
export function invoiceReceiptEligibilitySql(productCount) {
  if (!Number.isInteger(productCount) || productCount < 1 || productCount > 1000) throw new TypeError('Invalid product count');
  const placeholders = Array.from({ length: productCount }, (_, i) => `(@p${i})`).join(',');
  return `SET NOCOUNT ON;
    DECLARE @current nvarchar(8)=@year+REPLACE(@week,N'-',N'');
    DECLARE @previous nvarchar(20),@next nvarchar(20);
    SELECT TOP(1) @previous=OrderYearWeek FROM dbo.StockMaster
      WHERE OrderYearWeek<@current ORDER BY OrderYearWeek DESC,OrderWeek DESC;
    SELECT TOP(1) @next=OrderYearWeek FROM dbo.StockMaster
      WHERE OrderYearWeek>@current ORDER BY OrderYearWeek,OrderWeek;
    DECLARE @products TABLE(ProdKey int,ProdName nvarchar(max),CountryFlower nvarchar(max),isDeleted int);
    INSERT INTO @products SELECT p.ProdKey,p.ProdName,p.CountryFlower,p.isDeleted
      FROM dbo.Product p JOIN (VALUES ${placeholders}) requested(ProdKey) ON requested.ProdKey=p.ProdKey;
    SELECT ProdKey,ProdName,CountryFlower,isDeleted FROM @products;
    SELECT @current CurrentYearWeek,@previous PreviousYearWeek,@next NextYearWeek;
    WITH Categories AS (
      SELECT DISTINCT p.CountryFlower FROM @products p
        WHERE p.isDeleted=0 AND NULLIF(LTRIM(RTRIM(p.CountryFlower)),N'') IS NOT NULL
    ), Scope AS (
      SELECT N'CURRENT_FIXED' Phase,@current OrderYearWeek,1 FixValue
      UNION ALL SELECT N'PREVIOUS_UNFIXED',@previous,0
      UNION ALL SELECT N'NEXT_FIXED',@next,1
    )
    SELECT s.Phase,s.OrderYearWeek,c.CountryFlower,vs.ProdKey,vs.ProdName
      FROM Scope s JOIN dbo.ViewShipment vs ON vs.OrderYearWeek2=s.OrderYearWeek
      JOIN Categories c ON c.CountryFlower=vs.CountryFlower
      WHERE ISNULL(vs.DetailFix,0)=s.FixValue
      GROUP BY s.Phase,s.OrderYearWeek,c.CountryFlower,vs.ProdKey,vs.ProdName;`;
}

export async function readInvoiceReceiptEligibility({ queryFn, types, ...input } = {}) {
  const scope = normalizeInvoiceReceiptScope(input);
  if (typeof queryFn !== 'function' || !types?.Int || !types?.NVarChar) throw new TypeError('queryFn and SQL types required');
  const params = { year: { type: types.NVarChar, value: scope.orderYear },
    week: { type: types.NVarChar, value: scope.orderWeek } };
  scope.prodKeys.forEach((key, i) => { params[`p${i}`] = { type: types.Int, value: key }; });
  // No catch: a failed SELECT is not a zero-count successful check.
  const result = await queryFn(invoiceReceiptEligibilitySql(scope.prodKeys.length), params);
  if (!Array.isArray(result?.recordsets) || result.recordsets.length !== 3
    || !result.recordsets.every(Array.isArray) || result.recordsets[1].length !== 1) {
    fail('INVOICE_RECEIPT_SNAPSHOT_INVALID', '입고 확정 검사 결과를 완전히 조회하지 못했습니다.');
  }
  return evaluateInvoiceReceiptEligibility(scope, { products: result.recordsets[0],
    bounds: result.recordsets[1][0], blockers: result.recordsets[2] });
}
