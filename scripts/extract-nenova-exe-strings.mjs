/**
 * Extract readable Unicode strings from Nenova.exe (dnSpy 보조)
 * node scripts/extract-nenova-exe-strings.mjs "FormPrint"
 */
import fs from 'fs';

const exePath = process.argv[2] || 'C:\\Program Files (x86)\\Wooribnc\\Nenova\\Nenova.exe';
const filter = process.argv[3] || '';

const buf = fs.readFileSync(exePath);
const utf16 = buf.toString('utf16le');
const re = /[\uAC00-\uD7A3a-zA-Z_][\uAC00-\uD7A3a-zA-Z0-9_./\s:,\-]{4,120}/g;
const seen = new Set();
const hits = [];
for (const m of utf16.matchAll(re)) {
  const s = m[0].trim();
  if (s.length < 6 || seen.has(s)) continue;
  seen.add(s);
  if (!filter || s.toLowerCase().includes(filter.toLowerCase())) hits.push(s);
}
hits.sort();
for (const h of hits.slice(0, 200)) console.log(h);
console.error(`\n--- ${hits.length} strings (filter="${filter}") ---`);
