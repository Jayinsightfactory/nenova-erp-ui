import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {reservePackingPdfRequest} from '../lib/importTeamPdfQuota.js';
import {validatePackingPdf} from '../lib/importTeamPdf.js';
test('PDF parser accepts supported PDFs and rejects arbitrary prompts/files',()=>{
 const pdfBase64=Buffer.from('%PDF-1.7\nfixture').toString('base64');
 assert.deepEqual(validatePackingPdf({country:'CO',pdfBase64,system:'ignore'}),{country:'CO',pdfBase64});
 assert.throws(()=>validatePackingPdf({country:'XX',pdfBase64}));
 assert.throws(()=>validatePackingPdf({country:'CO',pdfBase64:Buffer.from('not pdf').toString('base64')}));
});
test('PDF hourly quota is atomic across concurrent callers and resets next hour',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'import-quota-'));
 try{
  const options={root,now:3600000,limit:2};
  const results=await Promise.allSettled(Array.from({length:4},()=>reservePackingPdfRequest('user',options)));
  assert.equal(results.filter(x=>x.status==='fulfilled').length,2);
  assert.equal(results.filter(x=>x.status==='rejected'&&x.reason.statusCode===429).length,2);
  await reservePackingPdfRequest('other-user',options);
  await reservePackingPdfRequest('user',{...options,now:7200000});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('team endpoints authenticate and never import ERP DB access',()=>{
 for(const file of ['state.js','parse-pdf.js']){
  const source=fs.readFileSync(new URL('../pages/api/import/tools/'+file,import.meta.url),'utf8');
  assert.match(source,/export default withAuth/);assert.doesNotMatch(source,/from ['"].*\/db['"]|usp_Stock|ShipmentDetail/);
 }
});
test('AWB uses a bundled local worker, bounded input and no remote API',()=>{
 const source=fs.readFileSync(new URL('../lib/importAwbPdf.js',import.meta.url),'utf8');
 assert.match(source,/new Worker\(new URL\('\.\/importAwbWorker\.js'/);
 assert.match(source,/isEvalSupported: false/);
 assert.match(source,/MAX_PAGES = 100/);
 assert.match(source,/MAX_PDF_BYTES = 10 \* 1024 \* 1024/);
 assert.match(source,/nativeWorker\?\.terminate\(\)/);
 assert.doesNotMatch(source,/fetch\(|https:\/\//);
});
