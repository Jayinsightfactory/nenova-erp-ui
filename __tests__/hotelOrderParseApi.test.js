import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import * as intake from '../lib/hotelMiuIntake.js';
import * as parse from '../lib/orderImportParse.js';
import * as match from '../lib/orderImportMatch.js';
import { normalizeToken } from '../lib/pasteMappingMatch.js';
import * as workspace from '../lib/hotelOrderWorkspace.js';
const require = createRequire(import.meta.url), XLSX = require('xlsx');
const swc = require('next/dist/build/swc');
const product = { ProdKey: 10, ProdName: '수국 화이트', DisplayName: '수국 화이트', OutUnit: '송이', SteamOf1Box: 30 };
function handler(file, fields = {}, mappings = []) {
  const calls = [];
  const imports = {
    fs, xlsx: XLSX,
    formidable: () => ({ parse: (_, cb) => cb(null, fields, { file }) }),
    '@anthropic-ai/sdk': class { constructor() { this.messages = { create: async () => ({ content: [{ type: 'text', text: JSON.stringify({ items: [{ name: '수국 화이트', qty: 15, unit: '송이' }] }) }] }) }; } },
    '../../../lib/auth': { withAuth: fn => fn },
    '../../../lib/db': { query: async sql => { calls.push(sql); assert.ok(/^SELECT/i.test(sql.trim())); return { recordset: sql.includes('FROM Product WHERE') ? [product] : sql.includes('FROM WebRaumPnl') ? mappings : [] }; } },
    '../../../lib/chat/costTracker': { trackLLMCall() {} },
    '../../../lib/orderImportParse': parse,
    '../../../lib/orderImportMatch': match,
    '../../../lib/parseMappings': { loadMappings: async () => ({}), normalizeToken },
    '../../../lib/orderImportUnits': { loadImportUnits: () => ({}) },
    '../../../lib/hotelMiuIntake': intake,
    '../../../lib/hotelOrderWorkspace': workspace,
  };
  const source = swc.transformSync(fs.readFileSync('pages/api/sales/hotel-miu-parse.js', 'utf8'), { filename: 'hotel-api.js', jsc: { parser: { syntax: 'ecmascript' }, target: 'es2022' }, module: { type: 'commonjs' } }).code;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require: name => { if (!(name in imports)) throw Error(name); return imports[name]; }, process: { env: { ANTHROPIC_API_KEY: 'fixture-only' } }, Buffer, TextDecoder, console });
  return { run: module.exports.default, calls };
}
async function invoke(file, fields, mappings, text) {
  const h = handler(file, fields, mappings), req = { method: 'POST', headers: { 'content-type': file ? 'multipart/form-data' : 'application/json' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ text })); } };
  const res = { status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
  await h.run(req, res); return res;
}
test('actual parse API accepts text, TXT, Excel and OCR without ERP writes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-parse-'));
  try {
    const text = '품명\t수량\t단위\n수국 화이트\t15\t송이';
    const a = await invoke(null, {}, [], text); assert.equal(a.code, 200); assert.equal(a.data.items[0].qty, 15);
    const txt = path.join(dir, 'input.txt'); fs.writeFileSync(txt, text);
    const b = await invoke({ filepath: txt, originalFilename: 'input.txt' }); assert.equal(b.code, 200); assert.equal(b.data.sourceType, 'text'); assert.equal(fs.existsSync(txt), false);
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['품명','수량','단위'], ['수국 화이트',15,'송이']]), '요청');
    const xlsx = path.join(dir, 'input.xlsx'); XLSX.writeFile(book, xlsx);
    const c = await invoke({ filepath: xlsx, originalFilename: 'input.xlsx' }); assert.equal(c.code, 200); assert.equal(c.data.items[0].qty, 15);
    const img = path.join(dir, 'input.png'); fs.writeFileSync(img, 'fixture');
    const d = await invoke({ filepath: img, originalFilename: 'input.png', mimetype: 'image/png' }); assert.equal(d.code, 200); assert.equal(d.data.sourceType, 'image'); assert.equal(d.data.items[0].qty, 15);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('multiple sheets require explicit selection; conflicting saved mappings require review', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-parse-'));
  try {
    const book = XLSX.utils.book_new(); for (const name of ['요청', '발주']) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['품명','수량','단위'], ['수국 화이트',15,'송이']]), name);
    const xlsx = path.join(dir, 'input.xlsx'); XLSX.writeFile(book, xlsx);
    const a = await invoke({ filepath: xlsx, originalFilename: 'input.xlsx' }); assert.deepEqual([...a.data.sheetNames], ['요청', '발주']);
    XLSX.writeFile(book, xlsx);
    const b = await invoke({ filepath: xlsx, originalFilename: 'input.xlsx' }, { sheet: '발주' }); assert.equal(b.data.items[0].qty, 15);
    const c = await invoke(null, {}, [{ ItemName: '수국 화이트', ProdKey: 10 }, { ItemName: '수국 화이트', ProdKey: 11 }], '품명\t수량\t단위\n수국 화이트\t15\t송이');
    assert.equal(c.data.items[0].prodKey, null); assert.match(c.data.items[0].matchWarning, /충돌/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
