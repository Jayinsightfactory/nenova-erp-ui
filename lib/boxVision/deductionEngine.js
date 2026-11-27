// lib/boxVision/deductionEngine.js
// 미식별 박스 검색 후보 추천 및 직육면체 3면 교차·전산 출고 잔여 소거법 역산 순수 엔진

import { FALLBACK_ERP_SHIPMENTS, SEARCHABLE_PRODUCT_CATALOG } from './fallbackLedgers.js';

/**
 * 품목이나 숫자가 안 보이는 박스(unreadable)에 대해
 * 1) 해당 사진 묶음의 차수(47-02차) · Bill 번호(1222993) · 업체(주광농원/늘봄원예/신라호텔) · 박스 색상/형태(예: 민트 가로 HOLEX 박스)와
 *    해당 업체의 전산 출고 원장(ShipmentDetail)에서 아직 확정 매칭되지 않은 잔여 출고 품목 리스트를 1순위로 자동 추천
 * 2) 검색어(한글/영문 품목명 또는 숫자 본수 40, 30, 120, 200 등)가 있으면 실시간 필터링하여 반환
 */
export function buildUnreadableBoxSearchCandidates(
  targetBox,
  {
    allBoxes = [],
    erpShipments = FALLBACK_ERP_SHIPMENTS,
    productCatalog = SEARCHABLE_PRODUCT_CATALOG,
    searchQuery = '',
  } = {}
) {
  if (!targetBox) return [];
  const q = String(searchQuery || '').trim().toLowerCase();

  // 현재 확정(confirmed 또는 matched)된 박스들의 업체×품목별 박스 수 및 수량 집계 (잔여 출고 후보 계산용)
  const confirmedMap = new Map();
  for (const b of allBoxes) {
    if (b.boxId === targetBox.boxId) continue;
    if (b.status !== 'COUNTED') continue;
    const isResolved = !b.ocrStatus || b.ocrStatus === 'confirmed' || b.resolutionAction === 'matched';
    if (!isResolved) continue;
    const k = `${b.custKey || b.custName}::${b.prodKey}`;
    const prev = confirmedMap.get(k) || { boxCount: 0, qtySum: 0 };
    prev.boxCount += 1;
    prev.qtySum += Number(b.qtyPerBox || 0);
    confirmedMap.set(k, prev);
  }

  const candidateMap = new Map();

  // 1) 전산 출고 원장(ShipmentDetail) 기반 후보 생성
  for (const ship of erpShipments) {
    const k = `${ship.custKey}::${ship.prodKey}`;
    const confirmed = confirmedMap.get(k) || { boxCount: 0, qtySum: 0 };
    const remainingBoxes = Math.max(0, Number(ship.erpBoxQty || 0) - confirmed.boxCount);
    const remainingQty = Math.max(0, Number(ship.erpOutQty || 0) - confirmed.qtySum);
    const catMeta = productCatalog.find((c) => Number(c.prodKey) === Number(ship.prodKey));
    const suggestedQtyPerBox = ship.erpBoxQty > 0
      ? Math.round(Number(ship.erpOutQty || 0) / Number(ship.erpBoxQty || 1))
      : (catMeta?.defaultQtyPerBox || 40);

    const sameCustomer = Number(ship.custKey) === Number(targetBox.custKey) || ship.custName === targetBox.custName;
    const sameProdHint = Number(ship.prodKey) === Number(targetBox.prodKey);
    const sameColorProfile = (ship.boxColorHint || catMeta?.boxColorProfile) === targetBox.boxColorProfile;
    const stickerT6Match = String(targetBox.stickerCode || '').includes('T6') && Number(ship.prodKey) === 329;
    const stickerT7Match = String(targetBox.stickerCode || '').includes('T7') && Number(ship.prodKey) === 1874;

    let priorityScore = 50;
    const reasons = [];
    if (sameCustomer) {
      priorityScore += 25;
      reasons.push(`${ship.custName} 출고원장`);
    }
    if (remainingBoxes > 0) {
      priorityScore += 30;
      reasons.push(`미매칭 잔여 ${remainingBoxes}박스(${remainingQty}${ship.unit})`);
    }
    if (sameColorProfile) {
      priorityScore += 15;
      reasons.push(targetBox.boxColorProfile === 'holex-mint-flat' ? '민트 가로 HOLEX 박스 일치' : '박스 외형 일치');
    }
    if (sameProdHint || stickerT6Match || stickerT7Match) {
      priorityScore += 35;
      reasons.push(stickerT6Match ? 'T6 스티커·카라 130본 일치' : stickerT7Match ? 'T7 스티커·튤립 200본 일치' : '라벨 힌트 1순위 일치');
    }

    const entryKey = `${ship.custKey}-${ship.prodKey}`;
    candidateMap.set(entryKey, {
      candidateId: entryKey,
      custKey: ship.custKey,
      custName: ship.custName,
      custCode: ship.custCode,
      prodKey: ship.prodKey,
      prodName: ship.prodName,
      flowerName: ship.flowerName || catMeta?.flowerName || '절화',
      unit: ship.unit || catMeta?.unit || '송이',
      suggestedQtyPerBox: sameProdHint && targetBox.qtyPerBox ? Number(targetBox.qtyPerBox) : suggestedQtyPerBox,
      stemsPerBox: ship.stemsPerBox || catMeta?.stemsPerBox || null,
      erpBoxQty: ship.erpBoxQty,
      erpOutQty: ship.erpOutQty,
      remainingBoxes,
      remainingQty,
      invoiceNo: ship.invoiceNo || targetBox.invoiceNo || '1222993',
      awbNo: ship.awbNo || targetBox.awbNo || '180-9162-6441',
      orderWeek: ship.orderWeek || targetBox.orderWeek || '47-02',
      farmName: ship.farmName || targetBox.farmName || 'Holex',
      priorityScore,
      isTopResidual: sameCustomer && (remainingBoxes > 0 || sameProdHint),
      recommendReason: reasons.join(' · ') || '해당 차수 전산 출고 품목',
      searchBlob: `${ship.custName} ${ship.prodName} ${ship.flowerName} ${suggestedQtyPerBox} ${ship.erpOutQty} ${catMeta?.keywords || ''}`.toLowerCase(),
    });
  }

  // 2) 전체 품목 카탈로그(Product / WarehouseDetail) 중 아직 후보에 없는 품목 추가 (직접 검색 대응)
  for (const cat of productCatalog) {
    const entryKey = `${targetBox.custKey || 533}-${cat.prodKey}`;
    if (candidateMap.has(entryKey)) continue;
    const sameColor = cat.boxColorProfile === targetBox.boxColorProfile;
    candidateMap.set(entryKey, {
      candidateId: entryKey,
      custKey: targetBox.custKey || 533,
      custName: targetBox.custName || '주광농원',
      custCode: targetBox.custCode || 'YCL2',
      prodKey: cat.prodKey,
      prodName: cat.prodName,
      flowerName: cat.flowerName,
      unit: cat.unit,
      suggestedQtyPerBox: cat.defaultQtyPerBox,
      stemsPerBox: cat.stemsPerBox || null,
      erpBoxQty: 1,
      erpOutQty: cat.defaultQtyPerBox,
      remainingBoxes: 1,
      remainingQty: cat.defaultQtyPerBox,
      invoiceNo: cat.invoiceNo || targetBox.invoiceNo || '1222993',
      awbNo: cat.awbNo || targetBox.awbNo || '180-9162-6441',
      orderWeek: cat.orderWeek || targetBox.orderWeek || '47-02',
      farmName: cat.farmName || targetBox.farmName || 'Holex',
      priorityScore: sameColor ? 45 : 30,
      isTopResidual: false,
      recommendReason: `${cat.orderWeek}차 입고 품목 카탈로그 (${cat.farmName})`,
      searchBlob: `${cat.prodName} ${cat.flowerName} ${cat.defaultQtyPerBox} ${(cat.altQtys || []).join(' ')} ${cat.keywords || ''}`.toLowerCase(),
    });
  }

  let list = [...candidateMap.values()].sort((a, b) => b.priorityScore - a.priorityScore);
  if (q) {
    list = list.filter(
      (item) =>
        item.searchBlob.includes(q) ||
        String(item.prodKey).includes(q) ||
        String(item.suggestedQtyPerBox) === q ||
        String(item.stemsPerBox || '') === q
    );
  }
  return list;
}

/**
 * [신규 핵심] 직육면체 1면 라벨 부착 & 팔레트 지그재그(90도 교차) 적재로 인해
 * 긴 옆면(zigzag_side, HOLEX 로고면)이 정면에 노출되고 라벨 단면(label_end)이 좌/우 측면(left/right)으로 돌아간 박스에 대해:
 * 1) [방식 1: 팔레트 3면(정면·좌·우) 묶음 사진 교차 라벨 매칭]
 *    - 좌측면/우측면 사진에서 단면(label_end)으로 찍힌 동일 라벨/스티커 박스가 있으면 이중 카운팅 없이 측면 라벨(품목·본수·일련번호)을 1:1 교차 결합
 * 2) [방식 2: 전산 출고 원장 소거법(차감 추론) 역산 매칭]
 *    - [전산 전체 출고 품목(ShipmentDetail)] - [라벨 단면(label_end)으로 이미 확인된 품목 수량] = [지그재그 옆면(zigzag_side) 잔여 품목]
 *    - 박스 외형/색상(민트 가로형 vs 흰색 가로형 vs 흰색 세로형) 및 보조 스티커(T6, T7, 7,5, 3,6, SECURITY)를 교차하여 1순위 deductionCandidate를 생성
 */
export function buildZigzagDeductionCandidate(
  targetBox,
  {
    allBoxes = [],
    erpShipments = FALLBACK_ERP_SHIPMENTS,
    productCatalog = SEARCHABLE_PRODUCT_CATALOG,
  } = {}
) {
  if (!targetBox) return null;

  const sideLabelName =
    targetBox.exposedLabelSide === 'left'
      ? '팔레트 좌측면(left)'
      : targetBox.exposedLabelSide === 'right'
      ? '팔레트 우측면(right)'
      : '팔레트 측면(left/right)';

  // 1) 팔레트 3면(정면·좌·우) 측면 사진 교차 라벨 확인
  const crossPhotoBox = allBoxes.find(
    (other) =>
      other.boxId !== targetBox.boxId &&
      other.photoNumber !== targetBox.photoNumber &&
      (other.boxFace || 'label_end') === 'label_end' &&
      (
        (targetBox.crossAngleMatchedSerial && other.serialNo === targetBox.crossAngleMatchedSerial) ||
        (targetBox.serialNo && other.serialNo === targetBox.serialNo)
      )
  );

  // 2) 해당 거래처의 전산 전체 출고량 vs 정면/단면(label_end) 확정 박스량 집계
  const custShipments = erpShipments.filter(
    (s) => Number(s.custKey) === Number(targetBox.custKey) || s.custName === targetBox.custName
  );
  const totalErpBoxesForCust = custShipments.reduce((acc, s) => acc + Number(s.erpBoxQty || 0), 0);

  const confirmedFrontBoxesForCust = allBoxes.filter(
    (b) =>
      b.status === 'COUNTED' &&
      (Number(b.custKey) === Number(targetBox.custKey) || b.custName === targetBox.custName) &&
      ((b.boxFace || 'label_end') === 'label_end' && (!b.ocrStatus || b.ocrStatus === 'confirmed'))
  );

  const candidates = buildUnreadableBoxSearchCandidates(targetBox, {
    allBoxes,
    erpShipments,
    productCatalog,
    searchQuery: '',
  });
  const topCand = candidates[0] || {
    custKey: targetBox.custKey || 533,
    custName: targetBox.custName || '주광농원',
    custCode: targetBox.custCode || 'YCL2',
    prodKey: targetBox.prodKey,
    prodName: targetBox.prodName,
    flowerName: targetBox.flowerName,
    unit: targetBox.unit || '송이',
    suggestedQtyPerBox: targetBox.qtyPerBox || 40,
    stemsPerBox: targetBox.stemsPerBox || targetBox.qtyPerBox || 40,
    invoiceNo: targetBox.invoiceNo || '1222993',
    awbNo: targetBox.awbNo || '180-9162-6441',
    orderWeek: targetBox.orderWeek || '47-02',
    farmName: targetBox.farmName || 'Holex',
    erpBoxQty: 1,
    remainingBoxes: 1,
  };

  if (crossPhotoBox) {
    const crossAngleLabel =
      crossPhotoBox.cameraAngle === 'left'
        ? '좌측면 사진'
        : crossPhotoBox.cameraAngle === 'right'
        ? '우측면 사진'
        : `측면 사진 #${crossPhotoBox.photoNumber}`;
    return {
      matchMethod: 'cross_angle_3side',
      methodBadge: '[3면 사진 교차 라벨 매칭]',
      crossAngleMatchedSerial: crossPhotoBox.serialNo,
      crossAnglePhotoNumber: crossPhotoBox.photoNumber,
      crossAnglePhotoAngle: crossPhotoBox.cameraAngle || 'right',
      exposedLabelSide: targetBox.exposedLabelSide || 'left',
      custKey: crossPhotoBox.custKey || targetBox.custKey,
      custName: crossPhotoBox.custName || targetBox.custName,
      custCode: crossPhotoBox.custCode || targetBox.custCode,
      prodKey: crossPhotoBox.prodKey,
      prodName: crossPhotoBox.prodName,
      flowerName: crossPhotoBox.flowerName,
      unit: crossPhotoBox.unit,
      qtyPerBox: Number(crossPhotoBox.qtyPerBox || targetBox.qtyPerBox || topCand.suggestedQtyPerBox),
      stemsPerBox: crossPhotoBox.stemsPerBox || targetBox.stemsPerBox || null,
      serialNo: crossPhotoBox.serialNo,
      invoiceNo: crossPhotoBox.invoiceNo || targetBox.invoiceNo || '1222993',
      awbNo: crossPhotoBox.awbNo || targetBox.awbNo || '180-9162-6441',
      orderWeek: crossPhotoBox.orderWeek || targetBox.orderWeek || '47-02',
      farmName: crossPhotoBox.farmName || targetBox.farmName || 'Holex',
      formulaText: `정면 지그재그 옆면(${targetBox.boxSpec}) ⇄ ${crossAngleLabel}(사진 #${crossPhotoBox.photoNumber}) 단면 라벨(${crossPhotoBox.serialNo}) 1:1 교차 결합 (이중 카운팅 제외)`,
      deductionReason: `정면 사진에서는 지그재그 적재로 긴 옆면만 노출되었으나, ${sideLabelName}을 촬영한 사진 #${crossPhotoBox.photoNumber}에서 단면 바코드 라벨(${crossPhotoBox.serialNo} · ${crossPhotoBox.prodName} ${crossPhotoBox.qtyPerBox}${crossPhotoBox.unit})이 확인되어 이중 카운팅 없이 1:1 결합`,
    };
  }

  // [주의] 임의 업로드 사진에서 업체·품목이 전혀 읽히지 않은 박스(custKey=0, prodKey=0)는
  // 가짜 품목을 자동 추론 후보(deductionCandidate)로 강제 부여하지 않고 사용자가 직접 검색 매칭하거나 패스하도록 null 반환
  if (!Number(targetBox.custKey) && !Number(targetBox.prodKey)) {
    return null;
  }

  const colorLabel =
    targetBox.boxColorProfile === 'holex-mint-flat'
      ? '민트색 가로형 HOLEX'
      : targetBox.boxColorProfile === 'holex-white-flat'
      ? '흰색 가로형 HOLEX'
      : targetBox.boxColorProfile === 'funza-kraft-brown'
      ? '크라프트 갈색 FUNZA / FLOWERS'
      : targetBox.boxColorProfile === 'sparkling-forest-green'
      ? '진녹색 SPARKLING FLOWERS / Colombia'
      : '흰색 세로형 HOLEX';

  return {
    matchMethod: 'erp_residual_elimination',
    methodBadge: '[전산 출고 원장 소거법 역산]',
    crossAngleMatchedSerial: targetBox.crossAngleMatchedSerial || null,
    crossAnglePhotoNumber: null,
    crossAnglePhotoAngle: null,
    exposedLabelSide: targetBox.exposedLabelSide || 'right',
    custKey: topCand.custKey || targetBox.custKey || 533,
    custName: topCand.custName || targetBox.custName || '주광농원',
    custCode: topCand.custCode || targetBox.custCode || 'YCL2',
    prodKey: topCand.prodKey,
    prodName: topCand.prodName,
    flowerName: topCand.flowerName,
    unit: topCand.unit,
    qtyPerBox: Number(targetBox.qtyPerBox || topCand.suggestedQtyPerBox || 40),
    stemsPerBox: targetBox.stemsPerBox || topCand.stemsPerBox || null,
    serialNo: targetBox.serialNo,
    invoiceNo: topCand.invoiceNo || targetBox.invoiceNo || '1222993',
    awbNo: topCand.awbNo || targetBox.awbNo || '180-9162-6441',
    orderWeek: topCand.orderWeek || targetBox.orderWeek || '47-02',
    farmName: topCand.farmName || targetBox.farmName || 'Holex',
    formulaText: `[전산 총출고 ${totalErpBoxesForCust}박스] - [정면 라벨단면 확인 ${confirmedFrontBoxesForCust.length}박스] = 지그재그 옆면 잔여 품목(${topCand.prodName} ${targetBox.qtyPerBox || topCand.suggestedQtyPerBox}${topCand.unit}) 확정`,
    deductionReason: `직육면체 지그재그 교차 적재로 라벨이 ${sideLabelName}으로 돌아가 정면에서 안 보이지만, [전산 출고 원장(ShipmentDetail) - 라벨 단면(label_end) 기확인 수량] 차감 소거법과 박스 외형(${colorLabel} · ${targetBox.stickerCode || targetBox.boxSpec}) 교차로 [${topCand.prodName} (${targetBox.qtyPerBox || topCand.suggestedQtyPerBox}${topCand.unit} · ${targetBox.serialNo})] 1순위 역산 확정`,
  };
}
