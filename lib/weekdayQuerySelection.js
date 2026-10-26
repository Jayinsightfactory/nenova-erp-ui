export function stepWeekdayQuerySelection(value,direction) {
  if (String(value ?? '').trim()==='') return '1';
  const current=Number(value);
  if (!Number.isInteger(current)) return String(value ?? '');
  return String(Math.max(1,Math.min(53,current+(direction>0?1:-1))));
}

export function parseWeekdayQuerySelection(year,majorWeek) {
  if(!/^\d{4}$/.test(String(year)) || Number(year)<2000 || Number(year)>2200
    || !/^\d{1,2}$/.test(String(majorWeek)) || Number(majorWeek)<1 || Number(majorWeek)>53)
    throw new Error('연도(2000~2200)와 차수(1~53)를 선택하세요.');
  return {year:String(Number(year)),majorWeek:String(Number(majorWeek)).padStart(2,'0')};
}
