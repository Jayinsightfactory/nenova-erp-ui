// lib/pmTimesave.js
// /pm 업무 시간 계기판·기능 후보·직원 시간 탭 — runtime work-feature-timesave.json(사장님 PC measure-time.js 산출) 요약.
// 파일 전용·읽기 전용(MSSQL 무관). 수치는 관찰 표본 기반 추정치.
import { findPerson } from './pmStaff';

const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : 0);
const arr = (x) => (Array.isArray(x) ? x : []);

// {키:h} → [{name,h}] 내림차순, top 개 초과분은 '기타'로 합침
export function topBuckets(obj, top = 8) {
  const rows = Object.entries(obj && typeof obj === 'object' ? obj : {}).map(([name, h]) => ({ name, h: num(h) })).filter((r) => r.h > 0).sort((a, b) => b.h - a.h);
  if (rows.length <= top) return rows;
  const rest = rows.slice(top).reduce((a, r) => a + r.h, 0);
  return [...rows.slice(0, top), { name: '기타', h: num(rest) }];
}

export function timesaveSummary(ts) {
  if (!ts || typeof ts !== 'object') return null;
  return {
    generatedAt: ts.generatedAt || null, days: ts.days ?? null, method: ts.method || '',
    totals: { activeHoursPerWeek: num(ts.totals?.activeHoursPerWeek), assignedHoursPerWeek: num(ts.totals?.assignedHoursPerWeek), saveHoursPerWeek: num(ts.totals?.saveHoursPerWeek) },
    features: arr(ts.features).map((f) => ({ menu: f.menu || '', title: f.title || '', saveHoursPerWeek: num(f.saveHoursPerWeek), people: arr(f.people).map(String), workflows: arr(f.workflows).map(String) }))
      .sort((a, b) => b.saveHoursPerWeek - a.saveHoursPerWeek),
    unproposed: arr(ts.unproposed).map((u) => ({ person: u.person || '', name: u.name || '', measuredHoursPerWeek: num(u.measuredHoursPerWeek), saveHoursPerWeek: num(u.saveHoursPerWeek) }))
      .sort((a, b) => b.measuredHoursPerWeek - a.measuredHoursPerWeek),
  };
}

export function timesavePerson(ts, name) {
  const p = findPerson(ts?.people, name);
  if (!p) return null;
  return {
    name: p.name, dept: p.dept || '', workDays: p.workDays ?? null, generatedAt: ts.generatedAt || null, method: ts.method || '',
    activeHoursPerWeek: num(p.activeHoursPerWeek), assignedHoursPerWeek: num(p.assignedHoursPerWeek), saveHoursPerWeek: num(p.saveHoursPerWeek),
    workflows: arr(p.workflows).map((w) => ({
      name: w.name || '', measuredHoursPerWeek: num(w.measuredHoursPerWeek), saveRatio: Number(w.saveRatio) || 0, saveHoursPerWeek: num(w.saveHoursPerWeek), basis: w.basis || '',
      feature: w.feature ? { title: w.feature.title || '', menu: w.feature.menu || '' } : null,
    })).sort((a, b) => b.measuredHoursPerWeek - a.measuredHoursPerWeek),
    other: topBuckets(p.otherHoursPerWeek, 8),
    kakaoRooms: topBuckets(p.kakaoRoomsHoursPerWeek, 8),
    kakaoTypes: topBuckets(p.kakaoTypesHoursPerWeek, 8),
    erpScreens: topBuckets(p.erpScreensHoursPerWeek, 8),
  };
}
