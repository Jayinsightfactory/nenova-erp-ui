// GET /api/shipment/exe-errors?week=28-01 — 전산(nenova.exe) 오류알림 원인 스캔 (읽기 전용)
// exe 오류창은 DB 상태에서 발생한다. 알려진 유발 패턴을 차수 단위로 전수 스캔해
// "왜 생겼고 어디서 생겼는지"를 업체/품목/키 단위로 보여준다.
// + 웹 오류로그(AppLog IsError=1) / ECOUNT 동기화 실패(EcountSyncLog) 최근분 포함.
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { normalizeOrderWeek, resolveActiveOrderYear } from '../../../lib/orderUtils';

export const CHECKS = [
  {
    code: 'dateMismatch',
    title: '출고수량 ≠ 출고일지정수량',
    exeAlert: '"출고수량과 출고일지정수량이 다릅니다" / 견적서 수량 누락',
    cause: 'ShipmentDetail.OutQuantity 와 ShipmentDate 합계가 다르거나, ShipmentDate 행이 없거나 출고일이 NULL. 수국류 분수박스(155송이=5.1666…박스) 정밀도 갈림이 대표 원인(웹은 2026-07-08 수정됨).',
    fix: '출고분배 화면에서 해당 품목 수량을 다시 저장하면 Detail·Date 가 동기화됩니다. 확정차수면 확정취소 후 수정.',
    sql: `
      SELECT sm.OrderWeek, c.CustName, p.ProdName, sd.SdetailKey AS keyNo,
             sd.OutQuantity AS v1, agg.dateQty AS v2, agg.dateRows AS v3
        FROM ShipmentDetail sd
        JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
        JOIN Product p ON sd.ProdKey=p.ProdKey
        LEFT JOIN Customer c ON sm.CustKey=c.CustKey
        OUTER APPLY (
          SELECT ISNULL(SUM(x.ShipmentQuantity),0) AS dateQty, COUNT(*) AS dateRows,
                 SUM(CASE WHEN x.ShipmentDtm IS NULL THEN 1 ELSE 0 END) AS nullDates
            FROM ShipmentDate x WHERE x.SdetailKey=sd.SdetailKey
        ) agg
       WHERE sm.OrderWeek=@week AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.OutQuantity,0)<>0
         AND (ABS(agg.dateQty - sd.OutQuantity) > 0.001 OR agg.dateRows = 0 OR ISNULL(agg.nullDates,0) > 0)`,
    cols: ['업체', '품목', 'SdetailKey', '출고수량', '출고일지정합', '출고일행수'],
  },
  {
    code: 'zeroOut',
    title: '출고수량 0 빈 레코드',
    exeAlert: '"이미 출고분배됨" — 전산에서 품목 삭제/재분배가 차단됨',
    cause: '전산이 분배 시 OutQuantity=0 인 빈 ShipmentDetail 을 자동 생성해 남긴 것.',
    fix: '진단 API view=cleanupZero 로 정리하거나 관리자에게 요청.',
    sql: `
      SELECT sm.OrderWeek, c.CustName, p.ProdName, sd.SdetailKey AS keyNo,
             sd.OutQuantity AS v1, NULL AS v2, NULL AS v3
        FROM ShipmentDetail sd
        JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
        JOIN Product p ON sd.ProdKey=p.ProdKey
        LEFT JOIN Customer c ON sm.CustKey=c.CustKey
       WHERE sm.OrderWeek=@week AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.OutQuantity,0)=0`,
    cols: ['업체', '품목', 'SdetailKey', '출고수량', '', ''],
  },
  {
    code: 'ghost',
    title: '주문 없는 분배 (고스트 출고)',
    exeAlert: '"제품잔량이 마이너스인 출고 정보가 존재" — 확정 불가',
    cause: '주문(OrderDetail)이 없거나 삭제됐는데 분배(ShipmentDetail)만 남아 잔량 계산이 마이너스로 빠짐.',
    fix: '실제 출고가 맞으면 주문등록을 생성(업로드 주문등록+분배 경로), 아니면 해당 분배 삭제.',
    sql: `
      SELECT sm.OrderWeek, c.CustName, p.ProdName, sd.SdetailKey AS keyNo,
             sd.OutQuantity AS v1, NULL AS v2, NULL AS v3
        FROM ShipmentDetail sd
        JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
        JOIN Product p ON sd.ProdKey=p.ProdKey
        LEFT JOIN Customer c ON sm.CustKey=c.CustKey
       WHERE sm.OrderWeek=@week AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.OutQuantity,0)>0
         AND NOT EXISTS (
           SELECT 1 FROM OrderMaster om JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey
            WHERE om.CustKey=sm.CustKey AND om.OrderWeek=sm.OrderWeek AND od.ProdKey=sd.ProdKey
              AND ISNULL(om.isDeleted,0)=0 AND ISNULL(od.isDeleted,0)=0
         )`,
    cols: ['업체', '품목', 'SdetailKey', '분배수량', '', ''],
  },
  {
    code: 'dupDetail',
    title: '중복 ShipmentDetail (같은 업체+품목 2행 이상)',
    exeAlert: '수량이 2배로 보이거나 전산 수정 시 엉뚱한 행이 바뀜',
    cause: '웹/전산이 기존 행을 못 찾고 새로 INSERT (패턴5) 또는 마스터 이중 생성.',
    fix: '중복 행 중 하나를 삭제하고 수량을 합산 — 관리자 작업 필요.',
    sql: `
      SELECT sm.OrderWeek, c.CustName, p.ProdName, MIN(sd.SdetailKey) AS keyNo,
             COUNT(*) AS v1, SUM(sd.OutQuantity) AS v2, NULL AS v3
        FROM ShipmentDetail sd
        JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
        JOIN Product p ON sd.ProdKey=p.ProdKey
        LEFT JOIN Customer c ON sm.CustKey=c.CustKey
       WHERE sm.OrderWeek=@week AND ISNULL(sm.isDeleted,0)=0
       GROUP BY sm.OrderWeek, sm.CustKey, c.CustName, sd.ProdKey, p.ProdName
      HAVING COUNT(*) > 1`,
    cols: ['업체', '품목', 'SdetailKey(첫)', '행수', '수량합', ''],
  },
  {
    code: 'dupMaster',
    title: '중복 ShipmentMaster (업체당 활성 마스터 2개 이상)',
    exeAlert: '분배가 갈라져 일부만 보이거나 이중분배',
    cause: '같은 업체+차수에 마스터가 2개 이상 (연도분열/재활용 충돌 등).',
    fix: '상세를 한 마스터로 통합 — 관리자 작업 필요.',
    sql: `
      SELECT sm.OrderWeek, c.CustName, NULL AS ProdName, MIN(sm.ShipmentKey) AS keyNo,
             COUNT(*) AS v1, NULL AS v2, NULL AS v3
        FROM ShipmentMaster sm
        LEFT JOIN Customer c ON sm.CustKey=c.CustKey
       WHERE sm.OrderWeek=@week AND ISNULL(sm.isDeleted,0)=0
       GROUP BY sm.OrderWeek, sm.CustKey, c.CustName
      HAVING COUNT(*) > 1`,
    cols: ['업체', '', 'ShipmentKey(첫)', '마스터수', '', ''],
  },
  {
    code: 'emptyDeletedMaster',
    title: '빈 삭제 마스터 (exe 재활용 트랩)',
    exeAlert: '새로 입력한 분배가 화면에서 사라짐 / 재입력 반복 시 중복',
    cause: '상세 없는 마스터가 isDeleted=1 로 남으면 exe 가 재활용해 새 입력을 숨김 (R-1 규칙 위반 상태).',
    fix: '해당 마스터 하드삭제 — 관리자 작업 필요.',
    sql: `
      SELECT sm.OrderWeek, c.CustName, NULL AS ProdName, sm.ShipmentKey AS keyNo,
             NULL AS v1, NULL AS v2, NULL AS v3
        FROM ShipmentMaster sm
        LEFT JOIN Customer c ON sm.CustKey=c.CustKey
       WHERE sm.OrderWeek=@week AND ISNULL(sm.isDeleted,0)=1
         AND NOT EXISTS (SELECT 1 FROM ShipmentDetail sd WHERE sd.ShipmentKey=sm.ShipmentKey)`,
    cols: ['업체', '', 'ShipmentKey', '', '', ''],
  },
  {
    code: 'yearMismatch',
    title: '연도 불일치 마스터 (연도분열)',
    exeAlert: '전산에서 분배가 "덜 된 것"처럼 보임 (다른 연도에 붙음)',
    cause: 'OrderYearWeek 가 기대 연도와 다름 — 2026-07-08 사고 유형 (NN-NN→2025 레거시 규칙).',
    fix: 'scripts/repair-week28-year-split.mjs 패턴으로 연도 정정 — 관리자 작업 필요.',
    sql: `
      SELECT sm.OrderWeek, c.CustName, NULL AS ProdName, sm.ShipmentKey AS keyNo,
             NULL AS v1, NULL AS v2, NULL AS v3
        FROM ShipmentMaster sm
        LEFT JOIN Customer c ON sm.CustKey=c.CustKey
       WHERE sm.OrderWeek=@week AND ISNULL(sm.isDeleted,0)=0
         AND ISNULL(sm.OrderYearWeek,'') <> @expectedYw`,
    cols: ['업체', '', 'ShipmentKey', '', '', ''],
  },
  {
    code: 'custKeyBad',
    title: 'ShipmentDetail.CustKey 누락/불일치',
    exeAlert: '전산 분배 grid 에서 행 누락',
    cause: '출고상세의 CustKey 가 비었거나 마스터와 다름.',
    fix: 'POST /api/shipment/distribute-diagnose { action: repairMissingCustKey } 로 복구.',
    sql: `
      SELECT sm.OrderWeek, c.CustName, p.ProdName, sd.SdetailKey AS keyNo,
             sd.CustKey AS v1, sm.CustKey AS v2, NULL AS v3
        FROM ShipmentDetail sd
        JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
        JOIN Product p ON sd.ProdKey=p.ProdKey
        LEFT JOIN Customer c ON sm.CustKey=c.CustKey
       WHERE sm.OrderWeek=@week AND ISNULL(sm.isDeleted,0)=0
         AND (sd.CustKey IS NULL OR sd.CustKey <> sm.CustKey)`,
    cols: ['업체', '품목', 'SdetailKey', 'sd.CustKey', 'sm.CustKey', ''],
  },
  {
    code: 'managerBad',
    title: 'OrderMaster.Manager 가 UserID 아님',
    exeAlert: '전산 분배 grid 에서 거래처 통째로 사라짐',
    cause: 'ViewOrder 가 UserInfo INNER JOIN(Manager=UserID) — UserName(예: "관리자")이 들어가면 조인 탈락.',
    fix: '/admin/distribute-repair 의 Manager 정정 사용.',
    sql: `
      SELECT om.OrderWeek, c.CustName, NULL AS ProdName, om.OrderMasterKey AS keyNo,
             NULL AS v1, NULL AS v2, NULL AS v3
        FROM OrderMaster om
        LEFT JOIN Customer c ON om.CustKey=c.CustKey
       WHERE om.OrderWeek=@week AND ISNULL(om.isDeleted,0)=0
         AND NOT EXISTS (SELECT 1 FROM UserInfo ui WHERE ui.UserID=om.Manager)`,
    cols: ['업체', '', 'OrderMasterKey', '', '', ''],
  },
];

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const rawWeek = String(req.query.week || '').trim();
  if (!rawWeek) return res.status(400).json({ success: false, error: 'week 필요 (예: 28-01)' });

  let week;
  try {
    week = normalizeOrderWeek(rawWeek);
  } catch (e) {
    return res.status(400).json({ success: false, error: `차수 형식 오류: ${e.message}` });
  }
  const orderYear = resolveActiveOrderYear(rawWeek, req.query.year);
  const expectedYw = String(orderYear) + week.split('-')[0];

  try {
    const params = {
      week: { type: sql.NVarChar, value: week },
      expectedYw: { type: sql.NVarChar, value: expectedYw },
    };
    const checks = [];
    for (const c of CHECKS) {
      const usedParams = c.sql.includes('@expectedYw') ? params : { week: params.week };
      const r = await query(c.sql, usedParams);
      checks.push({
        code: c.code,
        title: c.title,
        exeAlert: c.exeAlert,
        cause: c.cause,
        fix: c.fix,
        cols: c.cols,
        count: r.recordset.length,
        items: r.recordset.slice(0, 100),
        truncated: r.recordset.length > 100,
      });
    }

    const [appLog, ecount] = await Promise.all([
      query(
        `SELECT TOP 30 LogKey, CONVERT(varchar(19), LogDtm, 120) AS logDtm, Category, Step, Detail
           FROM AppLog WHERE IsError=1 ORDER BY LogKey DESC`,
        {}
      ),
      query(
        `SELECT TOP 10 LogKey, SyncType, RefKey, CONVERT(varchar(19), SyncDtm, 120) AS syncDtm, ErrorMsg
           FROM EcountSyncLog WHERE SyncStatus=N'실패' ORDER BY LogKey DESC`,
        {}
      ),
    ]);

    const totalIssues = checks.reduce((s, c) => s + c.count, 0);
    return res.status(200).json({
      success: true,
      week,
      orderYear,
      expectedYw,
      totalIssues,
      checks,
      webErrors: appLog.recordset,
      ecountFails: ecount.recordset,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
