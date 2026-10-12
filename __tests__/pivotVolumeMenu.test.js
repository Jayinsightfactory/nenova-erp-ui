import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shiftOrderWeek } from '../lib/orderUtils.js';

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
assert.doesNotMatch(page, /<select\b/,
  '차수 선택은 드롭다운 대신 한눈에 보이는 버튼 목록이어야 합니다.');
assert.match(page, /role="radiogroup" aria-label=\{`\$\{group\.label\} 선택`\}/,
  '시작/끝 차수 버튼은 보조기술에 선택 그룹으로 전달되어야 합니다.');
assert.match(page, /for \(let offset = 0; offset <= 5; offset \+= 1\)/,
  '기준 차수부터 다음 5차수까지만 빠른 선택 버튼으로 보여야 합니다.');
assert.match(page, /범위 밖 직접 입력/,
  '빠른 선택 범위를 넘는 차수는 시작/끝 차수별로 직접 입력할 수 있어야 합니다.');
assert.match(page, /normalizeRoundInput/,
  '직접 입력 차수는 연도 내 유효 범위인 01-01~52-04로 검증해야 합니다.');
assert.match(page, /shiftOrderWeek\(current, 1\)/,
  '빠른 선택 차수 계산은 공통 주문 차수 이동 규칙을 사용해야 합니다.');
assert.match(page, /roundOrdinal\(next\) <= roundOrdinal\(current\)/,
  '연도 마지막 차수에서 빠른 선택이 차수 순서를 역행하거나 순환하지 않아야 합니다.');
assert.equal(shiftOrderWeek('41-04', 1), '42-01', '본차수 경계에서는 다음 본차수의 첫 세부차수로 이동해야 합니다.');
assert.equal(shiftOrderWeek('52-04', 1), '52-01', '공통 차수 이동기의 연도 마지막 경계는 순환하므로 UI에서 이를 차단해야 합니다.');
assert.match(page, /role="radio"[\s\S]*?aria-checked=\{active\}/,
  '현재 선택된 차수 버튼은 활성 상태를 접근성 속성으로 표시해야 합니다.');
assert.match(page, /tabIndex=\{active \|\| \(!quickWeeks\.includes\(group\.value\) && index === 0\) \? 0 : -1\}/,
  '차수 버튼 그룹은 활성 버튼을 탭 정지점으로 하고, 직접 입력 차수가 선택된 경우 첫 빠른 선택 버튼을 탭 정지점으로 유지해야 합니다.');
assert.match(page, /\.week-choice-button\[aria-checked="true"\][\s\S]*?background: #1764b0/,
  '활성 차수 버튼은 채워진 강조색으로 보여야 합니다.');
for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
  assert.ok(page.includes(key), `${key} 키로 차수 버튼 사이를 이동할 수 있어야 합니다.`);
}
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
