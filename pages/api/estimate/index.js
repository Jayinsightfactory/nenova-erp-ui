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
  const { week, custKey, shipmentKey } = req.query;

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

  let where = 'WHERE sm.isDeleted = 0';
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
            AND sm2.isDeleted = 0
          FOR XML PATH(''), TYPE
        ).value('.', 'NVARCHAR(MAX)'), 1, 1, '') AS ShipmentKeys,
        STUFF((
          SELECT ',' + sm2.OrderWeek
          FROM ShipmentMaster sm2
          WHERE sm2.CustKey = sm.CustKey
            AND LEFT(sm2.OrderWeek, CHARINDEX('-', sm2.OrderWeek) - 1)
                = LEFT(sm.OrderWeek, CHARINDEX('-', sm.OrderWeek) - 1)
            AND sm2.isDeleted = 0
          FOR XML PATH(''), TYPE
        ).value('.', 'NVARCHAR(MAX)'), 1, 1, '') AS SubWeeks,
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
// 단가 우선순위 (P3 전 구조 변경):
//   1) WeekProdCost   — 차수+거래처+품목 (매차수 즐겨찾기)
//   2) ShipmentDetail.Cost — 출고 분배 시 고정된 값 (1회성)
//   3) CustomerProdCost    — 거래처+품목 (매차수 고정)
//   4) Product.Cost        — 기본 단가
async function loadItems(sk) {
  const result = await query(
    `SELECT * FROM (
       -- ① 정상출고 (ShipmentDetail)
       -- EffectiveCost = COALESCE(wpc, sd.Cost, cpc, p.Cost)
       SELECT
         NULL                                      AS EstimateKey,
         '정상출고'                                AS EstimateType,
         p.ProdName,
         ISNULL(p.FlowerName, '')                  AS FlowerName,
         CASE WHEN sd.BunchQuantity > 0 THEN '단'
              WHEN sd.SteamQuantity > 0 THEN '송이'
              ELSE '박스' END                      AS Unit,
         CASE WHEN sd.BunchQuantity > 0 THEN sd.BunchQuantity
              WHEN sd.SteamQuantity > 0 THEN sd.SteamQuantity
              ELSE sd.BoxQuantity END              AS Quantity,
         COALESCE(NULLIF(wpc.Cost,0), NULLIF(sd.Cost,0), NULLIF(cpc.Cost,0), ISNULL(p.Cost,0)) AS Cost,
         ROUND(
           COALESCE(NULLIF(wpc.Cost,0), NULLIF(sd.Cost,0), NULLIF(cpc.Cost,0), ISNULL(p.Cost,0))
           * CASE WHEN sd.BunchQuantity > 0 THEN sd.BunchQuantity
                  WHEN sd.SteamQuantity > 0 THEN sd.SteamQuantity
                  ELSE sd.BoxQuantity END
           / 1.1, 0)                               AS Amount,
         ROUND(
           COALESCE(NULLIF(wpc.Cost,0), NULLIF(sd.Cost,0), NULLIF(cpc.Cost,0), ISNULL(p.Cost,0))
           * CASE WHEN sd.BunchQuantity > 0 THEN sd.BunchQuantity
                  WHEN sd.SteamQuantity > 0 THEN sd.SteamQuantity
                  ELSE sd.BoxQuantity END
           / 11, 0)                                AS Vat,
         ''                                        AS Descr,
         CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120) AS outDate
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
       LEFT JOIN Product p ON sd.ProdKey = p.ProdKey
       LEFT JOIN CustomerProdCost cpc ON cpc.CustKey = sm.CustKey AND cpc.ProdKey = sd.ProdKey
       -- WeekProdCost 는 없어도 안전하게 (신규 테이블) — LEFT JOIN + 조건 매칭
       OUTER APPLY (
         SELECT TOP 1 wpc0.Cost
           FROM WeekProdCost wpc0
          WHERE wpc0.OrderWeek = sm.OrderWeek
            AND wpc0.CustKey   = sm.CustKey
            AND wpc0.ProdKey   = sd.ProdKey
       ) wpc
       WHERE sd.ShipmentKey = @sk
       UNION ALL
       -- ② 차감 (Estimate)
       SELECT
         e.EstimateKey,
         e.EstimateType,
         p.ProdName,
         ISNULL(p.FlowerName, '')                  AS FlowerName,
         e.Unit,
         e.Quantity,
         e.Cost,
         e.Amount,
         e.Vat,
         ISNULL(e.Descr, '')                       AS Descr,
         CONVERT(NVARCHAR(10), sd2.ShipmentDtm, 120) AS outDate
       FROM Estimate e
       LEFT JOIN Product p  ON e.ProdKey = p.ProdKey
       LEFT JOIN ShipmentDetail sd2
         ON e.ShipmentKey = sd2.ShipmentKey AND e.ProdKey = sd2.ProdKey
       WHERE e.ShipmentKey = @sk
     ) T
     -- 차감(정상출고 아님) 항목은 무조건 최하단
     ORDER BY CASE WHEN EstimateType = '정상출고' THEN 0 ELSE 1 END,
              outDate, EstimateType, ProdName`,
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
