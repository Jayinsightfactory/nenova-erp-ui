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

export function isAlstroImportRow(row) {
  if (row?.sourceType === 'weekPivot') return false;
  return row?.productFamily === 'alstroemeria' || /알스트로|alstroe?meria/i.test(`${row?.sheetName || ''} ${row?.productLabel || ''}`);
}

/** 장미·카네이션 물량표(업체별 열): 셀 값은 단, Product.OutUnit 은 박스 — 차수피벗(단위열)은 제외. 수국 등은 제외 */
export function isBunchAllocationImportRow(row, product = {}) {
  if (row?.sourceType === 'weekPivot') return false;
  if (isAlstroImportRow(row)) return false;
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
  if (outU === '박스' && b1b > 0 && isBunchAllocationImportRow(row, product)) {
    return toOrderUnits(raw, '단', product).outQty;
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
