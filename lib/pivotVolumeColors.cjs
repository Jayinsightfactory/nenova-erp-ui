'use strict';

// Single source of truth for pivot-volume / field-volume weekday & region colors.
// Keep 6-char uppercase RGB hex strings; pastel fills pair with high-contrast dark inks.
const DAY_COLORS = {
  '목': { fill: 'FCE4D6', ink: '7C2D12' },
  '금': { fill: 'FFF2CC', ink: '713F12' },
  '토': { fill: 'E2F0D9', ink: '14532D' },
  '일': { fill: 'DDEBF7', ink: '1E3A8A' },
  '화': { fill: 'E4DFEC', ink: '4C1D95' },
  '수': { fill: 'F4CCCC', ink: '881337' },
  '월': { fill: 'D9EAF7', ink: '0C4A6E' },
  '미지정': { fill: 'E8EEF4', ink: '334155' },
};

const DEFAULT_DAY_COLOR = DAY_COLORS['미지정'];
const MONOCHROME_DEFAULT_FILLS = new Set(['', 'D9E6F2', 'E8EEF4', 'DCE6F2', 'FFFFFF']);

const REGION_COLORS = {
  '경부선주광': { fill: 'FEF3C7', ink: '846000' },
  '경부선': { fill: 'DCFCE7', ink: '23713D' },
  '양재동': { fill: 'DBEAFE', ink: '1658A0' },
  '지방': { fill: 'FFEDD5', ink: '9E470D' },
  '호남선': { fill: 'F3E8FF', ink: '753E91' },
  '호텔': { fill: 'CCFBF1', ink: '167469' },
  '강남': { fill: 'FCE7F3', ink: '9D174D' },
  '기타': { fill: 'E2E8F0', ink: '334155' },
};

const REGION_FALLBACK_PALETTE = [
  { fill: 'E0F2FE', ink: '075985' },
  { fill: 'FEF9C3', ink: '854D0E' },
  { fill: 'EDE9FE', ink: '5B21B6' },
  { fill: 'FFE4E6', ink: '9F1239' },
  { fill: 'D1FAE5', ink: '065F46' },
  { fill: 'FFEDD5', ink: '9A3412' },
  { fill: 'E0E7FF', ink: '3730A3' },
  { fill: 'F1F5F9', ink: '334155' },
];

function normalizeDayKey(day) {
  return String(day ?? '').trim().replace(/요일$/, '');
}

function normalizeRegionKey(region) {
  return String(region ?? '').replace(/[\s_]+/g, '').trim();
}

function getDayColor(day) {
  const key = normalizeDayKey(day);
  const hit = DAY_COLORS[key];
  return hit ? { ...hit } : { ...DEFAULT_DAY_COLOR };
}

function isMonochromeDefaultFill(hex) {
  let normalized = String(hex ?? '').trim().replace(/^#/, '').toUpperCase();
  if (/^[0-9A-F]{8}$/.test(normalized)) {
    normalized = normalized.slice(2);
  }
  return MONOCHROME_DEFAULT_FILLS.has(normalized);
}

function getRegionColor(region) {
  const key = normalizeRegionKey(region);
  if (!key) return { ...REGION_COLORS['기타'] };
  if (Object.prototype.hasOwnProperty.call(REGION_COLORS, key)) {
    return { ...REGION_COLORS[key] };
  }
  // Deterministic FNV-1a hash so any custom region always maps to the exact same color.
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const slot = REGION_FALLBACK_PALETTE[(hash >>> 0) % REGION_FALLBACK_PALETTE.length];
  return { ...slot };
}

module.exports = {
  DAY_COLORS,
  REGION_COLORS,
  REGION_FALLBACK_PALETTE,
  normalizeDayKey,
  normalizeRegionKey,
  getDayColor,
  getRegionColor,
  isMonochromeDefaultFill,
};
