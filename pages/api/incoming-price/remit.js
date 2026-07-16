// pages/api/incoming-price/remit.js — 농장 송금 기록 (웹 전용 테이블 WebFarmRemit)
// GET    ?year=2026&farm=X → 송금 기록 목록 (isDeleted=0)
// POST   { year, weeks, farmName, amountUSD, remitDate, memo } → 송금 기록 추가
// DELETE { key } → 소프트 삭제

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

let _ensured = false;
async function ensureTable() {
  if (_ensured) return;
  await query(`
    IF OBJECT_ID('dbo.WebFarmRemit', 'U') IS NULL
    CREATE TABLE dbo.WebFarmRemit (
      AutoKey    INT IDENTITY(1,1) PRIMARY KEY,
      OrderYear  NVARCHAR(4)   NOT NULL,
      Weeks      NVARCHAR(200) NOT NULL DEFAULT N'',
      FarmName   NVARCHAR(120) NOT NULL,
      AmountUSD  FLOAT         NOT NULL DEFAULT 0,
      RemitDate  NVARCHAR(10)  NOT NULL DEFAULT N'',
      Memo       NVARCHAR(400) NOT NULL DEFAULT N'',
      CreateID   NVARCHAR(50)  NOT NULL DEFAULT N'',
      CreateDtm  DATETIME      NOT NULL DEFAULT GETDATE(),
      isDeleted  BIT           NOT NULL DEFAULT 0
    )`);
  _ensured = true;
}

export default withAuth(async function handler(req, res) {
  try {
    await ensureTable();

    if (req.method === 'GET') {
      const { year, farm } = req.query;
      let where = 'isDeleted=0';
      const params = {};
      if (year) {
        where += ' AND OrderYear=@yr';
        params.yr = { type: sql.NVarChar, value: String(year).slice(0, 4) };
      }
      if (farm) {
        where += ' AND FarmName=@farm';
        params.farm = { type: sql.NVarChar, value: farm };
      }
      const r = await query(
        `SELECT AutoKey, OrderYear, Weeks, FarmName, AmountUSD, RemitDate, Memo, CreateID,
                CONVERT(varchar(16), CreateDtm, 120) AS CreateDtm
           FROM WebFarmRemit WHERE ${where}
          ORDER BY RemitDate DESC, AutoKey DESC`, params);
      return res.status(200).json({
        success: true,
        remits: r.recordset.map(x => ({
          key: x.AutoKey, year: x.OrderYear, weeks: x.Weeks, farmName: x.FarmName,
          amountUSD: x.AmountUSD, remitDate: x.RemitDate, memo: x.Memo,
          createId: x.CreateID, createDtm: x.CreateDtm,
        })),
      });
    }

    if (req.method === 'POST') {
      const { year, weeks, farmName, amountUSD, remitDate, memo } = req.body || {};
      const amt = parseFloat(amountUSD);
      if (!String(farmName || '').trim() || Number.isNaN(amt)) {
        return res.status(400).json({ success: false, error: 'farmName, amountUSD 필요' });
      }
      await query(
        `INSERT INTO WebFarmRemit (OrderYear, Weeks, FarmName, AmountUSD, RemitDate, Memo, CreateID)
         VALUES (@yr, @weeks, @farm, @amt, @dt, @memo, @uid)`,
        {
          yr: { type: sql.NVarChar, value: String(year || new Date().getFullYear()).slice(0, 4) },
          weeks: { type: sql.NVarChar, value: String(weeks || '').trim().slice(0, 200) },
          farm: { type: sql.NVarChar, value: String(farmName).trim().slice(0, 120) },
          amt: { type: sql.Float, value: amt },
          dt: { type: sql.NVarChar, value: String(remitDate || '').trim().slice(0, 10) },
          memo: { type: sql.NVarChar, value: String(memo || '').trim().slice(0, 400) },
          uid: { type: sql.NVarChar, value: req.user?.userId || 'admin' },
        });
      return res.status(200).json({ success: true });
    }

    if (req.method === 'DELETE') {
      const key = parseInt(req.body?.key, 10);
      if (!key) return res.status(400).json({ success: false, error: 'key 필요' });
      await query(`UPDATE WebFarmRemit SET isDeleted=1 WHERE AutoKey=@k`, { k: { type: sql.Int, value: key } });
      return res.status(200).json({ success: true });
    }

    return res.status(405).end();
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
