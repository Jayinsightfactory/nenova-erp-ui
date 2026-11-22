'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  runGuardrails,
  checkPs1Bom,
  checkSvgLayerOrder,
  checkMonospaceFallback,
  checkUiSlopAndPmGuards,
} = require('../scripts/check-agent-guardrails.cjs');

const REPO_ROOT = path.resolve(__dirname, '..');

function makeTempGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-guardrails-'));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  git('init');
  git('config', 'user.email', 'ci@nenova.local');
  git('config', 'user.name', 'CI Guard');
  return { dir, git };
}

test('PS1 UTF-8 BOM guard rejects Korean .ps1 without EF BB BF and allows BOM or pure ASCII', () => {
  const missingBom = Buffer.from('Write-Output "한글 스크립트"\n', 'utf8');
  const res = checkPs1Bom('scripts/test.ps1', missingBom);
  assert.equal(res.length, 1);
  assert.equal(res[0].rule, 'PS1_UTF8_BOM');

  const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), missingBom]);
  assert.equal(checkPs1Bom('scripts/test.ps1', withBom).length, 0);
  assert.equal(checkPs1Bom('scripts/ascii.ps1', Buffer.from('Write-Output "OK"\n', 'utf8')).length, 0);
});

test('SVG layer order guard passes real SolutionSuiteSimulator & TechRadarWorkbench and blocks inversion', () => {
  for (const rel of ['components/work/SolutionSuiteSimulator.js', 'components/pm/TechRadarWorkbench.js']) {
    const abs = path.join(REPO_ROOT, rel);
    assert.ok(fs.existsSync(abs), `${rel} must exist`);
    const v = checkSvgLayerOrder(rel, fs.readFileSync(abs, 'utf8'));
    assert.deepEqual(v, [], `${rel} must satisfy SVG wires-before-labels invariant`);
  }

  const badOrder = '<svg><g data-layer="labels"><text>Bus</text></g><g data-layer="wires"><path d="M0 0"/></g></svg>';
  assert.equal(checkSvgLayerOrder('components/work/Bad.js', badOrder)[0].rule, 'SVG_LAYER_ORDER');

  const badCircle =
    '<svg><g data-layer="wires"><path d="M0 0"/></g><g data-layer="labels"><text>Bus</text></g><circle r="4"/></svg>';
  assert.equal(checkSvgLayerOrder('components/work/Bad.js', badCircle)[0].rule, 'SVG_LAYER_ORDER');
});

test('Standalone monospace / JetBrains Mono guard blocks Gulim fallback and allows Korean gothic stack', () => {
  const bad = checkMonospaceFallback('components/work/Card.js', [
    { line: 4, text: 'font-family: monospace;' },
    { line: 5, text: "fontFamily: 'JetBrains Mono, ui-monospace'" },
  ]);
  assert.equal(bad.length, 2);
  assert.ok(bad.every((v) => v.rule === 'MONOSPACE_GULIM_FALLBACK'));

  const ok = checkMonospaceFallback('components/work/Card.js', [
    { line: 8, text: "font-family: Consolas, 'Pretendard', 'Malgun Gothic', sans-serif;" },
  ]);
  assert.equal(ok.length, 0);
});

test('Anti-AI Slop UI guard & /pm hex/raw button guard catch violations while respecting allowlists', () => {
  const uiBad = checkUiSlopAndPmGuards('components/work/Banner.js', [
    { line: 10, text: '<p>직원 활동 추적 패널</p>' },
    { line: 11, text: '<p>절감시간 30분 🔥</p>' },
  ]);
  assert.ok(uiBad.some((v) => v.rule === 'UI_FORBIDDEN_WORD'));
  assert.ok(uiBad.some((v) => v.rule === 'UI_SLOP_EMOJI'));

  const pmBad = checkUiSlopAndPmGuards('components/pm/Sample.js', [
    { line: 2, text: 'color: #2563eb;' },
    { line: 3, text: '<button onClick={fn}>Go</button>' },
  ]);
  assert.ok(pmBad.some((v) => v.rule === 'PM_NO_HEX_COLOR'));
  assert.ok(pmBad.some((v) => v.rule === 'PM_NO_RAW_BUTTON'));

  assert.equal(checkUiSlopAndPmGuards('lib/pmThemes.js', [{ line: 1, text: "bg: '#ffffff'" }]).length, 0);
  assert.equal(checkUiSlopAndPmGuards('components/pm/ui.js', [{ line: 1, text: '<button className="pmk"/>' }]).length, 0);
});

test('Changed-from git diff mode avoids legacy false positives and completes under 1 second', () => {
  const { dir, git } = makeTempGitRepo();
  try {
    fs.mkdirSync(path.join(dir, 'components', 'pm'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'components', 'pm', 'Legacy.js'),
      'export const OLD = "#ff0000";\nexport const SAFE = "ok";\n',
      'utf8'
    );
    git('add', '.');
    git('commit', '-m', 'base');
    const baseSha = git('rev-parse', 'HEAD').trim();

    // Edit only the clean line -> must pass
    fs.writeFileSync(
      path.join(dir, 'components', 'pm', 'Legacy.js'),
      'export const OLD = "#ff0000";\nexport const SAFE = "updated";\n',
      'utf8'
    );
    const passRes = runGuardrails({ repo: dir, changedFrom: baseSha });
    assert.equal(passRes.ok, true);
    assert.ok(passRes.durationMs < 1000, `Expected <1000ms, got ${passRes.durationMs}ms`);

    // Add a new violation -> must fail via CLI with exit code 1
    fs.writeFileSync(
      path.join(dir, 'components', 'pm', 'Legacy.js'),
      'export const OLD = "#ff0000";\nexport const SAFE = "updated";\nexport const BAD = "<button>x</button>";\n',
      'utf8'
    );
    let failed = false;
    try {
      execFileSync(
        process.execPath,
        [path.join(REPO_ROOT, 'scripts', 'check-agent-guardrails.cjs'), '--repo', dir, '--changed-from', baseSha, '--json'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
    } catch (err) {
      failed = err.status === 1;
      const parsed = JSON.parse(err.stdout);
      assert.equal(parsed.ok, false);
      assert.ok(parsed.violations.some((v) => v.rule === 'PM_NO_RAW_BUTTON'));
    }
    assert.equal(failed, true, 'CLI should exit with code 1 when violation is added');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
