/** exe SQL row → 웹 UI 공통 필드명 */

export function mapManagerSalesRow(r) {
  return {
    CustName: r.CustName,
    area: r.CustArea,
    manager: r.BusinessManager,
    curSales: Number(r.Amount1) || 0,
    prevSales: Number(r.Amount2) || 0,
    rate: Number(r.Rate) || 0,
  };
}

export function mapAreaSalesRow(r) {
  return {
    area: r.CustArea,
    curSales: Number(r.Amount1 ?? r.Amount) || 0,
    prevSales: Number(r.Amount2) || 0,
    rate: Number(r.Rate) || 0,
  };
}

export function mapAreaPivotRows(rows) {
  return (rows || []).map((r) => ({
    area: r.CustArea,
    week: r.OrderWeek2,
    sales: Number(r.Amount) || 0,
  }));
}

export function mapStockViewRow(r) {
  return {
    ...r,
    prevStock: Number(r.BeforeStock ?? r.prevStock) || 0,
    inQty: Number(r.WareQuantity ?? r.inQty) || 0,
    outQty: Number(r.ShipQuantity ?? r.outQty) || 0,
    adjustQty: Number(r.StockQuantity ?? r.adjustQty) || 0,
    currentStock: Number(r.Stock) || 0,
    _exeParity: true,
  };
}

export function mapAnalysisDefectRow(r) {
  return {
    EstimateType: r.Descr || r.Type || r.EstimateType,
    curAmount: Number(r.Amount1 ?? r.curAmount) || 0,
    prevAmount: Number(r.Amount2 ?? r.prevAmount) || 0,
  };
}

export function mapAnalysisFlowerRow(r) {
  return {
    FlowerName: r.FlowerName || r.Descr || r.Type,
    curSales: Number(r.Amount1 ?? r.Amount ?? r.curSales) || 0,
  };
}

export function mapAnalysisTrendRow(r) {
  return {
    week: r.OrderWeek2 || r.OrderWeek || r.week,
    sales: Number(r.Amount ?? r.sales) || 0,
  };
}

/** FormOrderView rows → orders/index UI shape */
export function mapExeOrderViewToOrders(rows) {
  const ordersMap = {};
  for (const row of rows || []) {
    const mk = row.OrderMasterKey;
    if (!ordersMap[mk]) {
      ordersMap[mk] = {
        id: mk,
        date: String(row.OrderDtm || '').slice(0, 10),
        week: row.OrderWeek,
        year: row.OrderYear,
        manager: row.BusinessManager || '',
        orderCode: row.OrderCode,
        custKey: row.CustKey,
        custName: row.CustName,
        custArea: row.CustArea,
        items: [],
      };
    }
    const unit = row.OutUnit || '박스';
    ordersMap[mk].items.push({
      detailKey: row.OrderDetailKey,
      prodKey: row.ProdKey,
      prodName: row.ProdName,
      flowerName: row.FlowerName,
      counName: row.CounName,
      boxQty: Number(row.BoxQuantity) || 0,
      bunchQty: Number(row.BunchQuantity) || 0,
      steamQty: Number(row.SteamQuantity) || 0,
      outQty: Number(row.OutQuantity) || 0,
      unit,
      qty: Number(row.OutQuantity || row.BoxQuantity || row.BunchQuantity || row.SteamQuantity) || 0,
    });
  }
  return Object.values(ordersMap);
}
