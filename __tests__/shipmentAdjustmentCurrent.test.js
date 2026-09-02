import assert from 'node:assert/strict';
import { loadShipmentAdjustmentCurrent } from '../lib/shipmentAdjustmentCurrent.js';

const calls = [];
const q = async (statement, params) => {
  calls.push({ statement, params });
  if (statement.includes('FROM ShipmentMaster')) {
    return { recordset: [{ ShipmentKey: 901, isFix: 0 }] };
  }
  return { recordset: [{ SdetailKey: 1901, curOut: 8, curBox: 0.8, curBunch: 8, curSteam: 80 }] };
};

const current = await loadShipmentAdjustmentCurrent(q, {
  orderYear: '2026',
  orderWeek: '35-02',
  custKey: 680,
  prodKey: 59,
  lock: true,
});

assert.equal(current.master.ShipmentKey, 901);
assert.equal(current.detail.curOut, 8);
assert.equal(calls.length, 2);
assert.match(calls[0].statement, /ShipmentMaster sm WITH \(UPDLOCK, HOLDLOCK\)/);
assert.match(calls[0].statement, /EXISTS \([\s\S]*ShipmentDetail sd[\s\S]*sd\.ProdKey=@pk[\s\S]*sd\.OutQuantity,0\)>0/);
assert.match(calls[0].statement, /ORDER BY CASE WHEN EXISTS[\s\S]*THEN 0 ELSE 1 END[\s\S]*ISNULL\(sm\.isFix,0\) DESC/);
assert.match(calls[0].statement, /ISNULL\(sm\.isDeleted,0\)=0/);
assert.equal(calls[0].params.yr.value, '2026');
assert.equal(calls[0].params.wk.value, '35-02');
assert.equal(calls[0].params.ck.value, 680);
assert.equal(calls[0].params.pk.value, 59);
assert.match(calls[1].statement, /ORDER BY CASE WHEN ISNULL\(OutQuantity,0\)>0 THEN 0 ELSE 1 END[\s\S]*SdetailKey ASC/);

console.log('shipment adjustment current master-selection tests passed');
