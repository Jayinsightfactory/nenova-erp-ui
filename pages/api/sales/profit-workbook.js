// 매출원가 양식 원천시트 API — 계약 docs/contracts/profit-workbook.json
// GET  ?year&week[&snapshot=<key>|live=1][&diff=1][&excel=1]  : SELECT만(ERP·웹 스냅샷 모두 읽기). 스키마 생성 없음.
// POST {year, week, action:'confirm'|'refresh'|'saveEdits', edits?, note?} : 웹 전용 ProfitWorkbookSnapshot(Row) INSERT만.
import { withAuth } from '../../../lib/auth';
import { isAdminUser } from '../../../lib/userAccess';
import {
  assertWorkbookSchema, loadLiveRows, listSnapshots, loadSnapshotRows, insertSnapshot, loadDefaultRegion,
} from '../../../lib/profitWorkbook';
import {
  resolveWorkbookAccess, carryManual, applyEdits, diffRows, sheetTotals, PURCHASE_COUNTRIES, REGIONS, REGION_ALL, SUB_TABS,
} from '../../../lib/profitWorkbookRules';
import { buildProfitWorkbookXlsx } from '../../../lib/profitWorkbookExcel';

export function parseMajor(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2})(-\d{2})?$/);
  return m ? m[1].padStart(2, '0') : null;
}
const parseYear = (raw) => (/^\d{4}$/.test(String(raw || '')) ? String(raw) : null);

async function schemaReady() {
  try { await assertWorkbookSchema(); return true; } catch (e) { if (e.code === 'MIGRATION_REQUIRED') return false; throw e; }
}

function filterForAccess(rows, access) {
  const allow = new Set(access.sheets);
  return rows.filter((r) => allow.has(r.sheet));
}

export default withAuth(async function handler(req, res) {
  const src = req.method === 'GET' ? req.query : (req.body || {});
  const major = parseMajor(src.week);
  const year = parseYear(src.year);
  if (!major || !year) return res.status(400).json({ success: false, error: 'year(YYYY)와 week(대차수)가 필요합니다.' });
  const access = resolveWorkbookAccess(req.user, { isAdmin: isAdminUser(req.user) });
  if (!access.tabs.length) return res.status(403).json({ success: false, error: '원천시트 조회 권한이 없습니다.' });
  const actor = req.user?.userName || req.user?.userId || 'user';

  if (req.method === 'GET') {
    const initialized = await schemaReady();
    const snapshots = initialized ? await listSnapshots(major, year) : [];
    const wantLive = src.live === '1' || !snapshots.length;
    let current = null; let rows;
    if (!wantLive) {
      current = snapshots.find((s) => String(s.SnapshotKey) === String(src.snapshot)) || snapshots[0];
      rows = await loadSnapshotRows(current.SnapshotKey);
    } else {
      rows = await loadLiveRows(major, year);
    }
    let changes = null;
    if (src.diff === '1' && current && access.full) changes = diffRows(rows, await loadLiveRows(major, year));

    if (src.excel === '1') {
      if (!access.canDownload) return res.status(403).json({ success: false, error: '다운로드 권한이 없습니다.' });
      const buf = await buildProfitWorkbookXlsx({ major, rows });
      const label = current ? `v${current.VersionNo}` : '현재DB';
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`매출원가 양식 - ${Number(major)}차_원천시트_${label}.xlsx`)}`);
      return res.status(200).send(buf);
    }

    const visible = filterForAccess(rows, access);
    return res.status(200).json({
      success: true, orderYear: year, major, initialized,
      source: current ? 'snapshot' : 'live',
      snapshot: current ? { key: current.SnapshotKey, version: current.VersionNo, kind: current.Kind, createdBy: current.CreatedBy, createdAt: current.CreatedAt } : null,
      snapshots: access.full ? snapshots.map((s) => ({ key: s.SnapshotKey, version: s.VersionNo, kind: s.Kind, createdBy: s.CreatedBy, createdAt: s.CreatedAt, rowCount: s.RowCnt, note: s.Note })) : [],
      rows: visible, totals: sheetTotals(visible), changes,
      access, regions: [REGION_ALL, ...REGIONS], defaultRegion: await loadDefaultRegion(req.user?.userName),
      subTabs: SUB_TABS.filter((t) => access.tabs.includes(t.key)), purchaseCountries: PURCHASE_COUNTRIES,
    });
  }

  if (req.method === 'POST') {
    if (!access.full) return res.status(403).json({ success: false, error: '확정/최신화/편집 권한이 없습니다(강명훈·관리자).' });
    if (!(await schemaReady())) return res.status(503).json({ success: false, error: '스냅샷 테이블 migration이 아직 적용되지 않았습니다.', code: 'MIGRATION_REQUIRED' });
    const action = String(src.action || '');
    const snapshots = await listSnapshots(major, year);
    const latest = snapshots[0] || null;
    const prevRows = latest ? await loadSnapshotRows(latest.SnapshotKey) : [];
    let rows; let kind;
    if (action === 'confirm' || action === 'refresh') {
      if (action === 'confirm' && latest) return res.status(409).json({ success: false, error: `이미 확정된 버전(v${latest.VersionNo})이 있습니다. [최신화]로 새 버전을 만드세요.` });
      if (action === 'refresh' && !latest) return res.status(409).json({ success: false, error: '확정된 스냅샷이 없습니다. 먼저 [스냅샷 확정]을 하세요.' });
      rows = carryManual(prevRows, await loadLiveRows(major, year));
      kind = action === 'confirm' ? 'CONFIRM' : 'REFRESH';
    } else if (action === 'saveEdits') {
      if (!latest) return res.status(409).json({ success: false, error: '확정된 스냅샷이 있어야 수기 편집을 저장할 수 있습니다.' });
      const edits = Array.isArray(src.edits) ? src.edits : [];
      if (!edits.length) return res.status(400).json({ success: false, error: '저장할 편집이 없습니다.' });
      try { rows = applyEdits(prevRows, edits, { by: actor, at: new Date().toISOString() }); }
      catch (e) { return res.status(400).json({ success: false, error: e.message }); }
      kind = 'EDIT';
    } else {
      return res.status(400).json({ success: false, error: `알 수 없는 action: ${action}` });
    }
    const saved = await insertSnapshot({ major, orderYear: year, kind, baseSnapshotKey: latest?.SnapshotKey ?? null, rows, actor, note: src.note });
    return res.status(200).json({ success: true, kind, ...saved });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ success: false, error: 'Method Not Allowed' });
});
