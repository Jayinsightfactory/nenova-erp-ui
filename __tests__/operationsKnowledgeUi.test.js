const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('next/dist/build/swc');

const filename = path.resolve(__dirname, '../pages/operations-knowledge.js');
const source = fs.readFileSync(filename, 'utf8');
const css = fs.readFileSync(path.resolve(__dirname, '../styles/OperationsKnowledge.module.css'), 'utf8');
const layout = fs.readFileSync(path.resolve(__dirname, '../components/Layout.js'), 'utf8');
const compiled = transformSync(source, { filename, jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } }).code;
const page = new Module(filename, module);
page.filename = filename;
page.paths = Module._nodeModulePaths(path.dirname(filename));
page.require = (name) => {
  if (name === '../styles/OperationsKnowledge.module.css') return {};
  if (name === '../lib/auth') return { verifyReqUser: (req) => req.fakeUser || null };
  return require(name);
};
page._compile(compiled, filename);

const { filterKnowledgeItems, auditLabel } = page.exports;
const sample = [
  { id: 'current', title: '장미 성수기 처리', category: 'SEASON', status: 'CURRENT', priority: 'IMPORTANT', tags: { countries: ['콜롬비아'], flowers: ['장미'], farms: ['A농장'], stages: ['입고'] }, situation: '7월 폭우', action: '검수', caution: '포장 주의', checklist: '사진', contact: '수입팀', updatedAt: '2026-07-01' },
  { id: 'check', title: '고객 문의', category: 'SITUATION', status: 'CHECK', priority: 'NORMAL', tags: { countries: ['네덜란드'], flowers: ['튤립'], farms: [], stages: [] }, situation: '문의', updatedAt: '2026-06-01' },
  { id: 'retired', title: '과거 절차', category: 'CASE', status: 'RETIRED', priority: 'NORMAL', tags: { countries: [], flowers: [], farms: [], stages: [] }, situation: '종료', updatedAt: '2025-01-01' },
];
assert.deepEqual(filterKnowledgeItems(sample).map((item) => item.id), ['current', 'check'], 'default excludes retired items and ranks important first');
assert.deepEqual(filterKnowledgeItems(sample, { status: 'RETIRED' }).map((item) => item.id), ['retired']);
assert.deepEqual(filterKnowledgeItems(sample, { category: 'SEASON', search: '포장', filters: { countries: '콜롬비아', flowers: '장미', farms: 'A농장', stages: '입고' } }).map((item) => item.id), ['current']);
assert.deepEqual(filterKnowledgeItems(sample, { search: '검수' }).map((item) => item.id), ['current'], 'body fields are searchable');
assert.deepEqual(filterKnowledgeItems(sample, { filters: { countries: '네덜란드' } }).map((item) => item.id), ['check']);
assert.equal(auditLabel({ action: 'UPDATE_ITEM', changedFields: ['status', 'tags.countries'] }), '지침 수정 · 변경: 상태, 국가 태그');
assert.equal(auditLabel({ action: 'ADD_ATTACHMENT' }), '첨부 등록');
assert.equal(filterKnowledgeItems(sample, { status: 'CURRENT' }).length, 1, 'legacy material cannot be counted as current because it is a separate source');
assert.match(source, /verifyReqUser\(req\)/);
assert.match(source, /destination: '\/login'/);
assert.match(source, /accountActive === false/);
assert.doesNotMatch(source, /import Layout|<Layout/);
assert.match(layout, /operations-knowledge/, 'menu route should be registered once in shared layout');
assert.equal((layout.match(/href:\s*['"]\/operations-knowledge['"]/g) || []).length, 1);
assert.match(source, /nenova:menu-back-request/);
assert.match(source, /beforeunload/);
assert.match(source, /ArrowDown/);
assert.match(source, /ArrowUp/);
assert.match(source, /Escape/);
assert.match(source, /role="alert"/);
assert.match(source, /detailRef\.current\.inert = busy/);
assert.match(source, /response\.status === 409/);
assert.match(source, /setConflict\(true\)/);
assert.match(source, /draftRevision !== snapshot\.revision/);
assert.match(source, /기존 인수인계 · 읽기 전용/);
assert.match(source, /statusLabel \|\| '기존 자료 · 상태 미분류'/);
assert.match(source, /CREATE_ITEM/);
assert.match(source, /UPDATE_ITEM/);
assert.match(source, /ADD_COMMENT/);
assert.match(source, /FormData/);
assert.match(source, /attachments\?id=/);
assert.doesNotMatch(source, /DELETE_ITEM|method: 'DELETE'|영구 삭제/);
assert.match(css, /max-width:1920px/);
assert.match(css, /@media\(max-width:850px\)/);
console.log('operations knowledge UI contract OK');
