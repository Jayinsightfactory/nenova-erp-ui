// __tests__/archFlowChart.test.js — /my-work '아키텍처 흐름도' 탭, /pm 아키텍처 토글, 데스크톱 셸 업데이트/PM 버튼 계약 검사.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const comp = read('components/pm/ArchFlowChart.js');
assert.match(comp, /export default function ArchFlowChart/);
for (const loopId of ['detail', 'heal', 'pipeline', 'roundtrip']) {
  assert.match(comp, new RegExp(`id:\\s*'${loopId}'`), `ArchFlowChart must include loop ${loopId}`);
}
assert.match(comp, /인보이스.*입고.*도착원가/, '연속 파이프라인 압축 사례 포함');
assert.match(comp, /분배.*주문등록/, '왕복 우회동작(A→B→A) 흡수 설계 사례 포함');
for (const tbl of ['OrderMaster', 'OrderDetail', 'ShipmentMaster', 'ShipmentDetail', 'WarehouseMaster', 'ViewShipment', 'WebProfitReport', 'assertWebSchemaContract', 'data/runtime', 'work-feature-workflows.json', 'adoption-ledger.json']) {
  assert.ok(comp.includes(tbl), `ArchFlowChart must include schema reference: ${tbl}`);
}
for (const hermesToken of ['arch-hermes-section', 'NousResearch/hermes-agent', 'hermes-manager.js', 'Session Rescue', 'Trajectory Compressor', 'Procedural Skill']) {
  assert.ok(comp.includes(hermesToken), `ArchFlowChart must include Hermes orchestration reference: ${hermesToken}`);
}
assert.ok(comp.includes('arch-solution-blueprints'), 'ArchFlowChart must include arch-solution-blueprints section');
assert.ok(comp.includes('SOLUTION_BLUEPRINTS'), 'ArchFlowChart must define SOLUTION_BLUEPRINTS');
for (const bpId of ['master', 'order_ship', 'import_cost', 'stock_profit']) {
  assert.match(comp, new RegExp(`id:\\s*'${bpId}'`), `ArchFlowChart must include blueprint ${bpId}`);
}
for (const itemExample of ['콜롬비아 장미 프리덤', '네덜란드 수국', '유오디아 블랙잭', '솔루션']) {
  assert.ok(comp.includes(itemExample), `ArchFlowChart must include solution blueprint token: ${itemExample}`);
}
assert.doesNotMatch(comp, /감시|추적|모니터링/, '작업자 노출 문구에 감시·추적·모니터링 금지');
assert.doesNotMatch(comp, /<button[\s>]/, 'PM UI 키트 규칙: raw <button> 금지');

const myWork = read('pages/my-work.js');
assert.match(myWork, /\{ id: 'arch', label: '아키텍처 흐름도' \}/);
assert.match(myWork, /tab === 'arch' && <ArchFlowChart/);
assert.match(myWork, /router\.query\?\.tab/);

const shell = read('desktop/shell/shell.js');
assert.match(shell, /needUpdate = \['available', 'downloaded'\]\.includes\(update\.phase\)/);
assert.match(shell, /#d82f36/);
assert.match(shell, /pmOpenButton\.textContent = '오류관제 열기'/);
assert.match(shell, /pmArchButton\.id = 'pmArchButton'/);
assert.match(shell, /pmArchButton\.textContent = '흐름도'/);
assert.match(shell, /url: '\/my-work\?tab=arch'/);

console.log('archFlowChart contract tests passed');
