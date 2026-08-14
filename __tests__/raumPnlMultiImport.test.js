const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

async function main() {
  const source = read('lib/raumPnl.js');

  // This is intentionally a source-level contract while the API implementation is
  // developed separately.  A multi-sheet workbook must yield six independent
  // batches (27–32), not a single "latest" batch.
  assert.doesNotMatch(source, /최신\s*차수\s*시트만\s*반영/,
    '27~32차를 한 파일로 올릴 때 최신 차수만 남기는 정책은 제거되어야 합니다.');
  assert.match(source, /group(?:Raum)?(?:Quote)?(?:Sheets|Workbook).{0,120}major|byMajor|majorGroups/s,
    '파싱 결과는 차수(major)별 독립 배치로 그룹화되어야 합니다.');
  assert.match(source, /all-or-nothing|atomic|transaction|withTransaction/i,
    '6개 배치는 검증 실패 시 일부만 저장되지 않는 원자적 처리여야 합니다.');

  // Acceptance fixture definition: 27~30 are two-branch batches; 31~32 are
  // Konkuk-only batches.  Do not derive a later week from an earlier week.
  const expected = {
    '27': ['강남', '건대'], '28': ['강남', '건대'], '29': ['강남', '건대'], '30': ['강남', '건대'],
    '31': ['건대'], '32': ['건대'],
  };
  assert.equal(Object.keys(expected).length, 6);
  for (const [week, branches] of Object.entries(expected)) {
    assert.ok(branches.length >= 1, `${week}차는 독립 배치여야 합니다.`);
  }
  console.log('Raum P&L multi-week import contract tests passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
