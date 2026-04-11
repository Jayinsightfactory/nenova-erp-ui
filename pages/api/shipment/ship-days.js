// pages/api/shipment/ship-days.js
// 출고요일 설정 CRUD
// GET  → 품목그룹별 출고요일 설정 조회
// POST → 저장/수정 (MERGE)

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

// 테이블 자동 생성 (없으면)
async function ensureTable() {
  await query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='_new_ShipDayConfig')
    BEGIN
      CREATE TABLE _new_ShipDayConfig (
        ConfigKey INT IDENTITY(1,1) PRIMARY KEY,
        ProdGroup NVARCHAR(100) NOT NULL,
        WeekSuffix NVARCHAR(10) NOT NULL DEFAULT '-01',
        CustKey INT NOT NULL DEFAULT 0,
        ShipDays NVARCHAR(50) NOT NULL DEFAULT '',
        CreateID NVARCHAR(50),
        CreateDtm DATETIME DEFAULT GETDATE()
      );
      CREATE UNIQUE INDEX UX_ShipDayConfig ON _new_ShipDayConfig(ProdGroup, WeekSuffix, CustKey);
    END
  `);
}

export default withAuth(async function handler(req, res) {
  await ensureTable();
  if (req.method === 'GET')  return getConfig(req, res);
  if (req.method === 'POST') return saveConfig(req, res);
  return res.status(405).end();
});

async function getConfig(req, res) {
  const { prodGroup, custKey } = req.query;
  try {
    let where = 'WHERE 1=1';
    const params = {};
    if (prodGroup) {
      where += ' AND ProdGroup = @pg';
      params.pg = { type: sql.NVarChar, value: prodGroup };
    }
    if (custKey !== undefined) {
      where += ' AND CustKey = @ck';
      params.ck = { type: sql.Int, value: parseInt(custKey) || 0 };
    }
    const result = await query(
      `SELECT ConfigKey, ProdGroup, WeekSuffix, CustKey, ShipDays, CreateDtm
       FROM _new_ShipDayConfig ${where}
       ORDER BY ProdGroup, WeekSuffix, CustKey`,
      params
    );
    return res.status(200).json({ success: true, configs: result.recordset });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// POST body: { configs: [{ prodGroup, weekSuffix, custKey, shipDays }] }
async function saveConfig(req, res) {
  const { configs } = req.body;
  if (!configs || !Array.isArray(configs)) {
    return res.status(400).json({ success: false, error: 'configs 배열 필요' });
  }
  try {
    const uid = req.user?.userId || 'system';
    let saved = 0;
    for (const cfg of configs) {
      const { prodGroup, weekSuffix, custKey, shipDays } = cfg;
      if (!prodGroup) continue;
      await query(
        `MERGE _new_ShipDayConfig AS tgt
         USING (SELECT @pg AS ProdGroup, @ws AS WeekSuffix, @ck AS CustKey) AS src
         ON tgt.ProdGroup = src.ProdGroup AND tgt.WeekSuffix = src.WeekSuffix AND tgt.CustKey = src.CustKey
         WHEN MATCHED THEN
           UPDATE SET ShipDays = @days, CreateID = @uid, CreateDtm = GETDATE()
         WHEN NOT MATCHED THEN
           INSERT (ProdGroup, WeekSuffix, CustKey, ShipDays, CreateID, CreateDtm)
           VALUES (@pg, @ws, @ck, @days, @uid, GETDATE());`,
        {
          pg:   { type: sql.NVarChar, value: prodGroup },
          ws:   { type: sql.NVarChar, value: weekSuffix || '-01' },
          ck:   { type: sql.Int,      value: parseInt(custKey) || 0 },
          days: { type: sql.NVarChar, value: shipDays || '' },
          uid:  { type: sql.NVarChar, value: uid },
        }
      );
      saved++;
    }
    return res.status(200).json({ success: true, saved });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
