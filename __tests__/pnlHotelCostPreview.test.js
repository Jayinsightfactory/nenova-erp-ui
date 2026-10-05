const assert = require('node:assert/strict');
(async () => {
  const { buildPnlHotelCostPreview } = await import('../lib/pnlHotelCostPreview.js');
  const rows = [
    { orderYear:'2026',partnerCode:'raum',partnerLabel:'라움',major:39,prodKey:2330,unit:'단',costPrice:9000 },
    { orderYear:'2026',partnerCode:'hotel_a',partnerLabel:'은화',major:39,prodKey:2330,unit:'단',costPrice:10000 },
    { orderYear:'2025',partnerCode:'raum',major:39,prodKey:2330,unit:'단',costPrice:1 },
    { orderYear:'2026',partnerCode:'shilla',major:39,prodKey:2330,unit:'송이',costPrice:2 },
    { orderYear:'2026',partnerCode:'shilla',major:39,prodKey:999,unit:'단',costPrice:3 },
  ];
  const before = JSON.stringify(rows);
  const refs = buildPnlHotelCostPreview({prodKey:2330,unit:'단'},rows,{orderYear:'2026',partnerCode:'hotel_a'});
  assert.deepEqual(refs.map(r=>[r.label,r.values]),[['은화',[[10000]]],['라움',[[9000]]]]);
  assert.equal(JSON.stringify(rows),before);
  const names = ['hotel_a','raum'].map(partnerCode=>({orderYear:'2026',partnerCode,major:39,name:'왁스',unit:'단',costPrice:0}));
  assert.equal(buildPnlHotelCostPreview({name:'왁스',unit:'단'},names,{orderYear:'2026',partnerCode:'hotel_a'}).length,1);
  console.log('Hotel hover history exact product/unit/year and unmapped isolation passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
