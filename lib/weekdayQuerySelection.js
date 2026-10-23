export function parseWeekdayQuerySelection(year,majorWeek) {
  if(!/^\d{4}$/.test(String(year)) || Number(year)<2000 || Number(year)>2200
    || !/^\d{1,2}$/.test(String(majorWeek)) || Number(majorWeek)<1 || Number(majorWeek)>53)
    throw new Error('연도(2000~2200)와 차수(1~53)를 선택하세요.');
  return {year:String(Number(year)),majorWeek:String(Number(majorWeek)).padStart(2,'0')};
}
