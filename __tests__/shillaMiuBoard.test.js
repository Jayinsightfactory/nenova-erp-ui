// 잔량분배 게시판 계약 테스트
// 흐름: 예상물량 → 현재분배 → 업체 최종분배(웹 입력) → 업체 잔량 → 미우 이관
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  allocationKey,
  buildGroupRows,
  buildMajorWeeks,
  buildOverviewSections,
  normalizeMajorWeek,
  roundQty,
  stepMajorWeek,
} from "../lib/shillaMiuBoard.js";

assert.equal(normalizeMajorWeek("2026-32-02"), "32");
assert.deepEqual(buildMajorWeeks("31", "32"), ["31", "32"]);
assert.equal(
  allocationKey({ groupKey: 3, useWeek: "32", prodKey: 7 }),
  "3|32|7",
);

// ── 차수 스피너: ▲▼/키보드/휠 공용 계산, 1 미만 금지, 52 상한
assert.equal(stepMajorWeek("32", 1), "33");
assert.equal(stepMajorWeek("32", -1), "31");
assert.equal(stepMajorWeek("01", -1), "01", "1 미만으로 내려가지 않는다.");
assert.equal(stepMajorWeek("", -1), "01");
assert.equal(stepMajorWeek("52", 1), "52");
assert.equal(stepMajorWeek("9", 1), "10", "표시는 항상 2자리로 채운다.");

// ── 소수 꼬리 정규화
assert.equal(roundQty(0.1 + 0.2), 0.3);
assert.equal(roundQty(10 - 9.9995), 0.001);
assert.equal(Object.is(roundQty(-0.0001), 0), true);

// ── 기본 흐름: 예상 150, 현재분배 120, 최종분배 130 → 잔량 20 → 미우 이관 20
const base = buildGroupRows({
  weeks: ["32"],
  baseOrders: [
    { week: "32", orderWeek: "32-01", prodKey: 1, prodName: "A", unit: "박스", qty: 100 },
    { week: "32", orderWeek: "32-02", prodKey: 1, prodName: "A", unit: "박스", qty: 50 },
  ],
  baseShipments: [
    { week: "32", orderWeek: "32-01", prodKey: 1, prodName: "A", unit: "박스", qty: 120 },
  ],
  receiverShipments: [
    { week: "32", orderWeek: "32-01", prodKey: 1, qty: 40 },
    { week: "32", prodKey: 2, prodName: "receiver only", qty: 99 },
  ],
  receiverOrders: [{ week: "32", prodKey: 1, qty: 45 }],
  allocations: [
    { useWeek: "32", prodKey: 1, qty: 110, finalQty: 130, matched: true },
    { useWeek: "32", prodKey: 3, qty: 20 },
  ],
});
assert.deepEqual(
  base.map((r) => r.prodKey),
  [1],
  "수령업체만 있는 품목과 웹값만 있는 품목은 원천업체 행이 되지 않는다.",
);
const w32 = base[0].weeks["32"];
assert.equal(w32.expectedQty, 150);
assert.equal(w32.currentQty, 120);
assert.equal(w32.finalQty, 130);
assert.equal(w32.finalIsUserSet, true);
assert.equal(w32.residualQty, 20);
assert.equal(w32.transferQty, 20);
assert.equal(w32.receiverActual, 40);
assert.equal(w32.receiverExpected, 45);
assert.equal(w32.legacyMoveQty, 110, "이전 이동입력 값은 보존만 한다.");
assert.equal(w32.subweeks.length, 2);
assert.equal(w32.subweeks[0].expectedQty, 100);
assert.equal(w32.subweeks[0].currentQty, 120);

// ── 주문만 있고 분배가 아직 없는 품목도 행이 되고, 최종분배 미입력이면 현재분배(0)를 임시값으로 쓴다.
const orderOnly = buildGroupRows({
  weeks: ["32"],
  baseOrders: [{ week: "32", orderWeek: "32-01", prodKey: 9, prodName: "B", qty: 30 }],
});
const w9 = orderOnly[0].weeks["32"];
assert.equal(w9.expectedQty, 30);
assert.equal(w9.currentQty, 0);
assert.equal(w9.finalIsUserSet, false);
assert.equal(w9.effectiveFinalQty, 0);
assert.equal(w9.residualQty, 30);
assert.equal(w9.transferQty, 30);

// ── 기존 저장값 호환: FinalQty 가 없는 과거 행(Qty 만 존재)은 최종분배로 승격하지 않는다.
const legacy = buildGroupRows({
  weeks: ["32"],
  baseOrders: [{ week: "32", prodKey: 5, prodName: "C", qty: 80 }],
  baseShipments: [{ week: "32", prodKey: 5, prodName: "C", qty: 60 }],
  allocations: [{ useWeek: "32", prodKey: 5, qty: 20, matched: true }],
});
const w5 = legacy[0].weeks["32"];
assert.equal(w5.finalQty, null);
assert.equal(w5.finalIsUserSet, false);
assert.equal(w5.legacyMoveQty, 20);
assert.equal(w5.effectiveFinalQty, 60, "미입력이면 현재분배를 임시로 쓴다.");
assert.equal(w5.residualQty, 20);
assert.equal(w5.matched, true, "완료 표시는 그대로 유지한다.");

// ── 0 저장과 초과(음수 잔량)
const edge = buildGroupRows({
  weeks: ["32"],
  baseOrders: [
    { week: "32", prodKey: 11, prodName: "Zero", qty: 40 },
    { week: "32", prodKey: 12, prodName: "Over", qty: 10 },
  ],
  baseShipments: [{ week: "32", prodKey: 11, prodName: "Zero", qty: 40 }],
  allocations: [
    { useWeek: "32", prodKey: 11, finalQty: 0 },
    { useWeek: "32", prodKey: 12, finalQty: 25 },
  ],
});
const zero = edge.find((r) => r.prodKey === 11).weeks["32"];
assert.equal(zero.finalIsUserSet, true, "0 은 미입력이 아니라 확정된 값이다.");
assert.equal(zero.effectiveFinalQty, 0);
assert.equal(zero.residualQty, 40);
const over = edge.find((r) => r.prodKey === 12).weeks["32"];
assert.equal(over.residualQty, -15);
assert.equal(over.isOverAllocated, true);
assert.equal(over.transferQty, 0, "초과분은 음수로 이관하지 않는다.");

// ── 전체 탭: 신라20 + 라움10 + 초이문5 + 미우 자체15 = 미우 총수량 50
const groupsFixture = [
  { groupKey: 1, groupName: "신라", baseCustKey: 11, baseCustName: "신라상사", receiverCustKey: 99, receiverCustName: "아이엠（미우）" },
  { groupKey: 2, groupName: "라움", baseCustKey: 12, baseCustName: "라움", receiverCustKey: 99, receiverCustName: "아이엠（미우）" },
  { groupKey: 3, groupName: "초이문", baseCustKey: 13, baseCustName: "초이문", receiverCustKey: 99, receiverCustName: "아이엠（미우）" },
  // 업체관리에서 나중에 추가한 원천 업체도 하드코딩 없이 같은 계산에 들어간다.
  { groupKey: 4, groupName: "신규업체", baseCustKey: 14, baseCustName: "신규상사", receiverCustKey: 99, receiverCustName: "아이엠（미우）" },
];
const boardOf = (group, expected, final) => ({
  group,
  rows: buildGroupRows({
    weeks: ["32"],
    baseOrders: [
      { week: "32", prodKey: 7, prodName: "장미 레드", unit: "박스", qty: expected },
    ],
    allocations: [{ useWeek: "32", prodKey: 7, finalQty: final }],
  }),
});
const overview = buildOverviewSections({
  week: "32",
  boards: [
    boardOf(groupsFixture[0], 50, 30), // 신라 잔량 20
    boardOf(groupsFixture[1], 30, 20), // 라움 잔량 10
    boardOf(groupsFixture[2], 15, 10), // 초이문 잔량 5
    boardOf(groupsFixture[3], 8, 8), // 신규업체 잔량 0
  ],
  receiverSelf: [
    {
      receiverCustKey: 99,
      prodKey: 7,
      prodName: "장미 레드",
      unit: "박스",
      qty: 15,
      expectedQty: 12,
    },
  ],
});
assert.equal(overview.length, 1, "수령업체가 하나면 구획도 하나다.");
assert.equal(overview[0].groups.length, 4, "추가된 원천 업체도 열로 포함한다.");
const overviewRow = overview[0].rows.find((r) => r.prodKey === 7);
assert.equal(overviewRow.byGroup[1].transferQty, 20);
assert.equal(overviewRow.byGroup[2].transferQty, 10);
assert.equal(overviewRow.byGroup[3].transferQty, 5);
assert.equal(overviewRow.byGroup[4].transferQty, 0);
assert.equal(overviewRow.residualTotal, 35, "기타 업체 잔량 합계");
assert.equal(overviewRow.receiverSelfQty, 15, "미우 자체수량");
assert.equal(overviewRow.receiverSelfExpected, 12);
assert.equal(overviewRow.receiverTotal, 50, "미우 총수량 = 자체 + 잔량 합계");

// ── 원천업체 행이 없어도 미우 자체수량 품목은 전체 탭에 남는다.
const selfOnly = buildOverviewSections({
  week: "32",
  boards: [boardOf(groupsFixture[0], 10, 10)],
  receiverSelf: [
    { receiverCustKey: 99, prodKey: 77, prodName: "미우 전용", unit: "단", qty: 7, expectedQty: 7 },
  ],
});
const selfRow = selfOnly[0].rows.find((r) => r.prodKey === 77);
assert.ok(selfRow, "미우만 취급하는 품목도 전체 탭에 표시한다.");
assert.equal(selfRow.receiverTotal, 7);

// ── 같은 ProdKey 라도 단위 문자열이 다르면 합산하지 않고 행을 분리한다.
const mixedUnit = buildOverviewSections({
  week: "32",
  boards: [
    {
      group: groupsFixture[0],
      rows: buildGroupRows({
        weeks: ["32"],
        baseOrders: [
          { week: "32", prodKey: 8, prodName: "혼합", unit: "박스", qty: 10 },
        ],
      }),
    },
    {
      group: groupsFixture[1],
      rows: buildGroupRows({
        weeks: ["32"],
        baseOrders: [
          { week: "32", prodKey: 8, prodName: "혼합", unit: "단", qty: 10 },
        ],
      }),
    },
  ],
  receiverSelf: [],
});
assert.equal(
  mixedUnit[0].rows.filter((r) => r.prodKey === 8).length,
  2,
  "단위가 다르면 임의 합산하지 않는다.",
);

// ── 수령업체가 서로 다르면 구획을 분리한다.
const twoReceivers = buildOverviewSections({
  week: "32",
  boards: [
    boardOf(groupsFixture[0], 10, 5),
    boardOf(
      { ...groupsFixture[1], receiverCustKey: 88, receiverCustName: "다른수령" },
      10,
      4,
    ),
  ],
  receiverSelf: [],
});
assert.equal(twoReceivers.length, 2);

const api = fs.readFileSync("pages/api/sales/shilla-miu-board.js", "utf8");
const page = fs.readFileSync("pages/sales/shilla-miu-board.js", "utf8");
const lib = fs.readFileSync("lib/shillaMiuBoard.js", "utf8");

// ── ERP 읽기 범위: 연도 + 대차수 prefix + 정확한 CustKey
assert.ok(
  api.includes("sm.OrderYear=@yr") && api.includes("LEFT(sm.OrderWeek,2) IN"),
);
assert.ok(
  api.includes("om.OrderYear=@yr") && api.includes("LEFT(om.OrderWeek,2) IN"),
  "예상물량(주문등록량)도 선택 연도와 대차수로 격리해야 한다.",
);
assert.ok(
  api.includes("sm.CustKey=@cust") &&
    api.includes("om.CustKey=@cust") &&
    !api.includes("CustName LIKE N'%신라%'"),
);
assert.ok(
  api.includes("ISNULL(sm.isDeleted,0)=0") &&
    api.includes("ISNULL(sd.OutQuantity,0)>0") &&
    api.includes("ISNULL(om.isDeleted,0)=0") &&
    api.includes("ISNULL(od.isDeleted,0)=0"),
);
assert.ok(
  api.includes("ISNULL(od.OutQuantity,CASE WHEN p.OutUnit"),
  "주문수량은 OutUnit 단일값을 쓰고 레거시 행만 환산으로 대체한다(합산 금지).",
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

// ── 웹 전용 저장 + 감사, ERP 원장 쓰기 금지
assert.ok(
  !api.match(
    /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+)?(?:dbo\.)?(?:Order|Shipment|Stock|Product|Estimate|WebProfitReport)/i,
  ),
  "조회/저장 API에 ERP 원장 쓰기가 없어야 한다.",
);
assert.ok(
  api.includes("FinalQty") && api.includes("ExpectedQtyAtSave"),
  "업체 최종분배는 기존 Qty를 덮어쓰지 않고 신규 컬럼에 저장해야 한다.",
);
assert.ok(
  !/UPDATE dbo\.WebShillaMiuBoardAllocation[\s\S]{0,200}\bSET\b[^;]*\bQty=/.test(
    api,
  ),
  "기존 이동입력 Qty 값은 보존해야 한다.",
);
assert.ok(
  api.includes("WebShillaMiuBoardAllocationHistory") &&
    api.includes("withActionLog"),
  "저장은 값 변경 이력과 SystemActionLog 감사를 남겨야 한다.",
);
assert.ok(
  /if \(req\.method === "POST"\) \{\s*await ensureSchema\(\);/.test(api),
  "DDL(ensureSchema)은 저장 경로에서만 실행해야 한다.",
);
assert.ok(
  !/req\.method !== "GET"[\s\S]*?ensureSchema\(\)/.test(
    api.slice(api.indexOf("async function handler")),
  ) && api.indexOf("ensureSchema()") < api.indexOf('req.method !== "GET"'),
  "GET 조회 중에는 스키마를 생성하지 않는다.",
);
assert.ok(
  api.includes("ledgerState") && api.includes("OBJECT_ID(N'dbo.WebShillaMiuBoard"),
  "웹 전용 테이블이 없으면 GET은 DDL 없이 빈 결과를 반환해야 한다.",
);
assert.ok(
  api.includes("0 이상의 수량만 저장"),
  "음수 최종분배는 저장을 거부해야 한다.",
);

// ── 화면 계약
assert.ok(
  page.includes("업체최종분배") &&
    page.includes("업체잔량") &&
    page.includes("미우이관") &&
    page.includes("예상물량") &&
    page.includes("현재분배"),
  "업체별 표는 예상물량→현재분배→최종분배→잔량→이관 흐름을 한 줄로 보여야 한다.",
);
assert.ok(
  !page.includes("확정분배"),
  "ERP 확정과 혼동되는 '확정분배' 명칭을 쓰지 않는다.",
);
assert.ok(
  page.includes("미우총수량") && page.includes("미우자체") && page.includes("잔량합계"),
  "전체 탭은 업체 잔량 합계·미우 자체수량·미우 총수량을 보여야 한다.",
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
  api.includes("(selected ? [selected] : active).map(async (group)") &&
    api.includes("boards"),
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
  page.includes("이전 이동입력"),
  "기존 저장값은 참고용으로 계속 보여야 한다.",
);

// ── 차수 스피너 화면 계약
assert.ok(
  page.includes("stepMajorWeek") &&
    page.includes('aria-label="차수 증가"') &&
    page.includes('aria-label="차수 감소"'),
  "차수 입력칸에 위/아래 클릭 버튼이 있어야 한다.",
);
assert.ok(
  page.includes('e.key === "ArrowUp"') && page.includes('e.key === "ArrowDown"'),
  "키보드 위/아래로 차수를 이동할 수 있어야 한다.",
);
assert.ok(
  /addEventListener\("wheel", onWheel, \{ passive: false \}\)/.test(page) &&
    page.includes("e.preventDefault()") &&
    page.includes("weekBoxRef"),
  "휠은 차수 입력칸에서만 처리하고 페이지 스크롤로 전파하지 않아야 한다.",
);
assert.ok(
  /stepWeek\(e\.deltaY < 0 \? 1 : -1\)/.test(page),
  "휠 위는 증가, 아래는 감소여야 한다.",
);
assert.ok(
  page.includes("load({ week: next })"),
  "차수 변경은 즉시 조회해야 한다.",
);
assert.ok(
  lib.includes("Math.min(52, Math.max(1,"),
  "차수는 1 미만/52 초과로 갈 수 없다.",
);

// ── 교차연도: 연도 파라미터가 모든 조회·저장에 전달된다.
assert.ok(
  api.includes("yr: { type: sql.NVarChar, value: year }") &&
    /OrderYear=@yr/.test(api),
  "2025/2026 동일 차수는 OrderYear로 격리해야 한다.",
);
assert.ok(
  page.includes("year=${data.year}") && page.includes("...(nextYear && { year: nextYear })"),
  "화면 선택 연도가 URL과 모든 조회 요청에 유지돼야 한다.",
);

// 조밀 표 계약: 품목명 열이 남은 폭을 전부 흡수하는 회귀를 막는다.
const cssValue = (selector, prop) => {
  const block = page.match(
    new RegExp(`${selector.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*\\{([^}]*)\\}`),
  );
  assert.ok(block, `${selector} 규칙이 있어야 한다.`);
  const found = block[1].match(new RegExp(`${prop}:\\s*(-?\\d+(?:\\.\\d+)?)px`));
  assert.ok(found, `${selector} 의 ${prop} 는 px 고정값이어야 한다.`);
  return Number(found[1]);
};
assert.ok(
  !/table\s*\{[^}]*width:\s*100%/.test(page),
  "표가 100% 폭을 채우려고 텍스트 열을 무제한 늘리면 안 된다.",
);
assert.ok(
  !/col\.product\s*\{[^}]*width:\s*auto/.test(page),
  "품목명 열은 auto 가 아닌 고정 폭이어야 한다.",
);
const productWidth = cssValue("col.product", "width");
assert.ok(
  productWidth >= 360 && productWidth <= 480,
  `품목명 열 폭은 360~480px 여야 한다. (현재 ${productWidth}px)`,
);
const unitWidth = cssValue("col.unit", "width");
assert.ok(
  unitWidth >= 40 && unitWidth <= 52,
  `단위 열 폭은 40~52px 여야 한다. (현재 ${unitWidth}px)`,
);
const numWidth = cssValue("col.num", "width");
assert.ok(
  numWidth >= 56 && numWidth <= 72,
  `수치 열 폭은 56~72px 여야 한다. (현재 ${numWidth}px)`,
);
const finalWidth = cssValue("col.final", "width");
assert.ok(
  finalWidth >= 56 && finalWidth <= 78,
  `최종분배 입력 열 폭은 56~78px 여야 한다. (현재 ${finalWidth}px)`,
);
const checkWidth = cssValue("col.check", "width");
const detailWidth = cssValue("col.detailBtn", "width");
for (const [label, width] of [
  ["완료", checkWidth],
  ["세부", detailWidth],
]) {
  assert.ok(
    width >= 40 && width <= 54,
    `${label} 열 폭은 40~54px 여야 한다. (현재 ${width}px)`,
  );
}
const cellBlock = page.match(/\bth,\s*\n\s*td\s*\{([^}]*)\}/);
assert.ok(cellBlock, "th, td 공통 규칙이 있어야 한다.");
const rowHeight = Number(cellBlock[1].match(/height:\s*(\d+)px/)?.[1]);
assert.ok(
  rowHeight >= 22 && rowHeight <= 25,
  `행 높이는 22~25px 여야 한다. (현재 ${rowHeight}px)`,
);
const cellPadding = Number(
  cellBlock[1].match(/padding:\s*\d+px\s+(\d+)px/)?.[1],
);
assert.ok(
  cellPadding >= 3 && cellPadding <= 5,
  `셀 좌우 여백은 3~5px 여야 한다. (현재 ${cellPadding}px)`,
);
// 업체별 표 9개 열: 품목 + 단위 + 수치4 + 최종분배 + 완료 + 세부
const boardWidth =
  productWidth + unitWidth + numWidth * 4 + finalWidth + checkWidth + detailWidth;
assert.ok(
  boardWidth >= 820 && boardWidth <= 920,
  `업체별 표 총 폭은 사용자가 확정한 875px 전후여야 한다. (현재 ${boardWidth}px)`,
);
assert.equal(
  cssValue(".groupbar", "min-width"),
  boardWidth,
  "그룹 머리띠 최소 폭은 표 총 폭과 같아야 가로 스크롤에서도 어긋나지 않는다.",
);
const groupColgroup = [...page.matchAll(/<colgroup>([\s\S]*?)<\/colgroup>/g)]
  .map((m) => m[1])
  .find((block) => block.includes('className="final"'));
assert.ok(groupColgroup, "업체별 표에 최종분배 열이 있어야 한다.");
assert.equal(
  (groupColgroup.match(/<col className="num" \/>/g) || []).length,
  4,
  "수치 4개 열은 num 클래스로 명시해 :not() 특이도 함정을 피한다.",
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
