#!/usr/bin/env node
// 쉬운 글(data/handover-plain-<부서id>.json)이 「따라 하는 사람이 읽기 쉬운 글」 기준을 지키는지 검사한다.
//   node scripts/validate-handover-plain.cjs                → 쉬운 글 파일이 있는 부서 전부
//   node scripts/validate-handover-plain.cjs import         → 한 부서
//   node scripts/validate-handover-plain.cjs field <원고.json> → 원고 파일을 따로 지정(아직 본편에 없는 원고로 미리 볼 때)
// 기준(2026-11-22 사장님: 매뉴얼을 직접 읽어 봤을 때 이해하기 쉬워야 한다)
//   · 쉬운 글에는 할 일만 쓴다. 근거(날짜 · 건수 · 출처 · 추정)는 원고에 남기고 화면에서 「자세히 · 근거」로 접어 보여 준다.
//   · 매뉴얼마다 한 줄 설명 · 왜 · 언제 · 준비 · 모든 단계(무엇을 보고 · 무엇을 넣고 · 왜) · 끝 확인 · 자주 틀리는 곳 · 다음 일이 있어야 한다.
//   · 길이 제한을 넘거나 쓰지 않는 표현이 있으면 실패.
const fs = require('node:fs'), path = require('node:path');
const repo = path.join(__dirname, '..');
const DEPTS = { import: 'import-handover.json', 'sales-support': 'handover-sales-support.json', sales: 'handover-sales.json', management: 'handover-management.json', field: 'handover-field.json' };
const LIMIT = { oneLine: 70, why: 120, when: 130, next: 90, prepare: 70, doneCheck: 70, mistake: 60, fix: 120, look: 90, input: 110, stepWhy: 80, detail: 120 };
// 쓰지 않는 표현: 근거 · 출처 · 불확실 표시와 내부 표기. (시각 「8~10시」, 기준 「85%」, 「오후 4시」 같은 지시에 필요한 숫자는 쓴다)
const BAD = [
  [/추정|미검증|확인 필요|확인하지 못|알 수 없/, '불확실 표시(모르는 것은 쉬운 글에 쓰지 않는다)'],
  [/사장님|관리자 답|설명\)/, '출처 표시'],
  [/관측|기록에|기록으로|화면 기록|카카오톡 기록|전산 기록|표본/, '근거 설명'],
  [/\d{1,2}월 \d{1,2}일|\d{1,2}\/\d{1,2}\b|20\d\d-\d\d/, '날짜'],
  [/\d[\d,]*\s*(건|곳 중|번 모두|줄)(?![가-힣])|\d+\s*차수\s*(모두|중)|\d+일 중/, '건수 통계'],
  [/IC\d|NN-0|낱건|\bSCR\b|\bDB\b/, '내부 표기'],
  [/감시|추적|모니터링|근태|성실|야근|피로|게으/, '쓰지 않는 말'],
  [/01[016789][- ]?\d{3,4}[- ]?\d{4}|[\w.+-]+@[\w-]+\.[\w.-]+/, '연락처'],
];
const text = (v) => typeof v === 'string' && v.trim().length > 0;

function checkText(at, v, max, out) {
  if (!text(v)) { out.push(`${at}: 비어 있음`); return; }
  if (v.length > max) out.push(`${at}: ${v.length}자(최대 ${max}자) — 「${v.slice(0, 30)}…」`);
  for (const [re, why] of BAD) { const m = v.match(re); if (m) out.push(`${at}: ${why} 「${m[0]}」`); }
  if ((v.match(/\(/g) || []).length > 1) out.push(`${at}: 괄호가 둘 이상 — 문장을 나누거나 괄호 안 설명을 뺀다`);
}

function check(id, baseFile) {
  const out = [];
  const plainFile = path.join(repo, 'data', `handover-plain-${id}.json`);
  if (!fs.existsSync(plainFile)) return [`쉬운 글 파일 없음: data/handover-plain-${id}.json`];
  const plain = JSON.parse(fs.readFileSync(plainFile, 'utf8'));
  const base = JSON.parse(fs.readFileSync(baseFile || path.join(repo, 'data', DEPTS[id]), 'utf8'));
  if (plain.version !== 1) out.push('version 1 필요');
  if (plain.dept !== id) out.push(`dept 는 「${id}」`);
  const ids = new Set((base.manuals || []).map((m) => m.id));
  for (const k of Object.keys(plain.manuals || {})) if (!ids.has(k)) out.push(`원고에 없는 매뉴얼: ${k}`);
  for (const m of base.manuals || []) {
    const p = plain.manuals?.[m.id]; const at = `매뉴얼 ${m.id}`;
    if (!p) { out.push(`${at}: 쉬운 글 없음`); continue; }
    checkText(`${at} 한 줄`, p.oneLine, LIMIT.oneLine, out);
    checkText(`${at} 왜`, p.why, LIMIT.why, out);
    checkText(`${at} 언제`, p.when, LIMIT.when, out);
    checkText(`${at} 다음 일`, p.next, LIMIT.next, out);
    for (const [k, max] of [['prepare', LIMIT.prepare], ['doneCheck', LIMIT.doneCheck]]) {
      if (!Array.isArray(p[k]) || !p[k].length) out.push(`${at} ${k}: 한 줄 이상`);
      else p[k].forEach((v, i) => checkText(`${at} ${k}[${i + 1}]`, v, max, out));
    }
    if (!Array.isArray(p.pitfalls) || !p.pitfalls.length) out.push(`${at} pitfalls: 한 줄 이상`);
    else p.pitfalls.forEach((x, i) => { checkText(`${at} 실수[${i + 1}]`, x?.mistake, LIMIT.mistake, out); checkText(`${at} 처리[${i + 1}]`, x?.fix, LIMIT.fix, out); });
    const want = (m.steps || []).map((s) => String(s.no));
    const got = Object.keys(p.steps || {});
    for (const no of got) if (!want.includes(no)) out.push(`${at}: 원고에 없는 단계 ${no}`);
    for (const no of want) {
      const s = p.steps?.[no];
      if (!s) { out.push(`${at} ${no}단계: 쉬운 글 없음`); continue; }
      checkText(`${at} ${no}단계 무엇을 보고`, s.look, LIMIT.look, out);
      checkText(`${at} ${no}단계 무엇을 넣고`, s.input, LIMIT.input, out);
      checkText(`${at} ${no}단계 왜`, s.why, LIMIT.stepWhy, out);
    }
  }
  const rows = ['daily', 'weekly', 'monthly'].flatMap((k) => base.schedule?.[k] || []);
  const rowIds = new Set(rows.map((r) => r.id));
  for (const k of Object.keys(plain.schedule || {})) if (!rowIds.has(k)) out.push(`원고에 없는 업무표 줄: ${k}`);
  for (const r of rows) {
    if (!text(r.detail)) continue;
    const d = plain.schedule?.[r.id]?.detail;
    if (!text(d)) out.push(`업무표 ${r.id}: 쉬운 설명 없음`); else checkText(`업무표 ${r.id}`, d, LIMIT.detail, out);
  }
  return out;
}
module.exports = { check, DEPTS, LIMIT };
if (require.main === module) {
  const [id, baseFile] = process.argv.slice(2);
  const targets = id ? [id] : Object.keys(DEPTS).filter((d) => fs.existsSync(path.join(repo, 'data', `handover-plain-${d}.json`)));
  if (!targets.length) { console.log('쉬운 글 파일이 아직 없습니다'); process.exit(0); }
  let bad = 0;
  for (const d of targets) { const out = check(d, baseFile); if (out.length) { bad++; console.log(`✗ ${d} (${out.length})\n  - ` + out.slice(0, 60).join('\n  - ') + (out.length > 60 ? `\n  … 외 ${out.length - 60}건` : '')); } else console.log(`✓ ${d}`); }
  process.exit(bad ? 1 : 0);
}
