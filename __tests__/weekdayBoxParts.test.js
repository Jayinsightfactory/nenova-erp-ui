import test from 'node:test';
import assert from 'node:assert/strict';
import {weekdayBoxPack,composeWeekdayBoxParts,splitWeekdayBoxParts,weekdayNativeBoxUnits} from '../lib/weekdayBoxParts.js';
import {weekdayQuantityLabel} from '../lib/weekdayHorizontalMatrix.js';
import {assertExactProductConversion} from '../lib/weekdayDistributionApply.js';
import {weekdayWilsonSplit,verifyWeekdayWilsonRecord} from '../lib/weekdayWilson.js';
test('native physical units retain fractional boxes, with N2 display only',()=>{
  for(const [flower,unit,count] of [['카네이션','단',15],['수국','송이',30],['수국','송이',50],['수국','송이',16]]){
    const packaging={bunchOf1Box:unit==='단'?count:0,steamOf1Box:unit==='송이'?count:300,steamOf1Bunch:unit==='단'?20:0};
    const row={flowerNames:[flower]},pack=weekdayBoxPack(row,'박스',packaging);
    const result=composeWeekdayBoxParts('1','3',pack);
    assert.deepEqual(splitWeekdayBoxParts(result.quantity,pack),{boxes:1,loose:3});
    assert.equal(weekdayQuantityLabel(result.quantity,row,'박스',packaging),`1박스 3${unit}`);
    const product={FlowerName:flower,OutUnit:'박스',EstUnit:unit,BunchOf1Box:packaging.bunchOf1Box,SteamOf1Box:packaging.steamOf1Box,SteamOf1Bunch:packaging.steamOf1Bunch};
    const one=composeWeekdayBoxParts('0','1',pack).quantity;
    assert.equal(weekdayNativeBoxUnits(one,product).estQty,1);
    assert.equal(assertExactProductConversion({actual:{product}},one+one).estQty,2);
    assert.equal(composeWeekdayBoxParts('0',String(count+3),pack).quantity,result.quantity);
  }
});
test('missing, non-box, unsupported family and invalid inputs are not guessed',()=>{
  assert.equal(weekdayBoxPack({flowerNames:['알스트로']},'단',{}),null);
  assert.equal(weekdayBoxPack({flowerNames:['수국']},'송이',{steamOf1Box:30}),null);
  const missing=weekdayBoxPack({flowerNames:['카네이션']},'박스',{});
  assert.throws(()=>composeWeekdayBoxParts('1','3',missing));
  const pack={count:15,unit:'단'};
  for(const value of ['','-1','1.2','NaN','1e3'])assert.throws(()=>composeWeekdayBoxParts(value,'3',pack));
  assert.equal(splitWeekdayBoxParts(1.01,pack),null);
  assert.equal(weekdayNativeBoxUnits(1,{FlowerName:'카네이션',OutUnit:'박스',EstUnit:'박스',BunchOf1Box:15}),null);
});
test('Wilson preserves one stem split from a two-stem day, scoped to ERP year',()=>{
  const one=composeWeekdayBoxParts('0','1',{count:30,unit:'송이'}).quantity;
  const record={year:2026,majorWeek:'43',orderWeek:'43-01',custKey:533,prodKey:866,date:'2026-10-22',unit:'박스',expectedTotal:one+one,wilsonQuantity:one,status:'CURRENT'};
  const rows=[{OrderYear:2026,OrderWeek:'43-01',CustKey:533,ProdKey:866,Date:'2026-10-22',Unit:'박스',Quantity:one+one,ProductActive:1,CustomerMatch:1}];
  assert.equal(verifyWeekdayWilsonRecord(record,rows).status,'CURRENT');
  assert.equal(weekdayWilsonSplit(one+one,'박스',record,record).general,one);
  assert.equal(verifyWeekdayWilsonRecord(record,rows.map(row=>({...row,OrderYear:2025}))).status,'UNVERIFIED');
});
