// lib/pmVisits.js
// /pm 페이지 열람 기록 — 직원별 하루 1회(이름·날짜만, 개인정보 최소).
// 목적: 제품 비전 P0 관문 "직원 70% 주 2회 자발 접속 4주" 측정(사장님 PC pm-vision.js 가 집계).
// 저장: data/runtime/pm-visits.json (파일 전용, git 미추적, MSSQL 무관). 형식: { days: { "YYYY-MM-DD": ["이름", ...] } }
import fs from 'fs';
import path from 'path';

const FILE = () => path.join(process.cwd(), 'data', 'runtime', 'pm-visits.json');
const KEEP_DAYS = 120;

export function readVisits(file = FILE()) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return j && typeof j.days === 'object' && j.days ? { days: j.days } : { days: {} };
  } catch { return { days: {} }; }
}

// KST 기준 날짜(접속은 한국 근무일 기준으로 센다)
export function kstDay(now = Date.now()) {
  return new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
}

function prune(days, today) {
  const min = kstDay(Date.parse(today + 'T00:00:00Z') - KEEP_DAYS * 86400e3);
  for (const d of Object.keys(days)) if (d < min) delete days[d];
}

// 이름이 그 날짜에 처음이면 기록하고 true. 이미 있으면 파일을 건드리지 않는다(20초 폴링 대비).
export function recordVisit(name, { file = FILE(), now = Date.now() } = {}) {
  const nm = String(name || '').trim();
  if (!nm) return false;
  const today = kstDay(now);
  const v = readVisits(file);
  const list = Array.isArray(v.days[today]) ? v.days[today] : [];
  if (list.includes(nm)) return false;
  v.days[today] = [...list, nm];
  prune(v.days, today);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(v));
    fs.renameSync(tmp, file);
    return true;
  } catch { return false; }
}
