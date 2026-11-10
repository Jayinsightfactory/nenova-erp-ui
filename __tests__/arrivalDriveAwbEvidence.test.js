import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { collectArrivalDriveAwbEvidence, awbNumbers } from '../lib/arrivalDriveAwbEvidence.js';
import { selectArrivalDriveCandidates, arrivalDriveTiming } from '../lib/arrivalDrivePolicy.js';

const config = { year:'2026', countries:['콜롬비아'] };
const body = 'Air Waybill Original Colombia 2026 AWB 865-14699602';
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['2026/46-01'],['AWB','865-14699602']]), '원가');
const workbook = XLSX.write(book, { type:'buffer', bookType:'xlsx' });
const doc = await PDFDocument.create();
doc.addPage().drawText(body, {font:await doc.embedFont(StandardFonts.Helvetica),size:11});
const pdf = Buffer.from(await doc.save());
const make = (id, filename, bytes) => ({id,filename,sha:crypto.createHash('sha256').update(bytes).digest('hex'),
  mtime:'2026-11-06T00:00:00Z',uploadedAt:'2026-11-06T00:00:00Z'});
const cost = make('cost','2026 46-01 콜롬비아 원가자료.xlsx',workbook);
const awb = make('awb','2026_46-01_콜롬비아_AWB_865-14699602.pdf',pdf);
const readBytes = f => f.id === 'cost' ? workbook : pdf;
const evaluate = async (a = awb, options = {}) => {
  const files = [cost, a];
  const evidence = await collectArrivalDriveAwbEvidence(files, config, {readBytes, extractPdf:async()=>body, ...options});
  return selectArrivalDriveCandidates(files, config, evidence)[0];
};
const valid = await evaluate();
assert.equal(valid.reason,'');
assert.equal(arrivalDriveTiming(valid,{},Date.parse('2026-11-08')).ready,true);
// Actual PDF decoding and actual XLSX cells, not metadata-only mocks.
const realEvidence = await collectArrivalDriveAwbEvidence([cost,awb],config,{readBytes});
assert.equal(selectArrivalDriveCandidates([cost,awb],config,realEvidence)[0].reason,'');
for (const patch of [
  {filename:'2025 46-01 콜롬비아 AWB.pdf'},
  {filename:'2026 콜롬비아 AWB.pdf'},
  {filename:'46-01 콜롬비아 AWB.pdf'},
  {filename:'2026 46-01 호주 AWB.pdf'},
  {filename:'2026 46-01 미국 AWB.pdf'},
  {filename:'2026 46-01 뉴질랜드 AWB.pdf'},
  {filename:'2026 46-01 콜롬비아 호주 AWB.pdf'},
  {filename:'AWB.pdf'},
  {filename:'shared-awb-2026-46-01-86514699602 (5).xlsx',origin:'PC_AUTO'},
  {filename:'2026 46-01 콜롬비아 AWB.xlsx'},
  {filename:'2026 46-01 콜롬비아 시험 AWB.pdf'},
  {filename:'2026 45-01 콜롬비아 AWB.pdf'},
  {filename:'2026 46-01 45-01 콜롬비아 AWB.pdf'},
  {filename:'2026 2025 46-01 콜롬비아 AWB.pdf'},
  {cycle:'45-1'}, {cycle:0}, {cycle:false}, {cycle:'invalid'},
  {deleted:true}, {egressSnapshot:true}, {type:'download'}, {sha:'0'.repeat(64)},
]) assert.ok((await evaluate({...awb,...patch})).reason,JSON.stringify(patch));
for (const text of ['',body.replace('2026','2025'),body.replace('865-14699602','865-14699591'),
  body.replace('Air Waybill','Calculation'),body.replace('Colombia','Australia'),body+' 2025',body+' TEST_ONLY',body+' OrderWeek 45-01']) {
  assert.ok((await evaluate(awb,{extractPdf:async()=>text})).reason,text);
}
assert.ok((await evaluate(awb,{readBytes:f=>f.id==='cost'?workbook:Buffer.from('not PDF')})).reason);
const impostorBytes = Buffer.from('XLSX renamed PDF'), impostor = make('awb',awb.filename,impostorBytes);
assert.ok((await evaluate(impostor,{readBytes:f=>f.id==='cost'?workbook:impostorBytes})).reason);
for (const patch of [{egressSnapshot:true},{type:'download'},{filename:'2026 46-01 콜롬비아 시험 원가자료.xlsx'},
  {filename:'2026 2025 46-01 콜롬비아 원가자료.xlsx'},{cycle:'45-1'},{cycle:0},{cycle:false}]) {
  const changedCost = {...cost,...patch}, files = [changedCost,awb];
  const proof = await collectArrivalDriveAwbEvidence(files,config,{readBytes,extractPdf:async()=>body});
  assert.ok(selectArrivalDriveCandidates(files,config,proof)[0].reason,JSON.stringify(patch));
}
const injected = {...awb,awbEvidence:{verified:true,year:'2026',week:'46-1',number:'86514699602'}};
assert.ok(selectArrivalDriveCandidates([cost,injected],config)[0].reason);
assert.ok(selectArrivalDriveCandidates([cost],config,realEvidence)[0].reason); // deleted since verification
assert.ok(selectArrivalDriveCandidates([cost,{...awb,sha:'replaced'}],config,realEvidence)[0].reason);
assert.ok(selectArrivalDriveCandidates([{...cost,sha:'changed'},awb],config,realEvidence)[0].reason);
assert.ok(selectArrivalDriveCandidates([{...cost,filename:cost.filename.replace('46-01','47-01')},
  {...awb,filename:awb.filename.replace('46-01','47-01')}],config,realEvidence)[0].reason,'proof scope cannot migrate to another week');
// Execute the actual server resolver: changes during async PDF decoding must be
// checked against a fresh index, not the list captured before await.
const service = fs.readFileSync(new URL('../lib/arrivalDriveAuto.js',import.meta.url),'utf8');
const resolverBody = service.slice(service.indexOf('async function verifiedCandidates'),service.indexOf('export async function arrivalDriveStatus'));
for (const current of [[cost,awb],[cost,{...awb,deleted:true}],[cost,{...awb,sha:'replaced'}]]) {
  const resolve = new Function('collectArrivalDriveAwbEvidence','getFileForVerification','fs','actor','selectArrivalDriveCandidates','listVisible',
    resolverBody+';return verifiedCandidates;')(async()=>realEvidence,()=>{throw Error('not used by fixture');},{},{},selectArrivalDriveCandidates,()=>current);
  const result = (await resolve([cost,awb],config))[0];
  assert.equal(!result.reason,current[1]===awb,'fresh post-await source scope');
}
assert.deepEqual(awbNumbers('AWB 865-14699602'),['86514699602']);
assert.deepEqual(awbNumbers('AWB 865-14699603'),[]); // check digit
assert.equal((await collectArrivalDriveAwbEvidence([cost,awb],{...config,countries:['중국']},{readBytes:()=>{throw Error('must not read');}})).size,0);
console.log('CO AWB evidence: actual PDF/XLSX positive, cross-year/week/country/number, generated output, hash, injection and stale-proof counterexamples passed');
