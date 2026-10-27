'use strict';
const HOUR = 3600000;
const DAY = 24 * HOUR;
const OFFSET = 9 * HOUR;
const RUN_HOURS = [8, 11, 14];
const LABEL = '평일 08:00·11:00·14:00 자동 수집 · 사용자 요청 시 추가 (한국시간)';
function isWeekday(day) {
  const dow = new Date(day).getUTCDay();
  return dow >= 1 && dow <= 5;
}
function kstDay(ms) { return Math.floor((ms + OFFSET) / DAY) * DAY; }
function previousSlot(now) {
  const ms = Number(now);
  if (!Number.isFinite(ms)) return NaN;
  const today = kstDay(ms);
  for (let back = 0; back <= 7; back++) {
    const day = today - back * DAY;
    if (!isWeekday(day)) continue;
    for (let i = RUN_HOURS.length - 1; i >= 0; i--) {
      const slot = day + RUN_HOURS[i] * HOUR - OFFSET;
      if (slot <= ms) return slot;
    }
  }
  return NaN;
}
function nextSlot(now) {
  const ms = Number(now);
  if (!Number.isFinite(ms)) return NaN;
  const today = kstDay(ms);
  for (let forward = 0; forward <= 7; forward++) {
    const day = today + forward * DAY;
    if (!isWeekday(day)) continue;
    for (const hour of RUN_HOURS) {
      const slot = day + hour * HOUR - OFFSET;
      if (slot > ms) return slot;
    }
  }
  return NaN;
}
function dueSlot(now = Date.now(), lastAttempt = null) {
  const ms = Number(now);
  if (!Number.isFinite(ms)) return null;
  const slot = previousSlot(ms);
  return Number.isFinite(slot) && ms - slot < 5 * 60000 && slot > Number(lastAttempt ?? -1) ? slot : null;
}
function isRefreshRequestAllowed(now = Date.now()) {
  const ms = Number(now);
  if (!Number.isFinite(ms)) return false;
  const kst = new Date(ms + OFFSET);
  return kst.getUTCDay() >= 1 && kst.getUTCDay() <= 5 && kst.getUTCHours() >= 8 && kst.getUTCHours() < 18;
}
function freshness(takenAt, now = Date.now()) {
  const ms = Number(now);
  const expected = previousSlot(ms - 10 * 60000);
  const taken = takenAt ? Date.parse(String(takenAt).replace(' ', 'T') + (/[zZ]|[+-]\d\d:\d\d$/.test(takenAt) ? '' : '+09:00')) : NaN;
  return { label: LABEL, nextAt: new Date(nextSlot(ms)).toISOString(), expectedAt: new Date(expected).toISOString(), stale: !Number.isFinite(taken) || taken < expected };
}
module.exports = { dueSlot, nextSlot, previousSlot, freshness, isRefreshRequestAllowed, RUN_HOURS, LABEL };
