'use strict';
// Generated reference data, parsed once per worker. No network/SQL during a request.
const reference=require('../data/calendar-holidays.json');
function calendarHolidays(dates){
  const wanted=new Set(dates),years=new Set([...wanted].map(d=>d.slice(0,4)));
  return {countries:reference.countries,reviewedAt:reference.reviewedAt,source:reference.source,entries:[...years].flatMap(year=>reference.years[year]||[]).filter(row=>wanted.has(row.date))};
}
module.exports={calendarHolidays};
