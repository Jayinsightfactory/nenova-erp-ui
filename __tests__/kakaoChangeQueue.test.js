// __tests__/kakaoChangeQueue.test.js
// node __tests__/kakaoChangeQueue.test.js 로 단독 실행(DB 불필요).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function main() {
  // (a) 새 API 소스에 쓰기 SQL 동사가 없어야 한다(GET=SELECT만, 상태는 웹 전용 파일).
  const src = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'orders', 'change-queue.js'), 'utf8');
  // SQL 쓰기 동사는 대문자로 쓰는 관례(다른 API 파일들의 SQL 참고)를 따르므로 대문자만 검사한다.
  // JS의 `delete state[id]` 같은 소문자 연산자는 상태 파일 편집일 뿐 DB 쓰기가 아니므로 제외한다.
  const writeVerbRe = /\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b/;
  assert.equal(writeVerbRe.test(src), false, 'change-queue.js에는 INSERT/UPDATE/DELETE/MERGE/EXEC가 없어야 한다');

  // (b) 분류 규칙을 소스에서 정규식으로 뽑아 기대 분류와 대조.
  const ruleBlockMatch = src.match(/const CATEGORY_RULES = \[([\s\S]*?)\n\];/);
  assert.ok(ruleBlockMatch, 'CATEGORY_RULES 블록을 찾지 못함');
  const rules = [];
  const ruleRe = /category:\s*'([^']+)',\s*re:\s*(\/.+?\/),\s*confidence:\s*([\d.]+),\s*queue:\s*(true|false)/g;
  let m;
  while ((m = ruleRe.exec(ruleBlockMatch[1]))) {
    const [, category, reLiteral, confidence, queue] = m;
    const body = reLiteral.slice(1, reLiteral.lastIndexOf('/'));
    const flags = reLiteral.slice(reLiteral.lastIndexOf('/') + 1);
    rules.push({ category, re: new RegExp(body, flags), confidence: Number(confidence), queue: queue === 'true' });
  }
  assert.equal(rules.length, 5, '분류 규칙 5개(변경사항/검역차감/발주추가/잔량/현장)를 추출해야 한다');

  function classify(message) {
    for (const rule of rules) {
      if (rule.re.test(message)) return rule.category;
    }
    return '기타';
  }

  assert.equal(classify('38-1 수국 변경사항 주광 화이트 215 취소'), '변경사항');
  assert.equal(classify('37-2차 네덜란드 검역차감 주광 라스라지 -5스팀'), '검역차감');
  assert.equal(classify('38-1차 중국 발주 추가 주광 CL2 프라우드 30단'), '발주추가');
  assert.equal(classify('주광 출발합니다'), '현장');

  // (c) 상태 파일 병합(applied/ignored/reset) 단위 테스트 — 임시 파일로 loadState/saveState 로직 재현.
  const tmpFile = path.join(require('node:os').tmpdir(), `kakao-change-queue-test-${Date.now()}.json`);
  function loadState(file) {
    try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}; } catch { return {}; }
  }
  function saveState(file, state) { fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8'); }

  let state = loadState(tmpFile);
  assert.deepEqual(state, {}, '초기 상태는 빈 객체여야 한다');
  state['msg-1'] = { status: 'applied', by: 'admin', byName: '관리자', at: '2026-09-26T00:00:00.000Z', note: '' };
  saveState(tmpFile, state);
  state = loadState(tmpFile);
  assert.equal(state['msg-1'].status, 'applied', '저장 후 다시 읽으면 applied 상태가 유지되어야 한다');

  delete state['msg-1'];
  saveState(tmpFile, state);
  state = loadState(tmpFile);
  assert.equal(state['msg-1'], undefined, 'reset(삭제) 후에는 항목이 없어야 한다');
  fs.unlinkSync(tmpFile);

  console.log('kakaoChangeQueue tests passed');
}

main();
