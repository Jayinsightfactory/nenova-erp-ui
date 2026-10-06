import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {packingPdfCacheKey,readPackingPdfCache,writePackingPdfCache} from '../lib/importTeamPdfCache.js';
import {validatePackingPdf,MAX_PACKING_PDF_BYTES} from '../lib/importTeamPdf.js';
const input={country:'NL',pdfBase64:Buffer.from('%PDF-test').toString('base64'),prompt:'v1'};
const data={stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({invoices:[{invoice:'1',lines:[{description:'Flower',stems:0,price:0}]}]})}]};
test('PDF cache isolates user, country, bytes and prompt; expires and skips partial responses',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pdf-cache-'));
 try{
  const key=packingPdfCacheKey(input),opts={root,now:Date.now()};
  assert.equal(await readPackingPdfCache('a',key,opts),null);
  assert.equal(await writePackingPdfCache('a',key,'NL',data,opts),true);
  assert.deepEqual(await readPackingPdfCache('a',key,opts),data);
  assert.equal(await readPackingPdfCache('b',key,opts),null);
  assert.equal(await readPackingPdfCache('a',key,{...opts,now:opts.now+31*86400000}),null);
  for(const patch of [{country:'CO'},{prompt:'v2'},{pdfBase64:Buffer.from('%PDF-new').toString('base64')}])assert.notEqual(packingPdfCacheKey({...input,...patch}),key);
  assert.equal(await writePackingPdfCache('b',key,'NL',{...data,stop_reason:'max_tokens'},opts),false);
  await assert.rejects(()=>readPackingPdfCache('a','../escape',opts));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('20MiB PDF boundary is accepted; larger and noncanonical base64 rejected',()=>{
 const pdf=Buffer.alloc(MAX_PACKING_PDF_BYTES,32);pdf.write('%PDF-1.7');
 assert.equal(validatePackingPdf({country:'NL',pdfBase64:pdf.toString('base64')}).country,'NL');
 assert.throws(()=>validatePackingPdf({country:'NL',pdfBase64:Buffer.concat([pdf,Buffer.from('x')]).toString('base64')}));
 assert.throws(()=>validatePackingPdf({country:'NL',pdfBase64:'JVBERi0x==='}));
});
