// 엑셀 업로드 수량 환산·이상 징후 탐지 (DB 의존 없음 — 단위 테스트용)
import { normalizeOrderUnit } from './orderUtils.js';

function asNumber(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function sameQty(a, b) {
  return Math.abs(asNumber(a) - asNumber(b)) < 0.0001;
}

export function importMatchNormText(value) {
  return String(value ?? '')
    .replace(/\s+/g, '')
    .replace(/[()（）\[\]{}]/g, '')
    .replace(/[△☆★※＋+]/g, '')
    .toLowerCase();
}

/** 수동 품목 매칭 키 — sheet|정규화품목명|품종 */
export function importProductOverrideKey(row) {
  return `${String(row?.sheetName || '').trim()}|${importMatchNormText(row?.productLabel)}|${row?.productFamily || ''}`;
}

export function classifyImportUnmatchedReason(hasCustomer, hasProduct) {
  if (!hasCustomer && !hasProduct) return { reason: '품목/업체 매칭 실패', matchKind: 'both' };
  if (!hasProduct) return { reason: '품목 매칭 실패', matchKind: 'product' };
  return { reason: '업체 매칭 실패', matchKind: 'customer' };
}

/**
 * 사후 검증(post-apply verification) 대상 (custKey,prodKey) 를 다시 한 번 합산·중복제거.
 * 같은 거래처+품목이 물량표에서 여러 출고일(요일) 열로 나뉘어 apply 대상 목록에 중복 키로
 * 들어와도(정상 — 같은 (custKey,prodKey) 는 한 ShipmentDetail 로 합산 반영되어야 함),
 * "합산 후 최종값" 하나로 intended 를 만들어야 실제 DB 합계와 같은 기준으로 비교할 수 있다.
 * 합산 없이 마지막 값만 남기면 정상 분배를 불일치로 오판(false mismatch)한다.
 * @param {Array<{custKey:number, prodKey:number, custName?:string, prodName?:string, intended:number}>} targets
 */
export function dedupeVerifyTargets(targets) {
  const byKey = new Map();
  for (const t of targets || []) {
    const custKey = Number(t?.custKey);
    const prodKey = Number(t?.prodKey);
    if (!custKey || !prodKey) continue;
    const key = `${custKey}|${prodKey}`;
    const intended = Number(t?.intended || 0);
    const prior = byKey.get(key);
    if (prior) {
      prior.intended += intended;
      if (!prior.custName && t.custName) prior.custName = t.custName;
      if (!prior.prodName && t.prodName) prior.prodName = t.prodName;
    } else {
      byKey.set(key, { custKey, prodKey, custName: t.custName, prodName: t.prodName, intended });
    }
  }
  return [...byKey.values()];
}

/**
 * 사후 검증 대조 순수 로직 — DB 재조회 결과(actualByKey)와 의도값(targets)을 같은 기준으로 비교.
 * targets 는 dedupeVerifyTargets 를 거친(=중복 출고일 열 합산 완료) 유일 (custKey,prodKey) 목록이어야 한다.
 * @param {Array<{custKey:number, prodKey:number, custName?:string, prodName?:string, intended:number}>} targets
 * @param {Map<string,{outQuantity:number, dateQty:number, dateIssueCount:number}>} actualByKey key=`${custKey}|${prodKey}`
 */
export function compareVerifyResult(targets, actualByKey) {
  const mismatches = [];
  let matched = 0;
  for (const t of targets || []) {
    const custKey = Number(t.custKey);
    const prodKey = Number(t.prodKey);
    const key = `${custKey}|${prodKey}`;
    const actual = actualByKey?.get?.(key) || { outQuantity: 0, dateQty: 0, dateIssueCount: 0 };
    const intended = Number(t.intended || 0);
    const actualOut = Number(actual.outQuantity || 0);
    const actualDateQty = Number(actual.dateQty || 0);
    const dateIssueCount = Number(actual.dateIssueCount || 0);
    const qtyMatches = sameQty(actualOut, intended);
    // 출고일(요일)별 ShipmentDate 합계가 OutQuantity 와 다르면(1 Detail + N Date 불변식 위반) 불일치로 잡는다.
    const dateSumMatches = actualOut <= 0.0001 || sameQty(actualDateQty, actualOut);
    if (qtyMatches && dateSumMatches && dateIssueCount === 0) {
      matched += 1;
      continue;
    }
    mismatches.push({
      custKey,
      custName: t.custName,
      prodKey,
      prodName: t.prodName,
      intended,
      actual: actualOut,
      dateQty: actualDateQty,
      dateIssueCount,
      reason: !qtyMatches
        ? '분배수량 불일치'
        : dateIssueCount > 0 || !dateSumMatches
          ? '출고일(ShipmentDate) 합계 불일치'
          : '확인필요',
    });
  }
  return {
    checked: (targets || []).length,
    matched,
    mismatchCount: mismatches.length,
    mismatches,
  };
}

/**
 * (custKey, prodKey) DB 조합이 "이번 업로드가 다뤄야 했던 범위" 안인지 판정 — missingFromExcel 게이트.
 * uploadedProductKeys 만 쓰면 "품목 행 자체를 시트에서 통째로 삭제"했을 때 그 시트 어디서도
 * 텍스트 매칭이 안 돼 게이트를 못 넘고 유령 분배가 그대로 남는다.
 * 키맵(_keymap)이 있으면 export 시점 워크북 전체 범위(custKeysInScope/prodKeysInScope)를 함께 써서
 * 라벨 텍스트가 지금 사라졌어도(행 삭제) 범위 판정이 가능하게 한다.
 * @param {number} custKey
 * @param {number} prodKey
 * @param {Set<number>} uploadedProductKeys 실제 텍스트 매칭에 성공한 prodKey 집합
 * @param {Set<number>} [custKeysInScope] 키맵 기반 이번 워크북의 전체 custKey 범위
 * @param {Set<number>} [prodKeysInScope] 키맵 기반 이번 워크북의 전체 prodKey 범위
 */
export function isImportRowInUploadScope(custKey, prodKey, uploadedProductKeys, custKeysInScope, prodKeysInScope) {
  const pk = Number(prodKey);
  const ck = Number(custKey);
  if (uploadedProductKeys?.has?.(pk)) return true;
  const scopedProd = prodKeysInScope instanceof Set ? prodKeysInScope : null;
  const scopedCust = custKeysInScope instanceof Set ? custKeysInScope : null;
  if (scopedProd?.has(pk) && scopedCust?.has(ck)) return true;
  return false;
}

/** 엑셀 적용 시 주문 동기화 여부 — 분배만 바뀌면 주문 삭제/수정하지 않음 */
export function resolveImportOrderSyncPlan({ orderQty, uploadQty }) {
  if (sameQty(orderQty, uploadQty)) {
    return { action: 'skip', allowOrderDelete: false };
  }
  if (Number(uploadQty || 0) > 0) {
    return { action: 'sync', allowOrderDelete: false };
  }
  return { action: 'skip_keep_order', allowOrderDelete: false };
}

export function isAlstroImportRow(row) {
  if (row?.sourceType === 'weekPivot') return false;
  return row?.productFamily === 'alstroemeria' || /알스트로|alstroe?meria/i.test(`${row?.sheetName || ''} ${row?.productLabel || ''}`);
}

/** 콜롬비아 카네이션 물량표 등 — 셀 값이 박스 (장미 물량표는 단) */
export function isBoxAllocationImportSheet(row, product = {}) {
  const text = [
    row?.sheetName,
    product?.CountryFlower,
    product?.CounName,
    product?.FlowerName,
  ].filter(Boolean).join(' ');
  return /콜롬비아\s*카네|콜롬비아카네이션|colombia\s*carnation/i.test(text);
}

/** 장미·카네이션 물량표(업체별 열): 기본은 단→박스 환산. 콜롬비아카네이션·주문수량 일치 시 박스. */
export function isBunchAllocationImportRow(row, product = {}) {
  if (row?.sourceType === 'weekPivot') return false;
  if (isAlstroImportRow(row)) return false;
  if (isBoxAllocationImportSheet(row, product)) return false;
  const text = [
    row?.productFamily,
    row?.sheetName,
    row?.productLabel,
    product?.ProdName,
    product?.DisplayName,
    product?.FlowerName,
    product?.CountryFlower,
  ].filter(Boolean).join(' ');
  if (/수국|hydrangea|알스트로|alstroe?meria/i.test(text)) return false;
  if (row?.productFamily === 'rose' || row?.productFamily === 'carnation' || row?.productFamily === 'minicarnation') {
    return true;
  }
  return /장미|\brose\b|카네|carnation|minicarnation|mini\s*카네/i.test(text);
}

/** @deprecated use isBunchAllocationImportRow */
export function isRoseAllocationImportRow(row, product = {}) {
  return isBunchAllocationImportRow(row, product);
}

export function toOrderUnits(qty, unit, product = {}) {
  const b1b = Number(product.BunchOf1Box || 0);
  const s1b = Number(product.SteamOf1Box || 0);
  const outUnit = normalizeOrderUnit(product.OutUnit, unit || '박스');
  const displayUnit = normalizeOrderUnit(unit, outUnit);

  let box = 0;
  let bunch = 0;
  let steam = 0;
  if (displayUnit === '단') {
    bunch = qty;
    box = b1b > 0 ? qty / b1b : 0;
    steam = box > 0 && s1b > 0 ? box * s1b : 0;
  } else if (displayUnit === '송이') {
    steam = qty;
    box = s1b > 0 ? qty / s1b : 0;
    bunch = box > 0 && b1b > 0 ? box * b1b : 0;
  } else {
    box = qty;
    bunch = b1b > 0 ? qty * b1b : 0;
    steam = s1b > 0 ? qty * s1b : 0;
  }

  const outQty = outUnit === '단' ? bunch : outUnit === '송이' ? steam : box;
  return { box, bunch, steam, outQty };
}

/** 장미 물량표(단) vs 박스 물량표 — 주문·분배 수량과 맞는 해석 선택 */
function resolveBunchOrBoxUploadQty(raw, row, product) {
  const b1b = Number(product.BunchOf1Box || 0);
  const asBox = raw;
  const asFromBunch = b1b > 0 ? toOrderUnits(raw, '단', product).outQty : raw;

  const baselines = [
    asNumber(row?.orderQty),
    asNumber(row?.currentOutQty),
    normalizedExcelOrderQty(row, product),
  ].filter(v => v > 0);

  if (baselines.length === 0) {
    return asFromBunch;
  }

  for (const b of baselines) {
    if (sameQty(asBox, b)) return asBox;
    if (sameQty(asFromBunch, b)) return asFromBunch;
  }

  let best = asFromBunch;
  let bestErr = Infinity;
  for (const cand of [asBox, asFromBunch]) {
    for (const b of baselines) {
      const err = Math.abs(cand - b) / b;
      if (err < bestErr) {
        bestErr = err;
        best = cand;
      }
    }
  }
  return bestErr <= 0.05 ? best : asFromBunch;
}

/** 엑셀 셀 수량 → 품목 OutUnit 기준 수량 (차수피벗 단위열·알스트로 16배 반영) */
export function normalizeUploadQtyForProduct(row, product = {}) {
  const raw = asNumber(row?.excelQty ?? row?.uploadQty);
  if (!raw) return 0;
  if (isAlstroImportRow(row)) return raw * 16;

  const excelUnit = String(row?.excelUnit || row?.outUnit || '').trim();
  if (excelUnit) {
    const excelU = normalizeOrderUnit(excelUnit, product?.OutUnit || '박스');
    const outU = normalizeOrderUnit(product?.OutUnit, '박스');
    if (excelU !== outU) {
      return toOrderUnits(raw, excelU, product).outQty;
    }
    return raw;
  }

  const outU = normalizeOrderUnit(product?.OutUnit, '박스');
  const b1b = Number(product.BunchOf1Box || 0);

  if (isBoxAllocationImportSheet(row, product)) {
    return raw;
  }

  if (outU === '박스' && b1b > 0 && isBunchAllocationImportRow(row, product)) {
    return resolveBunchOrBoxUploadQty(raw, row, product);
  }

  return raw;
}

export function normalizedExcelOrderQty(row, product = {}) {
  const raw = asNumber(row?.excelOrderQtyRaw ?? row?.excelOrderQty ?? 0);
  if (!raw) return 0;
  return normalizeUploadQtyForProduct(
    {
      ...row,
      excelQty: raw,
      uploadQty: raw,
    },
    product
  );
}

const SUSPECT_RATIOS = [10, 15, 16, 30, 5, 20, 25, 0.1, 0.0625, 0.2, 0.0667];

function pushRatioWarnings(warnings, upload, baseline, label, seenCodes) {
  if (!(baseline > 0)) return;
  const ratio = upload / baseline;
  for (const m of SUSPECT_RATIOS) {
    const tol = m < 1 ? 0.04 : 0.03;
    if (Math.abs(ratio - m) / m >= tol) continue;
    const code = `SUSPECT_RATIO:${label}:${m}`;
    if (seenCodes.has(code)) continue;
    seenCodes.add(code);
    warnings.push({
      severity: 'critical',
      code: 'SUSPECT_RATIO',
      ratio: m,
      baselineLabel: label,
      message: m >= 1
        ? `엑셀 환산 수량(${upload})이 ${label}(${baseline}) 대비 약 ${m}배입니다. 박스/단/송이 단위 오류를 확인하세요.`
        : `엑셀 환산 수량(${upload})이 ${label}(${baseline}) 대비 약 1/${Math.round(1 / m)}배입니다. 단위 오류를 확인하세요.`,
    });
    break;
  }
}

function pushBunchPerBoxWarnings(warnings, upload, baseline, label, product, seenCodes) {
  if (!(baseline > 0)) return;
  const b1b = Number(product.BunchOf1Box || 0);
  const s1b = Number(product.SteamOf1Box || 0);
  const r = upload / baseline;
  if (b1b > 1 && Math.abs(r - b1b) / b1b < 0.03) {
    const code = `BUNCH_PER_BOX:${label}`;
    if (!seenCodes.has(code)) {
      seenCodes.add(code);
      warnings.push({
        severity: 'critical',
        code: 'BUNCH_PER_BOX',
        message: `${label}(${baseline}) 대비 변경 비율이 박스당 ${b1b}단과 일치합니다. 엑셀 단(묶음)을 박스로 읽었을 수 있습니다.`,
      });
    }
  }
  if (s1b > 1 && Math.abs(r - s1b) / s1b < 0.03) {
    const code = `STEAM_PER_BOX:${label}`;
    if (!seenCodes.has(code)) {
      seenCodes.add(code);
      warnings.push({
        severity: 'critical',
        code: 'STEAM_PER_BOX',
        message: `${label}(${baseline}) 대비 변경 비율이 박스당 ${s1b}송이와 일치합니다. 송이·박스 혼동을 확인하세요.`,
      });
    }
  }
}

/** 엑셀 업로드 수량 이상 징후 (10배·단위 혼동 등) — 적용 전 검증용 */
export function detectQtyWarnings(row, product = {}) {
  const warnings = [];
  const upload = Number(row.uploadQty) || 0;
  if (upload <= 0) return warnings;

  const order = Number(row.orderQty) || 0;
  const current = Number(row.currentOutQty) || 0;
  const excelOrder = normalizedExcelOrderQty(row, product);
  const excelQty = asNumber(row.excelQty);
  const excelUnit = String(row.excelUnit || row.outUnit || '').trim();
  const b1b = Number(product.BunchOf1Box || 0);
  const outU = normalizeOrderUnit(product?.OutUnit, '박스');
  const seenCodes = new Set();

  const baselines = [];
  if (excelOrder > 0) baselines.push({ value: excelOrder, label: '엑셀주문수량' });
  if (order > 0) baselines.push({ value: order, label: '주문등록' });
  if (current > 0) baselines.push({ value: current, label: '현재분배' });

  for (const baseline of baselines) {
    pushRatioWarnings(warnings, upload, baseline.value, baseline.label, seenCodes);
    pushBunchPerBoxWarnings(warnings, upload, baseline.value, baseline.label, product, seenCodes);
  }

  if (excelUnit) {
    const excelU = normalizeOrderUnit(excelUnit, product?.OutUnit || '박스');
    if (excelU === '단' && outU === '박스' && b1b > 1 && sameQty(upload, excelQty)) {
      warnings.push({
        severity: 'critical',
        code: 'UNIT_NOT_CONVERTED',
        message: `엑셀 ${excelQty}단이 박스 환산 없이 ${upload}박스로 읽혔습니다. (박스당 ${b1b}단)`,
      });
    } else if (excelU !== outU && row.excelQty != null) {
      warnings.push({
        severity: 'info',
        code: 'UNIT_CONVERTED',
        message: `엑셀 ${excelU} ${row.excelQty} → 출고단위 ${outU} ${upload} 환산 적용`,
      });
    }
  } else if (
    outU === '박스' &&
    b1b > 1 &&
    excelQty > 0 &&
    isBunchAllocationImportRow(row, product) &&
    !sameQty(upload, excelQty)
  ) {
    warnings.push({
      severity: 'info',
      code: 'BUNCH_ALLOC_CONVERTED',
      message: `물량표 ${excelQty}단 → ${upload}박스 환산 (박스당 ${b1b}단)`,
    });
  } else if (outU === '박스' && b1b > 1 && sameQty(upload, excelQty) && excelQty >= b1b) {
    const asBoxes = excelQty / b1b;
    for (const baseline of baselines) {
      if (baseline.value > 0 && Math.abs(asBoxes - baseline.value) / baseline.value < 0.05) {
        warnings.push({
          severity: 'critical',
          code: 'IMPLICIT_BUNCH',
          message: `엑셀 ${excelQty}이 ${b1b}단/박스 기준 ${asBoxes}박스와 같습니다. 단(묶음)을 박스로 읽었을 수 있습니다.`,
        });
        break;
      }
    }
  }

  const cells = row.cells || [];
  if (cells.length > 1) {
    warnings.push({
      severity: 'warn',
      code: 'MERGED_CELLS',
      message: `${cells.length}개 셀 합산. 중복 입력 여부 확인 (${cells.slice(0, 2).join(', ')})`,
    });
  }

  return warnings;
}

export function hasCriticalQtyWarnings(rows) {
  return (rows || []).some((r) => (r.qtyWarnings || []).some((w) => w.severity === 'critical'));
}

function median(values) {
  const nums = values.filter((v) => Number(v) > 0).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

/** 같은 품목·다른 업체 수량 대비 10배 이상 튀는 행 (물량표 형식 — DB 기준선 없을 때) */
export function appendPeerQtyWarnings(previewRows) {
  const byProd = new Map();
  for (const row of previewRows || []) {
    const upload = Number(row.uploadQty) || 0;
    if (!upload || !row.prodKey) continue;
    const pk = Number(row.prodKey);
    if (!byProd.has(pk)) byProd.set(pk, []);
    byProd.get(pk).push(row);
  }

  for (const rows of byProd.values()) {
    if (rows.length < 2) continue;
    for (const row of rows) {
      if (row.hasQtyWarning) continue;
      const upload = Number(row.uploadQty) || 0;
      const peerQtys = rows
        .filter((x) => x.key !== row.key)
        .map((x) => Number(x.uploadQty) || 0)
        .filter((q) => q > 0);
      if (peerQtys.length < 1) continue;
      const peerMed = median(peerQtys);
      if (!(peerMed > 0)) continue;
      const ratio = upload / peerMed;
      const peerRatios = [
        { m: 10, min: 8, max: 12 },
        { m: 15, min: 12, max: 18 },
        { m: 16, min: 13, max: 19 },
        { m: 5, min: 4, max: 6 },
      ];
      for (const { m, min, max } of peerRatios) {
        if (ratio < min || ratio > max) continue;
        const warnings = row.qtyWarnings || [];
        warnings.push({
          severity: 'critical',
          code: 'PEER_OUTLIER',
          ratio: m,
          message: `동일 품목 다른 업체 중앙값(${peerMed}) 대비 약 ${m}배(${upload})입니다. ${row.custName} 수량·단위를 확인하세요.`,
        });
        row.qtyWarnings = warnings;
        row.hasQtyWarning = true;
        break;
      }
    }
  }
  return previewRows;
}

/**
 * 같은 업체·다른 품목(박스단위) 대비 박스당 단수(BunchOf1Box)배로 튀는 행.
 * DB·엑셀 주문이 모두 10배로 틀어졌고(재업로드) 그 품목을 그 업체만 주문해
 * prodKey peer 가 없을 때(주광 단독주문) — 같은 업체의 다른 장미 박스수와 비교해 잡는다.
 * productByKey: Map<prodKey, product> 또는 { [prodKey]: product } (BunchOf1Box 조회용).
 */
export function appendCustomerPeerQtyWarnings(previewRows, productByKey) {
  const getProduct = (pk) => {
    if (!productByKey) return null;
    return typeof productByKey.get === 'function' ? productByKey.get(Number(pk)) : productByKey[Number(pk)];
  };

  const byCust = new Map();
  for (const row of previewRows || []) {
    const upload = Number(row.uploadQty) || 0;
    if (!upload || !row.custKey) continue;
    if (normalizeOrderUnit(row.outUnit, '박스') !== '박스') continue;
    const ck = Number(row.custKey);
    if (!byCust.has(ck)) byCust.set(ck, []);
    byCust.get(ck).push(row);
  }

  for (const rows of byCust.values()) {
    if (rows.length < 3) continue;
    for (const row of rows) {
      if (row.hasQtyWarning) continue;
      const b1b = Number(getProduct(row.prodKey)?.BunchOf1Box || 0);
      if (!(b1b > 1)) continue;
      const upload = Number(row.uploadQty) || 0;
      const peerQtys = rows
        .filter((x) => x.key !== row.key)
        .map((x) => Number(x.uploadQty) || 0)
        .filter((q) => q > 0);
      if (peerQtys.length < 2) continue;
      const peerMed = median(peerQtys);
      if (!(peerMed > 0)) continue;
      const ratio = upload / peerMed;
      if (Math.abs(ratio - b1b) / b1b >= 0.15) continue;
      const warnings = row.qtyWarnings || [];
      warnings.push({
        severity: 'critical',
        code: 'CUST_PEER_BUNCH',
        ratio: b1b,
        message: `${row.custName} 다른 품목 박스 중앙값(${peerMed}) 대비 약 ${Math.round(ratio)}배(${upload})입니다. 박스당 ${b1b}단을 박스로 읽었을 수 있습니다. 단위를 확인하세요.`,
      });
      row.qtyWarnings = warnings;
      row.hasQtyWarning = true;
    }
  }
  return previewRows;
}
