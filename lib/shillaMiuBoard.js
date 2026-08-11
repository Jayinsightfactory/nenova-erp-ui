// 잔량분배 게시판: 원천업체의 실제 주문/분배와 웹 전용 '업체 최종분배'를 결합하는 순수 로직
//
// 업무 흐름(ERP 확정상태 isFix 와 무관한 업무상 최종 수량):
//   1 예상물량(주문등록량) → 2 현재분배량 → 3 업체 최종분배(웹 입력)
//   → 4 업체 잔량 = 예상물량 - 업체 최종분배 → 5 미우 이관량 = max(0, 업체 잔량)
//   6 미우 자체수량 = 수령업체가 직접 주문·분배한 수량
//   7 기타 업체 잔량 합계 = 모든 원천 그룹 이관량 합계
//   8 미우 총수량 = 6 + 7
// 자세한 계약은 docs/RESIDUAL_FLOW_BOARD_SIDE_EFFECTS.md 를 따른다.

/**
 * 기준업체 연결 상태.
 * 게시판은 그룹의 BaseCustKey 로만 ERP 를 읽으므로, 연결이 잘못된 CustKey(전산에 실적이 전혀
 * 없는 껍데기 거래처)를 가리키면 모든 차수에서 조용히 빈 화면이 된다. 2026-08-11 운영 사고
 * (신라 그룹이 실적 0 인 '신라상사' CustKey 를 가리켜 33차 신라잔량이 전부 '-')의 재발 방지용.
 *   unlinked   : 선택 연도에 이 CustKey 의 주문·분배가 한 건도 없다 → 업체관리 연결 확인 필요
 *   emptyWeek  : 연결은 정상인데 이 차수에만 물량이 없다
 *   ok         : 표시할 품목이 있다
 */
export const GROUP_LINK = {
  OK: "ok",
  EMPTY_WEEK: "emptyWeek",
  UNLINKED: "unlinked",
};

export function groupLinkState({
  group = {},
  activity = null,
  rowCount = 0,
  year = "",
} = {}) {
  const baseName = group.baseCustName || group.groupName || "기준 업체";
  const baseKey = Number(group.baseCustKey) || 0;
  // 활동 정보를 못 받은 경우(구버전 응답)는 경고하지 않고 기존 문구를 유지한다.
  const known = activity !== null && activity !== undefined;
  const hasYearData = known
    ? Number(activity.orderQty || 0) > 0 || Number(activity.shipQty || 0) > 0
    : true;
  if (rowCount > 0)
    return { state: GROUP_LINK.OK, warn: !hasYearData, message: "" };
  if (!hasYearData)
    return {
      state: GROUP_LINK.UNLINKED,
      warn: true,
      message: `${baseName}(CustKey ${baseKey})는 ${year}년 주문·분배 실적이 없습니다. 업체관리에서 기준 Customer 연결을 확인하세요.`,
    };
  return {
    state: GROUP_LINK.EMPTY_WEEK,
    warn: false,
    message: "기준 업체 주문·분배 품목 없음",
  };
}

/** 업체관리 검색 결과 한 줄 요약 — 실적 없는 껍데기 거래처를 눈으로 걸러낸다. */
export function describeCustomerActivity(c = {}) {
  const last = [c.lastOrderYear && `주문 ${c.lastOrderYear}-${c.lastOrderWeek}`,
    c.lastShipYear && `분배 ${c.lastShipYear}-${c.lastShipWeek}`]
    .filter(Boolean)
    .join(" · ");
  return last || "전산 실적 없음";
}

export function normalizeMajorWeek(value) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/(?:^|-)(\d{1,2})(?:-|$)/);
  if (!match) throw new Error(`차수 형식이 올바르지 않습니다: ${value}`);
  const major = Number(match[1]);
  if (!Number.isInteger(major) || major < 1 || major > 52)
    throw new Error(`차수 범위가 올바르지 않습니다: ${value}`);
  return String(major).padStart(2, "0");
}

/** 차수 스피너(▲▼/키보드/휠) 공용 계산 — 1 미만과 52 초과를 막는다. */
export function stepMajorWeek(value, step) {
  const current = Number(String(value ?? "").match(/\d{1,2}/)?.[0] || 0);
  const base = Number.isInteger(current) && current >= 1 ? current : 1;
  const next = Math.min(52, Math.max(1, base + (Number(step) || 0)));
  return String(next).padStart(2, "0");
}

/** 한 번의 휠 동작(gesture)으로 인정하는 이벤트 간격. 이 안에 몰린 이벤트는 하나로 본다. */
export const WHEEL_GESTURE_MS = 200;

/**
 * 휠 burst 합치기 게이트.
 * 브라우저·트랙패드는 한 번 굴릴 때도 wheel 이벤트를 여러 번 보낸다.
 * 마지막 이벤트로부터 gapMs 안에 들어온 이벤트는 같은 gesture 로 보고 0(이동 없음)을 돌려주며,
 * gapMs 이상 쉰 뒤의 이벤트만 새 gesture 로 보고 ±1 을 돌려준다.
 * 세로 이동이 없는 이벤트(deltaY=0)는 이 입력칸이 처리하지 않는다(가로 스크롤 보존).
 */
export function createWheelGesture({ gapMs = WHEEL_GESTURE_MS } = {}) {
  let lastAt = null;
  return {
    read(now, deltaY) {
      const at = Number(now) || 0;
      const dy = Number(deltaY) || 0;
      if (!dy) return { handled: false, step: 0 };
      const isNewGesture = lastAt === null || at - lastAt >= gapMs;
      lastAt = at;
      // 휠 위(deltaY<0)는 증가, 아래(deltaY>0)는 감소. 같은 gesture 의 나머지 이벤트는 삼킨다.
      return { handled: true, step: isNewGesture ? (dy < 0 ? 1 : -1) : 0 };
    },
    reset() {
      lastAt = null;
    },
  };
}

/**
 * 조회 응답 한 건에서 표시값·URL·다음 요청 기준을 한 벌로 만든다.
 * 표시 차수와 URL 이 서로 다른 응답에서 나오는 것을 구조적으로 막는다.
 */
export function resolveBoardView(data = {}, fallback = {}) {
  const year = String(data.year ?? fallback.year ?? "");
  const week = String(
    data.weeks?.[0] || data.latest?.week || fallback.week || "",
  );
  const groupKey = Number(data.selectedGroup?.groupKey || 0);
  const query = `?year=${year}&week=${week}${groupKey ? `&groupKey=${groupKey}` : ""}`;
  return { year, week, groupKey, query };
}

export function buildMajorWeeks(start, end = start) {
  const first = Number(normalizeMajorWeek(start));
  const last = Number(normalizeMajorWeek(end));
  if (last < first)
    throw new Error("시작 차수가 종료 차수보다 클 수 없습니다.");
  if (last - first > 20)
    throw new Error("최대 21개 차수까지만 조회할 수 있습니다.");
  return Array.from({ length: last - first + 1 }, (_, i) =>
    String(first + i).padStart(2, "0"),
  );
}

export function allocationKey({ groupKey, useWeek, prodKey }) {
  return `${Number(groupKey) || 0}|${normalizeMajorWeek(useWeek)}|${Number(prodKey)}`;
}

/** 소수 꼬리를 0.001 수준으로 정규화한다. -0 도 0 으로 만든다. */
export function roundQty(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const rounded = Math.round(num * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const hasFinal = (v) => v !== null && v !== undefined && v !== "";

function emptyWeek() {
  return {
    expectedQty: 0, // 1 예상물량(주문등록량)
    currentQty: 0, // 2 현재분배량
    receiverActual: 0, // 수령업체(미우)가 같은 품목에 직접 분배한 수량
    receiverExpected: 0, // 수령업체 자체 주문등록량
    finalQty: null, // 3 업체 최종분배(웹 저장값, null=미입력)
    finalIsUserSet: false,
    legacyMoveQty: null, // 이전 정의의 '이동입력' 보존값(참고용)
    matched: false,
    memo: "",
    subweeks: [],
  };
}

function ensureRow(rows, source) {
  const key = Number(source.prodKey);
  if (!rows.has(key))
    rows.set(key, {
      prodKey: key,
      country: source.country || "",
      prodName: source.prodName || "",
      unit: source.unit || "",
      weeks: {},
    });
  const row = rows.get(key);
  if (!row.prodName && source.prodName) row.prodName = source.prodName;
  if (!row.unit && source.unit) row.unit = source.unit;
  if (!row.country && source.country) row.country = source.country;
  return row;
}

function ensureWeek(row, week) {
  row.weeks[week] ||= emptyWeek();
  return row.weeks[week];
}

function upsertSubweek(week, orderWeek, patch) {
  if (!orderWeek) return;
  let detail = week.subweeks.find((x) => x.orderWeek === orderWeek);
  if (!detail) {
    detail = {
      orderWeek,
      expectedQty: 0,
      currentQty: 0,
      receiverActual: 0,
    };
    week.subweeks.push(detail);
  }
  for (const [k, v] of Object.entries(patch)) detail[k] = roundQty(detail[k] + v);
}

/**
 * 한 원천업체 그룹의 품목 행을 만든다.
 * 행은 기준(원천)업체의 실제 주문 또는 실제 분배가 있는 품목만 만든다.
 * 수령업체만 있거나 웹 저장값만 있는 품목은 원천업체 행이 되지 않는다.
 */
export function buildGroupRows({
  weeks,
  baseOrders = [],
  baseShipments = [],
  receiverShipments = [],
  receiverOrders = [],
  allocations = [],
}) {
  const wanted = new Set((weeks || []).map(normalizeMajorWeek));
  const rows = new Map();

  for (const s of baseOrders) {
    if (!s.prodKey || n(s.qty) <= 0 || !wanted.has(normalizeMajorWeek(s.week)))
      continue;
    const week = ensureWeek(ensureRow(rows, s), normalizeMajorWeek(s.week));
    week.expectedQty = roundQty(week.expectedQty + n(s.qty));
    upsertSubweek(week, s.orderWeek, { expectedQty: n(s.qty) });
  }
  for (const s of baseShipments) {
    if (!s.prodKey || n(s.qty) <= 0 || !wanted.has(normalizeMajorWeek(s.week)))
      continue;
    const week = ensureWeek(ensureRow(rows, s), normalizeMajorWeek(s.week));
    week.currentQty = roundQty(week.currentQty + n(s.qty));
    upsertSubweek(week, s.orderWeek, { currentQty: n(s.qty) });
  }
  for (const s of receiverShipments) {
    const row = rows.get(Number(s.prodKey));
    if (!row) continue;
    const week = row.weeks[normalizeMajorWeek(s.week)];
    if (!week) continue;
    week.receiverActual = roundQty(week.receiverActual + n(s.qty));
    upsertSubweek(week, s.orderWeek, { receiverActual: n(s.qty) });
  }
  for (const s of receiverOrders) {
    const row = rows.get(Number(s.prodKey));
    if (!row) continue;
    const week = row.weeks[normalizeMajorWeek(s.week)];
    if (!week) continue;
    week.receiverExpected = roundQty(week.receiverExpected + n(s.qty));
  }
  for (const a of allocations) {
    const row = rows.get(Number(a.prodKey));
    if (!row) continue;
    const week = row.weeks[normalizeMajorWeek(a.useWeek)];
    if (!week) continue;
    if (hasFinal(a.finalQty)) {
      week.finalQty = roundQty(a.finalQty);
      week.finalIsUserSet = true;
    }
    // 이전 정의의 '이동입력'은 새 최종분배로 자동 변환하지 않고 참고값으로만 보존한다.
    // 새로 만든 행(Qty=0)이 과거 참고값을 덮어쓰지 않도록 양수만 표시한다.
    if (n(a.qty) > 0) week.legacyMoveQty = roundQty(a.qty);
    week.matched ||= !!a.matched;
    week.memo ||= a.memo || "";
  }

  return [...rows.values()]
    .map((row) => {
      for (const week of wanted) {
        const w = ensureWeek(row, week);
        // 미입력이면 현재분배를 임시 표시값으로 쓰되 사용자 입력과 구분한다.
        w.effectiveFinalQty = roundQty(
          w.finalIsUserSet ? w.finalQty : w.currentQty,
        );
        w.residualQty = roundQty(w.expectedQty - w.effectiveFinalQty);
        w.transferQty = Math.max(0, w.residualQty);
        w.isOverAllocated = w.residualQty < 0;
        w.expectedQty = roundQty(w.expectedQty);
        w.currentQty = roundQty(w.currentQty);
        w.receiverActual = roundQty(w.receiverActual);
        w.receiverExpected = roundQty(w.receiverExpected);
        w.subweeks.sort((a, b) => a.orderWeek.localeCompare(b.orderWeek));
      }
      return row;
    })
    .sort((a, b) =>
      `${a.country}${a.prodName}`.localeCompare(
        `${b.country}${b.prodName}`,
        "ko",
      ),
    );
}

/**
 * 전체 탭: 품목별로 모든 원천업체 잔량, 미우 자체수량, 미우 총수량을 한 행에 모은다.
 * 수령업체가 여러 개면 수령업체별 구획으로 나눈다(같은 미우로 모이면 구획 1개).
 * 같은 ProdKey 라도 단위 문자열이 다르면 합산하지 않고 행을 분리한다.
 */
export function buildOverviewSections({ week, boards = [], receiverSelf = [] }) {
  const target = normalizeMajorWeek(week);
  const sections = new Map();

  const sectionOf = (group) => {
    const key = Number(group.receiverCustKey) || 0;
    if (!sections.has(key))
      sections.set(key, {
        receiverCustKey: key,
        receiverCustName: group.receiverCustName || "",
        groups: [],
        rows: new Map(),
      });
    const section = sections.get(key);
    if (!section.groups.some((g) => g.groupKey === group.groupKey))
      section.groups.push({
        groupKey: group.groupKey,
        groupName: group.groupName,
        baseCustKey: group.baseCustKey,
        baseCustName: group.baseCustName,
      });
    return section;
  };

  const rowOf = (section, { prodKey, prodName, unit, country }) => {
    const key = `${Number(prodKey)}|${unit || ""}`;
    if (!section.rows.has(key))
      section.rows.set(key, {
        rowKey: key,
        prodKey: Number(prodKey),
        prodName: prodName || "",
        unit: unit || "",
        country: country || "",
        byGroup: {},
        residualTotal: 0,
        receiverSelfQty: 0,
        receiverSelfExpected: 0,
        receiverTotal: 0,
      });
    return section.rows.get(key);
  };

  for (const board of boards) {
    const group = board?.group;
    if (!group) continue;
    const section = sectionOf(group);
    for (const row of board.rows || []) {
      const w = row.weeks?.[target];
      if (!w) continue;
      const overviewRow = rowOf(section, row);
      overviewRow.byGroup[group.groupKey] = {
        expectedQty: w.expectedQty,
        currentQty: w.currentQty,
        finalQty: w.effectiveFinalQty,
        finalIsUserSet: w.finalIsUserSet,
        residualQty: w.residualQty,
        transferQty: w.transferQty,
      };
      overviewRow.residualTotal = roundQty(
        overviewRow.residualTotal + w.transferQty,
      );
    }
  }

  // 수령업체가 직접 주문·분배한 수량은 원천업체 행이 없어도 전체 탭에 보여야 한다.
  for (const self of receiverSelf) {
    const section = sections.get(Number(self.receiverCustKey));
    if (!section) continue;
    const row = rowOf(section, self);
    row.receiverSelfQty = roundQty(row.receiverSelfQty + n(self.qty));
    row.receiverSelfExpected = roundQty(
      row.receiverSelfExpected + n(self.expectedQty),
    );
  }

  return [...sections.values()].map((section) => ({
    receiverCustKey: section.receiverCustKey,
    receiverCustName: section.receiverCustName,
    groups: section.groups,
    rows: [...section.rows.values()]
      .map((row) => ({
        ...row,
        receiverTotal: roundQty(row.receiverSelfQty + row.residualTotal),
      }))
      .sort((a, b) =>
        `${a.country}${a.prodName}`.localeCompare(
          `${b.country}${b.prodName}`,
          "ko",
        ),
      ),
  }));
}
