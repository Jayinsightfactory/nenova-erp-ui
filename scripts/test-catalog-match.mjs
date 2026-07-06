import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
function parseCatalogSlidesJson(raw) {
  let data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const slides = Array.isArray(data) ? data : (data.slides || data.slides_data || []);
  const products = [];
  for (const slide of slides) {
    for (const p of slide.products || []) {
      let buffer = null;
      if (p.blob_b64) buffer = Buffer.from(p.blob_b64, 'base64');
      products.push({ name: p.name || '', eng_name: p.eng_name || '', label: `${p.eng_name || ''} ${p.name || ''}`.trim(), buffer });
    }
  }
  return products;
}

import { buildProductMatcher } from '../lib/catalogProductMatch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jsonPath = path.resolve(__dirname, '../_catalog-ref-browser/slides_data_export.json');
const raw = fs.readFileSync(jsonPath, 'utf8');
const extracted = parseCatalogSlidesJson(raw);
console.log('From JSON:', extracted.length, 'with image:', extracted.filter(i => i.buffer?.length > 100).length);

// Load products from bootstrap if env available
let products = [];
try {
  const { query } = await import('../lib/db.js');
  const r = await query('SELECT ProdKey, ProdCode, ProdName, DisplayName, FlowerName, CounName FROM Product WHERE isDeleted=0');
  products = r.recordset;
  console.log('ERP products:', products.length);
} catch (e) {
  console.log('DB skip:', e.message);
  process.exit(0);
}

const { matchCatalogProduct } = buildProductMatcher(products);
let matched = 0, unmatched = 0;
const samples = [];
for (const item of extracted) {
  if (!item.buffer || item.buffer.length < 100) continue;
  const m = matchCatalogProduct(item);
  if (m) matched++;
  else {
    unmatched++;
    if (samples.length < 20) samples.push({ eng: item.eng_name, name: item.name, label: item.label });
  }
}
console.log('Match:', matched, 'Unmatch:', unmatched);
console.log('Unmatched samples:', samples);
