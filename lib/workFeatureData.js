// lib/workFeatureData.js
// /my-work 탭2(기능 후보·스토리보드) 데이터 파일 위치 — 웹 전용 파일(MSSQL 무관).
//   저장소 파일 data/work-feature-<name>.json 은 배포 때의 스냅샷이고,
//   사장님 PC 예약 작업(nenova-work-features/run-all.sh)이 매일 만든 최신본은 data/runtime/ 에 올라온다(배포 없이 반영).
//   data/runtime/ 은 git 추적 안 함 → 배포가 덮어쓰지 않는다. 읽을 때는 runtime 이 있으면 그것을 먼저 쓴다.
import fs from 'fs';
import path from 'path';

export const FEATURE_NAMES = Object.freeze(['proposals', 'storyboards', 'workflows', 'simulations']);
export const FEATURE_MAX = 30 * 1024 * 1024;

const runtimeDir = () => path.join(process.cwd(), 'data', 'runtime');
const fileName = (name) => `work-feature-${name}.json`;

// 읽을 파일 경로: runtime 최신본 우선, 없으면 저장소 스냅샷
export function featureFilePath(name) {
  if (!FEATURE_NAMES.includes(name)) return null;
  const rt = path.join(runtimeDir(), fileName(name));
  if (fs.existsSync(rt)) return rt;
  return path.join(process.cwd(), 'data', fileName(name));
}

// 업로드 저장: 이름 검증 → JSON·generatedAt 검증 → 임시 파일에 쓰고 rename(읽는 중 반쪽 파일 방지)
export function saveFeatureFile(name, buffer) {
  if (!FEATURE_NAMES.includes(name)) return { ok: false, status: 400, error: 'name 은 ' + FEATURE_NAMES.join('|') };
  if (!buffer || !buffer.length) return { ok: false, status: 400, error: '빈 파일' };
  if (buffer.length > FEATURE_MAX) return { ok: false, status: 413, error: '30MB 초과' };
  let data;
  try { data = JSON.parse(buffer.toString('utf8')); } catch { return { ok: false, status: 400, error: 'JSON 아님' }; }
  if (!data || typeof data !== 'object' || !data.generatedAt) return { ok: false, status: 400, error: 'generatedAt 없음' };
  fs.mkdirSync(runtimeDir(), { recursive: true });
  const dest = path.join(runtimeDir(), fileName(name));
  const tmp = `${dest}.tmp`;
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, dest);
  return { ok: true, name, generatedAt: data.generatedAt, bytes: buffer.length };
}
