const fs = require('node:fs');
const assert = require('node:assert/strict');
const test = require('node:test');
const source = fs.readFileSync('pages/api/estimate/weekday-print.js', 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default', 'return');
const scope = { year: 2026, majorWeek: '41', custKey: 533, mode: 'major', dates: [] };
async function responseFor(error) {
  const handler = Function('withTransaction','sql','withAuth','normalizeWeekdayPrintRequest','readWeekdayPrintInTransaction',source)(
    callback => callback(() => {}), {}, handler => handler, () => scope, async () => { throw error; });
  const response = { statusCode: 200, setHeader() {}, status(code) { this.statusCode=code; return this; },
    json(body) { this.body=body; return this; } };
  await handler({ method:'POST', body:scope }, response);
  return response;
}
test('actual print handler distinguishes empty/unfixed/invalid readiness without changing 409 guard', async () => {
  for (const eligibility of [
    { positiveCount:0, unfixedCount:0, invalidCount:0, reasons:[] },
    { positiveCount:1345, unfixedCount:97, invalidCount:0, reasons:[] },
    { positiveCount:2, unfixedCount:0, invalidCount:1, reasons:['상세 9: 전산 연결'] },
  ]) {
    const result = await responseFor(Object.assign(new Error('existing guarded diagnostic'), { status:409, eligibility }));
    assert.equal(result.statusCode,409); assert.equal(result.body.success,false); assert.equal(result.body.readOnly,true);
    assert.equal(result.body.unfixedCount,eligibility.unfixedCount);
    assert.deepEqual(result.body.printReadiness,{ scope:'ALL_CUSTOMERS_MAJOR_WEEK', ...eligibility });
  }
});
test('non-eligibility conflicts and missing customer do not masquerade as empty shipment', async () => {
  for (const status of [409,404]) {
    const result = await responseFor(Object.assign(new Error('actual failure'),{status}));
    assert.equal(result.statusCode,status); assert.equal(result.body.error,'actual failure');
    assert.equal(result.body.printReadiness,undefined);
  }
});
