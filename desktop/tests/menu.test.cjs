'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { parseMenuSource, generateMenu } = require('../scripts/generate-menu.cjs');

const sample = `export const MENU_ITEMS = [
  {
    group: '업무',
    items: [
    { href: '/orders', labelKey: '주문', popup: false },
    { href: '/private', labelKey: '비공개', popup: true, userIds: ['staff'] },
    { href: '/computed', labelKey: '계산', popup: true, userIds: Object.keys(OWNERS).filter((id) => id) },
    { href: 'https://outside.example', labelKey: '외부', popup: false },
  ] },
  {
    group: '빈 그룹',
    items: [],
  },
];`;

test('parses only unrestricted same-site route literals, preserving source order', () => {
  assert.deepEqual(parseMenuSource(sample), [{
    group: '업무',
    items: [{ href: '/orders', labelKey: '주문', popup: false }],
  }]);
});

test('writes deterministic JSON from the source without evaluating it', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nenova-menu-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sourcePath = path.join(dir, 'Layout.js');
  const outputPath = path.join(dir, 'menu.json');
  fs.writeFileSync(sourcePath, sample);
  const first = generateMenu({ sourcePath, outputPath });
  const firstText = fs.readFileSync(outputPath, 'utf8');
  const second = generateMenu({ sourcePath, outputPath });
  assert.deepEqual(second, first);
  assert.equal(fs.readFileSync(outputPath, 'utf8'), firstText);
  assert.equal(firstText.includes('/private'), false);
  assert.equal(firstText.includes('/computed'), false);
});

test('invoice work and farm master share the canonical searchable desktop catalog',()=>{
  const repo=path.resolve(__dirname,'../..'),source=fs.readFileSync(path.join(repo,'components/Layout.js'),'utf8');
  const menu=JSON.parse(fs.readFileSync(path.join(repo,'desktop/menu.json'),'utf8'));
  assert.deepEqual(menu,parseMenuSource(source));
  const items=menu.flatMap(g=>g.items);
  assert.equal(items.filter(i=>i.href==='/import/tools').length,1);
  assert.match(items.find(i=>i.href==='/import/tools').labelKey,/인보이스 원본 대조/);
  const pipeline=items.filter(i=>i.href==='/import/pipeline');
  assert.equal(pipeline.length,1);
  assert.equal(pipeline[0].labelKey,'수입 원스톱 파이프라인(인보이스→원가→공유)');
  assert.equal(pipeline[0].popup,false);
  const gabriel=items.filter(i=>i.href==='/import/gabriel-agi');
  assert.equal(gabriel.length,1);
  assert.equal(gabriel[0].labelKey,'가브리엘 원가·이익 최적화 AGI(시뮬레이션)');
  assert.equal(gabriel[0].popup,false);
  const farms=items.filter(i=>i.href==='/master/codes');assert.equal(farms.length,1);assert.match(farms[0].labelKey,/농장 마스터/);
  assert.equal(farms[0].href,'/master/codes','stable URL preserves existing favorites');
  const arrival=items.filter(i=>i.href==='/arrival-cost');
  assert.equal(arrival.length,1,'arrival cost keeps its existing favorites URL');
  assert.match(arrival[0].labelKey,/콜롬비아 주차 통합/);
});
