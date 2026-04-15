// lib/chat/codePatterns.js — 기존 pages/api/**/*.js 에서 SQL 패턴 추출
//
// 목적: LLM 이 이미 검증된 "실제 운영 쿼리들" 을 예시로 참고 → 정확한 SQL 생성.
// 캐시 1시간 (코드는 배포 후 변하지 않음).
//
// 안전: 파일 읽기만 함. 쿼리 실행 X.

import fs from 'fs';
import path from 'path';

const TTL_MS = 60 * 60 * 1000;
let _cache = null;
let _cacheAt = 0;

// 템플릿 리터럴 안의 SQL 추출 (간단 휴리스틱)
// - `...` 안에 SELECT|INSERT|UPDATE 등이 포함된 큰 문자열만 추출
// - 너무 짧은 건 제외 (50자 미만)
// - 같은 SQL 중복 제거
function extractSqlFromFile(content) {
  const hits = [];
  // back-tick template literals (multi-line 포함)
  const regex = /`([^`]{50,})`/g;
  let m;
  while ((m = regex.exec(content)) !== null) {
    const sql = m[1].trim();
    if (/^\s*(SELECT|WITH)\b/i.test(sql)) {
      hits.push(sql);
    }
  }
  return hits;
}

// 디렉토리 재귀 순회 (pages/api/ 아래 .js 만)
function walk(dir, files = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (_) { return files; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, files);
    else if (e.isFile() && e.name.endsWith('.js')) files.push(p);
  }
  return files;
}

async function build() {
  const apiRoot = path.join(process.cwd(), 'pages', 'api');
  const files = walk(apiRoot);
  const allSql = new Map();  // sql → {count, files[]}

  for (const f of files) {
    let content;
    try { content = fs.readFileSync(f, 'utf8'); }
    catch (_) { continue; }
    const sqls = extractSqlFromFile(content);
    const rel = path.relative(process.cwd(), f).replace(/\\/g, '/');
    for (const s of sqls) {
      // 짧게 정규화 (공백 축소)
      const key = s.replace(/\s+/g, ' ').slice(0, 200);
      if (!allSql.has(key)) {
        allSql.set(key, { sql: s, files: [rel] });
      } else {
        allSql.get(key).files.push(rel);
      }
    }
  }
  const unique = [...allSql.values()];
  return {
    count: unique.length,
    patterns: unique,
    builtAt: new Date().toISOString(),
  };
}

export async function getCodePatterns({ force = false } = {}) {
  const now = Date.now();
  if (!force && _cache && now - _cacheAt < TTL_MS) return _cache;
  _cache = await build();
  _cacheAt = now;
  return _cache;
}

// LLM 프롬프트용: 대표적 SQL 패턴 N개만 요약해 반환
// (전체 패턴은 양이 너무 많음 — 맥락에 넣을 수 있는 수준으로 추림)
export async function getCodePatternPrompt({ max = 12 } = {}) {
  const c = await getCodePatterns();
  if (!c.count) return '';

  // 대표적 패턴 우선순위:
  // 1) 다양한 FROM 테이블이 들어간 것 (JOIN 풍부)
  // 2) GROUP BY / ORDER BY 포함
  // 3) 길이 적당 (100~400자) — 너무 긴 건 생략
  const scored = c.patterns
    .map(p => {
      let score = 0;
      if (/GROUP\s+BY/i.test(p.sql)) score += 2;
      if (/ORDER\s+BY/i.test(p.sql)) score += 1;
      if (/JOIN/i.test(p.sql)) score += 2;
      if (/TOP\s+\d+/i.test(p.sql)) score += 1;
      if (p.sql.length < 100 || p.sql.length > 600) score -= 1;
      return { ...p, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, max);

  const blocks = scored.map((p, i) => {
    const srcHint = p.files[0].replace('pages/api/', '').replace('.js', '');
    const sqlNorm = p.sql.replace(/\s+/g, ' ').trim().slice(0, 400);
    return `[${i + 1}] (from ${srcHint})\n${sqlNorm}`;
  });

  return `## 기존 운영 쿼리 예시 (참고용)
아래는 이미 잘 동작하는 실제 SQL 들이다. 유사한 질문에서 이 패턴을 최대한 재활용.

${blocks.join('\n\n')}`;
}
