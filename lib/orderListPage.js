export const ORDER_LIST_PAGE_SIZE = 100;

// Preserve the API's group/item order. Totals belong to the full filtered group,
// including when that group continues on the next page.
export function orderListModel(orders) {
  const totals = { totalBox: 0, totalBunch: 0, totalSteam: 0, totalCount: 0 };
  const groups = orders.map(order => {
    const start = totals.totalCount;
    const subtotal = { box: 0, bunch: 0, steam: 0 };
    for (const item of order.items) {
      subtotal.box += item.boxQty || 0;
      subtotal.bunch += item.bunchQty || 0;
      subtotal.steam += item.steamQty || 0;
      // Match the original row-by-row accumulation, including floating point
      // order and legacy values; do not add pre-aggregated group subtotals.
      totals.totalBox += item.boxQty || 0;
      totals.totalBunch += item.bunchQty || 0;
      totals.totalSteam += item.steamQty || 0;
    }
    totals.totalCount += order.items.length;
    return { order, start, subtotal };
  });
  return { groups, ...totals };
}

export function orderListPage(model, requestedPage, size = ORDER_LIST_PAGE_SIZE) {
  const pageCount = Math.max(1, Math.ceil(model.totalCount / size));
  const page = Math.max(0, Math.min(pageCount - 1, Math.trunc(requestedPage) || 0));
  const start = page * size, end = Math.min(start + size, model.totalCount);
  const groups = [];
  for (const group of model.groups) {
    const itemStart = Math.max(0, start - group.start);
    const itemEnd = Math.min(group.order.items.length, end - group.start);
    if (itemStart < itemEnd) groups.push({ ...group, itemStart, items: group.order.items.slice(itemStart, itemEnd) });
    if (group.start >= end) break;
  }
  return { groups, page, pageCount, start: model.totalCount ? start + 1 : 0, end };
}

export function orderListCsv(orders) {
  const rows = [['주문일자','차수','거래처','지역','담당자','국가','꽃','품목명(색상)','단위','박스수량','단수량','송이수량','클라이언트코드']];
  for (const order of orders) for (const item of order.items) rows.push([
    order.date, order.week, order.custName, order.custArea, order.manager,
    item.counName, item.flowerName, item.prodName, item.unit,
    item.boxQty || 0, item.bunchQty || 0, item.steamQty || 0, order.orderCode,
  ]);
  return rows.map(row => row.map(value => `"${value || ''}"`).join(',')).join('\n');
}
