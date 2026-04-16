// lib/chat/bizContext.js — 비즈니스 스냅샷 (챗봇 LLM 에 실제 경영 데이터 주입)
//
// 목적:
//   "주문관리 42회" 수준이 아니라 실제 거래처·품목·수량·추세까지 알려주기.
//   LLM 이 "미카엘은 카네이션 위주 소량 주문", "인터넷공판장이 최대 거래처",
//   "네덜란드산 장미가 줄고 에콰도르산이 늘었다" 를 알고 있으면
//   질문에 맥락 있는 정확한 답변 가능.
//
// 1시간 캐시. SQL 집계 쿼리 7종.

import { query } from '../db';

const TTL_MS = 60 * 60 * 1000;
let _cache = null;
let _cacheAt = 0;
let _building = null;

async function build() {
  const results = {};

  // ── 1) 최근 활성 차수 (가장 최근 3개 대차수)
  try {
    const r = await query(
      `SELECT DISTINCT LEFT(OrderWeek, 2) AS Major
         FROM OrderMaster WHERE ISNULL(isDeleted,0)=0
         ORDER BY Major DESC`
    );
    results.recentMajorWeeks = r.recordset.slice(0, 3).map(x => x.Major);
  } catch { results.recentMajorWeeks = []; }

  // ── 2) 거래처 TOP 10 (최근 차수 주문 기준)
  try {
    const latestMajor = results.recentMajorWeeks[0] || '16';
    const r = await query(
      `SELECT TOP 10 c.CustName,
              COUNT(DISTINCT om.OrderMasterKey) AS OrderCnt,
              SUM(CASE
                WHEN p.OutUnit IN (N'박스','BOX','Box') THEN ISNULL(od.BoxQuantity,0)
                WHEN p.OutUnit IN (N'단','BUNCH','Bunch') THEN ISNULL(od.BunchQuantity,0)
                WHEN p.OutUnit IN (N'송이','STEAM','STEM') THEN ISNULL(od.SteamQuantity,0)
                ELSE ISNULL(od.BoxQuantity,0) END) AS TotalQty
         FROM OrderMaster om
         JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey
         JOIN Customer c ON om.CustKey = c.CustKey
         JOIN Product p ON od.ProdKey = p.ProdKey
        WHERE ISNULL(om.isDeleted,0)=0 AND ISNULL(od.isDeleted,0)=0
          AND om.OrderWeek LIKE '${latestMajor}-%'
        GROUP BY c.CustName
        ORDER BY TotalQty DESC`
    );
    results.topCustomers = r.recordset;
  } catch { results.topCustomers = []; }

  // ── 3) 품목(꽃 종류) TOP 10 (최근 차수)
  try {
    const latestMajor = results.recentMajorWeeks[0] || '16';
    const r = await query(
      `SELECT TOP 10 p.FlowerName, p.CounName,
              COUNT(*) AS LineCnt,
              SUM(CASE
                WHEN p.OutUnit IN (N'박스','BOX','Box') THEN ISNULL(od.BoxQuantity,0)
                WHEN p.OutUnit IN (N'단','BUNCH','Bunch') THEN ISNULL(od.BunchQuantity,0)
                WHEN p.OutUnit IN (N'송이','STEAM','STEM') THEN ISNULL(od.SteamQuantity,0)
                ELSE ISNULL(od.BoxQuantity,0) END) AS TotalQty
         FROM OrderMaster om
         JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey
         JOIN Product p ON od.ProdKey = p.ProdKey
        WHERE ISNULL(om.isDeleted,0)=0 AND ISNULL(od.isDeleted,0)=0
          AND om.OrderWeek LIKE '${latestMajor}-%'
        GROUP BY p.FlowerName, p.CounName
        ORDER BY TotalQty DESC`
    );
    results.topFlowers = r.recordset;
  } catch { results.topFlowers = []; }

  // ── 4) 원산지별 비중 (최근 차수)
  try {
    const latestMajor = results.recentMajorWeeks[0] || '16';
    const r = await query(
      `SELECT p.CounName,
              COUNT(DISTINCT om.CustKey) AS CustCnt,
              SUM(CASE
                WHEN p.OutUnit IN (N'박스','BOX','Box') THEN ISNULL(od.BoxQuantity,0)
                WHEN p.OutUnit IN (N'단','BUNCH','Bunch') THEN ISNULL(od.BunchQuantity,0)
                WHEN p.OutUnit IN (N'송이','STEAM','STEM') THEN ISNULL(od.SteamQuantity,0)
                ELSE ISNULL(od.BoxQuantity,0) END) AS TotalQty
         FROM OrderMaster om
         JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey
         JOIN Product p ON od.ProdKey = p.ProdKey
        WHERE ISNULL(om.isDeleted,0)=0 AND ISNULL(od.isDeleted,0)=0
          AND om.OrderWeek LIKE '${latestMajor}-%' AND p.CounName IS NOT NULL
        GROUP BY p.CounName
        ORDER BY TotalQty DESC`
    );
    results.countryShare = r.recordset;
  } catch { results.countryShare = []; }

  // ── 5) 차수별 총 주문량 추이 (최근 5개 세부차수)
  try {
    const r = await query(
      `SELECT TOP 5 om.OrderWeek,
              COUNT(DISTINCT om.CustKey) AS CustCnt,
              COUNT(*) AS LineCnt,
              SUM(CASE
                WHEN p.OutUnit IN (N'박스','BOX','Box') THEN ISNULL(od.BoxQuantity,0)
                WHEN p.OutUnit IN (N'단','BUNCH','Bunch') THEN ISNULL(od.BunchQuantity,0)
                WHEN p.OutUnit IN (N'송이','STEAM','STEM') THEN ISNULL(od.SteamQuantity,0)
                ELSE ISNULL(od.BoxQuantity,0) END) AS TotalQty
         FROM OrderMaster om
         JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey
         JOIN Product p ON od.ProdKey = p.ProdKey
        WHERE ISNULL(om.isDeleted,0)=0 AND ISNULL(od.isDeleted,0)=0
        GROUP BY om.OrderWeek
        ORDER BY om.OrderWeek DESC`
    );
    results.weeklyTrend = r.recordset.reverse(); // 오래된→최신 순
  } catch { results.weeklyTrend = []; }

  // ── 6) 출고 확정률 (최근 차수)
  try {
    const latestMajor = results.recentMajorWeeks[0] || '16';
    const r = await query(
      `SELECT
              COUNT(*) AS Total,
              SUM(CASE WHEN sm.isFix=1 THEN 1 ELSE 0 END) AS Fixed,
              SUM(ISNULL(sd.Amount,0)) AS TotalAmt
         FROM ShipmentMaster sm
         JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
        WHERE ISNULL(sm.isDeleted,0)=0
          AND sm.OrderWeek LIKE '${latestMajor}-%'`
    );
    const row = r.recordset[0];
    results.shipmentStats = {
      total: row?.Total || 0,
      fixed: row?.Fixed || 0,
      fixRate: row?.Total ? Math.round((row.Fixed / row.Total) * 100) : 0,
      totalAmt: row?.TotalAmt || 0,
    };
  } catch { results.shipmentStats = {}; }

  // ── 7) 이번 달 매출 TOP 5 거래처
  try {
    const r = await query(
      `SELECT TOP 5 c.CustName, SUM(sd.Amount) AS Amt
         FROM ShipmentMaster sm
         JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
         JOIN Customer c ON sm.CustKey = c.CustKey
        WHERE ISNULL(sm.isDeleted,0)=0 AND sm.isFix=1
          AND YEAR(sd.ShipmentDtm) = YEAR(GETDATE())
          AND MONTH(sd.ShipmentDtm) = MONTH(GETDATE())
        GROUP BY c.CustName
        ORDER BY Amt DESC`
    );
    results.monthlyTopCust = r.recordset;
  } catch { results.monthlyTopCust = []; }

  results.builtAt = new Date().toISOString();
  return results;
}

export async function getBizContext({ force = false } = {}) {
  const now = Date.now();
  if (!force && _cache && now - _cacheAt < TTL_MS) return _cache;
  if (_building) return _building;
  _building = (async () => {
    try {
      _cache = await build();
      _cacheAt = Date.now();
      return _cache;
    } finally { _building = null; }
  })();
  return _building;
}

// ── LLM 프롬프트용 텍스트
export async function getBizContextPrompt() {
  let biz;
  try { biz = await getBizContext(); }
  catch { return ''; }
  if (!biz) return '';

  const fmtN = n => Number(n || 0).toLocaleString();
  const lines = [];

  lines.push('## 현재 경영 현황 (실제 DB 집계, 1시간 캐시)');
  lines.push('');

  // 차수 추이
  if (biz.weeklyTrend?.length) {
    lines.push('### 최근 차수별 주문량');
    for (const w of biz.weeklyTrend) {
      lines.push(`  ${w.OrderWeek}차: 거래처 ${w.CustCnt}곳, ${fmtN(w.LineCnt)}건, 수량 ${fmtN(w.TotalQty)}`);
    }
  }

  // 거래처 TOP
  if (biz.topCustomers?.length) {
    lines.push('');
    lines.push(`### ${biz.recentMajorWeeks[0] || '?'}차 주문량 TOP 거래처`);
    biz.topCustomers.forEach((c, i) =>
      lines.push(`  ${i + 1}. ${c.CustName}: 주문 ${c.OrderCnt}건, 수량 ${fmtN(c.TotalQty)}`)
    );
  }

  // 꽃 종류 TOP
  if (biz.topFlowers?.length) {
    lines.push('');
    lines.push(`### ${biz.recentMajorWeeks[0] || '?'}차 꽃 종류 TOP`);
    biz.topFlowers.forEach((f, i) =>
      lines.push(`  ${i + 1}. ${f.CounName || ''} ${f.FlowerName}: ${fmtN(f.TotalQty)} (${f.LineCnt}건)`)
    );
  }

  // 원산지
  if (biz.countryShare?.length) {
    lines.push('');
    lines.push('### 원산지별 비중');
    biz.countryShare.forEach(c =>
      lines.push(`  ${c.CounName}: 수량 ${fmtN(c.TotalQty)}, 거래처 ${c.CustCnt}곳`)
    );
  }

  // 출고 확정률
  if (biz.shipmentStats?.total) {
    lines.push('');
    lines.push(`### 출고 현황 (${biz.recentMajorWeeks[0] || '?'}차)`);
    lines.push(`  확정률: ${biz.shipmentStats.fixRate}% (${fmtN(biz.shipmentStats.fixed)}/${fmtN(biz.shipmentStats.total)}건)`);
    lines.push(`  총 공급가: ${fmtN(biz.shipmentStats.totalAmt)}원`);
  }

  // 이달 매출 TOP
  if (biz.monthlyTopCust?.length) {
    lines.push('');
    lines.push('### 이번 달 매출 TOP 거래처');
    biz.monthlyTopCust.forEach((c, i) =>
      lines.push(`  ${i + 1}. ${c.CustName}: ${fmtN(c.Amt)}원`)
    );
  }

  lines.push('');
  lines.push('→ 위 현황을 기반으로 질문에 맥락 있는 답변을 해라. 숫자는 이 데이터와 일관되어야.');

  return lines.join('\n');
}
