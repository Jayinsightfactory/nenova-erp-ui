#!/usr/bin/env node
// 수정안의 「업무 연결」 여섯 줄 검사 (2026-11-26 사장님 지정).
//   화면마다 "어느 직원 업무의 어느 단계를 대신하려는가"를 만들 때 적어 두지 않으면 나중에 거꾸로 맞혀야 한다.
//   수정안 본문 또는 저장 기록 본문 중 한 곳에 여섯 줄이 다 있으면 통과. "대응 업무 없음"·"화면 없음"도 답으로 인정한다.
//   CUTOFF 이전에 연 수정안은 검사하지 않는다.
const { execFileSync } = require('node:child_process');

const CUTOFF = '2026-11-27T00:00:00Z';
const KINDS = ['새로 만듦', '직원이 쓰다 걸린 것 고침', 'AI가 만든 것을 다시 고침', '보기만 바꿈'];
const FIELDS = [
  { key: '화면', hint: '주소(/로 시작) 또는 「화면 없음 — 계산·자료·점검」', ok: (v) => /^\/[\w\-/[\]]*/.test(v) || v.includes('화면 없음') },
  { key: '대신하는 업무', hint: '부서 · 업무 이름 · 몇 번째 단계, 없으면 「대응 업무 없음 — 누구를 위한 것」' },
  { key: '없애려는 것', hint: '엑셀 파일 · 대화방 글 · 다시 넣기 중 무엇(없으면 「없음」과 이유)' },
  { key: '종류', hint: KINDS.join(' / '), ok: (v) => KINDS.some((k) => v.includes(k)) },
  { key: '누가 언제 여나', hint: '부서와 시작 신호' },
  { key: '2주 뒤 셀 것', hint: '사용 건수와, 없애려던 엑셀·글이 줄었는지' },
];
const PLACEHOLDER = /^(<[^>]*>|\(.*\)|-|tbd|todo|미정|\.+)$/i;

// 글에서 여섯 줄을 읽는다. { 값들, 문제 목록 }
function parseWorkLink(text) {
  const values = {}; const problems = [];
  const lines = String(text || '').split(/\r?\n/);
  for (const f of FIELDS) {
    const re = new RegExp(`^\\s*(?:[-*]\\s*)?(?:\\*\\*)?${f.key}(?:\\*\\*)?\\s*[:：]\\s*(.*)$`);
    const hit = lines.map((l) => l.match(re)).find(Boolean);
    const v = hit ? hit[1].replace(/<!--.*?-->/g, '').trim() : '';
    values[f.key] = v;
    if (!hit) problems.push(`「${f.key}」 줄이 없음 — ${f.hint}`);
    else if (v.length < 2 || PLACEHOLDER.test(v)) problems.push(`「${f.key}」가 비어 있음 — ${f.hint}`);
    else if (f.ok && !f.ok(v)) problems.push(`「${f.key}」 값이 형식과 다름(${v.slice(0, 30)}) — ${f.hint}`);
  }
  return { values, problems };
}

// 여러 글 가운데 하나라도 여섯 줄이 다 맞으면 통과. 아니면 가장 덜 틀린 글의 문제를 돌려준다.
function checkTexts(texts) {
  let best = null;
  for (const t of texts.filter((x) => String(x || '').trim())) {
    const r = parseWorkLink(t);
    if (!r.problems.length) return { ok: true, values: r.values, problems: [] };
    if (!best || r.problems.length < best.problems.length) best = r;
  }
  return { ok: false, values: best ? best.values : {}, problems: best ? best.problems : FIELDS.map((f) => `「${f.key}」 줄이 없음 — ${f.hint}`) };
}

function main() {
  const createdAt = process.env.PR_CREATED_AT || '';
  if (!createdAt) { console.log('[work-link] 수정안이 아님 — 건너뜀'); return 0; }
  if (createdAt < CUTOFF) { console.log(`[work-link] ${CUTOFF} 이전에 연 수정안(${createdAt}) — 건너뜀`); return 0; }
  const texts = [];
  const num = process.env.PR_NUMBER;
  if (num) { try { texts.push(execFileSync('gh', ['pr', 'view', String(num), '--json', 'body', '-q', '.body'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch { /* 지금 본문을 못 읽으면 처음 본문으로 */ } }
  texts.push(process.env.PR_BODY || '');
  const base = process.env.BASE_SHA;
  if (base) { try { texts.push(...execFileSync('git', ['log', '--no-merges', '--format=%B%x00', `${base}..HEAD`], { encoding: 'utf8' }).split('\0')); } catch { /* 저장 기록을 못 읽으면 본문만 본다 */ } }
  const r = checkTexts(texts);
  if (r.ok) { console.log('[PASS] work-link: 업무 연결 여섯 줄 확인 — ' + FIELDS.map((f) => `${f.key}=${r.values[f.key].slice(0, 24)}`).join(' | ')); return 0; }
  console.log('[FAIL] work-link: 수정안 본문(또는 저장 기록 본문)에 「업무 연결」 여섯 줄을 채워 주세요.');
  for (const p of r.problems) console.log('  - ' + p);
  console.log('  양식은 .github/pull_request_template.md 의 「업무 연결」 칸. 본문을 고친 뒤 이 검사를 다시 돌리면 됩니다.');
  return 1;
}

module.exports = { parseWorkLink, checkTexts, FIELDS, KINDS, CUTOFF };
if (require.main === module) process.exit(main());
