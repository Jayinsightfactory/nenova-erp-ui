const fs = require('fs');

const uiSrc = fs.readFileSync('pages/shipment/distribute-import.js', 'utf8');
const apiSrc = fs.readFileSync('pages/api/shipment/distribute-import-apply.js', 'utf8');
const progressSrc = fs.readFileSync('lib/importApplyProgress.js', 'utf8');

function check(label, condition) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`PASS ${label}`);
}

console.log('\n=== 출고분배 업로드 504 응답 복구 계약 ===');
check('504/비JSON 응답은 로그인 만료로 단정하지 않고 jobId로 결과 조회',
  uiSrc.includes('data = await recoverApplyResult();') &&
  uiSrc.includes('[502, 503, 504].includes(res.status)') &&
  uiSrc.includes('실제 처리 상태를 자동 확인 중입니다'));
check('네트워크가 fetch 자체를 끊어도 동일 jobId로 결과 조회',
  /try \{\s*res = await fetch\('\/api\/shipment\/distribute-import-apply'/.test(uiSrc) &&
  /\} catch \{\s*data = await recoverApplyResult\(\);/.test(uiSrc));
check('실제 401/403만 재로그인 안내',
  /res\.status === 401 \|\| res\.status === 403/.test(uiSrc));
check('완료 progress에 적용 결과를 보존',
  progressSrc.includes('p.result = result') && apiSrc.includes("result }"));
check('서버 실패도 progress에 구조화해 보존',
  progressSrc.includes('p.error = error') && apiSrc.includes('statusCode: Number(e.statusCode) || 500'));
check('응답 단절 후 중복 POST 없이 GET progress만 폴링',
  uiSrc.includes('distribute-import-apply-progress?jobId=') &&
  uiSrc.includes('재실행하지 마세요'));

console.log('\n=== RESULT: all passed ===');
