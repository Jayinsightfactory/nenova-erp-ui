'use strict';
// ECOUNT 이관 묶음별 진행 보고 생성기.
// 59묶음 × (프로그램 수 / 버튼 목록 확보 프로그램 수 / 버튼 확정 수 / 구현 / 미구현 / 조건부 / 미관측 / API설계전용 / 검증 완료 / 상태)
// 모든 수치는 data/ecount-workbench/*.json 에서 계산한다. 퍼센트 완료율은 쓰지 않는다 (완료 0/373 명시).
// 분류(구현/미구현/조건부/미관측/API설계전용)는 scripts/ecount-step1-summary.cjs 의 classify 를 그대로 쓴다.
//
// Usage:
//   node scripts/ecount-progress-report.cjs [--out docs/ecount-migration/progress-YYYY-MM-DD.md]
//        [--prs 1164,1165,...] [--decisions docs/ecount-migration/decisions-pending-YYYY-MM-DD.json] [--date YYYY-MM-DD]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { classify } = require('./ecount-step1-summary.cjs');

const ROOT = path.join(__dirname, '..');
const CLASSES = ['구현', '미구현', '조건부', '미관측', 'API설계전용'];
const TOTAL_PROGRAMS = 373;
const TOTAL_PACKETS = 59;
const PR_BASE_URL = 'https://github.com/Jayinsightfactory/nenova-erp-ui/pull/';

function localDate(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 마크다운 표 셀: 파이프·개행 제거, 공란은 '-' 로 두어 표가 깨지지 않게 한다.
function cell(v) {
  if (v === null || v === undefined) return '-';
  const s = String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
  return s === '' ? '-' : s;
}
const row = cells => `| ${cells.map(cell).join(' | ')} |`;
function table(columns, rows, align) {
  const sep = columns.map((_, i) => (align && align[i] === 'r' ? '---:' : '---'));
  return [row(columns), `|${sep.join('|')}|`, ...rows.map(row)];
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function loadWorkbench(root) {
  const wb = path.join(root, 'data/ecount-workbench');
  return {
    report: readJson(path.join(wb, 'button-matches.json')),
    packets: readJson(path.join(wb, 'parity-packets.json')).packets,
    menu: readJson(path.join(wb, 'source-menu.json')),
    evidenceDir: path.join(wb, 'evidence'),
    scope: fs.existsSync(path.join(wb, 'scope-decisions.json')) ? readJson(path.join(wb, 'scope-decisions.json')) : null,
  };
}

// 기능·새창·조회값 비교가 모두 '일치'인 버튼만 검증 완료로 센다 (라벨 일치만으로는 미검증).
function isVerified(b) {
  const c = b.comparisons || {};
  return c.function?.status === '일치' && c.window?.status === '일치' && c.queryValues?.status === '일치';
}

function packetStatus(c) {
  if (c.programsWithButtons === 0) {
    if (c.programs > 0 && c.unused + c.riskExcluded === c.programs) return c.riskExcluded ? (c.unused ? '미사용(관찰 0건)·위험제외 — 구현 대상 제외' : '위험제외 — 구현 대상 제외') : '미사용(관찰 0건)·미조사 — 구현 대상 제외';
    return '원본 미조사';
  }
  const scope = c.programsWithButtons < c.programs ? '원본 목록 일부 확보' : '원본 목록 확보';
  if (c.verified > 0) return `${scope}·일부 검증`;
  if (c['구현'] > 0) return `${scope}·일부 구현(활성)·검증 대기`;
  return `${scope}·대상 셸 대기`;
}

function menuLabels(menu) {
  const labels = new Map();
  for (const m of menu.menus || []) {
    if (m.hasChildren || !m.program) continue;
    if (!labels.has(m.program)) labels.set(m.program, m.label);
  }
  return labels;
}

// scope-decisions.json(2026-10-22 사장님 결정): 관찰 0건 화면 = 미사용·미조사, 위험 화면 = 열지 않음. 둘 다 구현 대상 제외.
function scopeSets(scope) {
  const ids = k => new Set((scope?.[k]?.programs || []).map(p => p.program));
  return { unused: ids('unused'), risky: ids('riskExcluded') };
}

function buildPacketRows({ report, packets, menu, scope }) {
  const sets = scopeSets(scope);
  const pageByProgram = new Map(report.pages.map(p => [p.program, p]));
  const labels = menuLabels(menu);
  const rows = [];
  const uninventoried = [];
  for (const pk of packets) {
    const c = { id: pk.id, group: pk.group, programs: pk.screenIds.length, programsWithButtons: 0, unused: 0, riskExcluded: 0, buttons: 0, verified: 0 };
    for (const k of CLASSES) c[k] = 0;
    const missing = [];
    for (const id of pk.screenIds) {
      const page = pageByProgram.get(id);
      const buttons = page?.buttons || [];
      if (!buttons.length) {
        const scopeLabel = sets.risky.has(id) ? '위험제외' : sets.unused.has(id) ? '미사용(관찰 0건)' : '미조사';
        if (scopeLabel === '위험제외') c.riskExcluded += 1; else if (scopeLabel !== '미조사') c.unused += 1;
        missing.push({ program: id, label: labels.get(id) || page?.title || '-', scope: scopeLabel });
        continue;
      }
      c.programsWithButtons += 1;
      c.buttons += buttons.length;
      for (const b of buttons) {
        c[classify(b, id)] += 1;
        if (isVerified(b)) c.verified += 1;
      }
    }
    c.status = packetStatus(c);
    rows.push(c);
    if (missing.length) uninventoried.push({ id: pk.id, group: pk.group, screens: missing });
  }
  const totals = { id: '합계', group: '', programs: 0, programsWithButtons: 0, unused: 0, riskExcluded: 0, buttons: 0, verified: 0 };
  for (const k of CLASSES) totals[k] = 0;
  for (const r of rows) for (const k of Object.keys(totals)) if (typeof totals[k] === 'number') totals[k] += r[k];
  totals.status = `완료 0/${TOTAL_PROGRAMS} 프로그램 · 0/${TOTAL_PACKETS} 묶음`;
  return { rows, totals, uninventoried };
}

function defaultGhRunner(n) {
  const out = execFileSync('gh', ['pr', 'view', String(n), '--json', 'title,mergedAt,mergeCommit,url'], { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out);
}

function loadPrs(numbers, ghRunner = defaultGhRunner) {
  return numbers.map(n => {
    try {
      const r = ghRunner(n) || {};
      return { number: n, title: r.title || '-', mergedAt: r.mergedAt || '미머지', mergeCommit: r.mergeCommit?.oid ? r.mergeCommit.oid.slice(0, 8) : '-', url: r.url || PR_BASE_URL + n, source: 'gh' };
    } catch {
      return { number: n, title: '(gh 조회 실패)', mergedAt: '-', mergeCommit: '-', url: PR_BASE_URL + n, source: 'number-only' };
    }
  });
}

// evidence/*smoke*.json, *regression*.json → kind/대상/결과 표. 파일의 privacy 플래그가 전부 false 가 아니면 행을 싣지 않는다.
function loadEvidence(evidenceDir) {
  if (!evidenceDir || !fs.existsSync(evidenceDir)) return [];
  const files = fs.readdirSync(evidenceDir).filter(f => /\.json$/.test(f) && /(smoke|regression)/i.test(f)).sort();
  const rows = [];
  for (const f of files) {
    let doc;
    try { doc = readJson(path.join(evidenceDir, f)); } catch { rows.push({ file: f, id: '-', kind: 'invalid', what: '(JSON 파싱 실패)', result: '-' }); continue; }
    const privacy = doc.privacy || {};
    const unsafe = Object.values(privacy).some(v => v === true);
    if (unsafe) { rows.push({ file: f, id: doc.id || '-', kind: 'excluded', what: '(privacy 플래그 true — 미게재)', result: '-' }); continue; }
    for (const chk of doc.checks || []) {
      rows.push({ file: f, id: doc.id || '-', kind: chk.kind || '-', what: chk.what || chk.criteria || chk.dataset || '-', result: chk.result || chk.status || '-' });
    }
  }
  return rows;
}

function loadDecisions(file) {
  if (!file) return [];
  const arr = readJson(file);
  if (!Array.isArray(arr)) throw new Error('DECISIONS_NOT_ARRAY');
  return arr.map(d => ({ item: d.item || '-', reason: d.reason || '-', needed: d.needed || '-' }));
}

function buildModel(opts = {}) {
  const root = opts.root || ROOT;
  const data = { ...loadWorkbench(root), ...(opts.data || {}) };
  const packetModel = buildPacketRows(data);
  return {
    date: opts.date || localDate(),
    ...packetModel,
    pagesWithButtons: data.report.pages.filter(p => p.buttons?.length).length,
    pages: data.report.pages.length,
    prs: loadPrs(opts.prs || [], opts.ghRunner),
    evidence: loadEvidence(opts.evidenceDir !== undefined ? opts.evidenceDir : data.evidenceDir),
    decisions: opts.decisions ? loadDecisions(opts.decisions) : (opts.decisionRows || []),
  };
}

function renderMarkdown(m) {
  const L = [];
  L.push(`# ECOUNT 이관 묶음별 진행 보고 — ${m.date}`, '');
  L.push(`완료(전체 동등성 승인) 0/${TOTAL_PROGRAMS} 프로그램, 0/${TOTAL_PACKETS} 묶음. 아래 수치는 \`data/ecount-workbench\` 데이터에서 계산한 상태 집계이며 완료율이 아니다.`, '');
  L.push('- 버튼 목록 확보 = 원본에서 버튼을 1개 이상 관측해 button-matches 에 적재한 프로그램. 원본 전체 버튼 수(allSourceButtonsKnown)는 모든 화면에서 아직 미확정.');
  L.push('- 버튼 확정 수 = 관측 버튼 합. 구현 = 대상 컨트롤 렌더·활성 / 미구현 = 렌더·비활성(자리표시) / 조건부 = 코드 존재·크롤 미도달 / 미관측 = 대상 컨트롤 없음 / API설계전용 = 외부연동(UI·저장계약까지만).');
  L.push('- 미사용 = 직원 관찰(2026-09-18~10-14 ECOUNT 이용 210건)에서 열린 적 없는 화면, 미조사·구현 대상 제외(2026-10-22 결정). 위험제외 = 일괄 변경·삭제·반영 화면, 열지 않음. 근거 `data/ecount-workbench/scope-decisions.json`.');
  L.push('- 검증 완료 = 기능·새창·조회값 비교가 모두 \'일치\'인 버튼 수. 라벨 일치만으로는 세지 않는다.', '');

  L.push('## 1. 묶음별 현황', '');
  const cols = ['묶음', '기능군', '프로그램', '버튼 목록 확보', '미사용', '위험제외', '버튼 확정', '구현', '미구현', '조건부', '미관측', 'API설계전용', '검증 완료', '상태'];
  const align = ['l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'l'];
  const toCells = r => [r.id, r.group, r.programs, r.programsWithButtons, r.unused, r.riskExcluded, r.buttons, r['구현'], r['미구현'], r['조건부'], r['미관측'], r['API설계전용'], r.verified, r.status];
  L.push(...table(cols, [...m.rows.map(toCells), toCells(m.totals)], align), '');
  L.push(`화면 기준: 버튼 목록 확보 ${m.pagesWithButtons}/${m.pages}, 미조사 ${m.pages - m.pagesWithButtons}(미사용 ${m.totals.unused} · 위험제외 ${m.totals.riskExcluded} · 그 외 ${m.pages - m.pagesWithButtons - m.totals.unused - m.totals.riskExcluded}). 관측 버튼 ${m.totals.buttons}개 중 검증 완료 ${m.totals.verified}개.`, '');

  L.push('## 2. 남은 목록 — 프로그램 목록 확보 안 된 화면', '');
  if (!m.uninventoried.length) L.push('없음', '');
  for (const pk of m.uninventoried) {
    L.push(`### ${pk.id} ${cell(pk.group)} (${pk.screens.length}화면)`, '');
    L.push(...table(['프로그램', '라벨', '범위'], pk.screens.map(s => [s.program, s.label, s.scope || '미조사'])), '');
  }
  L.push('관측 화면의 남은 일: 버튼 목록 확보 화면 전부가 기능·새창·조회값 검증 대기(검증 완료 0). 미구현·조건부·미관측 버튼 상세는 `docs/ecount-migration/step1-closure-*.md` 참조.', '');

  L.push('## 3. PR 목록', '');
  if (!m.prs.length) L.push('(--prs 미지정)', '');
  else L.push(...table(['PR', '제목', '머지 시각(UTC)', '머지 커밋', '링크'], m.prs.map(p => [`#${p.number}`, p.title, p.mergedAt, p.mergeCommit, p.url])), '');

  L.push('## 4. 운영 스모크 증거', '');
  if (!m.evidence.length) L.push('(evidence/*smoke*.json, *regression*.json 없음)', '');
  else L.push(...table(['파일', '증거 ID', 'kind', '대상', '결과'], m.evidence.map(e => [e.file, e.id, e.kind, e.what, e.result])), '');

  L.push('## 5. 결정 대기', '');
  if (!m.decisions.length) L.push('(--decisions 미지정)', '');
  else L.push(...table(['항목', '사유', '필요한 결정'], m.decisions.map(d => [d.item, d.reason, d.needed])), '');

  return L.join('\n');
}

function parseArgs(argv) {
  const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const date = opt('--date') || localDate();
  return {
    date,
    out: opt('--out') || `docs/ecount-migration/progress-${date}.md`,
    prs: (opt('--prs') || '').split(',').map(s => s.trim()).filter(Boolean).map(Number).filter(n => Number.isInteger(n) && n > 0),
    decisions: opt('--decisions') ? path.resolve(ROOT, opt('--decisions')) : null,
  };
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const model = buildModel({ date: a.date, prs: a.prs, decisions: a.decisions });
  const md = renderMarkdown(model) + '\n';
  const outPath = path.resolve(ROOT, a.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, md);
  const t = model.totals;
  console.log(`written ${a.out}`);
  console.log(JSON.stringify({ packets: model.rows.length, pagesWithButtons: model.pagesWithButtons, uninventoried: model.pages - model.pagesWithButtons, buttons: t.buttons, '구현': t['구현'], '미구현': t['미구현'], '조건부': t['조건부'], '미관측': t['미관측'], 'API설계전용': t['API설계전용'], verified: t.verified, prs: model.prs.length, evidenceRows: model.evidence.length, decisions: model.decisions.length }));
}

if (require.main === module) main();

module.exports = { buildModel, renderMarkdown, buildPacketRows, loadPrs, loadEvidence, loadDecisions, isVerified, packetStatus, CLASSES, TOTAL_PROGRAMS, TOTAL_PACKETS };
