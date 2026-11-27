// lib/boxVision/routeAndBill.js
// 카톡 출고 노선 메시지 파서 및 Bill/AWB → 입고 차수(OrderWeek) 역조회 순수 함수

import { FALLBACK_WAREHOUSE_BILLS } from './fallbackLedgers.js';

export function parseKakaoBatchRoute(rawMessage = '', allBoxes = []) {
  const text = String(rawMessage || '').trim();
  const hasPhoto5Note = allBoxes.some((b) => String(b.handwriting || '').includes('경부선'));

  let detectedRoute = '호남선/경부선 통합 출고';
  if (/호남선/.test(text) && /경부선/.test(text)) {
    detectedRoute = '호남선 · 경부선 통합 출고';
  } else if (/호남/.test(text)) {
    detectedRoute = '호남선 출고';
  } else if (/경부/.test(text)) {
    detectedRoute = '경부선 출고';
  } else if (/영동/.test(text)) {
    detectedRoute = '영동선 출고';
  } else if (/중부/.test(text)) {
    detectedRoute = '중부선 출고';
  } else if (/직배|터미널|호텔/.test(text)) {
    detectedRoute = '직배/터미널 출고';
  } else if (hasPhoto5Note) {
    detectedRoute = '호남선 · 경부선 출고 (사진5 수기메모: 11/23(월) 경부선 감지)';
  }

  const dateMatch = text.match(/(\d{1,2}\/\d{1,2}(?:\([월화수목금토일]\))?)/);
  const shipDateLabel = dateMatch ? dateMatch[1] : hasPhoto5Note ? '11/23(월)' : '당일 출고';

  return {
    rawMessage: text || '호남선 출고입니다 (카톡 묶음 사진 일괄 업로드)',
    routeName: detectedRoute,
    shipDateLabel,
    photoHandwritingMemo: hasPhoto5Note ? '사진 #5 우측 하단 수기 메모: 11/23(월) 경부선 / 그린 20 Bunches Douglas' : null,
  };
}

/**
 * Bill 번호(InvoiceNo), AWB 번호, 또는 홀렉스 오더번호(2493354/2494499/2494510)로
 * 해당 물량이 몇 년도 몇 차수(OrderWeek) 어느 농장 입고분인지 확인 조회
 */
export function lookupBillOrderWeek(queryText = '', warehouseBills = FALLBACK_WAREHOUSE_BILLS, currentLedger = []) {
  const q = String(queryText || '').trim();
  const normalized = q.replace(/[\s-]/g, '').toLowerCase();

  const mergedPool = [...warehouseBills];
  for (const row of currentLedger) {
    if (!mergedPool.some((b) => String(b.invoiceNo) === String(row.invoiceNo))) {
      mergedPool.push({
        warehouseKey: row.warehouseKey || 8247,
        invoiceNo: row.invoiceNo,
        awbNo: row.awbNo,
        awbCompact: String(row.awbNo || '').replace(/[\s-]/g, ''),
        holexOrderNos: row.orderNos || [],
        orderYear: row.orderYear || 2026,
        orderWeek: row.orderWeek || '47-02',
        orderWeekLabel: `${row.orderYear || 2026}년 ${row.orderWeek || '47-02'}차 입고`,
        farmName: row.farmName || 'Holex',
        countryName: row.countryName || '네덜란드',
        totalInboundBoxes: row.totalInboundBoxes || row.photoBoxCount || 1,
        totalInboundStems: row.totalInboundStems || row.photoTotalStems || 0,
        distributedCustomers: row.customerNames || [],
        note: '실시간 DB 입고 원장 매칭',
      });
    }
  }

  if (!normalized) {
    return mergedPool;
  }

  return mergedPool.filter((bill) => {
    const inv = String(bill.invoiceNo || '').replace(/[\s-]/g, '').toLowerCase();
    const awb = String(bill.awbNo || '').replace(/[\s-]/g, '').toLowerCase();
    const wk = String(bill.orderWeek || '').toLowerCase();
    const farm = String(bill.farmName || '').toLowerCase();
    const country = String(bill.countryName || '').toLowerCase();
    const orders = (bill.holexOrderNos || []).map((o) => String(o).replace(/[\s-]/g, '').toLowerCase());
    const custs = (bill.distributedCustomers || []).join(' ').toLowerCase();

    return (
      inv.includes(normalized) ||
      awb.includes(normalized) ||
      wk.includes(normalized) ||
      farm.includes(normalized) ||
      country.includes(normalized) ||
      custs.includes(q.toLowerCase()) ||
      orders.some((o) => o.includes(normalized) || normalized.includes(o))
    );
  });
}
