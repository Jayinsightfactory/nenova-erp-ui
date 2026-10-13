/* Preparation-only mechanical extraction; runtime never opens private source files. */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const JSZip = require('jszip');
const profiles = {
  CO_ORIGINAL_V1: { hash: '23d4f8065148bf31b09669d4ea8904cf07077ab7a9a843b147eacd7a5d430afc', sheet: '12-2', output: 'colombia-v1.json', lastRow: 25 },
  TH_ORIGINAL_V1: { hash: 'dcbb0bdb1ebd8fc0011d8b0bc41877413ff794407b16baabebf469939350f900', sheet: '40', output: 'thailand-v1.json', lastRow: 40 },
  US_ORIGINAL_V1: { hash: '49d523cd457f0e6c36cd4fb50f72705344899968b91b1142f8da5130b4d589df', sheet: '40-1', output: 'us-v1.json', lastRow: 13 },
  VN_ORIGINAL_V1: { hash: '81123f0c69859eab1b78ed6d4d722c7738d4395df9e0d2b8d7cd25a7e39969c6', sheet: '24-1', output: 'vietnam-v1.json', lastRow: 21 },
  AU_ORIGINAL_V1: { hash: '7cb66ca12afce9ff937ea8bd6fda597c4ce411174961638fa276ed6713dfd320', sheet: '38-1', output: 'australia-v1.json', lastRow: 16 },
  NZ_ORIGINAL_V1: { hash: 'c58848b2daf200d650548d932b514acc8499e2d020ed721cd6bfff7bbdf692a4', sheet: 'Sheet1', output: 'new-zealand-v1.json', lastRow: 19 },
  EC_ORIGINAL_V1: { hash: '9f889056cbed364d30b20edd51cc803f2ba8a4c789ac17cf9908ab80976406eb', sheet: '40-2', output: 'ecuador-v1.json', lastRow: 27 },
  CN_SEA_ORIGINAL_V1: { hash: '5e9241ac85d3152b976419422d2cce6498c02346563e2dc1a637e7eace9187a7', sheet: '41-1 해상 (95% 기준)', output: 'china-sea-v1.json' },
  NL_ORIGINAL_V1: { hash: 'fc9448ed983d18f0c180b4b8e1f27c1a7ef935b2e657c429eb42f2251b836d42', sheet: '40-2', output: 'netherlands-v1.json' },
};
async function main() {
  const [id, source] = process.argv.slice(2), p = profiles[id];
  if (!p || !source) throw new Error('Explicit verified profile/source required');
  const bytes = fs.readFileSync(source);
  if (createHash('sha256').update(bytes).digest('hex') !== p.hash) throw new Error('Source hash mismatch');
  const zip = await JSZip.loadAsync(bytes), workbook = await zip.file('xl/workbook.xml').async('string');
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*\/>/g)].map(m => m[0]);
  const index = sheets.findIndex(s => s.includes(`name="${p.sheet}"`));
  if (index < 0) throw new Error('Source sheet missing');
  const rid = sheets[index].match(/r:id="([^"]+)"/)[1];
  const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const rel = [...rels.matchAll(/<Relationship\b[^>]*\/>/g)].map(m => m[0]).find(s => s.includes(`Id="${rid}"`));
  const target = rel.match(/Target="([^"]+)"/)[1];
  const sheet = await zip.file(target.startsWith('/') ? target.slice(1) : `xl/${target}`).async('string');
  const tag = name => sheet.match(new RegExp(`<${name}\\b[^>]*(?:/>|>[\\s\\S]*?</${name}>)`))?.[0] || '';
  const asset = { schemaVersion: 1, profileId: id, profileVersion: '1.0.0', sourceHash: p.hash, sourceSheet: p.sheet,
    styles: await zip.file('xl/styles.xml').async('string'), theme: await zip.file('xl/theme/theme1.xml').async('string'),
    sheetViews: tag('sheetViews'), sheetFormatPr: tag('sheetFormatPr'), cols: tag('cols'),
    rows: [...sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)].map(([, attrs, cells]) => ({
      attrs: attrs.replace(/\s(?:spans|xr:uid)="[^"]*"/g, ''),
      cells: [...cells.matchAll(/<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g)].map(([, a]) => ({
        ref: a.match(/\br="([^"]+)"/)[1], style: a.match(/\bs="(\d+)"/)?.[1] || '0',
      })),
    })),
    merges: [...sheet.matchAll(/<mergeCell\s+ref="([^"]+)"\/>/g)].map(m => m[1]),
    // Printer-device binary relationship is private/nonportable; retain every page setting attribute.
    print: ['printOptions', 'pageMargins', 'pageSetup'].map(tag).join('').replace(/\s+r:id="[^"]*"/g, ''),
    printArea: [...workbook.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)]
      .find(([, a]) => a.includes('name="_xlnm.Print_Area"') && a.includes(`localSheetId="${index}"`))?.[2]?.split('!')[1] || null,
  };
  // Only verified result block: omit blank tails and alternate historical calculation blocks.
  if (p.lastRow) {
    asset.rows = asset.rows.filter(row => Number(row.attrs.match(/\br="(\d+)"/)[1]) <= p.lastRow);
    asset.merges = asset.merges.filter(ref => Number(ref.match(/(\d+)$/)[1]) <= p.lastRow);
  }
  if (/r:id=/.test(asset.print)) throw new Error('Print setting requires an unsupported private relationship');
  asset.assetHash = createHash('sha256').update(JSON.stringify(asset)).digest('hex');
  fs.writeFileSync(path.join(__dirname, p.output), JSON.stringify(asset));
  console.log(asset.assetHash);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
