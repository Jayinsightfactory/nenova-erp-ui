const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const defaults = JSON.parse(read('config/menu-development-defaults.json'));
const guide = read('docs/MENU_DEVELOPMENT_DEFAULTS.md');
const agents = read('AGENTS.md');

const expectedSectionIds = [
  'scope-and-iteration',
  'layout-and-accessibility',
  'navigation-and-context',
  'matching-and-apply',
  'drafts-history-and-progress',
  'erp-safety',
  'verification-and-release',
];

test('menu development defaults expose the stable UI data shape', () => {
  assert.deepEqual(Object.keys(defaults), ['version', 'intro', 'sections']);
  assert.equal(defaults.version, '2026-10-09');
  assert.equal(typeof defaults.intro, 'string');
  assert.ok(defaults.intro.length > 20);
  assert.deepEqual(defaults.sections.map(section => section.id), expectedSectionIds);
  assert.equal(new Set(expectedSectionIds).size, expectedSectionIds.length);

  for (const section of defaults.sections) {
    assert.deepEqual(Object.keys(section), ['id', 'title', 'items']);
    assert.match(section.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(typeof section.title, 'string');
    assert.ok(section.title.startsWith('항상 적용') || section.title.startsWith('해당할 때 적용'));
    assert.ok(Array.isArray(section.items));
    assert.ok(section.items.length >= 4);
    assert.ok(section.items.every(item => typeof item === 'string' && item.trim().length > 10));
  }
});

test('markdown keeps every JSON section id and title in the same order', () => {
  let previousIndex = -1;
  for (const section of defaults.sections) {
    const marker = `<!-- section:${section.id} -->`;
    const markerIndex = guide.indexOf(marker);
    assert.ok(markerIndex > previousIndex, `${section.id} marker should exist in JSON order`);
    assert.match(guide.slice(markerIndex), new RegExp(`^${escapeRegExp(marker)}\\r?\\n## ${escapeRegExp(section.title)}`, 'm'));
    previousIndex = markerIndex;
  }
  assert.deepEqual(
    [...guide.matchAll(/<!-- section:([a-z0-9-]+) -->/g)].map(match => match[1]),
    expectedSectionIds,
  );
});

test('guide preserves universal and conditional boundaries', () => {
  assert.match(guide, /새 메뉴와 이번 작업에서 실제로 수정하는 메뉴/);
  assert.match(guide, /관련 없는 기존 페이지를 전부 다시 만드는 지시가 아니다/);
  assert.match(guide, /최신 사용자 지시.*우선/);
  assert.match(guide, /모든 메뉴에 클립보드나 업로드 기능을 추가하라는 뜻이 아니다/);
  assert.match(guide, /적용 \/ 해당 없음 \/ 예외/);
  assert.match(guide, /가짜 퍼센트를 만들지 않는다/);
  assert.match(guide, /완료라고 쓰지 않는다/);
});

test('AGENTS requires reading and acknowledging the menu baseline', () => {
  assert.match(agents, /docs\/MENU_DEVELOPMENT_DEFAULTS\.md/);
  assert.match(agents, /기준선 확인 결과/);
  assert.match(agents, /적용[^\n]*해당 없음[^\n]*예외/);
});

test('baseline artifacts are read-only guidance and declare no data mutation', () => {
  assert.match(guide, /런타임 데이터나 ERP 원장을 읽거나 변경하지 않는다/);
  assert.match(guide, /취소, 확정 해제, 재고 조정은 자동으로 실행하지 않는다/);
  assert.match(JSON.stringify(defaults), /명시 확인/);
  assert.equal(Object.hasOwn(defaults, 'actions'), false);
  assert.equal(Object.hasOwn(defaults, 'api'), false);
  assert.equal(Object.hasOwn(defaults, 'database'), false);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
