// lib/pmGrowStore.js — /pm 키우기 상태 저장(웹 전용 파일 data/runtime/pm-grow-state.json, MSSQL 무관).
// pm-office 피드 수신 직후 서버가 tickGrowFromOffice() 로 한 번 갱신한다(클라이언트 값 사용 안 함).
import fs from 'fs';
import path from 'path';
import { advanceGrow } from './pmGrow';
import { trackAll } from './pmMood';

const file = () => path.join(process.cwd(), 'data', 'runtime', 'pm-grow-state.json');

export function readGrowState() {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return null; }
}

export function tickGrowFromOffice(office, nowMs = Date.now()) {
  // 성장 포인트(advanceGrow) 계산 후, 캐릭터 연출용 활동 추적값만 덧붙인다(포인트 무관)
  const next = trackAll(advanceGrow(readGrowState(), office, nowMs), office, nowMs);
  const f = file();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next));
  fs.renameSync(tmp, f);
  return next;
}
