// 엑셀 업로드 수량 환산·이상 징후 탐지 (DB 의존 없음 — 단위 테스트용)
import { normalizeOrderUnit } from './orderUtils.js';

function asNumber(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

export function isAlstroImportRow(row) {
  if (row?.sourceType === 'weekPivot') return false;
  return row?.productFamily === 'alstroemeria' || /알스트로|alstroe?meria/i.test(`${row?.sheetName || ''} ${row?.productLabel || ''}`);
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
  }
  return raw;
}

const SUSPECT_RATIOS = [10, 16, 30, 5, 20, 25, 0.1, 0.0625, 0.2];

/** 엑셀 업로드 수량 이상 징후 (10배·단위 혼동 등) — 적용 전 검증용 */
export function detectQtyWarnings(row, product = {}) {
  const warnings = [];
  const upload = Number(row.uploadQty) || 0;
  if (upload <= 0) return warnings;

  const order = Number(row.orderQty) || 0;
  const current = Number(row.currentOutQty) || 0;
  const baseline = order > 0 ? order : current;

  if (baseline > 0) {
    const ratio = upload / baseline;
    for (const m of SUSPECT_RATIOS) {
      const tol = m < 1 ? 0.04 : 0.03;
      if (Math.abs(ratio - m) / m < tol) {
        warnings.push({
          severity: 'critical',
          code: 'SUSPECT_RATIO',
          ratio: m,
          message: m >= 1
            ? `엑셀 환산 수량(${upload})이 기존(${baseline}) 대비 약 ${m}배입니다. 박스/단/송이 단위 오류를 확인하세요.`
            : `엑셀 환산 수량(${upload})이 기존(${baseline}) 대비 약 1/${Math.round(1 / m)}배입니다. 단위 오류를 확인하세요.`,
        });
        break;
      }
    }
  }

  const b1b = Number(product.BunchOf1Box || 0);
  const s1b = Number(product.SteamOf1Box || 0);
  if (baseline > 0 && b1b > 1) {
    const r = upload / baseline;
    if (Math.abs(r - b1b) / b1b < 0.03) {
      warnings.push({
        severity: 'critical',
        code: 'BUNCH_PER_BOX',
        message: `변경 비율이 박스당 ${b1b}단과 일치합니다. 엑셀 단(묶음)을 박스로 읽었을 수 있습니다.`,
      });
    }
  }
  if (baseline > 0 && s1b > 1) {
    const r = upload / baseline;
    if (Math.abs(r - s1b) / s1b < 0.03) {
      warnings.push({
        severity: 'critical',
        code: 'STEAM_PER_BOX',
        message: `변경 비율이 박스당 ${s1b}송이와 일치합니다. 송이·박스 혼동을 확인하세요.`,
      });
    }
  }

  const excelUnit = String(row.excelUnit || row.outUnit || '').trim();
  if (excelUnit && product?.OutUnit) {
    const excelU = normalizeOrderUnit(excelUnit, product.OutUnit);
    const outU = normalizeOrderUnit(product.OutUnit, '박스');
    if (excelU !== outU && row.excelQty != null) {
      warnings.push({
        severity: 'info',
        code: 'UNIT_CONVERTED',
        message: `엑셀 ${excelU} ${row.excelQty} → 출고단위 ${outU} ${upload} 환산 적용`,
      });
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
