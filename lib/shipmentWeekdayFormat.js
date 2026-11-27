import pivotVolumeColors from './pivotVolumeColors.cjs';

const { getDayColor, getRegionColor } = pivotVolumeColors;

export const KO_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const WEEKDAY_DISPLAY_ORDER = ['목', '금', '토', '일', '월', '화', '수', '미지정'];

/**
 * Timezone-safe YYYY-MM-DD parser that extracts calendar year/month/day directly
 * without local timezone offset drift and pairs it with PR #2061's unified DAY_COLORS.
 */
export function parseShipmentDateMeta(rawDate) {
  if (rawDate instanceof Date && !Number.isNaN(rawDate.getTime())) {
    const iso = rawDate.toISOString().slice(0, 10);
    return parseShipmentDateMeta(iso);
  }
  const text = String(rawDate ?? '').trim();
  const m = text.match(/^(\d{4})[-./](\d{2})[-./](\d{2})/);
  if (!m) {
    const fallback = getDayColor('미지정');
    return {
      isoDate: '',
      shortDate: '미지정',
      weekday: '미지정',
      weekdayFull: '출고일 미지정',
      unassigned: true,
      dayColor: {
        fill: `#${fallback.fill}`,
        ink: `#${fallback.ink}`,
      },
    };
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(utcDate.getTime()) ||
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    const fallback = getDayColor('미지정');
    return {
      isoDate: '',
      shortDate: '미지정',
      weekday: '미지정',
      weekdayFull: '출고일 미지정',
      unassigned: true,
      dayColor: {
        fill: `#${fallback.fill}`,
        ink: `#${fallback.ink}`,
      },
    };
  }
  const isoDate = `${m[1]}-${m[2]}-${m[3]}`;
  const shortDate = `${m[2]}-${m[3]}`;
  const weekday = KO_WEEKDAYS[utcDate.getUTCDay()];
  const palette = getDayColor(weekday);
  return {
    isoDate,
    shortDate,
    weekday,
    weekdayFull: `${weekday}요일`,
    unassigned: false,
    dayColor: {
      fill: `#${palette.fill}`,
      ink: `#${palette.ink}`,
    },
  };
}

export function getShipmentRegionStyle(rawRegion) {
  const label = String(rawRegion ?? '').trim() || '지역 미등록';
  const lookup = label === '지역 미등록' || label === '미지정' ? '기타' : label;
  const palette = getRegionColor(lookup);
  return {
    label,
    fill: `#${palette.fill}`,
    ink: `#${palette.ink}`,
  };
}

export function formatShipmentDateWithWeekday(rawDate, { short = false } = {}) {
  const meta = parseShipmentDateMeta(rawDate);
  if (meta.unassigned) return '출고일 미지정';
  return `${short ? meta.shortDate : meta.isoDate} (${meta.weekday})`;
}

/**
 * Aggregates `{ date, qty }` allocations by calendar date in chronological order,
 * preserving unassigned positive quantities if any detail lacks a date.
 */
export function summarizeShipmentDates(entries = []) {
  const byDate = new Map();
  for (const item of Array.isArray(entries) ? entries : []) {
    if (!item) continue;
    const rawDate = typeof item === 'string' ? item : (item.date ?? item.isoDate ?? item.shipDate ?? '');
    const qtyNum = typeof item === 'object' && item.qty != null ? Number(item.qty) || 0 : 0;
    const meta = parseShipmentDateMeta(rawDate);
    const key = meta.unassigned ? '__UNASSIGNED__' : meta.isoDate;
    if (!byDate.has(key)) {
      byDate.set(key, {
        isoDate: meta.isoDate,
        shortDate: meta.shortDate,
        weekday: meta.weekday,
        weekdayFull: meta.weekdayFull,
        unassigned: meta.unassigned,
        dayColor: meta.dayColor,
        qty: 0,
      });
    }
    const slot = byDate.get(key);
    slot.qty = Math.round((slot.qty + qtyNum) * 10000) / 10000;
  }

  return [...byDate.values()].sort((a, b) => {
    if (a.unassigned !== b.unassigned) return a.unassigned ? 1 : -1;
    return a.isoDate.localeCompare(b.isoDate);
  });
}
