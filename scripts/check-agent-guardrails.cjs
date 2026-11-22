#!/usr/bin/env node
'use strict';

/**
 * check-agent-guardrails.cjs — 전 저장소 공용 1초 정적 가드레일 엔진 (LLM 토큰 0, 순수 Node 내장 모듈)
 *
 * 사용법:
 *   node check-agent-guardrails.cjs [--repo <경로>] [--changed-from <ref>] [--files <f1,f2>] [--json]
 *
 * 4대 결정론적 가드 (기존 레거시 오탐 방지를 위해 변경 파일/추가 라인 기준 정밀 검사):
 *   1) PS1_UTF8_BOM           : 한글/비ASCII 포함 *.ps1 파일 선두 UTF-8 BOM(EF BB BF) 필수
 *   2) SVG_LAYER_ORDER        : data-layer="wires" / "labels" 보유 SVG에서 wires 역전 또는 labels 뒤 <circle> 패킷 금지
 *   3) MONOSPACE_GULIM_FALLBACK : 추가된 스타일 라인에서 한글 고딕 폴백 없는 단독 monospace / JetBrains Mono 금지
 *   4) UI_ANTI_SLOP & PM_GUARD : 직원 노출 UI 금지어(감시/추적/모니터링/절감시간)·슬롭 이모지(🚀✨🔥💡) 및 /pm raw #hex·<button> 금지
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ZERO_SHA_RE = /^0+$/;
const SKIP_DIR_RE = /(?:^|\/)(?:node_modules|\.git|\.next|\.next-build|dist|build|coverage|\.turbo)(?:\/|$)/i;
const TEST_OR_GUARD_FILE_RE =
  /(?:^|\/)(?:__tests__|tests?|spec|fixtures?|mocks?)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|check-agent-guardrails\.cjs$|pstack-verify\.cjs$/i;

const UI_PATH_RE =
  /^(?:components|pages|src|app|desktop\/shell|public|data)\//i;
const NON_UI_PATH_RE =
  /^(?:pages\/api|scripts|docs|config|__tests__|tests)\//i;
const PM_PATH_RE =
  /^(?:components\/pm\/|pages\/pm\.js$|pages\/pm\/|lib\/pm[^/]*\.js$)/i;

const SVG_EXT_RE = /\.(?:js|jsx|tsx|html)$/i;
const STYLE_EXT_RE = /\.(?:js|jsx|tsx|css|scss|html)$/i;
const UI_EXT_RE = /\.(?:js|jsx|tsx|html|vue|svelte)$/i;

const PURE_COMMENT_LINE_RE = /^\s*(?:\/\/|\/\*|\*|<!--|\{\/\*)/;
const GOTHIC_FALLBACK_RE = /Pretendard|Malgun\s+Gothic|맑은\s*고딕|Apple\s+SD\s+Gothic|Noto\s+Sans\s+KR|sans-serif/i;
const FONT_DECL_RE = /\b(?:font-family|fontFamily|FONT_MONO)\b/i;
const MONO_TOKEN_RE = /\b(?:ui-)?monospace\b|JetBrains\s+Mono/i;

const FORBIDDEN_UI_WORDS_RE = /감시|추적|모니터링|절감시간/;
const SLOP_EMOJIS_RE = /[🚀✨🔥💡]/u;
const PM_HEX_RE = /(^|[^&\w$])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/;
const PM_RAW_BUTTON_RE = /<button[\s>]/;

function normalizeRel(p) {
  return String(p || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function runGit(repoRoot, args) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function isValidGitRef(repoRoot, ref) {
  if (!ref || ZERO_SHA_RE.test(ref)) return false;
  const out = runGit(repoRoot, ['rev-parse', '--verify', '--quiet', ref]);
  return Boolean(out && out.trim());
}

function resolveDefaultBaseRef(repoRoot) {
  const head = (runGit(repoRoot, ['rev-parse', '--verify', '--quiet', 'HEAD']) || '').trim();
  if (!head) return '';
  for (const candidate of ['origin/master', 'origin/main']) {
    if (isValidGitRef(repoRoot, candidate)) {
      const mb = (runGit(repoRoot, ['merge-base', 'HEAD', candidate]) || '').trim();
      if (mb && mb !== head) return mb;
    }
  }
  return 'HEAD';
}

function parseUnifiedDiff(diffText) {
  const fileMap = new Map();
  if (!diffText) return fileMap;

  let currentFile = null;
  let nextLineNo = 0;

  for (const rawLine of diffText.split(/\r?\n/)) {
    if (rawLine.startsWith('+++ ')) {
      const target = rawLine.slice(4).trim();
      if (target === '/dev/null') {
        currentFile = null;
      } else {
        const cleaned = target.replace(/^b\//, '');
        currentFile = normalizeRel(cleaned);
        if (!fileMap.has(currentFile)) fileMap.set(currentFile, []);
      }
      continue;
    }
    if (rawLine.startsWith('@@ ')) {
      const m = rawLine.match(/\+(\d+)(?:,(\d+))?/);
      nextLineNo = m ? Number(m[1]) : 0;
      continue;
    }
    if (!currentFile) continue;
    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      fileMap.get(currentFile).push({ line: nextLineNo, text: rawLine.slice(1) });
      nextLineNo += 1;
    } else if (rawLine.startsWith(' ')) {
      nextLineNo += 1;
    }
  }
  return fileMap;
}

function collectChangedDiff(repoRoot, { changedFrom = '', explicitFiles = [] } = {}) {
  const files = new Map();

  if (explicitFiles && explicitFiles.length > 0) {
    for (const raw of explicitFiles) {
      const rel = normalizeRel(raw);
      const abs = path.resolve(repoRoot, rel);
      if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) continue;
      const text = fs.readFileSync(abs, 'utf8');
      const lines = text.split(/\r?\n/).map((t, i) => ({ line: i + 1, text: t }));
      files.set(rel, lines);
    }
    return { baseRef: 'explicit', files };
  }

  const isGitRepo = Boolean(runGit(repoRoot, ['rev-parse', '--is-inside-work-tree']));
  if (!isGitRepo) {
    return { baseRef: '', files };
  }

  let baseRef = '';
  if (changedFrom && isValidGitRef(repoRoot, changedFrom)) {
    baseRef = changedFrom;
  } else {
    baseRef = resolveDefaultBaseRef(repoRoot);
  }

  if (baseRef) {
    const diffOut = runGit(repoRoot, [
      'diff',
      '--unified=0',
      '--no-color',
      '--diff-filter=ACMR',
      baseRef,
    ]);
    const parsed = parseUnifiedDiff(diffOut || '');
    for (const [rel, addedLines] of parsed.entries()) {
      if (SKIP_DIR_RE.test(rel)) continue;
      const abs = path.join(repoRoot, rel);
      if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) continue;
      files.set(rel, addedLines);
    }
  }

  // Always include newly created untracked files in working tree
  const untrackedOut = runGit(repoRoot, ['ls-files', '--others', '--exclude-standard']) || '';
  for (const raw of untrackedOut.split(/\r?\n/)) {
    const rel = normalizeRel(raw);
    if (!rel || SKIP_DIR_RE.test(rel) || files.has(rel)) continue;
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) continue;
    try {
      const stat = fs.statSync(abs);
      if (stat.size > 5 * 1024 * 1024) continue; // skip >5MB binaries
      const text = fs.readFileSync(abs, 'utf8');
      const lines = text.split(/\r?\n/).map((t, i) => ({ line: i + 1, text: t }));
      files.set(rel, lines);
    } catch {
      // ignore unreadable binary
    }
  }

  return { baseRef, files };
}

function lineNumberAt(content, offset) {
  return content.slice(0, offset).split(/\r?\n/).length;
}

/**
 * Rule 1: PowerShell UTF-8 BOM Guard (*.ps1)
 */
function checkPs1Bom(relFile, rawBuf) {
  if (!/\.ps1$/i.test(relFile)) return [];
  let hasNonAscii = false;
  for (let i = 0; i < rawBuf.length; i += 1) {
    if (rawBuf[i] >= 0x80) {
      hasNonAscii = true;
      break;
    }
  }
  if (!hasNonAscii) return [];
  const hasBom = rawBuf.length >= 3 && rawBuf[0] === 0xef && rawBuf[1] === 0xbb && rawBuf[2] === 0xbf;
  if (hasBom) return [];
  return [
    {
      rule: 'PS1_UTF8_BOM',
      severity: 'error',
      file: relFile,
      line: 1,
      message: '한글/비ASCII 포함 PowerShell(.ps1) 파일은 선두 UTF-8 BOM(EF BB BF)이 필수입니다.',
      snippet: rawBuf.subarray(0, 40).toString('utf8').replace(/\r?\n/g, ' ').trim(),
    },
  ];
}

/**
 * Rule 2: SVG Wire-over-Label Layer Inversion Guard (*.js, *.jsx, *.tsx, *.html)
 */
function checkSvgLayerOrder(relFile, fullText) {
  if (!SVG_EXT_RE.test(relFile) || TEST_OR_GUARD_FILE_RE.test(relFile)) return [];
  if (!fullText.includes('data-layer=')) return [];

  const violations = [];
  const svgRe = /<svg\b[\s\S]*?<\/svg>/gi;
  let match;
  while ((match = svgRe.exec(fullText)) !== null) {
    const block = match[0];
    const blockOffset = match.index;
    const wiresMatch = block.match(/data-layer\s*=\s*["']wires["']/);
    const labelsMatch = block.match(/data-layer\s*=\s*["']labels["']/);
    if (!wiresMatch && !labelsMatch) continue;

    if (wiresMatch && labelsMatch && wiresMatch.index > labelsMatch.index) {
      violations.push({
        rule: 'SVG_LAYER_ORDER',
        severity: 'error',
        file: relFile,
        line: lineNumberAt(fullText, blockOffset + wiresMatch.index),
        message: 'SVG 배선 레이어(data-layer="wires")가 라벨 레이어(data-layer="labels")보다 뒤에 선언되어 배선이 글자 위를 덮습니다.',
        snippet: 'data-layer="wires" must precede data-layer="labels"',
      });
    }

    if (labelsMatch) {
      const afterLabels = block.slice(labelsMatch.index);
      const circleMatch = afterLabels.match(/<circle\b[^>]*>/i);
      if (circleMatch) {
        violations.push({
          rule: 'SVG_LAYER_ORDER',
          severity: 'error',
          file: relFile,
          line: lineNumberAt(fullText, blockOffset + labelsMatch.index + circleMatch.index),
          message: 'SVG 라벨 레이어(data-layer="labels") 뒤에 <circle> 패킷이 선언되어 텍스트 위로 겹칠 수 있습니다.',
          snippet: circleMatch[0].slice(0, 100),
        });
      }
    }
  }
  return violations;
}

/**
 * Rule 3: Windows Gulim Standalone Monospace Fallback Guard
 */
function checkMonospaceFallback(relFile, addedLines) {
  if (!STYLE_EXT_RE.test(relFile) || TEST_OR_GUARD_FILE_RE.test(relFile)) return [];
  const violations = [];
  for (const { line, text } of addedLines) {
    if (PURE_COMMENT_LINE_RE.test(text)) continue;
    const hasFontContext = FONT_DECL_RE.test(text) || /['"]JetBrains\s+Mono['"]/i.test(text);
    if (!hasFontContext) continue;
    if (!MONO_TOKEN_RE.test(text)) continue;
    if (GOTHIC_FALLBACK_RE.test(text)) continue;
    violations.push({
      rule: 'MONOSPACE_GULIM_FALLBACK',
      severity: 'error',
      file: relFile,
      line,
      message: "한글 고딕 폴백('Pretendard', 'Malgun Gothic', sans-serif) 없이 단독 monospace/JetBrains Mono 사용 금지 (Windows 굴림체 폴백 방지).",
      snippet: text.trim().slice(0, 120),
    });
  }
  return violations;
}

/**
 * Rule 4: Anti-AI Slop (Forbidden UI Words, Slop Emojis) & /pm Raw #hex / <button> Guard
 */
function checkUiSlopAndPmGuards(relFile, addedLines) {
  if (TEST_OR_GUARD_FILE_RE.test(relFile)) return [];
  const violations = [];

  const isEmployeeUi = UI_PATH_RE.test(relFile) && !NON_UI_PATH_RE.test(relFile) && UI_EXT_RE.test(relFile);
  const isPmFile = PM_PATH_RE.test(relFile);
  const isPmThemeTokens = relFile === 'lib/pmThemes.js';
  const isPmUiKit = relFile === 'components/pm/ui.js';

  for (const { line, text } of addedLines) {
    const trimmed = text.trim();
    if (!trimmed) continue;

    if (isEmployeeUi && !PURE_COMMENT_LINE_RE.test(text)) {
      const wordMatch = text.match(FORBIDDEN_UI_WORDS_RE);
      if (wordMatch) {
        violations.push({
          rule: 'UI_FORBIDDEN_WORD',
          severity: 'error',
          file: relFile,
          line,
          message: `직원 노출 UI 금지어('${wordMatch[0]}') 추가 금지.`,
          snippet: trimmed.slice(0, 120),
        });
      }
      const emojiMatch = text.match(SLOP_EMOJIS_RE);
      if (emojiMatch) {
        violations.push({
          rule: 'UI_SLOP_EMOJI',
          severity: 'error',
          file: relFile,
          line,
          message: `Anti-AI Slop: 장식용 이모지('${emojiMatch[0]}') UI 추가 금지.`,
          snippet: trimmed.slice(0, 120),
        });
      }
    }

    if (isPmFile) {
      if (!isPmThemeTokens && PM_HEX_RE.test(text)) {
        violations.push({
          rule: 'PM_NO_HEX_COLOR',
          severity: 'error',
          file: relFile,
          line,
          message: '/pm 컴포넌트 내 raw #hex 색 하드코딩 금지 (var(--pm-*) 토큰 사용 필수).',
          snippet: trimmed.slice(0, 120),
        });
      }
      if (!isPmUiKit && !/^lib\//i.test(relFile) && PM_RAW_BUTTON_RE.test(text)) {
        violations.push({
          rule: 'PM_NO_RAW_BUTTON',
          severity: 'error',
          file: relFile,
          line,
          message: '/pm 컴포넌트 내 raw <button> 금지 (components/pm/ui.js 키트 사용 필수).',
          snippet: trimmed.slice(0, 120),
        });
      }
    }
  }

  return violations;
}

function runGuardrails({ repo = process.cwd(), changedFrom = '', files: explicitFiles = [] } = {}) {
  const startedAt = Date.now();
  const repoRoot = path.resolve(repo);
  const { baseRef, files } = collectChangedDiff(repoRoot, { changedFrom, explicitFiles });

  const violations = [];
  const checkedFiles = [];

  for (const [relFile, addedLines] of files.entries()) {
    const absPath = path.join(repoRoot, relFile);
    if (!fs.existsSync(absPath)) continue;
    checkedFiles.push(relFile);

    let rawBuf;
    try {
      rawBuf = fs.readFileSync(absPath);
    } catch {
      continue;
    }

    // 1) PowerShell UTF-8 BOM
    violations.push(...checkPs1Bom(relFile, rawBuf));

    // Skip binary files for text-based rules
    if (rawBuf.includes(0)) continue;
    const fullText = rawBuf.toString('utf8');

    // 2) SVG Wire-over-Label Layer Inversion
    violations.push(...checkSvgLayerOrder(relFile, fullText));

    // 3) Windows Gulim Standalone Monospace Fallback
    violations.push(...checkMonospaceFallback(relFile, addedLines));

    // 4) Anti-AI Slop & /pm Design Guards
    violations.push(...checkUiSlopAndPmGuards(relFile, addedLines));
  }

  const rulesSummary = {
    PS1_UTF8_BOM: 0,
    SVG_LAYER_ORDER: 0,
    MONOSPACE_GULIM_FALLBACK: 0,
    UI_FORBIDDEN_WORD: 0,
    UI_SLOP_EMOJI: 0,
    PM_NO_HEX_COLOR: 0,
    PM_NO_RAW_BUTTON: 0,
  };
  for (const v of violations) {
    if (Object.prototype.hasOwnProperty.call(rulesSummary, v.rule)) {
      rulesSummary[v.rule] += 1;
    }
  }

  return {
    ok: violations.length === 0,
    repo: repoRoot,
    changedFrom: baseRef || changedFrom || '(working-tree)',
    durationMs: Date.now() - startedAt,
    checkedFilesCount: checkedFiles.length,
    checkedFiles,
    violationCount: violations.length,
    rulesSummary,
    violations,
  };
}

function parseCliArgs(argv) {
  const opts = { repo: process.cwd(), changedFrom: '', files: [], json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--repo' && argv[i + 1]) {
      opts.repo = argv[++i];
    } else if (a === '--changed-from' && argv[i + 1] !== undefined) {
      opts.changedFrom = argv[++i];
    } else if (a === '--files' && argv[i + 1]) {
      opts.files = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '--json') {
      opts.json = true;
    }
  }
  return opts;
}

function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  const result = runGuardrails(opts);

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.ok) {
    console.log(
      `[PASS] agent-guardrails: ${result.checkedFilesCount} changed file(s) clean (${result.durationMs}ms, base=${result.changedFrom})`
    );
  } else {
    console.error(
      `[FAIL] agent-guardrails: ${result.violationCount} violation(s) in ${result.checkedFilesCount} changed file(s) (${result.durationMs}ms)`
    );
    for (const v of result.violations) {
      console.error(`  - ${v.file}:${v.line} [${v.rule}] ${v.message}`);
      if (v.snippet) console.error(`      ${v.snippet}`);
    }
  }
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = {
  runGuardrails,
  checkPs1Bom,
  checkSvgLayerOrder,
  checkMonospaceFallback,
  checkUiSlopAndPmGuards,
  collectChangedDiff,
  parseUnifiedDiff,
};
