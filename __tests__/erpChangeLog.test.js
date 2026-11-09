import assert from 'node:assert/strict';
import { validateChangeLogRequest, parseKstDatetime, erpChangeLogSql } from '../lib/erpChangeLog.js';

const ok = validateChangeLogRequest({ since: '2026-11-08 09:00:00', until: '2026-11-09T09:00:00' });
assert.equal(ok.until - ok.since, 24 * 3600 * 1000);
validateChangeLogRequest({ since: '2026-11-08 00:00:00', until: '2026-11-09 02:00:00' });
for (const bad of [
  {}, { since: '2026-11-08 09:00:00' }, { until: '2026-11-08 09:00:00' },
  { since: '2026-11-08', until: '2026-11-09' },
  { since: '2026-02-30 00:00:00', until: '2026-03-01 00:00:00' },
  { since: '2026-11-08 09:00:00', until: '2026-11-08 09:00:00' },
  { since: '2026-11-09 09:00:00', until: '2026-11-08 09:00:00' },
  { since: '2026-11-08 00:00:00', until: '2026-11-09 02:00:01' },
  { since: ['2026-11-08 00:00:00'], until: '2026-11-08 01:00:00' },
]) assert.throws(() => validateChangeLogRequest(bad), bad.toString());
assert.equal(parseKstDatetime('2026-11-08 25:00:00'), null);
assert.ok(!/\bsd\.isDeleted\b/i.test(erpChangeLogSql));
assert.ok(!/\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i.test(erpChangeLogSql));
console.log('erpChangeLog tests passed');
