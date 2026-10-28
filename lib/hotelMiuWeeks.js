// Shared browser-safe sales period choices.
export const HOTEL_MIU_FORWARD_MAJOR_COUNT = 9;

function calendarMajorWeek(now = new Date()) {
  const date = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const year = date.getFullYear();
  const start = new Date(year, 0, 1);
  const dayOfYear = Math.floor((date - start) / 86400000) + 1;
  return { year, major: Math.min(52, Math.max(1, Math.ceil(dayOfYear / 7))) };
}

function shiftHotelMiuMajor(year, major, delta) {
  let nextYear = Number(year);
  let nextMajor = Number(major) + Number(delta);
  while (nextMajor > 52) { nextMajor -= 52; nextYear += 1; }
  while (nextMajor < 1) { nextMajor += 52; nextYear -= 1; }
  return { year: nextYear, major: nextMajor };
}

/** 영업 발주는 달력 대차수보다 한 차수 앞서 입력하며, 기본부터 +9까지 고른다. */
export function hotelMiuMajorWeekOptions(now = new Date(), forwardMajorCount = HOTEL_MIU_FORWARD_MAJOR_COUNT, backwardMajorCount = 0) {
  const calendar = calendarMajorWeek(now);
  const base = shiftHotelMiuMajor(calendar.year, calendar.major, 1);
  const count = Math.min(20, Math.max(0, Number(forwardMajorCount) || 0));
  const back = Math.min(20, Math.max(0, Number(backwardMajorCount) || 0));
  return Array.from({ length: back + count + 1 }, (_, index) => {
    const offset = index - back;
    const shifted = shiftHotelMiuMajor(base.year, base.major, offset);
    return {
      year: String(shifted.year),
      major: shifted.major,
      majorText: String(shifted.major).padStart(2, '0'),
      label: `${shifted.year !== base.year ? `${String(shifted.year).slice(2)}년 ` : ''}${shifted.major}${offset === 0 ? ' 기본' : ` ${offset > 0 ? '+' : ''}${offset}`}`,
      offset,
      isDefault: offset === 0,
    };
  });
}
