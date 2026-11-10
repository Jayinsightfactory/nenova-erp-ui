// Server-only, bounded, read-only evidence. Never trusts index/request proof flags.
import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import { arrivalDriveCandidate, isColombiaAwbFile, selectArrivalDriveCandidates, normalizeArrivalDriveWeek } from './arrivalDrivePolicy.js';
import { parsePrintedDate } from './importAwbFields.js';

export function awbNumbers(text) {
  const matches = [...String(text).matchAll(/(?:^|[^\d])(\d{3})[\s-]?(\d{7})[\s-]?(\d)(?!\d)/g)];
  return [...new Set(matches.filter(m => Number(m[2]) % 7 === Number(m[3])).map(m => m[1] + m[2] + m[3]))];
}
export function workbookAwb(bytes) {
  const book = XLSX.read(bytes, { type: 'buffer', sheetRows: 300, cellFormula: false });
  const numbers = new Set();
  for (const name of book.SheetNames.slice(0, 30)) {
    const rows = XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: true });
    for (const row of rows) {
      // Only labelled header rows, never arbitrary telephone/account/product numbers.
      const line = row.slice(0, 50).join(' ');
      if (/\bAWB\b|air\s*way\s*bill|항공\s*운송장/i.test(line)) awbNumbers(line).forEach(n => numbers.add(n));
    }
  }
  return numbers.size === 1 ? [...numbers][0] : '';
}
// Bind business year to execution-date fields, not copyright dates or mtime.
export function colombiaAwbOriginal(text) {
  const value = String(text || '');
  if (!/air\s*way\s*bill/i.test(value) || !/shipper'?s?\s+name\s+and\s+address/i.test(value)
    || !/consignee'?s?\s+name\s+and\s+address/i.test(value) || !/colombia|콜롬비아/i.test(value)) return null;
  const dates = [];
  for (const label of value.matchAll(/Executed on\s*\(date\)/gi)) {
    const around = value.slice(Math.max(0,label.index-200),label.index+label[0].length+100);
    for (const m of around.matchAll(/\b(?:\d{1,2}[-\s][A-Za-z]+[-\s](?:\d{4}|\d{2})|20\d{2}[/-]\d{1,2}[/-]\d{1,2})\b/g)) {
      const date = parsePrintedDate(m[0]);if(date)dates.push(date);
    }
  }
  const distinct=[...new Set(dates)];
  const numbers=awbNumbers(value);
  return distinct.length===1 && numbers.length===1 ? {year:distinct[0].slice(0,4),date:distinct[0],number:numbers[0]} : null;
}
export async function pdfAwbText(bytes, { timeoutMs = 5000 } = {}) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false,
    disableFontFace: true, stopAtErrors: true });
  let timer;
  try {
    return await Promise.race([(async () => {
      const doc = await task.promise;
      if (doc.numPages > 10) throw new Error('AWB 페이지 범위 확인 필요');
      let text = '';
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i), content = await page.getTextContent();
        text += content.items.map(x => x.str || '').join(' ') + '\n';
        if (text.length > 100000) throw new Error('AWB 본문 범위 확인 필요');
      }
      return text;
    })(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('AWB 본문 확인 시간초과')), timeoutMs); })]);
  } finally { clearTimeout(timer); await task.destroy(); }
}
function verifiedBytes(file, readBytes) {
  const bytes = readBytes(file);
  if (!Buffer.isBuffer(bytes) || bytes.length > 20 * 1024 * 1024 || !/^[a-f0-9]{64}$/i.test(file.sha || '')
    || crypto.createHash('sha256').update(bytes).digest('hex') !== file.sha) throw new Error('원본 해시 확인 필요');
  return bytes;
}
export async function collectArrivalDriveAwbEvidence(files, config, { readBytes, extractPdf = pdfAwbText } = {}) {
  const evidence = new Map();
  if (!config.countries.includes('콜롬비아')) return evidence;
  const selected = new Set(selectArrivalDriveCandidates(files, config).filter(c => c.country === '콜롬비아').map(c => c.id));
  const costs = files.filter(f => selected.has(f.id)).map(f => ({ file: f, candidate: arrivalDriveCandidate(f, config.year) }))
    .filter(x => x.candidate?.country === '콜롬비아' && !x.candidate.reason);
  for (const { file, candidate } of costs) {
    const proof = { sourceSha: file.sha, year: candidate.year, week: candidate.week,
      reason: '원가자료의 원본 AWB 번호·명시 연도 확인 필요' };
    evidence.set(file.id, proof);
    try {
      if (file.egressSnapshot || file.type === 'download'
        || /shared.awb|미승인|시험|test|generated|replay|계산본|산출물/i.test(file.filename)) continue;
      const years = [...new Set([...file.filename.matchAll(/(?:^|[^\d])(20\d{2})(?=[^\d]|$)/g)].map(m => m[1]))];
      if (years.length !== 1 || years[0] !== String(config.year)) continue;
      if (file.cycle !== undefined && file.cycle !== null && file.cycle !== ''
        && normalizeArrivalDriveWeek(file.cycle) !== candidate.week) continue;
      const number = workbookAwb(verifiedBytes(file, readBytes));
      if (!number) continue;
      proof.reason = 'AWB 원본의 동일 연도·차수·번호·본문 확인 필요';
      const matches = files.filter(f => isColombiaAwbFile(f, candidate.week, candidate.year))
        .filter(f => { const ids = awbNumbers(f.filename); return !ids.length || (ids.length === 1 && ids[0] === number); })
        .sort((a, b) => a.id.localeCompare(b.id));
      if (matches.length > 10) { proof.reason = 'AWB 후보가 많습니다. 원본 범위 확인 필요'; continue; }
      const accepted = [];
      const deadline = Date.now() + 15000;
      for (const awb of matches) {
        try {
          if (Date.now() >= deadline) break;
          const bytes = verifiedBytes(awb, readBytes);
          if (bytes.subarray(0, 5).toString() !== '%PDF-') continue;
          const text = await extractPdf(bytes, { timeoutMs: Math.min(5000, deadline - Date.now()) });
          const original = colombiaAwbOriginal(text);
          const weeks = [...text.matchAll(/(?:order\s*week|세부차수|차수)\s*[:=]?\s*(\d{1,2}-0?[1-4])/gi)]
            .map(m => normalizeArrivalDriveWeek(m[1]));
          if (!original || original.year !== candidate.year || original.number !== number
            || weeks.some(w => w !== candidate.week)
            || /미승인|시험용|test.only|shared.awb|generated|재검증용/i.test(text)) continue;
          const nameNumbers = awbNumbers(awb.filename);
          if (nameNumbers.length && (nameNumbers.length !== 1 || nameNumbers[0] !== number)) continue;
          accepted.push({ id: awb.id, sha: awb.sha, number });
          break;
        } catch { /* Invalid/unreadable evidence must not unlock the writer. */ }
      }
      if (!accepted.length) continue;
      accepted.sort((a, b) => a.id.localeCompare(b.id));
      proof.awb = accepted[0];
      proof.key = crypto.createHash('sha256').update(JSON.stringify([file.sha, candidate.year, candidate.week, proof.awb])).digest('hex');
      proof.reason = '';
    } catch { proof.reason = '원가자료 원본 형식·해시·AWB 번호 확인 필요'; }
  }
  return evidence;
}
