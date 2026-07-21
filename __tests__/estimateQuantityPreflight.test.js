// node __tests__/estimateQuantityPreflight.test.js

import {
  BLOCKING_EXE_ERROR_CODES,
  buildQuantityItemPreflightError,
  buildQuantityPreflightError,
  summarizeQuantityPreflight,
} from '../lib/estimateQuantityPreflight.js';

let pass = 0;
let fail = 0;
const assert = (label, condition) => {
  if (condition) pass += 1;
  else { fail += 1; console.log(`  ✗ ${label}`); }
};

console.log('=== estimate quantity preflight ===');
assert('custKey mismatch is blocking', BLOCKING_EXE_ERROR_CODES.has('custKeyBad'));
assert('duplicate master is blocking', BLOCKING_EXE_ERROR_CODES.has('dupMaster'));
assert('clean week passes', summarizeQuantityPreflight({ week: '29-01', totalIssues: 0, checks: [] }, '29-01').ok);

const blocked = summarizeQuantityPreflight({
  week: '29-01',
  totalIssues: 2,
  checks: [
    { code: 'custKeyBad', title: 'ShipmentDetail.CustKey 누락/불일치', count: 692, items: [{ keyNo: 1 }] },
    { code: 'duplicate', title: '비차단 정보', count: 1 },
  ],
}, '29-01');
assert('blocking check fails', !blocked.ok);
const error = buildQuantityPreflightError([blocked]);
assert('error code is actionable', error?.code === 'ERP_INTEGRITY_ACTION_REQUIRED');
assert('error includes week and count', error?.message.includes('29-01') && error?.message.includes('692건'));

const itemError = buildQuantityItemPreflightError([{
  item: {
    keyNumber: 3158,
    isEstimate: false,
    item: { OrderWeek: '29-01', CustName: '주광농원', ProdName: 'Mondial White' },
  },
  error: {
    code: 'ERP_INTEGRITY_ACTION_REQUIRED',
    message: '주문등록이 없어 고스트 출고가 될 수 있습니다.',
    issues: [{ code: 'GHOST_SHIPMENT', message: '주문등록이 없어 고스트 출고가 될 수 있습니다.' }],
  },
}]);
assert('item error exposes manual action', itemError.preflight?.manualActions?.[0]?.id === 'resolveGhostShipment');
assert('item error keeps target row', itemError.preflight?.items?.[0]?.sdetailKey === 3158);

const safeItemError = buildQuantityItemPreflightError([{
  item: { keyNumber: 9, isEstimate: false, item: { OrderWeek: '29-02', ProdName: 'Rose' } },
  error: {
    code: 'ERP_INTEGRITY_ACTION_REQUIRED',
    message: 'CustKey 불일치',
    issues: [{ code: 'CUSTKEY_MISMATCH', message: 'CustKey 불일치' }],
  },
}]);
assert('item error exposes safe repair', safeItemError.preflight?.safeActions?.[0]?.id === 'repairMissingCustKey');

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
