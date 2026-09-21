import assert from 'node:assert/strict';
import fs from 'node:fs';
import { arrivalDriveCandidate, selectArrivalDriveCandidates, scopeArrivalDriveRows } from '../lib/arrivalDrivePolicy.js';
const config = { year: '2026', countries: ['네덜란드'] };
const file = (id, name, mtime='2026-09-14T03:16:00Z') => ({ id, filename: name, mtime, sha: id });
const a = file('a', '37-2 NL 원가자료.xlsx');
const b = file('b', '37-2 NL 원가자료 (2).xlsx', '2026-09-14T02:01:00Z');
assert.equal(selectArrivalDriveCandidates([b, a], config)[0].id, 'a');
assert.equal(selectArrivalDriveCandidates([a, file('c', '36-2 NL 원가자료.xlsx','2026-09-21T00:00:00Z')], config)[0].id, 'a');
assert.equal(selectArrivalDriveCandidates([a, file('d', '38-1 NL 원가자료.xlsx')], config)[0].id, 'd');
assert.equal(selectArrivalDriveCandidates([file('p', '2025 37-2 NL 원가자료.xlsx')], config).length, 0);
assert.match(arrivalDriveCandidate(file('p', '2025 37-2 NL 원가자료.xlsx'), '2026').reason, /연도/);
assert.equal(arrivalDriveCandidate(file('p','37-2 NL Order.xlsx'),'2026'), null);
assert.match(arrivalDriveCandidate(file('p','37차 NL 원가자료.xlsx'),'2026').reason, /세부차수/);
assert.match(selectArrivalDriveCandidates([a, file('z','37-2 NL 원가자료 다른농장.xlsx')], config)[0].reason, /파일군|수정시각/);
const source = arrivalDriveCandidate(a,'2026');
const row = { orderYear:'2026', orderWeek:'37-2', countryName:'네덜란드', quantity:10, sourceArrivalCostKRW:1800, matchStatus:'MATCHED' };
const parsed = { rows:[row,{...row,orderWeek:'36-1'}], sheetStats:[], rejectedRows:[] };
assert.equal(scopeArrivalDriveRows(parsed,source).rows.length,1);
assert.throws(()=>scopeArrivalDriveRows({...parsed,rows:[{...row,orderYear:'2025'}]},source),/연도/);
assert.throws(()=>scopeArrivalDriveRows({...parsed,rows:[{...row,countryName:'콜롬비아'}]},source),/국가/);
assert.throws(()=>scopeArrivalDriveRows({...parsed,rejectedRows:[{orderWeek:'37-2'}]},source),/계산/);
assert.equal(scopeArrivalDriveRows({...parsed,rejectedRows:[{orderWeek:'36-1'}]},source).rows.length,1);
assert.throws(()=>scopeArrivalDriveRows({...parsed,rows:[]},source),/없습니다/);
const core=fs.readFileSync(new URL('../lib/arrivalCost.js',import.meta.url),'utf8');
assert.ok(core.indexOf('sp_getapplock')<core.indexOf('SELECT ISNULL(MAX(RevisionNo)'));
assert.match(core,/DRIVE_IMPORT/); assert.match(core,/before\.modified >= driveSource\.modified/);
const service=fs.readFileSync(new URL('../lib/arrivalDriveAuto.js',import.meta.url),'utf8');
assert.match(service,/scopeArrivalDriveRows/); assert.match(service,/sha256/);
assert.doesNotMatch(service,/UPDATE\s+(?:dbo\.)?(?:Product|Warehouse|Shipment|Estimate|Stock)/i);
const api=fs.readFileSync(new URL('../pages/api/arrival-cost/drive-auto.js',import.meta.url),'utf8');
assert.match(api,/isOrbitReportViewer\(req.user\)/);
console.log('arrival drive auto policy: positive, cross-year and near-miss fixtures passed');

// Execute the real import core against an isolated transaction fixture, not production data.
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const executable = core.replace(/^import .*;\r?\n/gm,'').replaceAll('export async function','async function').replaceAll('export function','function').replaceAll('export const','const');
let state = { imports:[], lines:[], history:[] }, failAfterInsert = false, rollbacks = 0;
const q = async (text,p={}) => {
  const v = key => p[key]?.value;
  if (text.includes('sp_getapplock') || text.includes('OBJECT_ID')) return {recordset:[]};
  if (text.includes('JSON_VALUE')) return {recordset:state.history.filter(h=>h.source.sha===v('sha')&&h.source.week===v('week')&&h.source.year===v('year')).map(h=>({ImportKey:h.key,AfterJson:JSON.stringify(h.source)}))};
  if (text.includes('SELECT DISTINCT l.ImportKey')) return {recordset:state.lines.filter(l=>l.year===v('year')&&l.week===v('week')&&l.current&&l.country===v('country')).map(l=>({ImportKey:l.key,AfterJson:state.history.find(h=>h.key===l.key)?JSON.stringify(state.history.find(h=>h.key===l.key).source):null}))};
  if(text.includes('SELECT TOP 1 h.HistoryKey'))return {recordset:[]};
  if(text.includes('MAX(RevisionNo)'))return {recordset:[{RevisionNo:state.imports.length+1}]};
  if(text.includes('INSERT INTO dbo.WebArrivalCostImport')){const key=state.imports.length+1;state.imports.push(key);return {recordset:[{ImportKey:key}]};}
  if(text.includes('SELECT ArrivalLineKey'))return {recordset:[]};
  if(text.includes('UPDATE dbo.WebArrivalCostLine SET IsCurrent=0')){state.lines.forEach(l=>{if(l.year===v('year')&&l.week===v('week')&&l.country===v('country'))l.current=false;});return {recordset:[]};}
  if(text.includes('INSERT INTO dbo.WebArrivalCostLine')){Object.keys(p).filter(k=>k.startsWith('importKey_')).forEach(k=>{const i=k.split('_')[1];state.lines.push({key:v(k),year:v(`year_${i}`),week:v(`week_${i}`),country:v(`country_${i}`),current:true});});if(failAfterInsert)throw Error('fixture insert failure');return {recordset:[]};}
  if(text.includes("VALUES (@key,N'DRIVE_IMPORT'")){state.history.push({key:v('key'),source:JSON.parse(v('source'))});return {recordset:[]};}
  if(text.includes('COUNT(*) AS cnt'))return {recordset:[{cnt:state.lines.filter(l=>l.key===v('key')&&l.current).length}]};
  throw Error('Unhandled fixture SQL: '+text.slice(0,80));
};
const transact = async fn => {const before=structuredClone(state);try{return await fn(q);}catch(e){state=before;rollbacks++;throw e;}};
const sqlTypes={Int:'Int',NVarChar:'NVarChar',Decimal:'Decimal'};
const create = await new AsyncFunction('query','withTransaction','sql',executable+'\nreturn createArrivalCostImport;')(q,transact,sqlTypes);
const input={parsed:scopeArrivalDriveRows(parsed,source),fileName:a.filename,user:{userId:'fixture'},orderYear:'2026',driveSource:source};
await create(input);
assert.equal(state.lines.length,1); assert.equal(state.history.length,1);
assert.equal((await create(input)).duplicate,true); assert.equal(state.lines.length,1);
state.lines.push({key:99,year:'2025',week:'37-2',country:'네덜란드',current:true});
await create({...input,driveSource:{...source,sha:'new',modified:source.modified+1000}});
assert.equal(state.lines.filter(l=>l.current&&l.year==='2026').length,1);
assert.equal(state.lines.find(l=>l.year==='2025').current,true);
const committed=structuredClone(state);failAfterInsert=true;
await assert.rejects(create({...input,driveSource:{...source,sha:'failed',modified:source.modified+2000}}),/fixture insert failure/);
assert.deepEqual(state,committed);assert.equal(rollbacks,1);failAfterInsert=false;
state.lines.push({key:100,year:'2026',week:'37-2',country:'네덜란드',current:true});
await assert.rejects(create({...input,driveSource:{...source,sha:'manual',modified:source.modified+3000}}),/수동 등록/);
console.log('arrival drive real import core fixture: duplicate, replacement, cross-year preservation, rollback, manual protection passed');
