// Read-only, hash-bound extraction. Never package historical rows or transaction inputs.
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const XLSX = require('xlsx');
const sourceHash = 'd5f71f57a93d3006bb889321d00e249592ab136b855f3f20a4b2b693f78a8da3';
const bytes = fs.readFileSync(process.argv[2]);
if (createHash('sha256').update(bytes).digest('hex') !== sourceHash) throw new Error('Unverified source');
const sheet = XLSX.read(bytes, { cellFormula: true }).Sheets['42-1'];
const labels = {};
for (const [ref, cell] of Object.entries(sheet)) {
  if (/^[A-Z]+\d+$/.test(ref) && Number(ref.match(/\d+$/)[0]) <= 14 && cell.t === 's' && !cell.f && ref !== 'C5') labels[ref] = cell.v;
}
const defaults = Object.fromEntries(['P7','P9','R6','AB8','AB9','AB10','AB11','AB12','AG8','AG9','AG10','AG11','AG12'].map(ref => [ref, sheet[ref].v]));
const formulas = Object.fromEntries(['P6','P8','P10','H15','I15','J15','M15','O15','P15','R15','S15','T15','U15','V15'].map(ref => [ref, sheet[ref].f]));
const asset = { sourceHash, sourceSheet: '42-1', labels, defaults, formulas };
asset.assetHash = createHash('sha256').update(JSON.stringify(asset)).digest('hex');
fs.writeFileSync('lib/invoiceCostTemplates/colombia-42-1-content.json', JSON.stringify(asset, null, 2) + '\n');
console.log(asset.assetHash);
