// pages/api/incoming/box-by-country.js — 차수별 국가 입고 박스 집계
//
// GET  ?year=2026                → 웹 입고(WarehouseMaster/Detail, SELECT only) + 카톡 선적(WebFlightScheduleBox) 합산 집계
// POST { text }                  → 비행 스케줄 카톡방 내보내기(txt) 본문을 파싱해 WebFlightScheduleBox(웹 전용)에 MERGE (관리자)
//
// ERP 원장(Order/Shipment/Warehouse/Stock/Estimate)은 읽기만 한다. 쓰기는 웹 전용 테이블 WebFlightScheduleBox 뿐이다.
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { isAdminUser } from '../../../lib/userAccess';
import { buildBoxByCountry, parseKakaoFlightSchedule } from '../../../lib/incomingBoxByCountry';

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } };

let _ensured = null;
function ensureTable() {
  if (_ensured) return _ensured;
  _ensured = query(
    `IF OBJECT_ID(N'dbo.WebFlightScheduleBox', N'U') IS NULL
     CREATE TABLE dbo.WebFlightScheduleBox (
       RowKey NVARCHAR(160) NOT NULL CONSTRAINT PK_WebFlightScheduleBox PRIMARY KEY,
       OrderYear NVARCHAR(4) NOT NULL,
       OrderWeek NVARCHAR(10) NOT NULL,
       SubWeek NVARCHAR(12) NOT NULL DEFAULT N'',
       Country NVARCHAR(30) NOT NULL,
       Item NVARCHAR(60) NOT NULL DEFAULT N'',
       AwbKey NVARCHAR(40) NOT NULL DEFAULT N'',
       AwbRaw NVARCHAR(60) NOT NULL DEFAULT N'',
       Flight NVARCHAR(20) NOT NULL DEFAULT N'',
       BoxQty INT NULL,
       ArrivalDate NVARCHAR(10) NOT NULL DEFAULT N'',
       ItemsJson NVARCHAR(1000) NOT NULL DEFAULT N'[]',
       Flags NVARCHAR(500) NOT NULL DEFAULT N'',
       IsDuplicate BIT NOT NULL DEFAULT 0,
       IsEstimated BIT NOT NULL DEFAULT 0,
       MentionCount INT NOT NULL DEFAULT 1,
       SourceFile NVARCHAR(255) NOT NULL DEFAULT N'',
       UpdateID NVARCHAR(50) NOT NULL,
       UpdateDtm DATETIME NOT NULL DEFAULT GETDATE()
     )`
  ).catch(e => { _ensured = null; throw e; });
  return _ensured;
}

async function readWarehouse(year) {
  // 입고 헤더(AWB=OrderNo) 단위: Σ 박스, 국가(품목 마스터 최빈), 장미 '단만 입력(박스0)' 단수
  const result = await query(
    `SELECT wm.OrderWeek, LTRIM(RTRIM(ISNULL(wm.OrderNo, N''))) AS awb, ISNULL(wm.FarmName, N'') AS farmName,
            CONVERT(NVARCHAR(10), wm.InputDate, 120) AS inputDate,
            ISNULL(p.CounName, N'미상') AS country,
            SUM(ISNULL(wd.BoxQuantity, 0)) AS boxQty,
            SUM(CASE WHEN p.FlowerName = N'장미' AND ISNULL(wd.BoxQuantity, 0) = 0 THEN ISNULL(wd.BunchQuantity, 0) ELSE 0 END) AS roseNoBoxBunch,
            COUNT(wd.WdetailKey) AS lines
       FROM WarehouseMaster wm
       LEFT JOIN WarehouseDetail wd ON wd.WarehouseKey = wm.WarehouseKey
       LEFT JOIN Product p ON p.ProdKey = wd.ProdKey
      WHERE wm.isDeleted = 0 AND wm.OrderYear = @year
      GROUP BY wm.WarehouseKey, wm.OrderWeek, wm.OrderNo, wm.FarmName, wm.InputDate, p.CounName`,
    { year: { type: sql.NVarChar, value: String(year) } }
  );
  return result.recordset.map(r => ({ weekKey: r.OrderWeek, awb: r.awb, farmName: r.farmName, country: r.country, boxQty: Number(r.boxQty) || 0, roseNoBoxBunch: Number(r.roseNoBoxBunch) || 0, lines: Number(r.lines) || 0, inputDate: r.inputDate || '' }));
}

async function readKakao(year) {
  await ensureTable();
  const result = await query(
    `SELECT OrderWeek, SubWeek, Country, Item, AwbKey, AwbRaw, Flight, BoxQty, ArrivalDate, ItemsJson, Flags, IsDuplicate, IsEstimated, MentionCount, UpdateDtm, SourceFile
       FROM dbo.WebFlightScheduleBox WHERE OrderYear = @year`,
    { year: { type: sql.NVarChar, value: String(year) } }
  );
  const rows = result.recordset.map(r => ({ weekKey: r.OrderWeek, subWeek: r.SubWeek, country: r.Country, item: r.Item, awbKey: r.AwbKey, awbRaw: r.AwbRaw, flight: r.Flight, box: r.BoxQty == null ? null : Number(r.BoxQty), arrival: r.ArrivalDate, items: safeJson(r.ItemsJson), flags: r.Flags ? r.Flags.split(' | ') : [], duplicate: !!r.IsDuplicate, estimated: !!r.IsEstimated, mentionCount: r.MentionCount }));
  const last = result.recordset.reduce((acc, r) => (!acc || r.UpdateDtm > acc.UpdateDtm ? r : acc), null);
  return { rows, lastUpdate: last ? { at: last.UpdateDtm, file: last.SourceFile } : null };
}

function safeJson(text) { try { return JSON.parse(text || '[]'); } catch { return []; } }

export default withAuth(async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    if (req.method === 'GET') {
      const year = /^\d{4}$/.test(String(req.query.year || '')) ? String(req.query.year) : String(new Date().getFullYear());
      const [warehouse, kakao] = await Promise.all([readWarehouse(year), readKakao(year)]);
      const report = buildBoxByCountry({ warehouse, kakao: kakao.rows });
      return res.status(200).json({
        success: true, readOnly: true, year, ...report,
        kakaoShipments: kakao.rows.length, kakaoLastUpdate: kakao.lastUpdate, generatedAt: new Date().toISOString(),
        basis: {
          web: 'WarehouseMaster(isDeleted=0, OrderYear) × Σ WarehouseDetail.BoxQuantity, 국가=Product.CounName',
          kakao: '비행 스케줄 카톡방 공지(AWB·박스) — WebFlightScheduleBox(웹 전용), 업로드로 갱신',
          rule: '중복 AWB 제외 · 웹 박스 0이면 카톡 박스 · 콜롬비아 장미 단만 입력(박스0)은 카톡 박스 · 그 외 웹(전산)',
        },
      });
    }
    if (req.method === 'POST') {
      if (!isAdminUser(req.user)) return res.status(403).json({ success: false, error: '카톡 선적 업로드는 관리자만 가능합니다.' });
      const text = String(req.body?.text || '');
      if (text.length < 100) return res.status(400).json({ success: false, error: '카카오톡 내보내기(txt) 본문이 비어 있습니다.' });
      const fromYear = /^\d{4}$/.test(String(req.body?.fromYear || '')) ? Number(req.body.fromYear) : 2026;
      const sourceFile = String(req.body?.fileName || '').slice(0, 255);
      const parsed = parseKakaoFlightSchedule(text, { fromYear });
      if (!parsed.shipments.length) return res.status(400).json({ success: false, error: '선적 공지를 찾지 못했습니다. 비행 스케줄 방 내보내기 파일인지 확인해 주세요.' });
      await ensureTable();
      const uid = String(req.user?.userId || 'admin').slice(0, 50);
      let saved = 0;
      for (let i = 0; i < parsed.shipments.length; i += 100) {
        const chunk = parsed.shipments.slice(i, i + 100);
        const values = []; const params = { uid: { type: sql.NVarChar, value: uid }, src: { type: sql.NVarChar, value: sourceFile } };
        chunk.forEach((s, j) => {
          const rowKey = s.awbKey ? `${s.year}|AWB:${s.awbKey}` : `${s.year}|NOAWB:${s.subWeek}|${s.country}|${s.item}|${s.awbRaw}`;
          values.push(`(@k${j}, @y${j}, @w${j}, @sw${j}, @c${j}, @it${j}, @ak${j}, @ar${j}, @fl${j}, @bx${j}, @ad${j}, @ij${j}, @fg${j}, @dup${j}, @est${j}, @mc${j}, @src, @uid)`);
          Object.assign(params, {
            [`k${j}`]: { type: sql.NVarChar, value: rowKey.slice(0, 160) }, [`y${j}`]: { type: sql.NVarChar, value: String(s.year) },
            [`w${j}`]: { type: sql.NVarChar, value: s.weekKey }, [`sw${j}`]: { type: sql.NVarChar, value: s.subWeek.slice(0, 12) },
            [`c${j}`]: { type: sql.NVarChar, value: s.country.slice(0, 30) }, [`it${j}`]: { type: sql.NVarChar, value: s.item.slice(0, 60) },
            [`ak${j}`]: { type: sql.NVarChar, value: s.awbKey.slice(0, 40) }, [`ar${j}`]: { type: sql.NVarChar, value: s.awbRaw.slice(0, 60) },
            [`fl${j}`]: { type: sql.NVarChar, value: s.flight.slice(0, 20) }, [`bx${j}`]: { type: sql.Int, value: s.box == null ? null : s.box },
            [`ad${j}`]: { type: sql.NVarChar, value: s.arrival.slice(0, 10) }, [`ij${j}`]: { type: sql.NVarChar, value: JSON.stringify(s.items).slice(0, 1000) },
            [`fg${j}`]: { type: sql.NVarChar, value: s.flags.join(' | ').slice(0, 500) }, [`dup${j}`]: { type: sql.Bit, value: s.duplicate ? 1 : 0 },
            [`est${j}`]: { type: sql.Bit, value: s.estimated ? 1 : 0 }, [`mc${j}`]: { type: sql.Int, value: s.mentionCount },
          });
        });
        await query(
          `MERGE dbo.WebFlightScheduleBox AS target
           USING (VALUES ${values.join(',')}) AS source(RowKey, OrderYear, OrderWeek, SubWeek, Country, Item, AwbKey, AwbRaw, Flight, BoxQty, ArrivalDate, ItemsJson, Flags, IsDuplicate, IsEstimated, MentionCount, SourceFile, UpdateID)
              ON target.RowKey = source.RowKey
           WHEN MATCHED THEN UPDATE SET OrderWeek=source.OrderWeek, SubWeek=source.SubWeek, Country=source.Country, Item=source.Item, AwbRaw=source.AwbRaw, Flight=source.Flight,
                BoxQty=source.BoxQty, ArrivalDate=source.ArrivalDate, ItemsJson=source.ItemsJson, Flags=source.Flags, IsDuplicate=source.IsDuplicate, IsEstimated=source.IsEstimated,
                MentionCount=source.MentionCount, SourceFile=source.SourceFile, UpdateID=source.UpdateID, UpdateDtm=GETDATE()
           WHEN NOT MATCHED THEN INSERT (RowKey, OrderYear, OrderWeek, SubWeek, Country, Item, AwbKey, AwbRaw, Flight, BoxQty, ArrivalDate, ItemsJson, Flags, IsDuplicate, IsEstimated, MentionCount, SourceFile, UpdateID)
                VALUES (source.RowKey, source.OrderYear, source.OrderWeek, source.SubWeek, source.Country, source.Item, source.AwbKey, source.AwbRaw, source.Flight, source.BoxQty, source.ArrivalDate, source.ItemsJson, source.Flags, source.IsDuplicate, source.IsEstimated, source.MentionCount, source.SourceFile, source.UpdateID);`,
          params
        );
        saved += chunk.length;
      }
      return res.status(200).json({ success: true, saved, mentions: parsed.mentions.length, duplicates: parsed.shipments.filter(s => s.duplicate).length, years: parsed.years });
    }
    return res.status(405).json({ success: false, error: 'GET/POST만 지원합니다.' });
  } catch (error) {
    console.error('[incoming/box-by-country]', error?.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});
