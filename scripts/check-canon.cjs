#!/usr/bin/env node
/*
 * 정본 연결 검사 (최소 형태)
 *
 * 확인하는 것은 딱 세 가지다.
 *   1. 정본 파일(docs/canon/CANON.md)이 있고 필수 구역 표시가 들어 있는가
 *   2. 도구별 진입 지침 파일이 정본 경로를 가리키는가
 *   3. 수정+왜 기록(docs/canon/why-log.jsonl)의 각 줄이 정해진 필드를 갖췄는가
 *
 * 규칙을 "잘 지켰는지", 판단이 "좋은지"는 검사하지 않는다. 형식만 본다.
 * 사용: node scripts/check-canon.cjs [--root <dir>]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CANON_PATH = 'docs/canon/CANON.md';
const WHY_LOG_PATH = 'docs/canon/why-log.jsonl';

// 정본 안에 반드시 있어야 하는 구역 표시(사람이 읽는 제목이 아니라 주석 표시로 고정)
const CANON_MARKERS = [
  '<!-- canon:priority -->',
  '<!-- canon:thinking-order -->',
  '<!-- canon:must -->',
  '<!-- canon:conflict-order -->',
  '<!-- canon:rule-map -->',
  '<!-- canon:why-log-format -->',
];

// 도구가 작업 시작 때 읽는 진입 파일. 각 파일이 정본 경로를 한 번 이상 적어야 한다.
const ENTRY_FILES = [
  { file: 'CLAUDE.md', tool: 'Claude Code' },
  { file: '.claude/CLAUDE.md', tool: 'Claude Code' },
  { file: 'AGENTS.md', tool: 'Codex' },
  { file: '.claude/agents/README.md', tool: 'Claude Code 하위 에이전트' },
  { file: '.claude/agents/nenova-pm.md', tool: 'PM 에이전트 정의' },
  { file: '.claude/agents/nenova-hr.md', tool: 'HR 에이전트 정의' },
];

const WHY_LOG_REQUIRED = ['id', 'date', 'area', 'before', 'after', 'why', 'why_source', 'decided_by', 'evidence', 'status'];
const WHY_SOURCES = ['stated', 'inferred', 'unknown'];
const DECIDERS = ['owner', 'staff', 'agent', 'unknown'];
const STATUSES = ['case', 'candidate', 'rule', 'retired'];

function readIfExists(root, rel) {
  const full = path.join(root, rel);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
}

function checkCanon(root) {
  const errors = [];
  const canon = readIfExists(root, CANON_PATH);
  if (canon === null) {
    errors.push(`정본 없음: ${CANON_PATH}`);
  } else {
    for (const marker of CANON_MARKERS) {
      if (!canon.includes(marker)) errors.push(`정본에 구역 표시 없음: ${marker}`);
    }
  }

  for (const { file, tool } of ENTRY_FILES) {
    const text = readIfExists(root, file);
    if (text === null) {
      errors.push(`진입 파일 없음: ${file} (${tool})`);
    } else if (!text.includes(CANON_PATH)) {
      errors.push(`정본을 가리키지 않음: ${file} (${tool}) — "${CANON_PATH}" 경로가 본문에 없음`);
    }
  }

  const log = readIfExists(root, WHY_LOG_PATH);
  if (log === null) {
    errors.push(`수정+왜 기록 없음: ${WHY_LOG_PATH}`);
  } else {
    const seen = new Set();
    log.split(/\r?\n/).forEach((line, index) => {
      if (!line.trim()) return;
      const where = `${WHY_LOG_PATH}:${index + 1}`;
      let row;
      try {
        row = JSON.parse(line);
      } catch (error) {
        errors.push(`${where} JSON 아님: ${error.message}`);
        return;
      }
      for (const key of WHY_LOG_REQUIRED) {
        if (row[key] === undefined || row[key] === null || row[key] === '') errors.push(`${where} 필드 없음: ${key}`);
      }
      if (row.id !== undefined) {
        if (seen.has(row.id)) errors.push(`${where} id 중복: ${row.id}`);
        seen.add(row.id);
      }
      if (row.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(row.date))) errors.push(`${where} date 형식(YYYY-MM-DD) 아님`);
      if (row.why_source !== undefined && !WHY_SOURCES.includes(row.why_source)) errors.push(`${where} why_source 값 오류: ${row.why_source}`);
      if (row.decided_by !== undefined && !DECIDERS.includes(row.decided_by)) errors.push(`${where} decided_by 값 오류: ${row.decided_by}`);
      if (row.status !== undefined && !STATUSES.includes(row.status)) errors.push(`${where} status 값 오류: ${row.status}`);
      // 이유를 직접 말한 기록이거나 사장님이 직접 정한 것만 규칙이 될 수 있다. 추정으로 모은 것은 원리 후보까지만.
      if (row.status === 'rule' && row.why_source !== 'stated' && row.decided_by !== 'owner') errors.push(`${where} 이유를 직접 말했거나(why_source=stated) 사장님이 정한(decided_by=owner) 기록만 status=rule 이 될 수 있음`);
    });
  }
  return errors;
}

module.exports = { checkCanon, CANON_PATH, WHY_LOG_PATH, CANON_MARKERS, ENTRY_FILES, WHY_LOG_REQUIRED };

if (require.main === module) {
  const rootFlag = process.argv.indexOf('--root');
  const root = rootFlag > -1 ? path.resolve(process.argv[rootFlag + 1]) : path.resolve(__dirname, '..');
  const errors = checkCanon(root);
  if (errors.length) {
    console.error(`정본 연결 검사 실패 ${errors.length}건`);
    for (const error of errors) console.error(` - ${error}`);
    process.exit(1);
  }
  console.log(`정본 연결 검사 통과: 정본 1개, 진입 파일 ${ENTRY_FILES.length}개, 기록 형식 확인`);
}
