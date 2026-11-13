// pages/api/pm/office.js
// /pm 사무실 화면 데이터 — 사장님 PC 가 ~1분마다 POST /api/work/feature-data-ingest (name=pm-office) 로 올린
// data/runtime/work-feature-pm-office.json 을 그대로 돌려준다(+서버 기준 나이). 파일 전용·읽기 전용, MSSQL 무관.
// 게이트: /my-work 와 동일 verifyReqUser + isOrbitReportViewer(아니면 404 은닉).
import fs from 'fs';
import { verifyReqUser } from '../../../lib/auth';
import { isOrbitReportViewer } from '../../../lib/orbitReportAccess';
import { featureFilePath } from '../../../lib/workFeatureData';
import { staffOfUser } from '../../../lib/pmAccount';
import { recordVisit } from '../../../lib/pmVisits';
import { pmUnresolved } from '../../../lib/pmUnresolved';

export default async function handler(req, res) {
  const user = await verifyReqUser(req, res);
  if (!user) return res.status(401).json({ success: false, error: '로그인 필요' });
  // 보기(GET)=로그인 직원 전체, 쓰기(POST 등)=관리자만 유지
  if (req.method !== 'GET' && !isOrbitReportViewer(user)) return res.status(403).json({ success: false, error: '관리자 전용' });
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ success: false, error: 'GET only' }); }
  res.setHeader('Cache-Control', 'private, no-store');
  // /pm 접속 기록(제품 비전 P0 관문 측정): 직원별 하루 1회, 이름·날짜만(파일 전용, 실패해도 조회는 정상)
  try { const nm = staffOfUser(user); if (nm) recordVisit(nm); } catch {}
  const f = featureFilePath('pm-office');
  let data = null; let mtime = null;
  try { mtime = fs.statSync(f).mtimeMs; data = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { data = null; }
  const now = Date.now();
  const gen = data?.generatedAt ? Date.parse(data.generatedAt) : NaN;
  const ageSec = Number.isFinite(gen) ? Math.max(0, Math.round((now - gen) / 1000)) : (mtime ? Math.round((now - mtime) / 1000) : null);
  // unresolved = "PM이 스스로 해결 못 한 일"의 쉬운 제목 목록(표시 전용 파생값, 원본 data 는 그대로). 데스크톱 홈의 PM 창이 제목만 쓴다.
  let unresolved = [];
  try { unresolved = pmUnresolved(data?.tasks); } catch { unresolved = []; }
  return res.status(200).json({ success: true, serverNow: new Date(now).toISOString(), receivedAt: mtime ? new Date(mtime).toISOString() : null, ageSec, unresolved, data });
}
