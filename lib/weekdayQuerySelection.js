export function stepWeekdayQuerySelection(value,direction) {
  if (String(value ?? '').trim()==='') return '';
  const current=Number(value);
  if (!Number.isInteger(current)) return String(value ?? '');
  return String(Math.max(1,Math.min(53,current+(direction>0?1:-1))));
}

export async function loadWeekdayEntryDefault({fetchFn=fetch,now=new Date(),signal}={}) {
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'})
    .formatToParts(now).reduce((parts,part)=>({...parts,[part.type]:part.value}),{});
  const response=await fetchFn(`/api/estimate/weekday-calendar?defaultNext=1&date=${date.year}-${date.month}-${date.day}`,
    {credentials:'include',cache:'no-store',signal});
  const result=await response.json();
  if(!response.ok || result.success!==true || result.readOnly!==true) throw new Error('기본 차수를 불러오지 못했습니다. 차수를 직접 입력한 뒤 조회하세요.');
  return parseWeekdayQuerySelection(result.scope?.year,result.scope?.majorWeek);
}

export function parseWeekdayQuerySelection(year,majorWeek) {
  if(!/^\d{4}$/.test(String(year)) || Number(year)<2000 || Number(year)>2200
    || !/^\d{1,2}$/.test(String(majorWeek)) || Number(majorWeek)<1 || Number(majorWeek)>53)
    throw new Error('연도(2000~2200)와 차수(1~53)를 선택하세요.');
  return {year:String(Number(year)),majorWeek:String(Number(majorWeek)).padStart(2,'0')};
}
