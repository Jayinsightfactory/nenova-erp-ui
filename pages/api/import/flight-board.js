// GET /api/import/flight-board — 홈 "수입 비행기 현황" (읽기 전용)
// 카톡 도착 공지(스케줄방·빌번호방·네노바&선율방)를 읽어 비행기(운송장) 단위로 묶고,
// 전산 입고 기록(WarehouseMaster.OrderNo = 운송장 번호)과 맞춰 상태·예측 위치·이슈를 돌려준다.
// 위치는 실제 위치가 아니라 일정으로 계산한 예측이다. DB 는 SELECT 만 한다.
import { withAuth } from '../../../lib/auth';
import { query } from '../../../lib/db';
import { normalizeAwb } from '../../../lib/importFlightNotice';
import { readImportScheduleFeed } from '../../../lib/importScheduleFeed';
import { buildFlightBoard } from '../../../lib/importFlightBoard';

async function readReceipts() {
  // 최근 30일 안에 등록된 입고 기록을 운송장 번호로 묶는다. WarehouseDetail 에는 isDeleted 칸이 없다(마스터로만 거름).
  const masters = await query(`
    SELECT REPLACE(REPLACE(m.OrderNo,'-',''),' ','') AS Awb,
           MIN(CONVERT(varchar(19), m.CreateDtm, 120)) AS RegAt,
           MIN(m.OrderWeek) AS OrderWeek,
           COUNT(DISTINCT m.WarehouseKey) AS Masters,
           COUNT(DISTINCT m.FarmName) AS Farms
    FROM WarehouseMaster m
    WHERE ISNULL(m.isDeleted,0)=0 AND m.CreateDtm >= DATEADD(day,-30,GETDATE()) AND ISNULL(m.OrderNo,'')<>''
    GROUP BY REPLACE(REPLACE(m.OrderNo,'-',''),' ','')`);
  const items = await query(`
    SELECT REPLACE(REPLACE(m.OrderNo,'-',''),' ','') AS Awb,
           ISNULL(p.CounName,'') AS CounName, ISNULL(p.FlowerName,'') AS FlowerName,
           SUM(ISNULL(d.BoxQuantity,0)) AS Boxes, COUNT(*) AS Lines
    FROM WarehouseMaster m
    JOIN WarehouseDetail d ON d.WarehouseKey = m.WarehouseKey
    JOIN Product p ON p.ProdKey = d.ProdKey
    WHERE ISNULL(m.isDeleted,0)=0 AND m.CreateDtm >= DATEADD(day,-30,GETDATE()) AND ISNULL(m.OrderNo,'')<>''
      AND d.ProdKey NOT IN (3100,3101,2182)
    GROUP BY REPLACE(REPLACE(m.OrderNo,'-',''),' ',''), ISNULL(p.CounName,''), ISNULL(p.FlowerName,'')`);
  const map = new Map();
  for (const r of masters.recordset) {
    const awb = normalizeAwb(r.Awb);
    if (!awb) continue;
    // RegAt 은 서버(한국 시간) 문자열 — node Date 로 읽으면 9시간 밀리므로 문자열에 오프셋을 붙인다.
    map.set(awb, { registeredAt: `${String(r.RegAt).replace(' ', 'T')}+09:00`, orderWeek: r.OrderWeek, masters: r.Masters, farms: r.Farms, boxes: 0, country: '', items: [] });
  }
  for (const r of items.recordset) {
    const rec = map.get(normalizeAwb(r.Awb));
    if (!rec) continue;
    rec.boxes += Number(r.Boxes) || 0;
    if (!rec.country && r.CounName) rec.country = r.CounName;
    rec.items.push({ name: r.FlowerName || '기타', box: Number(r.Boxes) || 0, lines: r.Lines });
  }
  for (const rec of map.values()) rec.items.sort((a, b) => b.box - a.box);
  return map;
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ success: false, error: 'GET만 지원합니다.' }); }
  const now = Date.now();
  let feed = { messages: [], rooms: {}, fetchedAt: null };
  let feedError = null;
  const token = process.env.NENOVA_SALES_READ_TOKEN;
  if (!token) feedError = '카톡 도착 공지 조회 설정이 없습니다.';
  else {
    try {
      feed = await readImportScheduleFeed(token, { days: 14, now });
      if (Object.values(feed.rooms).every(r => r.error)) feedError = '카톡 도착 공지를 불러오지 못했습니다.';
    } catch { feedError = '카톡 도착 공지를 불러오지 못했습니다.'; }
  }
  let receipts = new Map();
  let receiptError = null;
  try { receipts = await readReceipts(); } catch { receiptError = '전산 입고 기록을 불러오지 못했습니다.'; }

  const board = buildFlightBoard({ messages: feed.messages, receipts, now });
  return res.status(200).json({
    success: true,
    generatedAt: new Date(now).toISOString(),
    predicted: true,
    feed: { ok: !feedError, error: feedError, rooms: feed.rooms, fetchedAt: feed.fetchedAt },
    receipts: { ok: !receiptError, error: receiptError },
    ...board,
  });
}

export default withAuth(handler);
