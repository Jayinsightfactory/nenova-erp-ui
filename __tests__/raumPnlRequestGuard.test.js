import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRaumPnlRequestGuard, isRaumPnlPartnerMatch } from '../lib/raumPnlRequestGuard.js';

for (const partner of ['raum', 'choimun', 'shilla']) {
  assert.equal(isRaumPnlPartnerMatch(partner, partner), true);
  for (const other of ['raum', 'choimun', 'shilla', null, undefined, '', 'SHILLA']) {
    if (other !== partner) assert.equal(isRaumPnlPartnerMatch(other, partner), false);
  }
}

const guard = createRaumPnlRequestGuard();
const applied = [];
let partner = 'raum';
let releaseOld;
const oldResponse = new Promise(resolve => { releaseOld = resolve; });
const oldToken = guard.begin(partner);
const oldRequest = oldResponse.then(rows => {
  if (guard.isCurrent(oldToken, partner)) applied.push(rows);
});

// localStorage가 신라를 복원한 뒤, 먼저 시작된 라움 응답은 적용되면 안 된다.
partner = 'shilla';
guard.invalidate();
const shillaToken = guard.begin(partner);
releaseOld(['raum-row']);
await oldRequest;
assert.deepEqual(applied, [], 'late Raum list response must not overwrite Shilla');

if (guard.isCurrent(shillaToken, partner)) applied.push(['shilla-row']);
assert.deepEqual(applied, [['shilla-row']]);
assert.equal(guard.isCurrent(oldToken, partner), false);

// 저장 후 이전 렌더의 loadList 콜백은 live partner가 다르면 begin 자체를 호출하지 않는다.
const callbackGuard = createRaumPnlRequestGuard();
let livePartner = 'shilla';
const currentToken = callbackGuard.begin(livePartner);
const beginOnlyForLivePartner = capturedPartner => (
  capturedPartner === livePartner ? callbackGuard.begin(capturedPartner) : null
);
assert.equal(beginOnlyForLivePartner('raum'), null);
assert.equal(callbackGuard.isCurrent(currentToken, livePartner), true,
  'stale callback must not invalidate the current partner generation');

const pnlSource = fs.readFileSync(new URL('../pages/raum/pnl.js', import.meta.url), 'utf8');
assert.match(pnlSource, /isRaumPnlPartnerMatch\(j\.master\?\.PartnerCode, requestedPartner\)/);
assert.match(pnlSource, /isRaumPnlPartnerMatch\(meta\.partnerCode, partnerCodeRef\.current\)/);
assert.match(pnlSource, /const \[partnerReady, setPartnerReady\] = useState\(false\)/,
  'list loading must wait until localStorage partner restoration completes');
assert.match(pnlSource, /if \(!partnerReady\) return;/,
  'initial Raum list request must not start before partner readiness');
const selectPartnerSource = pnlSource.slice(pnlSource.indexOf('const selectPartner'), pnlSource.indexOf('const partner ='));
assert.match(selectPartnerSource, /listRequestGuard\.current\.invalidate\(\);/,
  'switching partner must invalidate the previous list request');
assert.match(selectPartnerSource, /setList\(\[\]\)/,
  'switching partner must invalidate and clear the previous list immediately');
assert.match(pnlSource, /if \(requestedPartner !== partnerCodeRef\.current\) return false;[\s\S]{0,80}listRequestGuard\.current\.begin\(requestedPartner\)/,
  'a stale callback must not start a new old-partner list generation');
assert.match(pnlSource, /disabled=\{uploading \|\| saving \|\| shillaMatching \|\| shillaBulkMatchOpen\}/,
  'partner controls must not switch scope while an upload, save, single-row mapping, or bulk mapping modal is active');
assert.match(pnlSource, /detailRequestGuard\.current\.isCurrent\(token, partnerCodeRef\.current\)/,
  'late detail responses must be rejected against the live partner');
assert.doesNotMatch(pnlSource.slice(pnlSource.indexOf('const onUpload'), pnlSource.indexOf('const saveBulkPreview')), /token, requestedPartner/,
  'upload error handling must not reference a detail request token');

console.log('Raum P&L request guard tests passed');
