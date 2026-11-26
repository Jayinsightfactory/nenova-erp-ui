// 화면 사용 기록의 날짜별 집계(읽기 전용). 기록 원본(lib/userActivityStore.cjs)은 건드리지 않는다.
//   listEvents 는 쪽마다 하루치 파일을 전부 다시 읽어, 44일치를 읽으면 2시간이 넘게 걸린다(2026-11-26 실측).
//   여기서는 하루치를 한 번만 읽어 화면 주소별로 세고, 지난 날은 <기록 폴더>/_summary/<날짜>.json 에 적어 두고 다시 읽지 않는다.
//   돌려주는 값에는 계정 이름·번호가 없다(화면 주소별 건수와 계정 수만).
const fs = require('node:fs');
const path = require('node:path');

const root = () => process.env.NENOVA_ACTIVITY_DIR || path.join(process.cwd(), 'data', 'user-activity');
const MAX_DAYS = 62;
const HOURS = Array.from({ length: 24 }, (_, n) => String(n).padStart(2, '0'));
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const cacheFile = (day) => path.join(root(), '_summary', day + '.json');

// 하루치를 한 번 읽어 화면 주소별로 센다. { day, total, paths: { 주소: { events, users[], kinds{}, desktop } } }
async function summarizeDay(day) {
  const paths = {}; let total = 0;
  for (const hour of HOURS) {
    const directory = path.join(root(), day, hour);
    let files; try { files = await fs.promises.readdir(directory); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const file of files) {
      if (!/^[a-f0-9]{64}\.jsonl$/.test(file)) continue;
      let row; try { row = JSON.parse(await fs.promises.readFile(path.join(directory, file), 'utf8')); } catch { continue; }
      const key = row.pagePath || row.path; if (!key || typeof key !== 'string') continue;
      const e = paths[key] || (paths[key] = { events: 0, users: new Set(), kinds: {}, desktop: 0 });
      e.events++; total++; if (row.userId) e.users.add(String(row.userId));
      e.kinds[row.kind] = (e.kinds[row.kind] || 0) + 1; if (row.source === 'desktop') e.desktop++;
    }
  }
  for (const k of Object.keys(paths)) paths[k].users = [...paths[k].users];
  return { day, total, paths };
}

async function readCached(day) { try { const j = JSON.parse(await fs.promises.readFile(cacheFile(day), 'utf8')); return j && j.day === day && j.paths ? j : null; } catch { return null; } }
async function writeCached(summary) {
  const file = cacheFile(summary.day), temp = file + '.' + process.pid + '.tmp';
  try { await fs.promises.mkdir(path.dirname(file), { recursive: true }); await fs.promises.writeFile(temp, JSON.stringify(summary), { mode: 0o600 }); await fs.promises.rename(temp, file); }
  catch { try { await fs.promises.unlink(temp); } catch { /* 적어 두지 못해도 집계는 돌려준다 */ } }
}

// 기간 집계. 시간 예산을 넘기면 못 한 날을 pending 으로 돌려준다(다시 부르면 이어서 한다).
async function summarizeRange({ from, to, budgetMs = 20000, now = new Date() } = {}) {
  if (!isDay(from) || !isDay(to) || from > to) throw new Error('INVALID_DATE_RANGE');
  const days = []; for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86400000) days.push(new Date(t).toISOString().slice(0, 10));
  if (days.length > MAX_DAYS) throw new Error('INVALID_DATE_RANGE');
  const settledBefore = now.toISOString().slice(0, 10); // 이 날짜보다 앞선 날만 적어 둔다(오늘은 아직 쌓이는 중)
  const started = Date.now(); const done = [], pending = [], merged = {}; const perDay = {};
  for (const day of days) {
    let s = day < settledBefore ? await readCached(day) : null;
    if (!s) {
      if (done.length && Date.now() - started > budgetMs) { pending.push(day); continue; }
      s = await summarizeDay(day);
      if (day < settledBefore) await writeCached(s);
    }
    done.push(day); perDay[day] = s.total;
    for (const [p, e] of Object.entries(s.paths)) {
      const m = merged[p] || (merged[p] = { events: 0, users: new Set(), days: 0, firstDay: day, lastDay: day, kinds: {}, desktop: 0 });
      m.events += e.events; m.days++; m.lastDay = day; m.desktop += e.desktop || 0;
      for (const u of e.users || []) m.users.add(u);
      for (const [k, n] of Object.entries(e.kinds || {})) m.kinds[k] = (m.kinds[k] || 0) + n;
    }
  }
  const paths = Object.entries(merged).map(([p, m]) => ({ path: p, events: m.events, accounts: m.users.size, days: m.days, firstDay: m.firstDay, lastDay: m.lastDay, desktop: m.desktop, kinds: m.kinds })).sort((a, b) => b.events - a.events);
  return { from, to, doneDays: done, pendingDays: pending, perDay, total: paths.reduce((a, x) => a + x.events, 0), paths };
}

module.exports = { summarizeDay, summarizeRange, MAX_DAYS };
