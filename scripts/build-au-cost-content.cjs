// Hash-bound, read-only source extraction. Generated content contains no current ledger data.
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const XLSX = require('xlsx');
const sourceHash = '7cb66ca12afce9ff937ea8bd6fda597c4ce411174961638fa276ed6713dfd320';
const bytes = fs.readFileSync(process.argv[2]);
if (createHash('sha256').update(bytes).digest('hex') !== sourceHash) throw new Error('Unverified AU source');
const sheet = XLSX.read(bytes, { cellFormula: true }).Sheets['38-1'];
const labels = {};
for (const [ref, cell] of Object.entries(sheet)) {
  if (/^[B-T]+\d+$/.test(ref) && Number(ref.match(/\d+$/)[0]) <= 12 && cell.t === 's' && !cell.f && ref !== 'D4') labels[ref] = cell.v;
}
const defaults = Object.fromEntries(['N6','N8','I5'].map(ref => [ref, sheet[ref].v]));
const formulas = Object.fromEntries(['N5','N7','N9','G13','H13','I13','J13','K13','M13','N13','P13','Q13','R13','S13','T13'].map(ref => [ref, sheet[ref].f]));
const referencePrices = Array.from({length:10},(_,i)=>({name:sheet[`V${i+3}`].v,price:sheet[`W${i+3}`].v}));
const asset = {sourceHash,sourceSheet:'38-1',labels,defaults,formulas,referencePrices};
asset.assetHash = createHash('sha256').update(JSON.stringify(asset)).digest('hex');
fs.writeFileSync('lib/invoiceCostTemplates/australia-content.json',JSON.stringify(asset,null,2)+'\n');
console.log(asset.assetHash);
