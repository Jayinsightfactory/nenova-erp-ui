// __tests__/purposeFlowTrace.test.js — 목적 우선 트레이스 도면(components/work/PurposeFlowTrace) 검증:
//   카드 배치·직교 S-커브 배선·레인 라벨이 어느 화면 폭에서도 서로 겹치지 않음, 단계 상태(완료/실행 중/대기) 규칙,
//   부서·파이프라인 데이터가 실제 매뉴얼 id 와 맞음, 장식 이모지·금지어·굴림체 0건, /work/manuals · /import/pipeline 장착 확인(MSSQL 불필요).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('next/dist/build/swc');

const repo = process.cwd();
const cache = new Map();

function resolveLocal(fromDir, id) {
  for (const c of [id, `${id}.js`, `${id}.cjs`, `${id}.mjs`]) {
    const abs = path.resolve(fromDir, c);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  }
  return null;
}

function loadEsm(relPath) {
  const filename = path.resolve(repo, relPath);
  if (cache.has(filename)) return cache.get(filename);
  const code = transformSync(fs.readFileSync(filename, 'utf8'), {
    filename,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  }).code;
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod.require = (id) => {
    if (id.startsWith('.')) {
      const abs = resolveLocal(path.dirname(filename), id);
      if (abs && abs.endsWith('.js')) return loadEsm(path.relative(repo, abs));
    }
    return require(id);
  };
  mod._compile(code, filename);
  cache.set(filename, mod.exports);
  return mod.exports;
}

const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');
const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const trace = loadEsm('components/work/PurposeFlowTrace.js');
const data = loadEsm('lib/workPurposeTrace.js');
const handoverLib = loadEsm('lib/importHandover.js');

// 1) 배치·배선·라벨: 폭 320~1920, 단계 1~8개 전부에서 겹침 0
for (const width of [320, 390, 520, 640, 768, 1024, 1280, 1600, 1920]) {
  for (let n = 1; n <= 8; n += 1) {
    const g = trace.layoutTrace(n, width);
    assert.equal(g.cards.length, n);
    assert.equal(g.wires.length, Math.max(0, n - 1), `${width}px ${n}단계: 배선 수`);
    g.cards.forEach((c, i) => {
      assert.ok(c.x >= 0 && c.x + c.w <= g.width + 0.5, `${width}px ${n}단계 카드 ${i + 1}: 가로 범위 안`);
      assert.ok(c.y >= 0 && c.y + c.h <= g.height + 0.5, `${width}px ${n}단계 카드 ${i + 1}: 세로 범위 안`);
      assert.ok(c.w >= 130, `${width}px ${n}단계 카드 ${i + 1}: 너무 좁지 않음(${c.w})`);
      g.cards.forEach((o, j) => { if (j > i) assert.ok(!hits(c, o), `${width}px ${n}단계: 카드 ${i + 1}↔${j + 1} 겹침`); });
    });
    for (const wire of g.wires) {
      const a = g.cards[wire.from];
      const b = g.cards[wire.to];
      assert.ok(/^M [\d. ]+/.test(wire.d) && !/[A-DF-Za-z]/.test(wire.d.replace(/[MHVQ]/g, '')), `직교 경로(M/H/V/Q)만 사용: ${wire.d}`);
      if (wire.kind === 'return') {
        assert.ok(wire.wireY > a.y + a.h && wire.wireY < b.y, `${width}px ${n}단계: 리턴 배선이 카드 줄 사이 레인에 있음`);
        const lb = wire.label;
        const box = { x: wire.start[0] === wire.end[0] ? lb.x - lb.maxW / 2 : lb.x - lb.maxW / 2, y: lb.top, w: lb.maxW, h: lb.h };
        assert.ok(lb.top >= a.y + a.h, '라벨은 위 카드 줄 아래');
        assert.ok(lb.top + lb.h + 8 <= wire.wireY, `${width}px ${n}단계: 라벨 아래 8px 이상 띄어 배선이 지남(라벨 하단 ${lb.top + lb.h}, 선 ${wire.wireY})`);
        assert.ok(box.x >= Math.min(wire.start[0], wire.end[0]) && box.x + box.w <= Math.max(wire.start[0], wire.end[0]), '라벨은 두 세로 배선 사이에 있음');
        g.cards.forEach((c, i) => assert.ok(!hits(box, c), `${width}px ${n}단계: 라벨↔카드 ${i + 1} 겹침`));
      } else if (wire.kind === 'row') {
        assert.equal(wire.start[1], wire.end[1], '같은 줄 배선은 수평');
        assert.ok(wire.start[0] === a.x + a.w && wire.end[0] === b.x, '카드 가장자리에서 가장자리로');
      } else {
        assert.equal(wire.start[0], wire.end[0], '1열 배선은 수직');
      }
    }
  }
}
assert.equal(trace.layoutTrace(4, 1280).rows, 1, '넓은 화면에서 4단계는 한 줄');
assert.equal(trace.layoutTrace(4, 768).rows, 2, '중간 화면에서 4단계는 2줄 S-커브');
assert.ok(trace.layoutTrace(5, 1280).wires.some((w) => w.kind === 'return'), '5단계는 리턴 배선 포함');
assert.equal(trace.layoutTrace(5, 390).cols, 1, '모바일은 1열');

// 2) 단계 상태 규칙
assert.deepEqual(trace.resolveStepStatuses([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'b'), ['done', 'running', 'wait']);
assert.deepEqual(trace.resolveStepStatuses([{ id: 'a' }, { id: 'b' }], 'zzz'), ['running', 'wait'], '없는 id 면 첫 단계가 실행 중');
assert.deepEqual(trace.resolveStepStatuses([{ id: 1, status: 'wait' }, { id: 2, status: 'done' }], 1), ['wait', 'done'], '명시 상태 우선');

// 3) 부서·파이프라인 데이터 ↔ 실제 매뉴얼
for (const dept of handoverLib.HANDOVER_DEPTS) {
  const preset = data.DEPT_PURPOSE_TRACES[dept.id];
  assert.ok(preset, `${dept.id}: 목적 도면 설정 필요`);
  const manuals = JSON.parse(read(`data/${dept.file}`)).manuals;
  const ids = new Set(manuals.map((m) => m.id));
  assert.ok(preset.purpose.headline.length >= 30 && preset.purpose.prevents && preset.purpose.outcome, `${dept.id}: 목적·막는 문제·결과물`);
  assert.ok(preset.steps.length >= 4 && preset.steps.length <= 6, `${dept.id}: 4~6단계`);
  const seen = new Set();
  for (const s of preset.steps) {
    assert.ok(ids.has(s.manualId), `${dept.id}: 매뉴얼 id 없음 ${s.manualId}`);
    assert.ok(!seen.has(s.id), `${dept.id}: 단계 id 중복 ${s.id}`);
    seen.add(s.id);
    assert.ok(s.surface && s.title && s.goal && s.token, `${dept.id}/${s.id}: 라벨·단계명·목적·토큰`);
    assert.ok(s.goal.length <= 30, `${dept.id}/${s.id}: 단계 목적은 1줄(30자 이하) — ${s.goal.length}자`);
  }
  const resolved = data.resolveDeptTrace(dept.id, { manuals, dept: dept.name }, dept.name);
  assert.equal(resolved.steps.length, preset.steps.length, `${dept.id}: 해석 결과 단계 수`);
}
const fallback = data.resolveDeptTrace('new-dept', { dept: '신설부', manuals: [{ id: 'a', title: 'A 업무', order: 2 }, { id: 'b', title: 'B 업무', order: 1, oneLine: 'B 한 줄' }] }, '신설부');
assert.equal(fallback.steps[0].manualId, 'b', '설정이 없는 부서는 order 순으로 대표 업무 구성');
assert.equal(data.resolveDeptTrace('new-dept', { manuals: [] }), null, '업무가 2개 미만이면 도면 없음');
assert.equal(data.IMPORT_PIPELINE_TRACE_STEPS.length, 4);
assert.deepEqual(data.IMPORT_PIPELINE_TRACE_STEPS.map((s) => s.id), [1, 2, 3, 4], '파이프라인 단계 id 는 PIPELINE_STEPS 와 같음');
assert.ok(data.IMPORT_PIPELINE_PURPOSE.headline.includes('화면 왕복을 없애고 원가 조기 확정으로 영업 마진을 방어'));
const pipelineLib = loadEsm('lib/importOneStopPipeline.js');
assert.deepEqual(pipelineLib.PIPELINE_STEPS.map((s) => s.id), data.IMPORT_PIPELINE_TRACE_STEPS.map((s) => s.id));

// 4) 렌더(SSR) — 목적 콜아웃 + 3가지 상태 + 모션 단추
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const html = renderToStaticMarkup(React.createElement(trace.default, {
  testId: 't', purpose: data.DEPT_PURPOSE_TRACES.import.purpose, steps: data.DEPT_PURPOSE_TRACES.import.steps, activeId: 'upload', onSelectStep() {},
}));
assert.ok(html.includes('업무 핵심 목적 · PURPOSE') && html.includes(data.DEPT_PURPOSE_TRACES.import.purpose.headline), '목적 콜아웃');
assert.ok(html.includes('data-status="done"') && html.includes('data-status="running"') && html.includes('data-status="wait"'), '완료·실행 중·대기');
assert.ok(html.includes('AUTO 1x') && html.includes('2,600ms'), 'AUTO 1x 모션 단추');
assert.equal((html.match(/class="pft-card /g) || []).length, 5, '카드 5장');
assert.ok(/aria-current="step"/.test(html), '실행 중 카드에 aria-current');
assert.ok(html.includes('font-family:Pretendard,"Malgun Gothic"') && !html.includes('&quot;'), '스타일 안 따옴표가 이스케이프되면 글꼴이 깨지고 hydration 불일치(React #418)가 남');

// 5) 소스 규칙 — 색·글꼴·모션·금지어·이모지
const src = read('components/work/PurposeFlowTrace.js') + read('lib/workPurposeTrace.js');
for (const token of ['#059669', '#2563eb', '#eff6ff', '#cbd5e1', 'stroke-dashoffset', 'prefers-reduced-motion', 'tabular-nums', 'width:4px', 'Pretendard', 'Malgun Gothic', 'font-size:14.5px', 'font-size:17px']) {
  assert.ok(src.includes(token), `소스에 ${token} 필요`);
}
const banned = new RegExp(['\uac10\uc2dc', '\ucd94\uc801', '\ubaa8\ub2c8\ud130\ub9c1', '\uc808\uac10\uc2dc\uac04'].join('|'));
assert.ok(!banned.test(src), '금지어 포함 금지');
assert.ok(!/gradient/i.test(src), '그라디언트 금지');
assert.ok(!/\p{Extended_Pictographic}/u.test(src), '장식 이모지 금지');
assert.ok(!/\uAD74\uB9BC|gulim|batang|dotum/i.test(src), '굴림체 계열 폴백 금지');
assert.ok(!/font-family:[^;`]*monospace[^;`]*;/.test(src.replace(/Consolas,"Malgun Gothic","Segoe UI",monospace/, '')), '고정폭 글꼴은 맑은 고딕을 먼저 거쳐야 함');

// 6) 장착 확인
const manualsSrc = read('pages/work/manuals.js');
assert.ok(manualsSrc.includes("import PurposeFlowTrace from '../../components/work/PurposeFlowTrace'") && manualsSrc.includes('resolveDeptTrace(curDept.id'), '/work/manuals 에 도면 장착');
assert.ok(/onSelectStep=\{onTraceStep\}/.test(manualsSrc) && manualsSrc.includes('openSearchManual(curDept.id, step.manualId)'), '단계 클릭 → 매뉴얼 열기');
assert.ok(manualsSrc.indexOf('<PurposeFlowTrace') < manualsSrc.indexOf('<ManualSearchBar'), '도면은 검색줄보다 위');
const pipeSrc = read('components/import-tools/ImportOneStopPipeline.js');
assert.ok(pipeSrc.includes('<PurposeFlowTrace') && pipeSrc.includes('activeId={activeStep}') && pipeSrc.includes('goToStep(step.id)'), '/import/pipeline 에 도면 장착·activeStep 양방향 연동');
assert.ok(pipeSrc.indexOf('<PurposeFlowTrace') < pipeSrc.indexOf('<WorkflowGuide'), '목적 도면이 가이드보다 위');

console.log('purposeFlowTrace tests passed');
