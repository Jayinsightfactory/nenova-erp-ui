// 수정안 「업무 연결」 여섯 줄 검사 — 양식과 검사기가 서로 맞는지, 빈 칸·틀린 종류를 잡는지.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseWorkLink, checkTexts, FIELDS, KINDS } = require('../scripts/check-pr-work-link.cjs');

const good = `## 업무 연결
- 화면: /import/tools
- 대신하는 업무: 수입부 · 패킹리스트 만들기 · 2~4단계
- 없애려는 것: 인보이스를 보고 엑셀에 옮겨 적기
- 종류: 직원이 쓰다 걸린 것 고침
- 누가 언제 여나: 수입부, 인보이스가 메일로 올 때
- 2주 뒤 셀 것: 사용 건수와 그 엑셀이 열린 횟수`;

test('여섯 줄이 다 있으면 통과', () => {
  assert.deepEqual(parseWorkLink(good).problems, []);
  assert.equal(checkTexts(['', '다른 글', good]).ok, true, '여러 글 중 하나만 맞아도 통과');
});

test('「화면 없음」「대응 업무 없음」도 답으로 인정', () => {
  const t = good.replace('/import/tools', '화면 없음 — 계산').replace('수입부 · 패킹리스트 만들기 · 2~4단계', '대응 업무 없음 — 개발 점검용');
  assert.deepEqual(parseWorkLink(t).problems, []);
});

test('빠진 줄 · 빈 칸 · 틀린 종류 · 주소 아닌 화면을 잡는다', () => {
  assert.equal(parseWorkLink('').problems.length, FIELDS.length);
  assert.equal(parseWorkLink(good.replace('- 2주 뒤 셀 것: 사용 건수와 그 엑셀이 열린 횟수', '')).problems.length, 1);
  assert.equal(parseWorkLink(good.replace('직원이 쓰다 걸린 것 고침', '버그 수정')).problems.length, 1);
  assert.equal(parseWorkLink(good.replace('/import/tools', '수입부 화면')).problems.length, 1);
  assert.equal(parseWorkLink(good.replace('수입부, 인보이스가 메일로 올 때', '<!-- 부서와 시작 신호 -->')).problems.length, 1, '안내 글만 남긴 칸은 빈 칸');
  assert.equal(checkTexts(['아무 글']).ok, false);
});

test('수정안 양식에 여섯 줄과 종류 네 가지가 들어 있고, 양식 그대로는 통과하지 못한다', () => {
  const tpl = fs.readFileSync(path.join(__dirname, '..', '.github', 'pull_request_template.md'), 'utf8');
  for (const f of FIELDS) assert.ok(new RegExp(`^- ${f.key}:`, 'm').test(tpl), `양식에 「${f.key}」 줄`);
  for (const k of KINDS) assert.ok(tpl.includes(k), `양식에 종류 「${k}」`);
  assert.equal(parseWorkLink(tpl).problems.length, FIELDS.length, '채우지 않은 양식은 여섯 줄 모두 빈 칸');
  assert.ok(tpl.includes('## 변경 계약'), '기존 점검 줄은 그대로');
});
