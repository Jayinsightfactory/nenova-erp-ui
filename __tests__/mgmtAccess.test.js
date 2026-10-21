import assert from 'node:assert/strict';
import { canUseMgmt, denyIfNotMgmtAdmin } from '../lib/mgmt/access.js';
assert.equal(canUseMgmt({ userId: 'nenovaSS3', authority: 5 }), true);
assert.equal(canUseMgmt({ userId: 'nenovaSS1', authority: 3, deptName: '영업지원' }), false);
assert.equal(canUseMgmt({ userId: 'x', authority: 1 }), true);
let code = 0; const res = { status(c) { code = c; return this; }, json() { return this; } };
assert.equal(denyIfNotMgmtAdmin({ user: { userId: 'nenovaSS1', authority: 3 } }, res), true); assert.equal(code, 403);
assert.equal(denyIfNotMgmtAdmin({ user: { userId: 'nenovaSS3' } }, res), false);
console.log('mgmt access tests passed');
