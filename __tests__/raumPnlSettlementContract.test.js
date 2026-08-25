const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function writeTargets(source) {
  const targets = [];
  const patterns = [
    /\bINSERT\s+INTO\s+([\w.]+)/gi,
    /\bUPDATE\s+([\w.]+)/gi,
    /\bDELETE\s+FROM\s+([\w.]+)/gi,
    /\bMERGE\s+([\w.]+)/gi,
  ];
  for (const re of patterns) for (const match of source.matchAll(re)) targets.push(match[1]);
  return [...new Set(targets.map(x => x.replace(/^dbo\./i, '')))];
}

async function main() {
  const contract = JSON.parse(read('docs/contracts/raum-pnl-settlement.json'));
  const source = read('lib/raumPnl.js');
  const api = read('pages/api/raum/pnl.js');
  const action = contract.actions.find(x => x.name === 'RAUM_PNL_MULTI_WEEK_IMPORT');
  assert.ok(action, '다중차수 업로드 action이 계약에 등록되어야 합니다.');
  assert.deepEqual(action.writeAllowlist, ['WebRaumPnl', 'WebRaumPnlItem']);
  assert.equal(action.validation, 'all-or-nothing');
  for (const testFile of ['__tests__/raumPnlMultiImport.test.js', '__tests__/raumPnlPreservation.test.js', '__tests__/raumPnlSettlementContract.test.js']) {
    assert.ok(contract.requiredTestFiles.includes(testFile), `${testFile}가 계약 필수 테스트여야 합니다.`);
  }
  assert.deepEqual(contract.businessIdentity, ['OrderYear', 'OrderWeek', 'CustKey', 'ProdKey']);
  assert.deepEqual(contract.settlementIdentity, ['OrderYear', 'MajorWeek', 'PartnerCode']);
  assert.ok(contract.requiredTestFiles.includes('__tests__/raumPnlPartner.test.js'));
  assert.match(source, /OrderYear=@yr AND MajorWeek=@mj AND PartnerCode=@pc/);
  assert.ok(contract.actions.find(x => x.name === 'RAUM_PNL_IMPORT_AUTO_COMMIT'));

  const targets = writeTargets(`${source}\n${api}`);
  for (const target of targets) {
    assert.match(target, /^WebRaumPnl(?:Item)?$/,
      `라움 손익 다중차수 저장은 WebRaumPnl* 외 테이블을 쓰면 안 됩니다: ${target}`);
  }
  console.log('Raum P&L settlement write-scope contract tests passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
