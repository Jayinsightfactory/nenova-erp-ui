#!/usr/bin/env node
// scripts/gen-historical-customs-seed.mjs — lib/profitReportHistoricalCustoms.js 의 값을 그대로
// docs/migrations/2026-08-12_profit_report_historical_customs_seed.sql 로 내보낸다.
// 모듈과 마이그레이션이 어긋나지 않도록 SQL을 손으로 쓰지 않고 이 스크립트로 생성한다.
import fs from 'node:fs';
import {
  historicalCountryMajors, historicalCountryCategories, historicalColombiaWeeks,
  getHistoricalCountryCustoms, getHistoricalColombiaWeekly, HISTORICAL_SNAPSHOT_YEAR,
} from '../lib/profitReportHistoricalCustoms.js';

const Y = HISTORICAL_SNAPSHOT_YEAR;
const q = (v) => (v == null ? 'NULL' : Number(v));
const country = [];
for (const major of historicalCountryMajors()) {
  for (const cat of historicalCountryCategories(major)) {
    const r = getHistoricalCountryCustoms(Y, major, cat);
    country.push(`    (N'${Y}', N'${major}', N'${cat}', ${q(r.GW1)}, ${q(r.GW2)}, ${q(r.Customs1)}, ${q(r.Customs2)}, ${q(r.SunYul1)}, ${q(r.SunYul2)}, ${q(r.WorldFreight1)}, ${q(r.WorldFreight2)}, 1, 1, ${q(r.Quarantine1)}, ${q(r.Quarantine2)}, ${q(r.BakSangRateApplied)})`);
  }
}
const colombia = [];
for (const wk of historicalColombiaWeeks()) {
  const { row } = getHistoricalColombiaWeekly(Y, wk);
  colombia.push(`    (N'${Y}', N'${wk}', ${q(row.GW)}, ${q(row.CW)}, ${q(row.HandlingFee)}, ${q(row.ItemCount)}, ${q(row.Truck1t)}, ${q(row.Truck2_5t)}, ${q(row.Truck5t)}, ${q(row.CustomsFee)}, ${q(row.DisinfectFee)}, ${q(row.QuarantineDeductFee)}, ${q(row.AirRateUSD)}, ${q(row.BakSangRateApplied)})`);
}

const sqlText = `-- 2026년 22~27차 그외통관비 원천 구성요소 historical snapshot seed (웹 전용 테이블에만 INSERT).
--
-- 근거: 원본 워크북 "매출원가 양식 - NN차_재고수정.xlsx"(22~27차 6개)의 \`그외통관비\` /
--       \`콜롬비아 1차\`·\`콜롬비아 2차\` 시트. 최종 H 합계가 아니라 **구성요소**를 그대로 넣는다 —
--       H는 lib/customsForwardingCalc.js의 원본 공식이 이 구성요소로 계산한다.
-- 생성: scripts/gen-historical-customs-seed.mjs (lib/profitReportHistoricalCustoms.js에서 생성, 손으로 수정 금지)
--
-- 이미 저장된 행이 있으면 절대 덮어쓰지 않는다(운영자 입력 우선, 행 단위).
-- WorldFreight{1,2}Manual=1: 원본에 남은 **실제 청구 운송료**이므로 GW 용량분해 자동추천으로 대체하지 않는다.
-- BakSangRateApplied: 시트 단위로 다르다 — 22차 콜롬비아 시트는 370원/kg, 그외통관비(국가) 시트는 460원/kg.
-- ERP 공용 원장(OrderMaster/OrderDetail/ShipmentMaster/ShipmentDetail/ProductStock/Estimate 등)은 건드리지 않는다.

IF OBJECT_ID(N'dbo.WebCustomsWeekly', N'U') IS NULL
  OR OBJECT_ID(N'dbo.WebColombiaWeekly', N'U') IS NULL
BEGIN
  RAISERROR(N'WebCustomsWeekly/WebColombiaWeekly가 없습니다. 그외통관비 스키마를 먼저 설치하세요.', 16, 1);
END
ELSE
BEGIN
  ;WITH seed(OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2,
             WorldFreight1, WorldFreight2, WorldFreight1Manual, WorldFreight2Manual,
             Quarantine1, Quarantine2, BakSangRateApplied) AS (
    SELECT * FROM (VALUES
${country.join(',\n')}
    ) v(OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2, SunYul1, SunYul2,
        WorldFreight1, WorldFreight2, WorldFreight1Manual, WorldFreight2Manual,
        Quarantine1, Quarantine2, BakSangRateApplied)
  )
  INSERT INTO WebCustomsWeekly (OrderYear, MajorWeek, Category, GW1, GW2, Customs1, Customs2,
                                SunYul1, SunYul2, WorldFreight1, WorldFreight2,
                                WorldFreight1Manual, WorldFreight2Manual,
                                Quarantine1, Quarantine2, BakSangRateApplied, UpdatedBy)
  SELECT s.OrderYear, s.MajorWeek, s.Category, s.GW1, s.GW2, s.Customs1, s.Customs2,
         s.SunYul1, s.SunYul2, s.WorldFreight1, s.WorldFreight2,
         s.WorldFreight1Manual, s.WorldFreight2Manual,
         s.Quarantine1, s.Quarantine2, s.BakSangRateApplied, N'historical-snapshot-seed'
    FROM seed s
   WHERE NOT EXISTS (SELECT 1 FROM WebCustomsWeekly t
                      WHERE t.OrderYear=s.OrderYear AND t.MajorWeek=s.MajorWeek AND t.Category=s.Category);

  ;WITH seedCol(OrderYear, OrderWeek, GW, CW, HandlingFee, ItemCount, Truck1t, Truck2_5t, Truck5t,
                CustomsFee, DisinfectFee, QuarantineDeductFee, AirRateUSD, BakSangRateApplied) AS (
    SELECT * FROM (VALUES
${colombia.join(',\n')}
    ) v(OrderYear, OrderWeek, GW, CW, HandlingFee, ItemCount, Truck1t, Truck2_5t, Truck5t,
        CustomsFee, DisinfectFee, QuarantineDeductFee, AirRateUSD, BakSangRateApplied)
  )
  INSERT INTO WebColombiaWeekly (OrderYear, OrderWeek, GW, CW, HandlingFee, ItemCount,
                                 Truck1t, Truck2_5t, Truck5t, CustomsFee, DisinfectFee,
                                 QuarantineDeductFee, AirRateUSD, BakSangRateApplied, UpdatedBy)
  SELECT s.OrderYear, s.OrderWeek, s.GW, s.CW, s.HandlingFee, s.ItemCount,
         s.Truck1t, s.Truck2_5t, s.Truck5t, s.CustomsFee, s.DisinfectFee,
         s.QuarantineDeductFee, s.AirRateUSD, s.BakSangRateApplied, N'historical-snapshot-seed'
    FROM seedCol s
   WHERE NOT EXISTS (SELECT 1 FROM WebColombiaWeekly t
                      WHERE t.OrderYear=s.OrderYear AND t.OrderWeek=s.OrderWeek);
END;
`;
fs.writeFileSync('docs/migrations/2026-08-12_profit_report_historical_customs_seed.sql', sqlText, 'utf8');
process.stderr.write(`wrote seed: ${country.length} country rows, ${colombia.length} colombia rows\n`);
