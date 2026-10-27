'use strict';
const HOUR = 3600000;
const OFFSET = 9 * HOUR;
const LABEL = '평일 09:00~18:00 매 정시 (한국시간)';
function isSlot(ms) {
  const d = new Date(ms + OFFSET);
  return d.getUTCDay() >= 1 && d.getUTCDay() <= 5 && d.getUTCHours() >= 9 && d.getUTCHours() <= 18;
}
function previousSlot(now) {
  let ms = Math.floor(Number(now) / HOUR) * HOUR;
  while (!isSlot(ms)) ms -= HOUR;
  return ms;
}
function nextSlot(now) {
  let ms = (Math.floor(Number(now) / HOUR) + 1) * HOUR;
  while (!isSlot(ms)) ms += HOUR;
  return ms;
}
function dueSlot(now = Date.now(), lastAttempt = null, bootstrap = false) {
  const ms = Number(now);
  if (!Number.isFinite(ms)) return null;
  const slot = previousSlot(ms);
  // 정시 직후 단일 브라우저의 앞선 조회를 기다릴 수 있다. 누락 슬롯은 소급하지 않는다.
  const initial = bootstrap === true && lastAttempt === null && ms-slot < HOUR && new Date(ms+OFFSET).getUTCHours()<18;
  return (ms - slot < 5 * 60000 || initial) && slot > Number(lastAttempt ?? -1) ? slot : null;
}
function freshness(takenAt, now = Date.now()) {
  const ms = Number(now);
  const expected = previousSlot(ms - 10 * 60000);
  const taken = takenAt ? Date.parse(String(takenAt).replace(' ', 'T') + (/[zZ]|[+-]\d\d:\d\d$/.test(takenAt) ? '' : '+09:00')) : NaN;
  return { label: LABEL, nextAt: new Date(nextSlot(ms)).toISOString(), expectedAt: new Date(expected).toISOString(), stale: !Number.isFinite(taken) || taken < expected };
}
module.exports = { LABEL, dueSlot, nextSlot, previousSlot, freshness };
