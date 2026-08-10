// 통합게시판: CustKey 기반 실제 출고와 웹 전용 잔량이동을 결합하는 순수 로직

export function normalizeMajorWeek(value) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/(?:^|-)(\d{1,2})(?:-|$)/);
  if (!match) throw new Error(`차수 형식이 올바르지 않습니다: ${value}`);
  const major = Number(match[1]);
  if (!Number.isInteger(major) || major < 1 || major > 52)
    throw new Error(`차수 범위가 올바르지 않습니다: ${value}`);
  return String(major).padStart(2, "0");
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

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function buildGroupRows({
  weeks,
  baseShipments = [],
  receiverShipments = [],
  allocations = [],
}) {
  const wanted = new Set((weeks || []).map(normalizeMajorWeek));
  const rows = new Map();
  // 행은 반드시 기준 업체의 실제 양수 출고로만 생성한다.
  for (const s of baseShipments) {
    if (!s.prodKey || n(s.qty) <= 0 || !wanted.has(normalizeMajorWeek(s.week)))
      continue;
    const key = Number(s.prodKey);
    if (!rows.has(key))
      rows.set(key, {
        prodKey: key,
        country: s.country || "",
        prodName: s.prodName || "",
        unit: s.unit || "",
        weeks: {},
      });
    const row = rows.get(key);
    const week = normalizeMajorWeek(s.week);
    row.weeks[week] ||= {
      baseActual: 0,
      receiverActual: 0,
      subweeks: [],
      moveQty: 0,
      matched: false,
      memo: "",
    };
    row.weeks[week].baseActual += n(s.qty);
    if (
      s.orderWeek &&
      !row.weeks[week].subweeks.some((x) => x.orderWeek === s.orderWeek)
    )
      row.weeks[week].subweeks.push({
        orderWeek: s.orderWeek,
        baseActual: n(s.qty),
        receiverActual: 0,
      });
  }
  for (const s of receiverShipments) {
    const row = rows.get(Number(s.prodKey));
    if (!row) continue;
    const week = normalizeMajorWeek(s.week);
    if (!row.weeks[week]) continue;
    row.weeks[week].receiverActual += n(s.qty);
    const detail = row.weeks[week].subweeks.find(
      (x) => x.orderWeek === s.orderWeek,
    );
    if (detail) detail.receiverActual += n(s.qty);
  }
  for (const a of allocations) {
    const row = rows.get(Number(a.prodKey));
    if (!row) continue;
    const week = normalizeMajorWeek(a.useWeek);
    if (!row.weeks[week]) continue;
    row.weeks[week].moveQty += n(a.qty);
    row.weeks[week].matched ||= !!a.matched;
    row.weeks[week].memo ||= a.memo || "";
  }
  return [...rows.values()]
    .map((row) => {
      for (const week of wanted) {
        row.weeks[week] ||= {
          baseActual: 0,
          receiverActual: 0,
          subweeks: [],
          moveQty: 0,
          matched: false,
          memo: "",
        };
        const w = row.weeks[week];
        w.calculatedRemainder = Math.max(0, w.baseActual - w.receiverActual);
        w.difference = w.moveQty - w.calculatedRemainder;
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
