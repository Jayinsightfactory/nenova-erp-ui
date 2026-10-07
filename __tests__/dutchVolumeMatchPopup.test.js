import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const board = read('../pages/stats/dutch-volume-board.js');
const picker = read('../components/dutch/ErpMatchPicker.js');
const popup = read('../pages/stats/dutch-volume-match.js');
const sheet = read('../components/dutch/DutchVolumeSheet.js');
const agents = read('../AGENTS.md');
const layoutContract = read('../docs/UI_LAYOUT_AND_MENU_CONTRACT.md');

assert.match(board, /window\.open\(`\/stats\/dutch-volume-match\?\$\{params\.toString\(\)\}`/, '미매칭 선택은 현재 화면 대신 별도 창을 열어야 합니다.');
assert.match(board, /popup: '1'/, '매칭 창은 메뉴 없는 간소 팝업 화면이어야 합니다.');
assert.match(board, /event\.origin !== window\.location\.origin/, '팝업 메시지는 동일 출처만 받아야 합니다.');
assert.match(board, /event\.source !== pending\.popup/, '현재 작업에서 연 팝업만 매칭값을 전달할 수 있어야 합니다.');
assert.match(board, /pending\.returnFocusElement\.focus\(\)/, '매칭 창을 닫으면 호출한 셀로 포커스를 복귀해야 합니다.');
assert.match(picker, /aria-haspopup="dialog"/, '매칭 실행 버튼은 별도 대화상자를 여는 컨트롤로 알려야 합니다.');
assert.match(picker, /onOpen\?\.\(\{[\s\S]*returnFocusElement: buttonRef\.current/, '매칭 창에 원본 필드와 복귀 포커스 정보를 전달해야 합니다.');
assert.match(popup, /event\.key === 'ArrowDown'/, '검색 후보는 아래 방향키로 이동할 수 있어야 합니다.');
assert.match(popup, /event\.key === 'ArrowUp'/, '검색 후보는 위 방향키로 이동할 수 있어야 합니다.');
assert.match(popup, /event\.key === 'Enter'/, '키보드 Enter로 검색 후보를 선택할 수 있어야 합니다.');
assert.match(popup, /event\.key === 'Escape'/, 'Escape로 매칭 창을 취소하고 닫을 수 있어야 합니다.');
assert.match(popup, /role="listbox"/, '검색 후보 목록은 보조기술에 목록으로 알려야 합니다.');
assert.match(popup, /role="option"/, '검색 후보는 접근성 있는 선택 항목이어야 합니다.');
assert.match(sheet, /onMatch\(customerUnmatchedEntry, 'customer'/);
assert.match(sheet, /onMatch\(productUnmatchedEntry, 'product'/);
assert.match(sheet, /moveSheetFocus = \(event, rowIndex, colIndex\)/, '표에서 방향키로 조작 셀 사이를 이동할 수 있어야 합니다.');
assert.match(sheet, /onKeyDown=\{event => moveSheetFocus\(event, rowIndex, colIndex\)\}/, '표의 각 셀은 방향키 이동을 제공해야 합니다.');
assert.match(sheet, /event\.target\.type !== 'button'/, '숫자 입력 중 방향키 커서 조작을 방해하지 않아야 합니다.');
assert.match(agents, /모든 페이지의 키보드 조작 기준/);
assert.match(agents, /Tab\/Shift\+Tab/);
assert.match(agents, /방향키로 항목을 이동하고 Enter로 선택/);
assert.match(layoutContract, /모든 페이지의 키보드 조작/);
assert.match(layoutContract, /마우스 없이 핵심 업무/);

console.log('Dutch volume match popup and keyboard navigation tests passed');
