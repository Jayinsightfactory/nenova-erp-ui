const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { publicGuidePath } = require('../lib/workflowGuides.cjs');

const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const sourceHash = file => sha256(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
const fail = message => { throw new Error(`WORKFLOW_GUIDE: ${message}`); };
function asset(root, url, extension) {
  if (!publicGuidePath(url, extension)) fail(`잘못된 가이드 경로: ${url}`);
  const full = path.join(root, 'public', url.slice(1));
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) fail(`파일 없음: ${url}`);
  return full;
}
function validateWorkflowGuides(root, registry, { allowDraft = false, addedPages = [] } = {}) {
  if (registry?.version !== 1 || !Array.isArray(registry.workflows)) fail('레지스트리 형식');
  const ids = new Set(); let videos = 0;
  for (const workflow of registry.workflows) {
    if (!/^[a-z0-9-]+$/.test(workflow.id) || ids.has(workflow.id)) fail('업무 ID 누락/중복');
    ids.add(workflow.id);
    if (!workflow.title || !workflow.entryPaths?.length || !workflow.sourceFiles?.length || !workflow.requiredScenarios?.length || !workflow.guides?.length) fail(`${workflow.id}: 업무 경로/원본/시나리오/영상 필요`);
    for (const file of workflow.sourceFiles) if (path.isAbsolute(file) || file.includes('..') || !fs.existsSync(path.join(root, file))) fail(`${workflow.id}: 원본 파일 ${file}`);
    for (const route of workflow.entryPaths) if (!route.startsWith('/') || route.startsWith('//')) fail(`${workflow.id}: 로컬 메뉴 경로 필요`);
    const roles = new Set(), guideIds = new Set();
    for (const guide of workflow.guides) {
      const label = `${workflow.id}/${guide.id}`;
      if (!/^[a-z0-9-]+$/.test(guide.id) || !guide.role || !guide.title || roles.has(guide.role) || guideIds.has(guide.id)) fail(`${label}: 대상/제목 누락 또는 중복`);
      roles.add(guide.role); guideIds.add(guide.id);
      if (guide.status !== 'ready') {
        if (allowDraft && guide.status === 'draft') continue;
        fail(`${label}: 가이드 촬영·검증 미완료`);
      }
      const mp4 = asset(root, guide.src, 'mp4');
      const captions = asset(root, guide.captions, 'ko\\.vtt');
      const proofFile = asset(root, guide.proof, 'proof\\.json');
      const data = fs.readFileSync(mp4);
      if (data.length < 1000 || data.length > 60 * 1024 * 1024 || data.subarray(4, 8).toString() !== 'ftyp') fail(`${label}: MP4 형식/크기(60MB 이하)`);
      const vtt = fs.readFileSync(captions, 'utf8').replace(/\r\n/g, '\n');
      if (!vtt.startsWith('WEBVTT\n') || !vtt.includes('-->') || !/[가-힣]/.test(vtt)) fail(`${label}: 한국어 WebVTT 설명 필요`);
      const proof = JSON.parse(fs.readFileSync(proofFile, 'utf8'));
      if (proof.version !== 1 || proof.width !== 1920 || proof.height !== 1080 || proof.browserZoom !== 100 || proof.dataMode !== 'synthetic-fixture' || proof.productionWrites !== 0 || proof.capture !== 'actual-browser-ui') fail(`${label}: 실제 1920×1080 연습 화면 검증 필요`);
      if (!(proof.duration > 0) || !Number.isFinite(proof.duration) || !Number.isFinite(proof.fps) || proof.fps < 10 || !/^\d{4}-\d{2}-\d{2}T/.test(proof.recordedAt)) fail(`${label}: 영상 길이/프레임/녹화시각`);
      const cueTimes = [...vtt.matchAll(/(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})/g)];
      const seconds = time => time.split(':').map(Number).reduce((total, value) => total * 60 + value, 0);
      if (!cueTimes.length || cueTimes.some(cue => seconds(cue[2]) <= seconds(cue[1]) || seconds(cue[2]) > proof.duration + .05)) fail(`${label}: 자막 시간 범위 오류`);
      if (proof.videoSha256 !== sha256(data) || proof.captionsSha256 !== sha256(vtt)) fail(`${label}: 영상/자막 검증 해시 불일치`);
      for (const file of workflow.sourceFiles) if (proof.sourceHashes?.[file] !== sourceHash(path.join(root, file))) fail(`${label}: ${file} 변경 후 가이드를 다시 촬영하세요`);
      if (!Array.isArray(guide.chapters) || guide.chapters.length === 0) fail(`${label}: 영상 목차 필요`);
      let previous = -1;
      for (const chapter of guide.chapters) {
        if (!chapter.title || !chapter.scenario || !Number.isFinite(chapter.seconds) || chapter.seconds < 0 || chapter.seconds <= previous || chapter.seconds >= proof.duration) fail(`${label}: 목차 순서/시간 오류`);
        previous = chapter.seconds;
      }
      for (const scenario of workflow.requiredScenarios) if (!guide.chapters.some(chapter => chapter.scenario === scenario)) fail(`${label}: ${scenario} 시나리오 누락`);
      videos++;
    }
  }
  for (const page of addedPages) {
    const route = ('/' + page.replace(/^pages\//, '').replace(/\.(?:jsx?|tsx?)$/, '')).replace(/\/index$/, '') || '/';
    if (!registry.workflows.some(workflow => workflow.entryPaths.some(entry => entry.split('?')[0] === route))) fail(`새 메뉴 ${route}: 사용 가이드 등록 필요`);
  }
  return { workflows: ids.size, videos };
}
module.exports = { validateWorkflowGuides, sourceHash, sha256 };
if (require.main === module) {
  try {
    const args = process.argv.slice(2), root = process.cwd();
    const base = args.includes('--changed-from') ? args[args.indexOf('--changed-from') + 1] : null;
    if (args.includes('--changed-from') && !base) fail('--changed-from 기준 커밋 필요');
    const addedPages = base ? execFileSync('git', ['diff', '--diff-filter=A', '--name-only', base, '--', 'pages'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(file => /^pages\/(?!api\/|_)[^\n]+\.(?:jsx?|tsx?)$/.test(file)) : [];
    const result = validateWorkflowGuides(root, JSON.parse(fs.readFileSync(path.join(root, 'config/workflow-guides.json'), 'utf8')), { allowDraft: args.includes('--allow-draft'), addedPages });
    console.log(`Workflow guides PASS: ${result.workflows} workflows, ${result.videos} verified videos${args.includes('--allow-draft') ? ' (draft allowed; not a release check)' : ''}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
