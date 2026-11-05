const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { validateWorkflowGuides, sourceHash, sha256 } = require('../scripts/check-workflow-guides.cjs');
const { workflowGuide, guideTime, publicGuidePath } = require('../lib/workflowGuides.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nenova-guide-test-'));
  fs.mkdirSync(path.join(root, 'public/guides/example'), { recursive: true });
  fs.mkdirSync(path.join(root, 'pages'));
  fs.writeFileSync(path.join(root, 'pages/example.js'), 'export default function Example(){return null;}\n');
  const video = Buffer.alloc(1024); video.write('ftyp', 4);
  const captions = 'WEBVTT\n\n00:00:00.000 --> 00:00:04.000\n농장 이름을 확인하세요.\n';
  const proof = { version: 1, width: 1920, height: 1080, browserZoom: 100, fps: 20, duration: 40, recordedAt: '2026-11-04T00:00:00.000Z', capture: 'actual-browser-ui', dataMode: 'synthetic-fixture', productionWrites: 0, videoSha256: sha256(video), captionsSha256: sha256(captions), sourceHashes: { 'pages/example.js': sourceHash(path.join(root, 'pages/example.js')) } };
  fs.writeFileSync(path.join(root, 'public/guides/example/import.mp4'), video);
  fs.writeFileSync(path.join(root, 'public/guides/example/import.ko.vtt'), captions);
  const writeProof = () => fs.writeFileSync(path.join(root, 'public/guides/example/import.proof.json'), JSON.stringify(proof)); writeProof();
  const guide = { id: 'import', role: '수입부', title: '입고 수정', status: 'ready', src: '/guides/example/import.mp4', captions: '/guides/example/import.ko.vtt', proof: '/guides/example/import.proof.json', chapters: [{ scenario: 'farm', title: '농장 수정', seconds: 0 }, { scenario: 'product', title: '품목 수정', seconds: 10 }, { scenario: 'quantity', title: '수량 수정', seconds: 20 }] };
  const registry = { version: 1, workflows: [{ id: 'example', title: '입고', entryPaths: ['/example'], sourceFiles: ['pages/example.js'], requiredScenarios: ['farm', 'product', 'quantity'], guides: [guide] }] };
  return { root, guide, registry, proof, writeProof, close: () => fs.rmSync(root, { recursive: true, force: true }) };
}
test('ready guide with assets, source evidence and each scenario passes', () => { const f = fixture(); try { assert.deepEqual(validateWorkflowGuides(f.root, f.registry, { addedPages: ['pages/example.js'] }), { workflows: 1, videos: 1 }); } finally { f.close(); } });
test('Windows checkout line endings preserve caption and source evidence', () => { const f = fixture(); try {
  for (const file of ['public/guides/example/import.ko.vtt', 'pages/example.js']) { const full = path.join(f.root, file); fs.writeFileSync(full, fs.readFileSync(full, 'utf8').replace(/\n/g, '\r\n')); }
  assert.equal(validateWorkflowGuides(f.root, f.registry).videos, 1);
} finally { f.close(); } });
test('release rejects unfinished video, absent scenarios and unregistered new menu', () => { const f = fixture(); try {
  f.guide.status = 'draft'; assert.throws(() => validateWorkflowGuides(f.root, f.registry), /미완료/);
  assert.equal(validateWorkflowGuides(f.root, f.registry, { allowDraft: true }).videos, 0);
  f.guide.status = 'ready'; f.guide.chapters.pop(); assert.throws(() => validateWorkflowGuides(f.root, f.registry), /quantity/);
  f.guide.chapters.push({ scenario: 'quantity', title: '수량', seconds: 20 });
  assert.throws(() => validateWorkflowGuides(f.root, f.registry, { addedPages: ['pages/new.js'] }), /새 메뉴/);
} finally { f.close(); } });
test('changed screens and altered media invalidate old recording evidence', () => { const f = fixture(); try {
  fs.appendFileSync(path.join(f.root, 'pages/example.js'), '// changed');
  assert.throws(() => validateWorkflowGuides(f.root, f.registry), /다시 촬영/);
  f.proof.sourceHashes['pages/example.js'] = sourceHash(path.join(f.root, 'pages/example.js')); f.writeProof();
  fs.appendFileSync(path.join(f.root, 'public/guides/example/import.mp4'), 'changed');
  assert.throws(() => validateWorkflowGuides(f.root, f.registry), /해시 불일치/);
} finally { f.close(); } });
test('wrong capture size, production data and invalid chapter timing are rejected', () => { const f = fixture(); try {
  f.proof.width = 1280; f.writeProof(); assert.throws(() => validateWorkflowGuides(f.root, f.registry), /1920/);
  f.proof.width = 1920; f.proof.dataMode = 'production'; f.writeProof(); assert.throws(() => validateWorkflowGuides(f.root, f.registry), /연습 화면/);
  f.proof.dataMode = 'synthetic-fixture'; f.writeProof(); f.guide.chapters[1].seconds = 80;
  assert.throws(() => validateWorkflowGuides(f.root, f.registry), /목차/);
} finally { f.close(); } });
test('local paths and human-readable times do not allow external media or traversal', () => {
  assert.equal(guideTime(125.8), '2:05'); assert.equal(guideTime(0), '0:00');
  assert.equal(publicGuidePath('/guides/incoming-approval/import.mp4', 'mp4'), true);
  for (const value of ['https://example.com/a.mp4', '/guides/../secret.mp4', '//guides/a.mp4', '/guides/a.mp4?token=x']) assert.equal(publicGuidePath(value, 'mp4'), false);
  assert.equal(workflowGuide('missing'), null); assert.equal(workflowGuide('incoming-approval').guides.length, 2);
});
