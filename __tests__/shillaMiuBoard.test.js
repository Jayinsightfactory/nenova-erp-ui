import assert from "node:assert/strict";
import fs from "node:fs";
import {
  allocationKey,
  buildGroupRows,
  buildMajorWeeks,
  normalizeMajorWeek,
} from "../lib/shillaMiuBoard.js";

assert.equal(normalizeMajorWeek("2026-32-02"), "32");
assert.deepEqual(buildMajorWeeks("31", "32"), ["31", "32"]);
assert.equal(
  allocationKey({ groupKey: 3, useWeek: "32", prodKey: 7 }),
  "3|32|7",
);

const rows = buildGroupRows({
  weeks: ["32"],
  baseShipments: [
    { week: "32", orderWeek: "32-01", prodKey: 1, prodName: "A", qty: 100 },
    { week: "32", orderWeek: "32-02", prodKey: 1, prodName: "A", qty: 50 },
  ],
  receiverShipments: [
    { week: "32", orderWeek: "32-01", prodKey: 1, qty: 40 },
    { week: "32", prodKey: 2, prodName: "receiver only", qty: 99 },
  ],
  allocations: [
    { useWeek: "32", prodKey: 1, qty: 110, matched: true },
    { useWeek: "32", prodKey: 3, qty: 20 },
  ],
});
assert.deepEqual(
  rows.map((r) => r.prodKey),
  [1],
  "수령업체만 출고된 품목과 웹값만 있는 품목은 기준업체 행에 포함하지 않는다.",
);
assert.equal(rows[0].weeks["32"].baseActual, 150);
assert.equal(rows[0].weeks["32"].receiverActual, 40);
assert.equal(rows[0].weeks["32"].calculatedRemainder, 110);
assert.equal(rows[0].weeks["32"].difference, 0);
assert.equal(rows[0].weeks["32"].subweeks.length, 2);

const api = fs.readFileSync("pages/api/sales/shilla-miu-board.js", "utf8");
const page = fs.readFileSync("pages/sales/shilla-miu-board.js", "utf8");
assert.ok(
  api.includes("sm.OrderYear=@yr") && api.includes("LEFT(sm.OrderWeek,2) IN"),
);
assert.ok(
  api.includes("sm.CustKey=@cust") && !api.includes("CustName LIKE N'%신라%'"),
);
assert.ok(
  api.includes("ISNULL(sm.isDeleted,0)=0") &&
    api.includes("ISNULL(sd.OutQuantity,0)>0"),
);
assert.ok(api.includes("WebShillaMiuBoardGroup") && api.includes("isAdmin"));
assert.ok(
  api.includes("CustName=N'아이엠（미우）'") &&
    api.includes("N'초이문(센스앤센서빌러티)'"),
  "정확히 한 건인 Customer만 초기 그룹으로 사용한다.",
);
assert.ok(
  api.includes("GroupKey IS NULL"),
  "기존 저장값 호환 읽기를 유지한다.",
);
assert.ok(
  !api.match(
    /(?:INSERT|UPDATE|DELETE)\s+(?:Order|Shipment|Stock|Estimate|WebProfitReport)/i,
  ),
  "조회/저장 API에 ERP 쓰기가 없어야 한다.",
);
assert.ok(
  page.includes("업체관리") &&
    page.includes("미완료") &&
    page.includes("open[key]"),
);
assert.ok(
  page.includes("전체") &&
    page.indexOf("전체") < page.indexOf("activeGroups.map"),
  "전체 탭이 업체 탭보다 먼저 존재해야 한다.",
);
assert.ok(
  api.includes("active.map(async (group)") && api.includes("boards"),
  "전체 보기는 모든 활성 그룹을 같은 조회 로직으로 불러야 한다.",
);
assert.ok(
  page.includes("displayedBoards") && page.includes("collapsed"),
  "전체와 업체별 세부 전환 및 업체 접기를 제공해야 한다.",
);
assert.ok(
  page.includes("draftKey(group.groupKey, r.prodKey)"),
  "전체 저장도 GroupKey와 ProdKey로 분리해야 한다.",
);
assert.ok(
  page.includes("table-layout: fixed") &&
    page.includes("@media (max-width: 1400px)"),
  "조밀한 반응형 표 레이아웃을 유지해야 한다.",
);
assert.ok(
  page.includes("open[key]") && page.includes("subweeks"),
  "세부차수는 기본 접힘 후 펼칠 수 있어야 한다.",
);
assert.ok(
  !page.includes("components/Layout") && !page.includes("<Layout"),
  "_app이 소유한 공통 Layout을 페이지에서 중복 렌더링하지 않아야 한다.",
);
assert.ok(
  fs.readFileSync("pages/_app.js", "utf8").includes("<Layout>"),
  "일반 화면과 popup=1 계약은 전역 Layout이 소유해야 한다.",
);
console.log("shilla miu board tests passed");
