// node __tests__/catalogPptxSpatial.test.js
const assert = (label, cond) => {
  if (!cond) {
    console.error(`  FAIL ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`  PASS ${label}`);
  }
};

async function main() {
  const fs = await import('fs');
  const path = await import('path');
  const dir = path.join(process.cwd(), '_catalog-ref-browser');
  const pptx = fs.readdirSync(dir).find(f => f.endsWith('.pptx'));
  if (!pptx) {
    console.log('  SKIP no reference pptx');
    return;
  }
  const { extractProductsFromPptxSpatial } = await import('../lib/catalogPptxSpatial.js');
  const buf = fs.readFileSync(path.join(dir, pptx));
  const items = await extractProductsFromPptxSpatial(buf);
  assert('extracts ~391 products', items.length >= 380 && items.length <= 400);
  assert('slide1 first eng', items[0]?.eng_name === 'Alhambra');
  assert('slide1 first kor', items[0]?.name === '알함브라');
  assert('all have image buffer', items.every(p => p.buffer && p.buffer.length > 1000));
  const named = items.filter(p => p.eng_name && p.name);
  assert('most have paired names', named.length >= 380);
}

main();
