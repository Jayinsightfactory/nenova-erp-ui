// ECOUNT 조회값 대조(읽기 전용): 네노바웹 워크벤치 화면 자료(ecount_work 현재 버전) vs ECOUNT 스냅샷(원본 화면 수집본).
// 비교 3단:
//   A) 원본 화면 자체 검산: 스냅샷 ScreenRowCnt/ScreenTotal(ECOUNT 화면 하단 값) vs 수집 행수/합계
//   B) 웹 = 그 버전의 원천 스냅샷: 행수·필드합·행별 값 일치(행 순서 기준)
//   C) 웹 vs 최신 스냅샷: 시차(데이터 시차) 여부
// 출력 evidence 에는 행수·일치/불일치 개수·합계 일치 여부만 남긴다(거래처명·금액 원값 미저장).
// 토큰: 사용자 env NENOVAWEB_TOKEN (Windows User 범위). 출력하지 않는다.
// Usage: node scripts/ecount-verify-values.mjs [--out data/ecount-workbench/evidence/<date>-value-parity.json]
import fs from 'fs';
import { execSync } from 'child_process';

const BASE = process.env.NENOVAWEB_URL || 'https://nenovaweb.com';
const token = process.env.NENOVAWEB_TOKEN || (process.platform === 'win32'
  ? execSync(`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('NENOVAWEB_TOKEN','User')"`).toString().trim() : '');
if (!token) { console.error('NENOVAWEB_TOKEN missing'); process.exit(2); }
const args = process.argv.slice(2);
const out = args.includes('--out') ? args[args.indexOf('--out') + 1]
  : `data/ecount-workbench/evidence/${new Date().toISOString().slice(0, 10)}-value-parity.json`;

// 프로그램 ↔ 워크벤치 dataset/menu (source-menu.json 의 화면 메뉴 ID)
const TARGETS = [
  { program: 'E040214', dataset: 'ar', menuId: 'MENUTREE_000500' },
  { program: 'E040309', dataset: 'ap', menuId: 'MENUTREE_000517' },
  { program: 'E010205', dataset: 'cash', menuId: 'MENUTREE_002563' },
  { program: 'E040207', dataset: 'sales', menuId: 'MENUTREE_000494' },
  { program: 'E040206', dataset: 'saleQuery', menuId: 'MENUTREE_000492' },
  { program: 'E010701', dataset: 'journal', menuId: 'MENUTREE_000098' },
];

async function get(path) {
  const r = await fetch(BASE + path, { headers: { Authorization: `Bearer ${token}` } });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}
const num = v => { if (v === null || v === undefined || v === '') return null; const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
const payloadOf = row => { const p = row.Payload ?? row.payload; if (!p) return {}; return typeof p === 'string' ? JSON.parse(p) : p; };
const isSub = r => r.isSubtotal === true || r.isSubtotal === 1 || r.IsSubtotal === true || r.IsSubtotal === 1;

function numericFields(rows) {
  const f = new Set();
  for (const r of rows) for (const [k, v] of Object.entries(r)) if (!['rowNumber', 'isSubtotal', 'IsSubtotal'].includes(k) && num(v) !== null && typeof v !== 'boolean') f.add(k);
  return [...f];
}
const sums = (rows, fields) => Object.fromEntries(fields.map(k => [k, Math.round(rows.reduce((a, r) => a + (num(r[k]) || 0), 0) * 100) / 100]));

function compareRows(web, src, fields) {
  let mismatchRows = 0, mismatchFields = 0;
  const n = Math.max(web.length, src.length);
  for (let i = 0; i < n; i++) {
    const w = web[i], s = src[i];
    if (!w || !s) { mismatchRows++; continue; }
    let bad = 0;
    for (const k of fields) { const a = num(w[k]), b = num(s[k]); if ((a ?? 0) !== (b ?? 0)) bad++; }
    if (bad) { mismatchRows++; mismatchFields += bad; }
  }
  return { comparedRows: n, comparedFields: fields.length, mismatchRows, mismatchFields };
}

const results = [];
for (const t of TARGETS) {
  const rec = { ...t, observedAt: new Date().toISOString() };
  try {
    const ws = await get(`/api/ecount/workspace?dataset=${t.dataset}&menuId=${t.menuId}&program=${t.program}`);
    const list = await get(`/api/ecount?dataset=${t.dataset}&limit=1`);
    const latestKey = list.body.snapshots?.[0]?.SnapshotKey ?? null;
    const v = ws.body.version;
    rec.web = { httpStatus: ws.status, hasVersion: !!v, sourceSnapshotKey: v?.sourceSnapshotKey ?? null, sourceTakenAt: v?.sourceTakenAt ?? null };
    rec.latestSnapshotKey = latestKey;
    rec.latestTakenAt = list.body.snapshots?.[0]?.TakenAt ?? null;
    if (!v) { rec.verdict = '미확인'; rec.cause = ws.status === 200 ? '미구현(웹 버전 없음: 원본 가져오기 미실행)' : `권한/조회 실패 HTTP ${ws.status}`; results.push(rec); continue; }
    rec.web.sourceKind = v.sourceKind ?? null;
    if (!v.sourceSnapshotKey) { rec.verdict = '미확인'; rec.cause = `원천 스냅샷 없음(sourceKind=${v.sourceKind ?? 'null'}): 수집 데이터셋(cash/ar/ap/sales) 밖이라 ECOUNT 원본 화면 직접 대조 필요`; rec.web.rowCount = (v.rows || []).filter(r => !isSub(r)).length; results.push(rec); continue; }
    const webDetail = v.rows.filter(r => !isSub(r));
    const fields = numericFields(webDetail);
    const evalSnap = async key => {
      const s = (await get(`/api/ecount?snapshot=${key}`)).body.snapshot;
      const rows = s.rows.map(r => ({ ...payloadOf(r), isSubtotal: isSub(r) }));
      const detail = rows.filter(r => !isSub(r));
      const screenTotal = num(s.ScreenTotal), parsedTotal = num(s.ParsedTotal);
      return {
        snapshotKey: key, takenAt: s.TakenAt, rowCnt: s.RowCnt, screenRowCnt: s.ScreenRowCnt ?? null,
        selfCheck: { status: s.VerifyStatus ?? null, score: s.VerifyScore ?? null,
          rowCountMatchesScreen: s.ScreenRowCnt == null ? null : Number(s.ScreenRowCnt) === detail.length,
          totalMatchesScreen: screenTotal == null || parsedTotal == null ? null : Math.abs(screenTotal - parsedTotal) <= Math.max(1, detail.length * 0.5) /* ECOUNT 화면은 원 단위 반올림 표시: 행당 ±0.5원 */ },
        detail, sums: sums(detail, fields),
      };
    };
    const srcSnap = await evalSnap(v.sourceSnapshotKey);
    const webSums = sums(webDetail, fields);
    const B = compareRows(webDetail, srcSnap.detail, fields);
    rec.webVsSource = { rowCountWeb: webDetail.length, rowCountSource: srcSnap.detail.length, totalsFields: fields.length,
      totalsMismatch: fields.filter(k => webSums[k] !== srcSnap.sums[k]), ...B };
    rec.sourceSelfCheck = srcSnap.selfCheck;
    if (latestKey && latestKey !== v.sourceSnapshotKey) {
      const lat = await evalSnap(latestKey);
      const C = compareRows(webDetail, lat.detail, fields);
      rec.webVsLatest = { rowCountLatest: lat.detail.length, totalsMismatch: fields.filter(k => webSums[k] !== lat.sums[k]), ...C };
      rec.latestSelfCheck = lat.selfCheck;
    } else rec.webVsLatest = { sameSnapshot: true };
    const sameAsSource = rec.webVsSource.rowCountWeb === rec.webVsSource.rowCountSource && !rec.webVsSource.totalsMismatch.length && !B.mismatchRows;
    const lagFree = rec.webVsLatest.sameSnapshot || (!rec.webVsLatest.totalsMismatch.length && !rec.webVsLatest.mismatchRows);
    rec.verdict = sameAsSource && lagFree ? '일치' : '불일치';
    rec.cause = !sameAsSource ? '계산식(웹 변환이 원천 스냅샷과 다름)' : !lagFree ? '데이터 시차(웹 버전이 최신 스냅샷보다 이전)' : null;
  } catch (e) { rec.verdict = '미확인'; rec.cause = 'error: ' + String(e.message).slice(0, 120); }
  results.push(rec);
}
fs.writeFileSync(out, JSON.stringify({ kind: 'ecount-value-parity', observedOn: new Date().toISOString().slice(0, 10), base: BASE,
  privacy: 'counts/booleans only; no names, amounts or row values stored', results }, null, 1) + '\n');
for (const r of results) console.log(r.program, r.dataset, r.verdict, r.cause || '', JSON.stringify({ web: r.web, vsSrc: r.webVsSource, src: r.sourceSelfCheck, vsLatest: r.webVsLatest, latest: r.latestSelfCheck }));
