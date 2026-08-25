const assert = require('node:assert/strict');
const fs = require('node:fs');

function main() {
  const hook = fs.readFileSync('hooks/useErpEditPresence.js', 'utf8');
  const banner = fs.readFileSync('components/ErpEditPresenceBanner.js', 'utf8');
  const estimate = fs.readFileSync('pages/estimate.js', 'utf8');
  const paste = fs.readFileSync('pages/orders/paste.js', 'utf8');
  const useApi = fs.readFileSync('lib/useApi.js', 'utf8');

  assert.match(hook, /sessionStorage\.getItem\(CLIENT_ID_KEY\)/, '탭별 작업 식별자는 sessionStorage에 보관해야 합니다.');
  assert.match(hook, /normalizeErpEditClientWeek/, '세부차수 순서가 달라도 같은 대차수 작업키를 사용해야 합니다.');
  assert.match(hook, /HEARTBEAT_MS = 20_000/, '작업권 연장은 20초 간격이어야 합니다.');
  assert.match(hook, /POLL_MS = 8_000/, '외부 변경 확인은 8초 간격이어야 합니다.');
  assert.doesNotMatch(hook, /if \(!current\.token \|\| savingRef\.current > 0\)/, '저장 중에도 작업권 연장은 멈추면 안 됩니다.');
  assert.match(hook, /endSaving[\s\S]{0,260}?refreshBaseline/, '성공한 전체 저장만 기준값을 새로 받아들일 수 있어야 합니다.');
  assert.match(hook, /stale: Boolean\(data\?\.stale\)/, '서버의 stale 상태를 화면 차단 상태에 반영해야 합니다.');
  assert.match(hook, /scopeMatches[\s\S]{0,220}blocked/, '업체를 바꾸는 순간 이전 업체의 작업권으로 저장할 수 없어야 합니다.');
  assert.match(useApi, /error\.code = data\.code/, '공용 API 호출도 편집 충돌 코드를 화면까지 보존해야 합니다.');

  assert.match(banner, /nenova\.exe 또는 다른 화면에서 값이 변경되었습니다\. 새로고침 후 다시 확인하세요\./, '전산 또는 다른 화면 변경 경고를 한글로 고정 표시해야 합니다.');
  assert.match(banner, /님이 .* 이 업체를 작업 중입니다/, '다른 작업자 이름을 사용자에게 보여줘야 합니다.');
  assert.match(banner, /같은 계정의 다른 창/, '본인의 다른 창을 다른 사용자로 오인하지 않아야 합니다.');
  assert.match(banner, /이 창에서 계속 작업/, '본인 작업권은 새로고침 없이 명시적으로 넘겨받을 수 있어야 합니다.');
  assert.match(estimate, /const selectedEditWeek = weekNum \? String\(weekNum\)\.padStart\(2, '0'\)/, '견적서 작업권은 불안정한 SubWeeks 순서가 아니라 대차수로 고정해야 합니다.');

  for (const label of ['＋ 불량/검역등록', '＋ 불량차감등록', '＋ 판매요청', '＋ 추가 품목등록']) {
    assert.ok(estimate.includes(label), `${label} 버튼을 보존해야 합니다.`);
  }
  assert.match(estimate, /disabled=\{[^}]*estimateEditPresence\.blocked/, '견적서 저장/등록 버튼은 다른 작업 또는 외부 변경 시 차단해야 합니다.');
  assert.ok((estimate.match(/editGuard: estimateEditGuard\(\)/g) || []).length >= 7, '견적서의 모든 저장 경로는 작업 확인 정보를 함께 보내야 합니다.');
  assert.ok((estimate.match(/endSaving\(\{ refreshBaseline: saveSucceeded \}\)/g) || []).length >= 5, '견적서 저장은 전체 성공 시에만 기준값을 갱신해야 합니다.');
  assert.match(estimate, /custKey: selectedShip\?\.CustKey,[\s\S]{0,100}editGuard: estimateEditGuard\(\)/, '확정취소·재확정에도 선택 업체와 작업 확인값을 함께 보내야 합니다.');
  assert.match(estimate, /expectedProdKey:[\s\S]{0,220}expectedDescr:/, '견적 품목·단위·적요도 조회 후 변경 여부를 함께 검증해야 합니다.');

  assert.match(paste, /setInterval\(loadStatuses, 8_000\)/, '붙여넣기 업체 상태는 8초마다 다시 확인해야 합니다.');
  assert.match(paste, /pageCode: 'paste', clientId: pasteClientId/, '상태 조회도 현재 탭 식별값을 보내 자기 작업을 다른 사용자로 오인하지 않아야 합니다.');
  assert.match(paste, /expectedDigest: currentPresence\.digest \|\| ''/, '작업 시작 시 마지막 조회 기준을 서버와 다시 대조해야 합니다.');
  assert.match(paste, /if \(currentPresence\.stale\)/, '이미 외부 변경을 감지한 카드는 작업권을 새로 얻어 변경을 숨기면 안 됩니다.');
  assert.match(paste, /heartbeatErpEditPresence[\s\S]{0,180}20_000/, '붙여넣기 장시간 저장은 20초 작업권 연장을 유지해야 합니다.');
  assert.match(paste, /clearInterval\(guard\.heartbeatTimer\)/, '붙여넣기 작업 완료/실패 뒤 작업권 연장 타이머를 정리해야 합니다.');
  assert.match(paste, /pasteWriteError[\s\S]{0,220}ERP_EDIT_STALE/, '409 응답의 코드와 상태를 카드 고정 경고로 전달해야 합니다.');
  assert.match(paste, /acquireAllPasteGuards\(targets\.map\(t => t\.custKey\)\)[\s\S]{0,800}\/api\/shipment\/adjust-batch/, '전체 일괄은 모든 업체의 작업권을 먼저 얻은 뒤에만 저장해야 합니다.');
  assert.match(paste, /entries: targets\.map[\s\S]{0,1800}editGuard: guardByCust\.get/, '전체 일괄의 각 업체 행에는 해당 작업 확인 정보를 실어야 합니다.');
  assert.match(paste, /endPasteSaving\(pasteGuard, \{ refreshBaseline: saveSucceeded \}\)/, '붙여넣기 부분 성공/실패는 새 기준값을 자동 수용하면 안 됩니다.');
  assert.match(paste, /presence\.stale \|\| Boolean\(presence\.error\)/, '외부 변경이나 상태 확인 실패 중에는 전체 저장 버튼을 막아야 합니다.');
  assert.match(paste, /presence\.loading \|\| \(presence\.active/, '최초 작업 상태 확인이 끝나기 전에도 저장을 막아야 합니다.');
  assert.match(paste, /disabled=\{bulkRunning \|\| orderBlocked\}/, '업체별 분배 버튼도 작업 충돌 중에는 비활성화해야 합니다.');

  console.log('ERP edit presence UI contract tests passed');
}

try { main(); } catch (error) { console.error(error); process.exitCode = 1; }
