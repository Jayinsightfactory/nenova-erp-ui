import fs from 'fs';
import path from 'path';
import { extractProductsFromPptx } from '../lib/catalogSourceImport.js';

const refDir = path.resolve('_catalog-ref-browser');
const pptx = fs.readdirSync(refDir).find(f => f.endsWith('.pptx') && f.includes('통합'));
if (!pptx) {
  console.error('PPTX not found in', refDir);
  process.exit(1);
}
const buf = fs.readFileSync(path.join(refDir, pptx));
const items = await extractProductsFromPptx(buf);
console.log('File:', pptx);
console.log('Extracted:', items.length);
console.log('With image:', items.filter(i => i.buffer?.length > 100).length);
console.log('Sample (first 15):');
for (const it of items.slice(0, 15)) {
  console.log(' -', JSON.stringify({ name: it.name, eng: it.eng_name, label: it.label, img: it.buffer?.length || 0 }));
}
