// pages/api/estimate/index.js — 견적서 (실제 DB 조회)
// P3 구조 변경:
//   - 단가 우선순위: WeekProdCost → ShipmentDetail.Cost → CustomerProdCost → Product.Cost
//   - WeekProdCost: 차수+거래처+품목 단가 (매차수 즐겨찾기, 웹 전용 신규 테이블)
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

// ── WeekProdCost 테이블 idempotent 생성 (최초 호출 시 1회)
// 전산이 모르는 웹 전용 테이블. 없으면 생성, 권한 없으면 무시.
let _wpcEnsured = null;
async function ensureWeekProdCostTable() {
  if (_wpcEnsured) return _wpcEnsured;
  _wpcEnsured = (async () => {
    try {
      await query(
        `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WeekProdCost')
         BEGIN
           CREATE TABLE WeekProdCost (
             AutoKey INT IDENTITY(1,1) PRIMARY KEY,
             OrderWeek NVARCHAR(10) NOT NULL,
             CustKey INT NOT NULL,
             ProdKey INT NOT NULL,
             Cost FLOAT NOT NULL,
             CreatedAt DATETIME DEFAULT GETDATE(),
             UpdatedAt DATETIME DEFAULT GETDATE(),
             UpdatedBy NVARCHAR(50)
           );
           CREATE UNIQUE INDEX IX_WeekProdCost_Lookup
             ON WeekProdCost(OrderWeek, CustKey, ProdKey);
         END`,
        {}
      );
    } catch (e) {
      // 권한 부족 등은 무시 — OUTER APPLY 결과가 null 이 되므로 견적서 계산은 계속 동작
      console.warn('[estimate] WeekProdCost 테이블 생성 스킵:', e.message);
    }
  })();
  return _wpcEnsured;
}

export default withAuth(async function handler(req, res) {
  // 최초 1회: WeekProdCost 테이블 존재 보장
  await ensureWeekProdCostTable();
  if (req.method === 'GET')  return await getEstimates(req, res);
  if (req.method === 'POST') return await createEstimate(req, res);
  return res.status(405).end();
});

async function getEstimates(req, res) {
  const { week, custKey, shipmentKey, includeUnfixed, view } = req.query;
  const showUnfixed = includeUnfixed === '1' || includeUnfixed === 'true';

  // ── view=mismatch: 거래처+차수의 OrderDetail vs ShipmentDetail 합산 비교
  // 출고수량 != 주문수량 인 품목만 반환
  if (view === 'mismatch') {
    if (!week || !custKey) {
      return res.status(400).json({ success: false, error: 'week, custKey 필요' });
    }
    const parentWeek = week.split('-')[0];
    try {
      const r = await query(
        `SELECT
           p.ProdKey, p.ProdName, p.OutUnit, p.FlowerName, p.CounName,
           ISNULL(od_agg.orderQty, 0) AS orderQty,
           ISNULL(sd_agg.shipQty,  0) AS shipQty,
           ISNULL(od_agg.orderQty, 0) - ISNULL(sd_agg.shipQty, 0) AS diff,
           sd_agg.shipDateCount,
           sd_agg.shipKeyCount
         FROM Product p
         OUTER APPLY (
           SELECT SUM(
             CASE WHEN ISNULL(od.BunchQuantity,0) > 0 THEN od.BunchQuantity
                  WHEN ISNULL(od.SteamQuantity,0) > 0 THEN od.SteamQuantity
                  ELSE od.BoxQuantity END
           ) AS orderQty
           FROM OrderMaster om
           JOIN OrderDetail od ON om.OrderMasterKey = od.OrderMasterKey AND od.isDeleted = 0
           WHERE om.CustKey = @ck AND LEFT(om.OrderWeek, LEN(@pw)) = @pw
             AND om.isDeleted = 0 AND od.ProdKey = p.ProdKey
         ) od_agg
         OUTER APPLY (
           SELECT SUM(
             CASE WHEN ISNULL(sd.BunchQuantity,0) > 0 THEN sd.BunchQuantity
                  WHEN ISNULL(sd.SteamQuantity,0) > 0 THEN sd.SteamQuantity
                  ELSE sd.BoxQuantity END
           ) AS shipQty,
           COUNT(DISTINCT CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120)) AS shipDateCount,
           COUNT(DISTINCT sm.ShipmentKey) AS shipKeyCount
           FROM ShipmentMaster sm
           JOIN ShipmentDetail sd ON sm.ShipmentKey = sd.ShipmentKey
           WHERE sm.CustKey = @ck AND LEFT(sm.OrderWeek, LEN(@pw)) = @pw
             AND sm.isDeleted = 0 AND sd.ProdKey = p.ProdKey
         ) sd_agg
         WHERE p.isDeleted = 0
           AND (ISNULL(od_agg.orderQty,0) > 0 OR ISNULL(sd_agg.shipQty,0) > 0)
           AND ABS(ISNULL(od_agg.orderQty,0) - ISNULL(sd_agg.shipQty,0)) > 0.001
         ORDER BY ABS(ISNULL(od_agg.orderQty,0) - ISNULL(sd_agg.shipQty,0)) DESC`,
        {
          ck: { type: sql.Int, value: parseInt(custKey) },
          pw: { type: sql.NVarChar, value: parentWeek },
        }
      );
      // 분류
      const items = r.recordset.map(x => ({
        ...x,
        diffType: x.diff > 0 ? 'shortage' : 'overflow', // shortage=출고부족, overflow=과출고
      }));
      const shortage = items.filter(x => x.diffType === 'shortage');
      const overflow = items.filter(x => x.diffType === 'overflow');
      return res.status(200).json({
        success: true,
        week: parentWeek,
        custKey: parseInt(custKey),
        total: items.length,
        shortageCount: shortage.length,
        overflowCount: overflow.length,
        items,
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // ── shipmentKey 직접 지정 시: 해당 건 상세만 반환 (왼쪽 목록 불필요)
  if (shipmentKey) {
    try {
      const items = await loadItems(parseInt(shipmentKey));
      return res.status(200).json({ success: true, source: 'real_db', shipments: [], items });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // parentWeek: "14-01" → "14" (앞 주차 번호만 추출, 하이픈 포함 시)
  const parentWeek = week ? week.split('-')[0] : '';

  // 전산과 동일: 기본은 isFix=1 (확정된 출고)만 표시.
  // includeUnfixed=1 시 미확정도 포함 (사장님 미리보기/검토용)
  let where = showUnfixed
    ? 'WHERE sm.isDeleted = 0'
    : 'WHERE sm.isDeleted = 0 AND sm.isFix = 1';
  const params = {};
  if (week) {
    // OrderWeek = "14-01" 형식 → LEFT 2자리가 parentWeek와 일치하는 것 모두 조회
    where += ' AND LEFT(sm.OrderWeek, LEN(@parentWeek)) = @parentWeek';
    params.parentWeek = { type: sql.NVarChar, value: parentWeek };
  }
  if (custKey) { where += ' AND sm.CustKey = @custKey'; params.custKey = { type: sql.Int, value: parseInt(custKey) }; }

  try {
    // 출고 목록 (왼쪽 패널) — 부모주차+거래처 기준으로 그룹핑 (14-01, 14-02 → "14"로 묶음)
    const masterResult = await query(
      `SELECT
        LEFT(sm.OrderWeek, CHARINDEX('-', sm.OrderWeek) - 1) AS ParentWeek,
        sm.CustKey, c.CustName,
        STUFF((
          SELECT ',' + CAST(sm2.ShipmentKey AS NVARCHAR(20))
          FROM ShipmentMaster sm2
          WHERE sm2.CustKey = sm.CustKey
            AND LEFT(sm2.OrderWeek, CHARINDEX('-', sm2.OrderWeek) - 1)
                = LEFT(sm.OrderWeek, CHARINDEX('-', sm.OrderWeek) - 1)
            AND sm2.isDeleted = 0 ${showUnfixed ? '' : 'AND sm2.isFix = 1'}
          FOR XML PATH(''), TYPE
        ).value('.', 'NVARCHAR(MAX)'), 1, 1, '') AS ShipmentKeys,
        STUFF((
          SELECT ',' + sm2.OrderWeek
          FROM ShipmentMaster sm2
          WHERE sm2.CustKey = sm.CustKey
            AND LEFT(sm2.OrderWeek, CHARINDEX('-', sm2.OrderWeek) - 1)
                = LEFT(sm.OrderWeek, CHARINDEX('-', sm.OrderWeek) - 1)
            AND sm2.isDeleted = 0 ${showUnfixed ? '' : 'AND sm2.isFix = 1'}
          FOR XML PATH(''), TYPE
        ).value('.', 'NVARCHAR(MAX)'), 1, 1, '') AS SubWeeks,
        -- 각 세부차수의 ShipmentKey:isFix 매핑 (예: '17-01:1,17-02:0')
        STUFF((
          SELECT ',' + sm2.OrderWeek + ':' + CAST(ISNULL(sm2.isFix,0) AS NVARCHAR(1))
          FROM ShipmentMaster sm2
          WHERE sm2.CustKey = sm.CustKey
            AND LEFT(sm2.OrderWeek, CHARINDEX('-', sm2.OrderWeek) - 1)
                = LEFT(sm.OrderWeek, CHARINDEX('-', sm.OrderWeek) - 1)
            AND sm2.isDeleted = 0 ${showUnfixed ? '' : 'AND sm2.isFix = 1'}
          FOR XML PATH(''), TYPE
        ).value('.', 'NVARCHAR(MAX)'), 1, 1, '') AS SubWeeksFix,
        SUM(ISNULL(sa.shipAmt, 0) + ISNULL(ea.estAmt, 0)) AS totalAmount,
        MIN(sm.ShipmentKey) AS firstShipmentKey
       FROM ShipmentMaster sm
       LEFT JOIN Customer c ON sm.CustKey = c.CustKey
       OUTER APPLY (
         SELECT SUM(ISNULL(p2.Cost,0)
           * CASE WHEN sd2.BunchQuantity > 0 THEN sd2.BunchQuantity
                  WHEN sd2.SteamQuantity > 0 THEN sd2.SteamQuantity
                  ELSE sd2.BoxQuantity END
         ) AS shipAmt
         FROM ShipmentDetail sd2
         LEFT JOIN Product p2 ON sd2.ProdKey = p2.ProdKey
         WHERE sd2.ShipmentKey = sm.ShipmentKey
       ) sa
       OUTER APPLY (
         SELECT SUM(e2.Amount + e2.Vat) AS estAmt
         FROM Estimate e2
         WHERE e2.ShipmentKey = sm.ShipmentKey
       ) ea
       ${where}
       GROUP BY LEFT(sm.OrderWeek, CHARINDEX('-', sm.OrderWeek) - 1), sm.CustKey, c.CustName
       ORDER BY ParentWeek DESC, c.CustName`, params
    );

    // 견적서 상세 — 첫 번째 그룹의 모든 ShipmentKey 항목 합산
    let items = [];
    if (masterResult.recordset.length > 0) {
      const firstRow = masterResult.recordset[0];
      const keys = (firstRow.ShipmentKeys || '').split(',').map(Number).filter(Boolean);
      const allItems = await Promise.all(keys.map(k => loadItems(k)));
      items = allItems.flat();
    }

    return res.status(200).json({
      success: true, source: 'real_db',
      shipments: masterResult.recordset,
      items,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── 공통: ShipmentKey → 정상출고(ShipmentDetail) + 차감(Estimate) UNION 반환
// 14차 패턴: ShipmentDetail.Cost/Amount/Vat 를 그대로 읽음 (DB = Truth)
// 단가 수정은 update-cost API 를 통해 ShipmentDetail 을 직접 UPDATE 하므로
// 모든 화면(견적서/매출/미수금/세금계산서/eCount)이 일관된 값을 봄
async function loadItems(sk) {
  const result = await query(
    `SELECT * FROM (
       -- ① 정상출고 (ShipmentDetail) — sd.Cost/Amount/Vat 원본 사용
       SELECT
         NULL                                      AS EstimateKey,
         '정상출고'                                AS EstimateType,
         sd.SdetailKey,
         sd.ProdKey,
         smOuter.OrderWeek                         AS OrderWeek,
         p.ProdName,
         ISNULL(p.FlowerName, '')                  AS FlowerName,
         ISNULL(p.CounName, '')                    AS CounName,
         -- 표시 단위: BunchQty>0 단, SteamQty>0 송이, 그 외 박스 (옛 양식 우선순위)
         -- 카네이션처럼 OutUnit='박스' 라도 Bunch 가 채워져 있으면 단 단위로 표시
         CASE WHEN ISNULL(sd.BunchQuantity,0) > 0 THEN N'단'
              WHEN ISNULL(sd.SteamQuantity,0) > 0 THEN N'송이'
              ELSE N'박스' END                     AS Unit,
         CASE WHEN ISNULL(sd.BunchQuantity,0) > 0 THEN sd.BunchQuantity
              WHEN ISNULL(sd.SteamQuantity,0) > 0 THEN sd.SteamQuantity
              ELSE sd.BoxQuantity END              AS Quantity,
         ISNULL(sd.BoxQuantity, 0)                 AS BoxQty,
         -- Cost: sd.Cost 있으면 그대로, 없으면 p.Cost (14차 fallback)
         ISNULL(NULLIF(sd.Cost, 0), ISNULL(p.Cost, 0)) AS Cost,
         -- Amount/Vat: sd.Amount 있으면 그대로, 없으면 표시단위 우선순위로 환산
         ISNULL(NULLIF(sd.Amount, 0),
           ROUND(ISNULL(p.Cost, 0)
             * CASE WHEN ISNULL(sd.BunchQuantity,0) > 0 THEN sd.BunchQuantity
                    WHEN ISNULL(sd.SteamQuantity,0) > 0 THEN sd.SteamQuantity
                    ELSE sd.BoxQuantity END
             / 1.1, 0)
         ) AS Amount,
         ISNULL(NULLIF(sd.Vat, 0),
           ROUND(ISNULL(p.Cost, 0)
             * CASE WHEN ISNULL(sd.BunchQuantity,0) > 0 THEN sd.BunchQuantity
                    WHEN ISNULL(sd.SteamQuantity,0) > 0 THEN sd.SteamQuantity
                    ELSE sd.BoxQuantity END
             / 11, 0)
         ) AS Vat,
         ''                                        AS Descr,
         CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120) AS outDate
       FROM ShipmentDetail sd
       LEFT JOIN Product p ON sd.ProdKey = p.ProdKey
       LEFT JOIN ShipmentMaster smOuter ON sd.ShipmentKey = smOuter.ShipmentKey
       WHERE sd.ShipmentKey = @sk
       UNION ALL
       -- ② 차감 (Estimate) — 단가 수정 대상 아님, SdetailKey=NULL
       SELECT
         e.EstimateKey,
         e.EstimateType,
         NULL                                      AS SdetailKey,
         e.ProdKey,
         smE.OrderWeek                             AS OrderWeek,
         p.ProdName,
         ISNULL(p.FlowerName, '')                  AS FlowerName,
         ISNULL(p.CounName, '')                    AS CounName,
         e.Unit,
         e.Quantity,
         CASE WHEN ISNULL(p.OutUnit,'박스')='박스' THEN e.Quantity
              WHEN p.OutUnit='단'  AND p.BunchOf1Box>0 THEN e.Quantity / p.BunchOf1Box
              WHEN p.OutUnit='송이' AND p.SteamOf1Box>0 THEN e.Quantity / p.SteamOf1Box
              ELSE 0 END                            AS BoxQty,
         e.Cost,
         e.Amount,
         e.Vat,
         ISNULL(e.Descr, '')                       AS Descr,
         CONVERT(NVARCHAR(10), sd2.ShipmentDtm, 120) AS outDate
       FROM Estimate e
       LEFT JOIN Product p  ON e.ProdKey = p.ProdKey
       LEFT JOIN ShipmentDetail sd2
         ON e.ShipmentKey = sd2.ShipmentKey AND e.ProdKey = sd2.ProdKey
       LEFT JOIN ShipmentMaster smE ON e.ShipmentKey = smE.ShipmentKey
       WHERE e.ShipmentKey = @sk
     ) T
     -- 사장님 지정 정렬 우선순위:
     --   콜롬비아 수국 → 알스트로 → 루스커스 → 카네이션 → 장미
     --   네덜란드 → 호주 → 중국 → 에콰도르
     --   운송료 → 운임 → 그 외 차감
     ORDER BY
       CASE
         WHEN EstimateType = N'정상출고' AND CounName LIKE N'%콜롬비아%' AND FlowerName LIKE N'%수국%'   THEN 1
         WHEN EstimateType = N'정상출고' AND CounName LIKE N'%콜롬비아%' AND FlowerName LIKE N'%알스트로%' THEN 2
         WHEN EstimateType = N'정상출고' AND CounName LIKE N'%콜롬비아%' AND FlowerName LIKE N'%루스커스%' THEN 3
         WHEN EstimateType = N'정상출고' AND CounName LIKE N'%콜롬비아%' AND FlowerName LIKE N'%카네이션%' THEN 4
         WHEN EstimateType = N'정상출고' AND CounName LIKE N'%콜롬비아%' AND FlowerName LIKE N'%장미%'    THEN 5
         WHEN EstimateType = N'정상출고' AND CounName LIKE N'%콜롬비아%'                                 THEN 6
         WHEN EstimateType = N'정상출고' AND CounName LIKE N'%네덜란드%'                                 THEN 10
         WHEN EstimateType = N'정상출고' AND CounName LIKE N'%호주%'                                     THEN 11
         WHEN EstimateType = N'정상출고' AND CounName LIKE N'%중국%'                                     THEN 12
         WHEN EstimateType = N'정상출고' AND CounName LIKE N'%에콰도르%'                                 THEN 13
         WHEN EstimateType = N'정상출고'                                                                 THEN 50
         WHEN ProdName LIKE N'%운송%'                                                                   THEN 79
         WHEN ProdName LIKE N'%운임%'                                                                   THEN 80
         ELSE 99
       END,
       outDate, ProdName`,
    { sk: { type: sql.Int, value: sk } }
  );
  return result.recordset;
}

async function createEstimate(req, res) {
  // 불량/검역 등록 → Estimate 테이블에 직접 저장 (원본 테이블)
  // ※ 차감 항목은 기존 전산과 동일하게 수량/금액 음수로 저장
  const { shipmentKey, prodKey, estimateType, unit, quantity, cost } = req.body;
  try {
    const qty    = -Math.abs(parseFloat(quantity) || 0);   // 항상 음수
    const amount = Math.round(qty * (cost || 0) / 1.1);    // 공급가액 (음수)
    const vat    = Math.round(qty * (cost || 0) / 11);     // 부가세 (음수)
    await query(
      `INSERT INTO Estimate
         (EstimateType, ProdKey, Unit, Quantity, Cost, Amount, Vat, ShipmentKey, EstimateDtm)
       VALUES (@type, @pk, @unit, @qty, @cost, @amount, @vat, @sk, GETDATE())`,
      {
        type:   { type: sql.NVarChar, value: estimateType },
        pk:     { type: sql.Int,      value: prodKey },
        unit:   { type: sql.NVarChar, value: unit },
        qty:    { type: sql.Float,    value: qty },
        cost:   { type: sql.Float,    value: cost },
        amount: { type: sql.Float,    value: amount },
        vat:    { type: sql.Float,    value: vat },
        sk:     { type: sql.Int,      value: shipmentKey },
      }
    );
    return res.status(201).json({ success: true, message: '견적 등록 완료' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
