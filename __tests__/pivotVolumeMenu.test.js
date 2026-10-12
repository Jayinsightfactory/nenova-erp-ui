import assert from 'node:assert/strict';
import fs from 'node:fs';

const menu = fs.readFileSync('components/Layout.js', 'utf8');
const pivot = fs.readFileSync('pages/stats/pivot.js', 'utf8');
const page = fs.readFileSync('pages/stats/volume-board.js', 'utf8');
const contract = JSON.parse(fs.readFileSync('docs/contracts/pivot-stats.json', 'utf8'));

assert.match(menu, /href:\s*'\/stats\/volume-board',\s*labelKey:\s*'물량표',\s*popup:\s*true/,
  '물량표는 공통 메뉴에서 새 팝업 화면으로 열려야 합니다.');
assert.equal((menu.match(/labelKey:\s*'물량표'/g) || []).length, 1,
  '물량표 메뉴는 한 번만 등록해야 합니다.');
assert.match(pivot, /onClick=\{handleVolumeExcel\}[^\n]*물량표 다운받기/,
  '기존 전체 통합 물량표 다운로드는 유지해야 합니다.');
assert.doesNotMatch(pivot, /차수·품종별\(선택\)|const openPick|const downloadPicked/,
  '품종 선택 다운로드 진입 버튼은 기존 피벗에서 제거해야 합니다.');

assert.match(page, /\/api\/stats\/pivot-weeks\?/,
  '새 화면은 선택 연도의 실제 입력 차수를 읽어야 합니다.');
assert.match(page, /aria-label="시작 차수"/);
assert.match(page, /aria-label="끝 차수"/);
assert.match(page, /list:\s*'1'/,
  '선택한 연도·차수 범위에 대한 품종 목록을 기존 API로 읽어야 합니다.');
assert.match(page, /species:\s*item\.key/,
  '개별 파일 생성은 선택한 품종 키를 기존 API에 전달해야 합니다.');
assert.match(page, /combineSubweeks:\s*'1'/,
  '기존 동일 본차수 세부차수 합산 옵션을 보존해야 합니다.');
assert.doesNotMatch(page, /method:\s*['"](POST|PUT|PATCH|DELETE)['"]|\/api\/(orders|shipment|warehouse)\//,
  '물량표 메뉴는 조회·다운로드만 하고 ERP 쓰기 API를 호출하지 않아야 합니다.');
assert.ok(contract.scope.includes('pages/stats/volume-board.js'),
  '신규 물량표 메뉴 페이지는 피벗 통계 계약 범위에 포함해야 합니다.');
assert.ok(contract.actions.some(action => action.name === 'PIVOT_VOLUME_MENU_SPECIES_DOWNLOAD'),
  '새 메뉴의 선택 다운로드와 원장 보존 계약을 선언해야 합니다.');

console.log('Pivot volume menu tests passed');
