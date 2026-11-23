'use strict';
const { performance } = require('node:perf_hooks');
const ingressPolicy = Object.freeze({ version: 1, ratePerSecond: 8, burst: 8, retryAfterSeconds: 5 });
// Admission is process-wide, before multipart parsing or creation of storage workers.
// A single sender produced >4,000 requests/minute in the 2026-11-19 incident.
// Normal background clients retry 429/5xx without marking the file uploaded.
function createIngressBudget({ rate = ingressPolicy.ratePerSecond, burst = ingressPolicy.burst, now = () => performance.now() } = {}) {
  if (!(rate > 0 && burst >= 1)) throw Error('INVALID_INGRESS_BUDGET');
  let tokens = burst, last = now();
  return {
    take() {
      const at = now();
      tokens = Math.min(burst, tokens + Math.max(0, at - last) * rate / 1000);
      last = at;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}
function admitUpload(res) {
  const key = Symbol.for('nenova.drive-ingress-budget.v1');
  const budget = globalThis[key] ||= createIngressBudget();
  if (budget.take()) return true;
  res.setHeader('Retry-After', '5');
  res.setHeader('Cache-Control', 'no-store');
  res.status(429).json({ success: false, code: 'DRIVE_UPLOAD_RATE_LIMIT', retryAfterSeconds: 5,
    error: '업무 파일 요청이 몰려 잠시 대기합니다. 5초 후 다시 시도해 주세요.' });
  return false;
}
module.exports = { createIngressBudget, admitUpload, ingressPolicy };
