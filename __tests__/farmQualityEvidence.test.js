import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {detectEvidenceImage,evidenceFileName,normalizeEvidenceKeys,QUALITY_EVIDENCE_MAX_FILES} from '../lib/farmQualityEvidence.js';

assert.equal(detectEvidenceImage(Buffer.from([0xff,0xd8,0xff,0xe0,0,0,0,0,0,0,0,0])).mime,'image/jpeg');
assert.equal(detectEvidenceImage(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0])).mime,'image/png');
assert.equal(detectEvidenceImage(Buffer.from('RIFF0000WEBP')).mime,'image/webp');
assert.equal(detectEvidenceImage(Buffer.from('<svg onload=alert(1)>')),null,'SVG must never be served as evidence');
assert.equal(evidenceFileName('../현장:사진.png','jpg'),'.._현장_사진.jpg');
const key=crypto.randomUUID();assert.deepEqual(normalizeEvidenceKeys([key,key.toUpperCase()]),[key]);
assert.throws(()=>normalizeEvidenceKeys(['bad']));
assert.throws(()=>normalizeEvidenceKeys(Array.from({length:QUALITY_EVIDENCE_MAX_FILES+1},()=>crypto.randomUUID())));

const api=fs.readFileSync('pages/api/sales/farm-quality-evidence.js','utf8');
const store=fs.readFileSync('lib/farmQualityStore.js','utf8');
const page=fs.readFileSync('pages/sales/farm-quality.js','utf8');
const migration=fs.readFileSync('docs/migrations/2026-09-14_farm_quality.sql','utf8');
assert.match(api,/bodyParser:false/);assert.match(api,/withAuth/);assert.match(api,/X-Content-Type-Options/);
assert.match(api,/CreatedBy=@user/);assert.match(api,/c\.OrderYear=@year/);assert.match(api,/EventKey IS NULL/);
assert.doesNotMatch(api,/api\/public|Access-Control-Allow-Origin/);
assert.match(store,/OUTPUT INSERTED\.EventKey/);assert.match(store,/CreatedBy=@author/);assert.match(store,/e\.OrderYear=@year/);
assert.match(page,/onPaste=\{pasteEvidence\}/);assert.match(page,/accept="image\/jpeg,image\/png,image\/webp"/);assert.match(page,/multiple/);
assert.match(page,/증거 이미지/);assert.match(page,/evidenceKeys/);assert.match(page,/event-images/);
assert.match(migration,/WebFarmQualityEvidence/);assert.match(migration,/VARBINARY\(MAX\)/);assert.match(migration,/FOREIGN KEY\(EventKey\)/);
for(const source of [api,store,migration])assert.doesNotMatch(source,/(INSERT|UPDATE|DELETE)\s+(?:dbo\.)?(?:Estimate|OrderDetail|ShipmentDetail|StockHistory|WebSalesDefectDeduction)\b/i);
console.log('Farm quality evidence: image signatures, private access, year binding, clipboard UI and web-only writes passed');
