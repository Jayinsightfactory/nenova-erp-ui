/**
 * 운영 smoke / probe 공용 — 견적서 24차 회귀 (Orange Flame + 그린화원)
 * 2026-06-16: OutQuantity=0 유령행·Detail↔Date 불일치 재발 방지
 */

/** 정상출고 행 중 수량·단가 모두 양수가 아닌 “bad” 행 (웹 byDate 목록 노출 버그) */
export function countBadNormalEstimateRows(items) {
  return (items || []).filter((row) => {
    const t = row?.EstimateType ?? row?.estimateType ?? '정상출고';
    if (t !== '정상출고') return false;
    const qty = Number(row?.Quantity ?? row?.quantity ?? 0);
    const cost = Number(row?.Cost ?? row?.cost ?? 0);
    return !(qty > 0 && cost > 0);
  });
}

function parseShipmentKeys(raw) {
  return String(raw || '')
    .split(',')
    .map((v) => parseInt(v, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * @param { (path: string) => Promise<{status:number, json:object}> } request
 * @returns {Promise<{ok:boolean, skip?:boolean, label:string, detail?:string, count?:number}>}
 */
export async function checkOrangeFlameCostParity(request) {
  const r = await request('/api/dev/estimate-cost-source-audit?week=24-01&prod=Orange%20Flame&limit=80');
  if (r.status !== 200 || r.json?.success === false) {
    return { ok: false, label: 'Orange Flame cost-audit HTTP', detail: `status=${r.status}` };
  }
  const mismatches = (r.json?.allMismatches || []).filter((row) =>
    /orange\s*flame/i.test(String(row.ProdName || row.prodName || ''))
  );
  return {
    ok: mismatches.length === 0,
    label: 'Orange Flame 24-01 Detail↔Date Cost mismatch',
    detail: mismatches.length
      ? mismatches.slice(0, 3).map((x) => `${x.ProdName} D=${x.DetailCost} d=${x.DateCost}`).join('; ')
      : '0 mismatches',
    count: mismatches.length,
  };
}

/**
 * @param { (path: string) => Promise<{status:number, json:object}> } request
 */
export async function checkGreenGardenEstimateRows(request) {
  const est = await request('/api/estimate?week=24&includeUnfixed=0');
  if (est.status !== 200 || est.json?.success === false) {
    return { ok: false, label: '그린화원 estimate list HTTP', detail: `status=${est.status}` };
  }
  const greenShipments = (est.json?.shipments || []).filter((s) =>
    String(s.CustName || s.custName || '').includes('그린')
  );
  if (greenShipments.length === 0) {
    return { ok: true, skip: true, label: '그린화원 24차 (데이터 없음 — skip)', detail: 'no shipment' };
  }

  let totalBad = 0;
  const samples = [];
  for (const g of greenShipments) {
    for (const sk of parseShipmentKeys(g.ShipmentKeys || g.shipmentKeys)) {
      const itemsRes = await request(`/api/estimate?shipmentKey=${sk}&byDate=1`);
      if (itemsRes.status !== 200) continue;
      const bad = countBadNormalEstimateRows(itemsRes.json?.items);
      totalBad += bad.length;
      bad.slice(0, 2).forEach((row) => {
        samples.push(`${g.CustName} SK=${sk} ${String(row.ProdName || '').slice(0, 30)} qty=${row.Quantity} cost=${row.Cost}`);
      });
    }
  }

  return {
    ok: totalBad === 0,
    label: '그린화원 24차 byDate zero qty/cost (정상출고)',
    detail: totalBad ? samples.join(' | ') : `bad=0 (${greenShipments.length} shipment)`,
    count: totalBad,
  };
}

/**
 * @param { (path: string) => Promise<{status:number, json:object}> } request
 * @returns {Promise<Array<{ok:boolean, skip?:boolean, label:string, detail?:string}>>}
 */
export async function runEstimateRegressionChecks(request) {
  return [
    await checkOrangeFlameCostParity(request),
    await checkGreenGardenEstimateRows(request),
  ];
}
