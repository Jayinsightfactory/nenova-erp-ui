// scripts/sync-orbit-manuals.js
// Orbit 서버의 직무 프로파일(GET /api/flow/duty-manuals)을 받아
// data/work-manuals/orbit-<userId>-<idx>.draft.json 초안 파일로 동기화한다.
// 직원이 이미 확인/수정한 매뉴얼은 data/work-manuals/_state.json.manuals[id]에 남아 있고,
// lib/workManuals.js의 allManuals()가 초안 위에 state를 덮어쓰는 merge를 하므로
// 이 스크립트가 초안 파일을 갱신해도 직원의 확인/수정 내용은 그대로 유지된다(별도 처리 불필요).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(process.cwd(), 'data', 'work-manuals');

const ALIAS = {
  'ㅋㅋ': '조현욱',
  'ᄏᄏ': '조현욱',
  'jaeyong lim': '임재용',
};

const DEPARTMENTS = [
  { id: 'sales-support', name: '영업지원', members: ['설연주', '강현우', '임재용'] },
  { id: 'import', name: '수입부', members: ['가브리엘', '김원빈'] },
  { id: 'sales', name: '영업부', members: ['박성수', '정재훈', '조현욱'] },
  { id: 'management', name: '경영지원', members: ['강명훈'] },
];

function resolveMember(name) {
  if (!name) return null;
  const trimmed = String(name).trim();
  const aliased = ALIAS[trimmed] || trimmed;
  for (const dept of DEPARTMENTS) {
    if (dept.members.includes(aliased)) return { dept: dept.name, owner: aliased };
  }
  return null;
}

function readToken() {
  if (process.env.ORBIT_TOKEN) return process.env.ORBIT_TOKEN.trim();
  try {
    const p = path.join(os.homedir(), '.orbit-config.json');
    let raw = fs.readFileSync(p, 'utf8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // BOM 제거
    const json = JSON.parse(raw);
    if (json && json.token) return String(json.token).trim();
  } catch (_) {}
  return null;
}

function confidenceLabel(n) {
  const v = Number(n) || 0;
  if (v >= 0.6) return 'high';
  if (v >= 0.4) return 'medium';
  return 'low';
}

function stepTitle(text) {
  const s = String(text || '').trim();
  const cut = s.slice(0, 40);
  const m = cut.match(/^[\s\S]*?[.。!?！？]/);
  if (m && m[0].length >= 4) return m[0].trim();
  return cut;
}

function toDraft(userId, name, mapped, duty, idx, generatedAt) {
  const tools = Array.isArray(duty.tools) ? duty.tools : [];
  const steps = (Array.isArray(duty.steps) ? duty.steps : []).map((s, i) => ({
    no: i + 1,
    title: stepTitle(s),
    detail: String(s || '').trim(),
    app: tools[0] || '',
    check: '',
  }));
  const summaryParts = [duty.when, duty.frequency].filter(Boolean);
  return {
    id: `orbit-${userId}-${idx}`,
    dept: mapped.dept,
    owner: mapped.owner,
    title: duty.title || '업무',
    summary: summaryParts.join(' / '),
    frequency: duty.frequency || '',
    tools,
    steps,
    evidence: {
      period: '',
      eventCount: 0,
      sources: Array.isArray(duty.evidence) ? duty.evidence : (duty.evidence ? [duty.evidence] : []),
    },
    confidence: confidenceLabel(duty.evidence && duty.evidence.confidence !== undefined ? duty.evidence.confidence : undefined),
    status: 'ai_draft',
    source: 'orbit-duty',
    generatedAt: generatedAt || new Date().toISOString(),
  };
}

async function main() {
  const base = process.env.ORBIT_SERVER_URL || 'https://mindmap-viewer-production-adb2.up.railway.app';
  const token = readToken();
  if (!token) {
    console.error('ORBIT 토큰을 찾을 수 없습니다 (ORBIT_TOKEN env 또는 ~/.orbit-config.json).');
    process.exit(1);
  }

  const res = await fetch(`${base}/api/flow/duty-manuals`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error(`Orbit 요청 실패: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const data = await res.json();
  if (!data || data.ok !== true || !Array.isArray(data.people)) {
    console.error('Orbit 응답 형식이 예상과 다릅니다.');
    process.exit(1);
  }

  const unmapped = [];
  const written = [];

  for (const person of data.people) {
    const mapped = resolveMember(person.name);
    if (!person.name || !mapped) {
      unmapped.push(person.name || person.userId);
      continue;
    }
    const duties = Array.isArray(person.duties) ? person.duties : [];
    duties.forEach((duty, idx) => {
      const draft = toDraft(person.userId, person.name, mapped, duty, idx, person.generatedAt);
      const conf = Number(person.confidence);
      if (!Number.isNaN(conf)) draft.confidence = confidenceLabel(conf);
      const file = `orbit-${person.userId}-${idx}.draft.json`;
      fs.writeFileSync(path.join(DIR, file), JSON.stringify(draft, null, 2) + '\n', 'utf8');
      written.push(file);
    });
  }

  // 재실행 안전: 이번 결과에 없는 기존 orbit-*.draft.json 은 삭제 (손작성 파일은 건드리지 않음)
  let existing = [];
  try {
    existing = fs.readdirSync(DIR).filter((f) => f.startsWith('orbit-') && f.endsWith('.draft.json'));
  } catch (_) {}
  for (const f of existing) {
    if (!written.includes(f)) {
      fs.unlinkSync(path.join(DIR, f));
    }
  }

  console.log(`사람 수: ${data.people.length}`);
  console.log(`매뉴얼 수: ${written.length}`);
  console.log(`미매핑: ${unmapped.length ? unmapped.join(', ') : '없음'}`);
}

main().catch((err) => {
  console.error('동기화 실패:', err.message);
  process.exit(1);
});
