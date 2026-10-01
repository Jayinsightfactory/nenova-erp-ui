const assert = require('node:assert/strict');
const fs = require('node:fs');
(async()=>{
 const {buildFarmWeekBoard,summarizeFarmRows,moveFarmWeek,varietyKey}=await import('../lib/farmWeekBoard.js');
 const base={orderYear:'2026',orderWeek:'39-02',prodKey:1,prodName:'Rose',country:'콜롬비아',flower:'장미',unit:'박스',quantity:3,kind:'incoming',farm:'A'};
 const source=[base,{...base,quantity:2},{...base,kind:'order',quantity:9},{...base,kind:'distribution',quantity:7},{...base,kind:'adjustment',quantity:-1},{...base,orderYear:'2025',quantity:999},{...base,orderWeek:'39-01',quantity:888},{...base,prodKey:2,unit:'단',kind:'distribution',quantity:4},{...base,prodKey:3,farm:null,quantity:2}];
 const result=buildFarmWeekBoard(source,{orderYear:'2026',orderWeek:'39-02'});
 assert.equal(result.length,3);const rose=result.find(r=>r.prodKey===1);
 assert.equal(rose.received,5);assert.equal(rose.order,9);assert.equal(rose.distribution,7);assert.equal(rose.adjustment,-1);
 assert.equal(result.find(r=>r.prodKey===3).incoming['농장 미지정'],2);
 assert.equal(summarizeFarmRows(result).length,2);
 assert.equal(moveFarmWeek('2026-52-04',1),'2027-01-01');assert.equal(moveFarmWeek('2026-01-01',-1),'2025-52-04');
 assert.equal(moveFarmWeek('2026-39-01',1),'2026-39-02');assert.equal(moveFarmWeek('invalid',1),null);
 assert.notEqual(varietyKey(base),varietyKey({...base,country:'중국'}));
 const page=fs.readFileSync('pages/stats/farm-week-board.js','utf8');
 assert(page.includes('groups.get(country).push(row)'));
 assert(page.includes('aria-label="국가 선택"'));
 assert(page.includes('activeVarieties.map(row=>'));
 assert(page.includes('aria-pressed={activeCountry===country}'));
 const css=fs.readFileSync('components/FarmWeekBoard.module.css','utf8');
 assert(/\.scroller thead th\{[^}]*white-space:normal;[^}]*overflow-wrap:anywhere/.test(css));
 assert.deepEqual(buildFarmWeekBoard([],{orderYear:'2026',orderWeek:'39-02'}),[]);
 const sql=fs.readFileSync('lib/farmWeekBoardSql.js','utf8');
 for(const alias of ['wm','om','sm','sh']) {assert(sql.includes(`${alias}.OrderYear=@year`));assert(sql.includes(`${alias}.OrderWeek=@week`));}
 assert(!/\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i.test(sql));assert(!sql.includes('sd.isDeleted'));assert(!sql.includes('sd.isFix'));
 const api=fs.readFileSync('pages/api/stats/farm-week-board.js','utf8');assert(api.includes('withAuth'));assert(api.includes("req.method !== 'GET'"));
 console.log('farmWeekBoard: cross-year, units, no fanout, missing farm, distribution-only, adjustment, year rollover, GET/auth passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
