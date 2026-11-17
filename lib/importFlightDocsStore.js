// 「서류 전달함」 표시 저장 — 웹 전용 파일(data/runtime/import-flight-docs.json), MSSQL 무관. 서버 전용.
// 형식: { [운송장 11자리]: { at: ISO, by: 사용자ID } }
import fs from 'fs';
import path from 'path';

const KEEP_MS = 90 * 24 * 3600 * 1000;
const file = () => process.env.IMPORT_FLIGHT_DOCS_FILE || path.join(process.cwd(), 'data', 'runtime', 'import-flight-docs.json');

export function readDocsSent() {
  try {
    const v = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

export function setDocsSent(awb11, by, sent, nowMs = Date.now()) {
  const data = readDocsSent();
  if (sent) data[awb11] = { at: new Date(nowMs).toISOString(), by: by || 'unknown' };
  else delete data[awb11];
  for (const [k, v] of Object.entries(data)) {
    const t = Date.parse(v && v.at);
    if (!Number.isFinite(t) || nowMs - t > KEEP_MS) delete data[k];
  }
  const f = file();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, f);
  return data;
}
