'use strict';

function isFractionalQty(qty) {
  if (qty === null || qty === undefined || qty === '') return false;
  const num = Number(qty);
  return Number.isFinite(num) && Math.abs(num - Math.round(num)) > 1e-6;
}

function formatDecimalQty(qty) {
  const num = Number(qty);
  if (!Number.isFinite(num)) return '';
  const rounded = Number(num.toFixed(2));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function snapUnit(val) {
  const rounded = Math.round(val);
  if (Math.abs(val - rounded) <= 0.06 && rounded >= 1) return rounded;
  return Math.round(val * 10) / 10;
}

function knownBoxFamilyFallback(flower) {
  if (!flower) return 0;
  if (/미니\s*카네이션|mini\s*carnation|minicarnation/i.test(flower)) return 30;
  if (/카네이션|carnation/i.test(flower)) return 15;
  if (/루스커스|ruscus/i.test(flower)) return 25;
  if (/장미|\brose\b/i.test(flower)) return 10;
  if (/알스트로|alstro/i.test(flower)) return 16;
  return 0;
}

function convertFractionalToUnit(qty, productMeta = {}) {
  if (!isFractionalQty(qty)) return null;
  const meta = productMeta || {};
  const outUnit = String(meta.unit ?? meta.outUnit ?? meta.OutUnit ?? '').trim();
  let b1b = Number(meta.bunchOf1Box ?? meta.BunchOf1Box ?? 0) || 0;
  const s1b = Number(meta.steamOf1Bunch ?? meta.SteamOf1Bunch ?? 0) || 0;
  const s1box = Number(meta.steamOf1Box ?? meta.SteamOf1Box ?? 0) || 0;
  const flower = String(meta.flower || meta.family || meta.label || meta.prodName || '').trim();

  const num = Number(qty);
  const absQty = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  const whole = Math.trunc(absQty);
  const frac = absQty - whole;
  const displayQty = formatDecimalQty(num);

  // Case A: 수국 (flower match) OR box unit with only SteamOf1Box (no BunchOf1Box)
  if (outUnit !== '단' && outUnit !== '송이' && (/수국|hydrangea/i.test(flower) || (outUnit === '박스' && b1b <= 0 && s1box > 0))) {
    const perBox = s1box > 0 ? s1box : 30;
    const stems = snapUnit(frac * perBox);
    const label = whole > 0 ? `${sign}${whole}박스 ${stems}송이` : `${sign}${stems}송이`;
    return { label, unit: '송이', displayQty };
  }

  // Case B: 박스 기준 품목
  if (outUnit === '박스' || (!outUnit && (b1b > 0 || s1box > 0))) {
    if (b1b <= 0) b1b = knownBoxFamilyFallback(flower);
    if (b1b > 0) {
      const bunches = snapUnit(frac * b1b);
      const label = whole > 0 ? `${sign}${whole}박스 ${bunches}단` : `${sign}${bunches}단`;
      return { label, unit: '단', displayQty };
    }
  }

  // Case C: 단 기준 품목
  if (outUnit === '단') {
    if (s1b > 0) {
      const stems = snapUnit(frac * s1b);
      const label = whole > 0 ? `${sign}${whole}단 ${stems}송이` : `${sign}${stems}송이`;
      return { label, unit: '송이', displayQty };
    }
    return { label: `${sign}${formatDecimalQty(absQty)}단`, unit: '단', displayQty };
  }

  // Case D: 송이 기준 품목
  if (outUnit === '송이') {
    return { label: `${sign}${formatDecimalQty(absQty)}송이`, unit: '송이', displayQty };
  }

  // Case E: Fallback when no unit/ratio available
  return null;
}

module.exports = {
  isFractionalQty,
  formatDecimalQty,
  snapUnit,
  convertFractionalToUnit,
};
