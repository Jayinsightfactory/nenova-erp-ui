// 판매등록 히스토리 API — 스냅샷 조회/수동생성/변경검사. 스냅샷 수정·삭제 경로 없음(불변).
import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { resolveActiveOrderYear, normalizeOrderWeek } from '../../../lib/orderUtils';
import {
  listSnapshots, getSnapshotRows, captureCurrentRows, diffRowSets, buildBaselineCompare,
  takeSnapshot, detectAndRecordChange, startSalesSnapshotScheduler,
} from '../../../lib/salesSnapshot';

// 기준 적용 확인 — 어떤 스냅샷을 '기준금액'으로 쓸지 (기본: TUE_FINAL, [적용 확인] 으로 변경 가능)
let _blEnsured = null;
function ensureBaselineTable() {
  if (_blEnsured) return _blEnsured;
  _blEnsured = query(
    `IF OBJECT_ID(N'dbo.WebSalesBaselineConfirm', N'U') IS NULL
     CREATE TABLE dbo.WebSalesBaselineConfirm (
       AutoKey INT IDENTITY(1,1) PRIMARY KEY,
       OrderYear NVARCHAR(4) NOT NULL,
       OrderWeek NVARCHAR(10) NOT NULL,
       SnapshotKey INT NOT NULL,
       ConfirmedBy NVARCHAR(50) NOT NULL DEFAULT N'',
       ConfirmedDtm DATETIME NOT NULL DEFAULT GETDATE(),
       isDeleted BIT NOT NULL DEFAULT 0
     )`
  ).catch(e => { _blEnsured = null; throw e; });
  return _blEnsured;
}

// 세부차수별 기준 스냅샷 해석 — 적용 확인이 있으면 그 스냅샷, 없으면 TUE_FINAL
async function resolveBaselines(subweeks, orderYear) {
  await ensureBaselineTable();
  const out = new Map(); // week → { snapshotKey, takenAt, type, confirmedBy, confirmedDtm, source }
  for (const w of subweeks) {
    const snaps = await listSnapshots(w, orderYear);
    const r = await query(
      `SELECT TOP 1 SnapshotKey, ConfirmedBy, CONVERT(varchar(19), ConfirmedDtm, 120) AS ConfirmedDtm
         FROM WebSalesBaselineConfirm
        WHERE OrderYear=@yr AND OrderWeek=@wk AND isDeleted=0
        ORDER BY AutoKey DESC`,
      { yr: { type: sql.NVarChar, value: String(orderYear) }, wk: { type: sql.NVarChar, value: w } }
    );
    const conf = r.recordset[0];
    const snap = conf ? snaps.find(s => s.SnapshotKey === conf.SnapshotKey) : null;
    if (snap) {
      out.set(w, {
        snapshotKey: snap.SnapshotKey, takenAt: snap.takenAt, type: snap.SnapshotType,
        confirmedBy: conf.ConfirmedBy, confirmedDtm: conf.ConfirmedDtm, source: 'confirmed',
      });
      continue;
    }
    const tue = snaps.find(s => s.SnapshotType === 'TUE_FINAL');
    if (tue) out.set(w, { snapshotKey: tue.SnapshotKey, takenAt: tue.takenAt, type: 'TUE_FINAL', source: 'default' });
  }
  return out;
}

export default withAuth(async function handler(req, res) {
  startSalesSnapshotScheduler(); // instrumentation 미지원 환경 폴백 — 첫 API 호출 시 기동
  try {
    if (req.method === 'GET') {
      const rawWeek = String(req.query.week || '').trim();
      if (!rawWeek) return res.status(400).json({ success: false, error: 'week 필요' });
      // 대차수 모드: '27' 처럼 세부차수 없이 입력하면 27-01+27-02 를 합산해 27차로 본다
      const majorMode = /^\d{1,2}$/.test(rawWeek);
      const major = majorMode ? rawWeek.padStart(2, '0') : null;
      const week = majorMode ? null : normalizeOrderWeek(rawWeek);
      const orderYear = resolveActiveOrderYear(majorMode ? `${major}-01` : rawWeek, req.query.year);
      const subweeks = majorMode
        ? (await query(
            `SELECT OrderWeek FROM (
               SELECT DISTINCT OrderWeek FROM ShipmentMaster
                WHERE ISNULL(isDeleted,0)=0 AND OrderWeek LIKE @pfx AND ISNULL(OrderYearWeek,'') = @yw
               UNION
               SELECT DISTINCT OrderWeek FROM WebSalesSnapshot WHERE OrderWeek LIKE @pfx AND OrderYear=@yr
             ) t ORDER BY OrderWeek`,
            {
              pfx: { type: sql.NVarChar, value: `${major}-%` },
              yw: { type: sql.NVarChar, value: `${orderYear}${major}` },
              yr: { type: sql.NVarChar, value: String(orderYear) },
            }
          )).recordset.map(x => x.OrderWeek)
        : [week];

      // 스냅샷 상세 행
      if (req.query.rows) {
        const rows = await getSnapshotRows(req.query.rows);
        return res.status(200).json({ success: true, rows });
      }

      // diff: from 스냅샷 → to(스냅샷키 또는 'current'). diffFrom 은 콤마목록 허용(합산 diff)
      if (req.query.diffFrom) {
        const fromKeys = String(req.query.diffFrom).split(',').map(Number).filter(Boolean);
        const baseRows = (await Promise.all(fromKeys.map(k => getSnapshotRows(k)))).flat();
        const toRows = req.query.diffTo === 'current' || !req.query.diffTo
          ? (await Promise.all(subweeks.map(w => captureCurrentRows(w)))).flat()
          : await getSnapshotRows(req.query.diffTo);
        const diff = diffRowSets(baseRows, toRows);
        return res.status(200).json({ success: true, diff });
      }

      // 업체별 3기준 비교: 화요일(TUE_FINAL) / 수요일(WED_CHECK) / 현재(live) 금액 + 차액 + 품목별 + 변경자
      if (req.query.compare3) {
        const tueRows = [], wedRows = [];
        let tueBaselineAt = null;
        for (const w of subweeks) {
          const snaps = await listSnapshots(w, orderYear);
          const tue = snaps.find(s => s.SnapshotType === 'TUE_FINAL');
          const wed = [...snaps].reverse().find(s => s.SnapshotType === 'WED_CHECK'); // 최신 수요일 점검
          if (tue) { tueRows.push(...await getSnapshotRows(tue.SnapshotKey)); if (!tueBaselineAt || tue.takenAt < tueBaselineAt) tueBaselineAt = tue.takenAt; }
          if (wed) wedRows.push(...await getSnapshotRows(wed.SnapshotKey));
        }
        const currRows = (await Promise.all(subweeks.map(w => captureCurrentRows(w)))).flat();
        // 변경자: 화요일 기준 이후 ShipmentHistory (SdetailKey → 변경자ID 집합)
        const changerByRefKey = new Map();
        if (tueBaselineAt) {
          for (const w of subweeks) {
            const r = await query(
              `SELECT DISTINCT sh.SdetailKey, sh.ChangeID
                 FROM ShipmentHistory sh
                 JOIN ShipmentDetail sd ON sh.SdetailKey = sd.SdetailKey
                 JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
                WHERE sm.OrderWeek = @week AND sh.ChangeDtm >= @since AND sh.ChangeID IS NOT NULL`,
              { week: { type: sql.NVarChar, value: w }, since: { type: sql.DateTime, value: new Date(tueBaselineAt) } }
            );
            for (const row of r.recordset) {
              const k = Number(row.SdetailKey);
              if (!changerByRefKey.has(k)) changerByRefKey.set(k, new Set());
              changerByRefKey.get(k).add(row.ChangeID);
            }
          }
        }
        const changerArr = new Map([...changerByRefKey].map(([k, v]) => [k, [...v]]));
        const byCust = buildBaselineCompare({ tueRows, wedRows, currRows, changerByRefKey: changerArr });
        return res.status(200).json({
          success: true, week: majorMode ? major : week, hasTue: tueRows.length > 0, hasWed: wedRows.length > 0,
          tueBaselineAt, byCust,
        });
      }

      // 변경 주체 추적 — 기준 스냅샷([적용 확인] 반영, 기본 화요일) 이후 ShipmentHistory (누가/언제/얼마→얼마)
      if (req.query.changeLog) {
        const entries = [];
        let baselineAt = null;
        const baselines = await resolveBaselines(subweeks, orderYear);
        for (const w of subweeks) {
          const baseline = baselines.get(w);
          if (!baseline) continue;
          if (!baselineAt || baseline.takenAt < baselineAt) baselineAt = baseline.takenAt;
          const r = await query(
            `SELECT TOP 200 sh.SdetailKey, CONVERT(varchar(19), sh.ChangeDtm, 120) AS changeDtm,
                    sh.ChangeType, sh.BeforeValue, sh.AfterValue, sh.Descr, sh.ChangeID,
                    c.CustName, p.ProdName, sm.OrderWeek
               FROM ShipmentHistory sh
               LEFT JOIN ShipmentDetail sd ON sh.SdetailKey = sd.SdetailKey
               LEFT JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
               LEFT JOIN Customer c ON sm.CustKey = c.CustKey
               LEFT JOIN Product p ON sd.ProdKey = p.ProdKey
              WHERE sm.OrderWeek = @week AND sh.ChangeDtm >= @since
                AND ISNULL(sh.BeforeValue, 0) <> ISNULL(sh.AfterValue, 0) -- 0→0(빈 행 생성)·값 무변경 제외, 수량/금액이 실제로 바뀐 것만
              ORDER BY sh.ChangeDtm DESC`,
            { week: { type: sql.NVarChar, value: w }, since: { type: sql.DateTime, value: new Date(baseline.takenAt) } }
          );
          entries.push(...r.recordset);
        }
        if (baselineAt == null) return res.status(200).json({ success: true, entries: [], noBaseline: true });
        entries.sort((a, b) => (a.changeDtm < b.changeDtm ? 1 : -1));
        return res.status(200).json({ success: true, entries: entries.slice(0, 200), baselineAt });
      }

      // 기본: 스냅샷 목록(세부차수 합침) + 현재 라이브 합계(합산) + 기준([적용 확인] 반영)
      const snapLists = await Promise.all(subweeks.map(w => listSnapshots(w, orderYear)));
      const snapshots = snapLists.flat().sort((a, b) => a.SnapshotKey - b.SnapshotKey);
      const currAll = (await Promise.all(subweeks.map(w => captureCurrentRows(w)))).flat();
      const liveAmount = currAll.reduce((s, r) => s + Number(r.Amount || 0) + Number(r.Vat || 0), 0);
      const baselines = await resolveBaselines(subweeks, orderYear);
      return res.status(200).json({
        success: true, week: majorMode ? major : week, orderYear, majorMode, subweeks, snapshots,
        live: { rowCnt: currAll.length, total: liveAmount },
        baseline: [...baselines.entries()].map(([w, b]) => ({ week: w, ...b })),
      });
    }

    if (req.method === 'POST') {
      const action = String(req.body?.action || '');
      const rawWeek = String(req.body?.week || '').trim();
      if (!rawWeek) return res.status(400).json({ success: false, error: 'week 필요' });
      const majorMode = /^\d{1,2}$/.test(rawWeek);
      const major = majorMode ? rawWeek.padStart(2, '0') : null;
      const orderYear = resolveActiveOrderYear(majorMode ? `${major}-01` : rawWeek, req.body?.year);
      const weeks = majorMode
        ? (await query(
            `SELECT DISTINCT OrderWeek FROM ShipmentMaster
              WHERE ISNULL(isDeleted,0)=0 AND OrderWeek LIKE @pfx AND ISNULL(OrderYearWeek,'') = @yw
              ORDER BY OrderWeek`,
            { pfx: { type: sql.NVarChar, value: `${major}-%` }, yw: { type: sql.NVarChar, value: `${orderYear}${major}` } }
          )).recordset.map(x => x.OrderWeek)
        : [normalizeOrderWeek(rawWeek)];
      const actor = req.user?.userName || req.user?.userId || 'user';

      if (action === 'manual') {
        const results = [];
        for (const w of weeks) results.push({ week: w, ...(await takeSnapshot({ week: w, orderYear, type: 'MANUAL', actor, note: req.body?.note || '수동 스냅샷' })) });
        const first = results[0] || {};
        return res.status(200).json({ success: true, results, ...first });
      }
      // [적용 확인] — 선택한 스냅샷(들)을 기준금액으로 확정 (세부차수별 1개)
      if (action === 'confirmBaseline') {
        await ensureBaselineTable();
        const keys = (Array.isArray(req.body?.snapshotKeys) ? req.body.snapshotKeys : [req.body?.snapshotKey])
          .map(Number).filter(Boolean);
        if (!keys.length) return res.status(400).json({ success: false, error: 'snapshotKeys 필요' });
        const confirmed = [];
        for (const w of weeks) {
          const snaps = await listSnapshots(w, orderYear);
          const snap = snaps.find(s => keys.includes(s.SnapshotKey));
          if (!snap) continue;
          await query(
            `UPDATE WebSalesBaselineConfirm SET isDeleted=1
              WHERE OrderYear=@yr AND OrderWeek=@wk AND isDeleted=0`,
            { yr: { type: sql.NVarChar, value: String(orderYear) }, wk: { type: sql.NVarChar, value: w } });
          await query(
            `INSERT INTO WebSalesBaselineConfirm (OrderYear, OrderWeek, SnapshotKey, ConfirmedBy)
             VALUES (@yr, @wk, @sk, @by)`,
            {
              yr: { type: sql.NVarChar, value: String(orderYear) },
              wk: { type: sql.NVarChar, value: w },
              sk: { type: sql.Int, value: snap.SnapshotKey },
              by: { type: sql.NVarChar, value: actor },
            });
          confirmed.push({ week: w, snapshotKey: snap.SnapshotKey, type: snap.SnapshotType });
        }
        if (!confirmed.length) return res.status(400).json({ success: false, error: '해당 차수의 스냅샷이 아닙니다.' });
        return res.status(200).json({ success: true, confirmed });
      }
      // 기준 초기화 — 화요일 최종분배로 되돌림
      if (action === 'resetBaseline') {
        await ensureBaselineTable();
        for (const w of weeks) {
          await query(
            `UPDATE WebSalesBaselineConfirm SET isDeleted=1
              WHERE OrderYear=@yr AND OrderWeek=@wk AND isDeleted=0`,
            { yr: { type: sql.NVarChar, value: String(orderYear) }, wk: { type: sql.NVarChar, value: w } });
        }
        return res.status(200).json({ success: true });
      }
      if (action === 'checkNow') {
        const results = [];
        for (const w of weeks) results.push({ week: w, ...(await detectAndRecordChange(w, orderYear, actor)) });
        const changedList = results.filter(r => r.changed);
        return res.status(200).json({
          success: true, results,
          changed: changedList.length > 0,
          note: changedList.map(r => `${r.week}: ${r.note}`).join(' / '),
        });
      }
      return res.status(400).json({ success: false, error: '알 수 없는 action' });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});
