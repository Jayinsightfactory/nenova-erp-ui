import { ChinaOrderValidationError, selectChinaOrderSubweek } from './chinaOrderDownload.js';
import { chinaBoxConversion, chinaBoxQuantity, chinaClientCodeGroup, compareChinaCustomers } from './chinaOrderQuantityPresentation.js';

const text = value => String(value ?? '').trim();

// One exact subweek only. Labels never act as business identities.
export function buildChinaOrderCustomerMatrix(report) {
  const selected = report?.columns?.find(column => column.key === report.selectedColumnKey && !column.empty);
  if (!selected || !Array.isArray(report.orders)) {
    throw new ChinaOrderValidationError('품목별 업체 수량표는 실제 세부차수 하나를 선택해야 합니다.');
  }
  for (const order of report.orders) {
    if (Number(order.orderYear) !== Number(selected.year) || order.orderWeek !== selected.orderWeek) {
      throw new ChinaOrderValidationError('선택 세부차수와 다른 연도·차수의 주문이 수량표에 포함되어 있습니다.');
    }
    if (text(order.country) !== '중국' || !Number.isFinite(Number(order.quantity)) || Number(order.quantity) <= 0) {
      throw new ChinaOrderValidationError('수량표는 중국 양수 주문등록 수량만 표시합니다.');
    }
  }
  const validated = selectChinaOrderSubweek(report, selected.key);
  const customers = new Map();
  const rows = new Map();
  const totals = new Map();
  for (const order of validated.orders) {
    const customerKey = String(order.custKey);
    const customer = { custKey: order.custKey, custName: text(order.custName), custOrderCode: text(order.custOrderCode) };
    const priorCustomer = customers.get(customerKey);
    if (priorCustomer && (priorCustomer.custName !== customer.custName || priorCustomer.custOrderCode !== customer.custOrderCode)) {
      throw new ChinaOrderValidationError('같은 업체키의 업체명·CL 코드가 다릅니다. 다시 조회하세요.');
    }
    customers.set(customerKey, customer);
    const rowKey = `${order.prodKey}|${order.unit}`;
    if (!rows.has(rowKey)) rows.set(rowKey, {
      rowKey, prodKey: order.prodKey, prodCode: text(order.prodCode), prodName: text(order.prodName),
      country: '중국', flower: text(order.flower), unit: order.unit, quantities: {}, total: 0, boxConversion: chinaBoxConversion(order),
    });
    const row = rows.get(rowKey);
    if (row.boxConversion.unitsPerBox !== chinaBoxConversion(order).unitsPerBox) {
      throw new ChinaOrderValidationError('같은 품목의 박스 환산 기준이 다릅니다. 다시 조회하세요.');
    }
    row.quantities[customerKey] = (row.quantities[customerKey] ?? 0) + order.quantity;
    row.total += order.quantity;
    if (!totals.has(order.unit)) totals.set(order.unit, { unit: order.unit, quantities: {}, total: 0 });
    const total = totals.get(order.unit);
    total.quantities[customerKey] = (total.quantities[customerKey] ?? 0) + order.quantity;
    total.total += order.quantity;
  }
  const columns = [...customers.values()].sort(compareChinaCustomers).map(customer => ({ ...customer, codeGroup: chinaClientCodeGroup(customer.custOrderCode) }));
  const productRows = validated.rows.map(product => rows.get(`${product.prodKey}|${product.unit}`));
  for (const row of [...productRows, ...totals.values()]) {
    row.quantities = Object.fromEntries(columns.map(customer => [String(customer.custKey), row.quantities[String(customer.custKey)] ?? 0]));
  }
  for (const row of productRows) {
    row.boxQuantities = Object.fromEntries(columns.map(customer => [String(customer.custKey), chinaBoxQuantity(row.quantities[String(customer.custKey)], row.boxConversion)]));
    row.boxTotal = chinaBoxQuantity(row.total, row.boxConversion);
  }
  const sumBoxes = values => values.some(value => value === null) ? null : values.reduce((sum, value) => sum + value, 0);
  for (const total of totals.values()) {
    const matching = productRows.filter(row => row.unit === total.unit);
    total.boxTotal = sumBoxes(matching.map(row => row.boxTotal));
    total.boxQuantities = Object.fromEntries(columns.map(customer => [String(customer.custKey), sumBoxes(matching.map(row => row.boxQuantities[String(customer.custKey)]))]));
  }
  return { selectedColumnKey: selected.key, year: selected.year, orderWeek: selected.orderWeek,
    customers: columns, rows: productRows, totals: [...totals.values()].sort((a, b) => a.unit.localeCompare(b.unit, 'ko')) };
}
