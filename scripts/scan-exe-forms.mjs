#!/usr/bin/env node
/** dnSpy export 폴더에서 GetData/GetDetail 메서드가 있는 Form 목록 출력 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EXE_FORM_REGISTRY } from '../lib/exeParity/registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DECOMPILED = process.env.NENOVA_DECOMPILED
  || path.join(process.env.USERPROFILE || '', 'nenova-decompiled', 'Nenova');

if (!fs.existsSync(DECOMPILED)) {
  console.error('decompiled folder not found:', DECOMPILED);
  process.exit(1);
}

const files = fs.readdirSync(DECOMPILED).filter((f) => f.startsWith('Form') && f.endsWith('.cs') && !f.includes('Designer'));

console.log('=== dnSpy Form SQL 메서드 스캔 ===');
console.log('path:', DECOMPILED, '\n');

for (const file of files.sort()) {
  const text = fs.readFileSync(path.join(DECOMPILED, file), 'utf8');
  const methods = [];
  if (/private void GetData\s*\(/.test(text)) methods.push('GetData');
  if (/private DataTable GetDetail\s*\(/.test(text)) methods.push('GetDetail');
  if (/GetPrintDetail\s*\(/.test(text)) methods.push('GetPrintDetail');
  if (/GetExcelDetail\s*\(/.test(text)) methods.push('GetExcelDetail');
  const formName = file.replace(/\.cs$/, '');
  const reg = EXE_FORM_REGISTRY.find((r) => r.form === formName);
  const status = reg?.status || '—';
  const lib = reg?.lib || '—';
  console.log(`${file.padEnd(32)} ${methods.join(', ') || '(no GetData)'}`);
  console.log(`  registry: ${status}  lib: ${lib}`);
}

console.log('\n=== 포팅 우선순위 (audit/partial) ===');
for (const f of EXE_FORM_REGISTRY.filter((x) => x.status !== 'ported')) {
  console.log(`[${f.status}] ${f.form} → ${f.webRoutes.join(', ')}`);
}
