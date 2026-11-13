import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

// 서버 보관 누적 도착원가 통합문서(국가별 1개). DB/ERP와 무관한 런타임 파일이며 git에서 제외된다.
// 쓸 때마다 직전 파일을 backups/에 남기고, 임시 파일에 쓴 뒤 이름을 바꿔 중간 상태가 보이지 않게 한다.
// CO = 콜카장(장미·카네이션·알스트로·루스커스 등, 원본 "45-1 콜카장 원가자료"), CO_HYDRANGEA = 수국 전용 공동 AWB(별도 원가자료).
export const MASTER_FILES = Object.freeze({ CO: 'colombia', CO_HYDRANGEA: 'colombia-hydrangea' });
export const MASTER_LABELS = Object.freeze({ CO: '콜카장 누적 원가자료', CO_HYDRANGEA: '수국 누적 원가자료' });

/** 계산에 쓰인 품종 그룹이 수국뿐이면 수국 파일, 그 외(혼합 포함)는 콜카장 파일. */
export function masterKeyFor(costGroups = []) {
  const active = costGroups.filter(group => Number(group?.quantity) > 0);
  return active.length && active.every(group => group.groupId === 'HYDRANGEA') ? 'CO_HYDRANGEA' : 'CO';
}
const MAX_BACKUPS = 30;
export const MAX_MASTER_BYTES = 12 * 1024 * 1024;
const root = () => process.env.COST_MASTER_DIR || path.join(process.cwd(), 'data', 'cost-master');
const fail = (message, statusCode = 422) => { throw Object.assign(new Error(message), { statusCode }); };
const slug = country => MASTER_FILES[country] || fail('누적 원가자료를 지원하지 않는 국가입니다.', 400);
const fileOf = country => path.join(root(), `${slug(country)}.xlsx`);

let queue = Promise.resolve();
/** 같은 프로세스 안에서 읽기-수정-쓰기가 겹치지 않도록 한 줄로 세운다. */
export function withMasterLock(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

/** 차수 "45-01" → 시트 이름 "45-1" (누적 파일의 기존 표기). */
export function weekSheetName(orderWeek) {
  const match = /^(\d{2})-(\d{2})$/.exec(String(orderWeek ?? ''));
  if (!match) fail('차수 형식(예: 45-01)을 확인하세요.', 400);
  return `${Number(match[1])}-${Number(match[2])}`;
}

export async function sheetNamesOf(buffer) {
  let zip;
  try { zip = await JSZip.loadAsync(buffer); } catch { fail('엑셀(xlsx) 파일이 아닙니다.'); }
  const workbook = await zip.file('xl/workbook.xml')?.async('string');
  if (!workbook) fail('엑셀 통합문서 구조를 읽지 못했습니다.');
  const names = [...workbook.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map(m => m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"'));
  if (!names.length) fail('시트가 없는 통합문서입니다.');
  return names;
}

export async function readMaster(country) {
  try { return await fs.readFile(fileOf(country)); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function masterInfo(country) {
  const file = fileOf(country);
  try {
    const [buffer, stat] = await Promise.all([fs.readFile(file), fs.stat(file)]);
    return { exists: true, sheetNames: await sheetNamesOf(buffer), updatedAt: stat.mtime.toISOString(), bytes: stat.size };
  } catch (error) { if (error.code === 'ENOENT') return { exists: false, sheetNames: [], updatedAt: null, bytes: 0 }; throw error; }
}

export async function writeMaster(country, buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_MASTER_BYTES) fail('누적 파일 크기를 확인하세요.');
  await sheetNamesOf(buffer);
  const file = fileOf(country), dir = path.dirname(file), backups = path.join(dir, 'backups');
  await fs.mkdir(backups, { recursive: true });
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.copyFile(file, path.join(backups, `${slug(country)}-${stamp}.xlsx`));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, buffer);
  await fs.rename(tmp, file);
  const old = (await fs.readdir(backups)).filter(name => name.startsWith(`${slug(country)}-`)).sort();
  for (const name of old.slice(0, Math.max(0, old.length - MAX_BACKUPS))) await fs.unlink(path.join(backups, name)).catch(() => {});
}
