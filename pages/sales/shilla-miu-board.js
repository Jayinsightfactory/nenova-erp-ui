// 잔량분배 게시판 — 예상물량 → 현재분배 → 업체 최종분배 → 업체 잔량 → 미우 이관 흐름
// '업체 최종분배'는 전산(nenova.exe)의 확정(isFix) 상태가 아니라 업무상 최종 납품·사용 수량이다.
// 화면 계약: 전체 탭과 업체 탭은 같은 열 순서·폭의 단일 표 하나만 쓴다(중복 상세표 금지).
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost } from "../../lib/useApi";
import {
  buildUnifiedBlocks,
  createWheelGesture,
  describeCustomerActivity,
  groupLinkState,
  resolveBoardView,
  roundQty,
  stepMajorWeek,
} from "../../lib/shillaMiuBoard";

const fmt = (v) =>
  Number(v || 0).toLocaleString("ko-KR", { maximumFractionDigits: 3 });
const draftKey = (groupKey, prodKey) => `${groupKey}|${prodKey}`;
const blank = (v) => v === "" || v === null || v === undefined;

export default function Board() {
  const initial = useMemo(
    () =>
      typeof window === "undefined"
        ? {}
        : Object.fromEntries(new URLSearchParams(location.search)),
    [],
  );
  const [year, setYear] = useState(initial.year || ""),
    [week, setWeek] = useState(initial.week || "");
  const [groupKey, setGroupKey] = useState(Number(initial.groupKey || 0));
  const [groups, setGroups] = useState([]),
    [boards, setBoards] = useState([]),
    [overview, setOverview] = useState([]),
    [rows, setRows] = useState([]);
  const [drafts, setDrafts] = useState({}),
    [open, setOpen] = useState({}),
    [collapsed, setCollapsed] = useState({});
  const [search, setSearch] = useState(""),
    [unfinished, setUnfinished] = useState(false),
    [hideZero, setHideZero] = useState(true),
    [showTotal, setShowTotal] = useState(true);
  const [loading, setLoading] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [admin, setAdmin] = useState(false),
    [manage, setManage] = useState(false),
    [customers, setCustomers] = useState([]),
    [customerQ, setCustomerQ] = useState("");
  const emptyForm = {
    groupKey: 0,
    groupName: "",
    baseCustKey: "",
    receiverCustKey: "",
    displayOrder: 0,
    isActive: true,
  };
  const [form, setForm] = useState(emptyForm);
  const weekBoxRef = useRef(null);
  const stateRef = useRef({ year, week, groupKey });
  stateRef.current = { year, week, groupKey };
  // 차수는 렌더를 기다리지 않는 ref 를 진실로 삼는다. 휠·키보드가 연달아 들어와도
  // 아직 반영되지 않은 이전 렌더값(stale closure)을 기준으로 계산하지 않게 한다.
  const weekRef = useRef(initial.week || "");
  const applyWeek = (value) => {
    weekRef.current = value;
    setWeek(value);
  };
  // 조회 요청 일련번호. 늦게 도착한 이전 응답이 지금 화면·URL 을 덮어쓰지 못하게 한다.
  const reqRef = useRef(0);

  const load = async (over = {}) => {
    const seq = ++reqRef.current;
    setLoading(true);
    setError("");
    const base = stateRef.current;
    const nextGroup = Object.prototype.hasOwnProperty.call(over, "groupKey")
      ? Number(over.groupKey)
      : base.groupKey;
    const nextWeek = over.week ?? weekRef.current;
    const nextYear = over.year ?? base.year;
    try {
      const data = await apiGet("/api/sales/shilla-miu-board", {
        ...(nextYear && { year: nextYear }),
        ...(nextWeek && { startWeek: nextWeek, endWeek: nextWeek }),
        ...(nextGroup && { groupKey: nextGroup }),
      });
      if (seq !== reqRef.current) return; // 최신 요청이 아니면 화면을 건드리지 않는다.
      // 표시 연도·차수·그룹과 URL 은 같은 응답 한 벌에서만 만든다.
      const view = resolveBoardView(data, { year: nextYear, week: nextWeek });
      setYear(view.year);
      applyWeek(view.week);
      setGroups(data.groups || []);
      setBoards(data.boards || []);
      setOverview(data.overview || []);
      setRows(data.rows || []);
      setAdmin(!!data.isAdmin);
      setGroupKey(view.groupKey);
      setDrafts({});
      history.replaceState(null, "", view.query);
    } catch (e) {
      if (seq !== reqRef.current) return;
      setError(e.message);
    } finally {
      if (seq === reqRef.current) setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 차수 스피너: ▲▼ 클릭 · 키보드 위/아래 · 입력칸 위에서의 휠. 1 미만으로 내려가지 않고 즉시 조회한다.
  // 기준값은 항상 weekRef(가장 최근 의도값)이며, 표시값·URL·조회요청이 한 번에 같은 차수로 간다.
  const stepWeek = (delta) => {
    const current = weekRef.current || "01";
    const next = stepMajorWeek(current, delta);
    if (next === current) return; // 1 미만/52 초과에서는 재조회하지 않는다.
    applyWeek(next);
    load({ week: next });
  };
  useEffect(() => {
    const el = weekBoxRef.current;
    if (!el) return;
    // 휠은 이 입력칸에서만 처리하고 페이지 스크롤로 전파하지 않는다.
    // 한 번 굴릴 때 쏟아지는 wheel 이벤트 burst 는 gesture 하나로 합쳐 정확히 1차만 이동한다.
    const gesture = createWheelGesture();
    const onWheel = (e) => {
      const { handled, step } = gesture.read(e.timeStamp, e.deltaY);
      if (!handled) return; // 세로 이동이 없는 휠은 이 입력칸이 가로채지 않는다.
      e.preventDefault();
      e.stopPropagation();
      if (step) stepWeek(step);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeGroups = groups.filter((g) => g.isActive);
  const selected = activeGroups.find((g) => g.groupKey === groupKey);
  const displayedBoards = (
    groupKey ? [{ group: selected, rows }] : boards
  ).filter((b) => b.group);
  // 전체 탭과 업체 탭이 같은 열 구성의 표 하나만 쓰도록 행 묶음을 한 곳에서 만든다.
  // 전체에서는 같은 품목이라도 업체별 행을 각각 유지하고, 미우 자체수량·총수량은
  // 같은 폭의 작은 합계 행으로만 보존한다(아래에 상세표를 다시 나열하지 않는다).
  const blocks = useMemo(() => {
    try {
      return buildUnifiedBlocks({
        week,
        boards: displayedBoards,
        overview: groupKey ? [] : overview,
      });
    } catch {
      return []; // 차수 입력 중(빈 값 등)에는 표를 비운다.
    }
  }, [week, groupKey, boards, rows, overview, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const draftOf = (g, r) => drafts[draftKey(g.groupKey, r.prodKey)];
  // 미입력이면 빈칸으로 두고 현재분배를 임시값(placeholder)으로 안내한다.
  const finalInput = (g, r, w) => {
    const d = draftOf(g, r);
    if (d && "finalQty" in d) return d.finalQty;
    return w.finalIsUserSet ? String(w.finalQty) : "";
  };
  const matched = (g, r, w) => draftOf(g, r)?.matched ?? w.matched;
  const flow = (g, r, w) => {
    const raw = finalInput(g, r, w);
    const finalQty = blank(raw) ? w.currentQty : roundQty(Number(raw) || 0);
    const residualQty = roundQty(w.expectedQty - finalQty);
    return {
      finalQty,
      residualQty,
      transferQty: Math.max(0, residualQty),
      userSet: !blank(raw),
    };
  };
  const change = (g, r, w, patch) =>
    setDrafts((d) => {
      const key = draftKey(g.groupKey, r.prodKey);
      return {
        ...d,
        [key]: {
          finalQty: finalInput(g, r, w),
          matched: matched(g, r, w),
          memo: w.memo || "",
          ...d[key],
          ...patch,
        },
      };
    });

  // 표시 필터는 업체 행 단위로만 건다. 접힌 업체는 표에서 빠지되 다른 업체 행은 그대로 남는다.
  const q = search.trim().toLowerCase();
  const visibleItem = (it) =>
    !collapsed[it.group.groupKey] &&
    (!unfinished || !matched(it.group, it.row, it.week)) &&
    (!hideZero ||
      it.week.expectedQty ||
      it.week.currentQty ||
      it.week.finalIsUserSet);
  const shownBlocks = blocks
    .filter((b) => !q || b.prodName.toLowerCase().includes(q))
    .map((b) => ({ ...b, items: b.items.filter(visibleItem) }))
    .filter(
      (b) =>
        b.items.length ||
        (!unfinished &&
          b.receiver &&
          (b.receiver.selfQty || b.receiver.selfExpected)),
    );
  // 잔량합계·미우총수량은 저장값이 아니라 지금 입력 중인 값으로 즉시 다시 계산한다.
  const liveOf = (b) => {
    const residual = b.items.reduce(
      (s, it) => roundQty(s + flow(it.group, it.row, it.week).transferQty),
      0,
    );
    const self = b.receiver?.selfQty || 0;
    return { residual, self, total: roundQty(self + residual) };
  };
  const hasSumRow = (b, live) =>
    showTotal &&
    !!b.receiver &&
    !!(live.self || b.receiver.selfExpected || live.residual);
  const totals = shownBlocks.reduce(
    (a, b) => {
      for (const it of b.items) {
        const f = flow(it.group, it.row, it.week);
        a.expected = roundQty(a.expected + it.week.expectedQty);
        a.current = roundQty(a.current + it.week.currentQty);
        a.final = roundQty(a.final + f.finalQty);
        a.transfer = roundQty(a.transfer + f.transferQty);
        a.lines += 1;
        a.done += matched(it.group, it.row, it.week) ? 1 : 0;
      }
      const live = liveOf(b);
      a.self = roundQty(a.self + live.self);
      a.total = roundQty(a.total + live.total);
      return a;
    },
    {
      expected: 0,
      current: 0,
      final: 0,
      transfer: 0,
      self: 0,
      total: 0,
      lines: 0,
      done: 0,
    },
  );
  // 업체별 표시 행 수 — '이 차수만 없음'과 'CustKey 연결 오류'를 구분해 안내하는 데만 쓴다.
  const shownByGroup = {};
  shownBlocks.forEach((b) =>
    b.items.forEach((it) => {
      shownByGroup[it.group.groupKey] = (shownByGroup[it.group.groupKey] || 0) + 1;
    }),
  );
  const notices = displayedBoards
    .filter(({ group }) => !collapsed[group.groupKey])
    .map(({ group }) => ({
      group,
      link: groupLinkState({
        group,
        activity: group.baseActivity ?? null,
        rowCount: shownByGroup[group.groupKey] || 0,
        year,
      }),
    }))
    .filter(({ link }) => link.message);

  const save = async () => {
    const byGroup = {};
    Object.entries(drafts).forEach(([key, data]) => {
      const [g, prodKey] = key.split("|");
      (byGroup[g] ||= []).push({
        prodKey: Number(prodKey),
        useWeek: week,
        finalQty: blank(data.finalQty) ? null : data.finalQty,
        matched: !!data.matched,
        memo: data.memo || "",
      });
    });
    if (!Object.keys(byGroup).length)
      return setMessage("변경된 값이 없습니다.");
    try {
      for (const [g, allocations] of Object.entries(byGroup))
        await apiPost("/api/sales/shilla-miu-board", {
          year,
          groupKey: Number(g),
          allocations,
        });
      setMessage(
        `${Object.keys(drafts).length}건의 업체 최종분배를 웹 게시판에 저장했습니다.`,
      );
      await load();
    } catch (e) {
      setError(e.message);
    }
  };
  const findCustomers = async () => {
    try {
      const d = await apiGet("/api/sales/shilla-miu-board", {
        mode: "customers",
        q: customerQ,
      });
      setCustomers(d.customers || []);
    } catch (e) {
      setError(e.message);
    }
  };
  // 기존 그룹 수정: 현재 연결된 두 Customer 를 선택지에 넣어 두어야 select 가 비지 않는다.
  const editGroup = (g) => {
    setForm({
      groupKey: g.groupKey,
      groupName: g.groupName || "",
      baseCustKey: String(g.baseCustKey || ""),
      receiverCustKey: String(g.receiverCustKey || ""),
      displayOrder: g.displayOrder || 0,
      isActive: !!g.isActive,
    });
    setCustomers((list) => {
      const merged = [...list];
      for (const [custKey, custName] of [
        [g.baseCustKey, g.baseCustName],
        [g.receiverCustKey, g.receiverCustName],
      ])
        if (!merged.some((c) => Number(c.custKey) === Number(custKey)))
          merged.unshift({ custKey: Number(custKey), custName });
      return merged;
    });
  };
  const saveGroup = async () => {
    try {
      await apiPost("/api/sales/shilla-miu-board", {
        action: "save-group",
        ...form,
        groupKey: Number(form.groupKey || 0),
        baseCustKey: Number(form.baseCustKey),
        receiverCustKey: Number(form.receiverCustKey),
        displayOrder: Number(form.displayOrder),
      });
      setManage(false);
      setForm(emptyForm);
      await load({ groupKey: 0 });
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="page">
      <div className="toolbar">
        <strong>잔량분배</strong>
        <button
          className={!groupKey ? "active" : ""}
          onClick={() => load({ groupKey: 0 })}
        >
          전체
        </button>
        {activeGroups.map((g) => (
          <button
            key={g.groupKey}
            className={g.groupKey === groupKey ? "active" : ""}
            title={`${g.baseCustName} → ${g.receiverCustName}`}
            onClick={() => load({ groupKey: g.groupKey })}
          >
            {g.groupName}
          </button>
        ))}
        <i />
        <label>
          연도{" "}
          <input
            value={year}
            onChange={(e) => setYear(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
          />
        </label>
        <span className="weekbox" ref={weekBoxRef} title="위/아래 키, 휠, ▲▼ 로 1차씩 이동합니다.">
          대차수
          <input
            className="weekInput"
            value={week}
            onChange={(e) => applyWeek(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") {
                e.preventDefault();
                stepWeek(1);
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                stepWeek(-1);
              } else if (e.key === "Enter") load();
            }}
          />
          <span className="spin">
            <button type="button" aria-label="차수 증가" onClick={() => stepWeek(1)}>
              ▲
            </button>
            <button type="button" aria-label="차수 감소" onClick={() => stepWeek(-1)}>
              ▼
            </button>
          </span>
        </span>
        <input
          className="search"
          placeholder="품목명 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={hideZero}
            onChange={(e) => setHideZero(e.target.checked)}
          />
          0 제외
        </label>
        <label>
          <input
            type="checkbox"
            checked={unfinished}
            onChange={(e) => setUnfinished(e.target.checked)}
          />
          미완료
        </label>
        <label title="품목마다 미우 자체수량 + 업체 잔량합계 = 미우 총수량 합계 행을 표시합니다.">
          <input
            type="checkbox"
            checked={showTotal}
            onChange={(e) => setShowTotal(e.target.checked)}
          />
          미우합계
        </label>
        <button onClick={() => load()}>{loading ? "조회…" : "조회"}</button>
        <button className="save" onClick={save}>
          저장
          {Object.keys(drafts).length ? ` ${Object.keys(drafts).length}` : ""}
        </button>
        {admin && <button onClick={() => setManage(true)}>업체관리</button>}
      </div>
      <div className="hint">
        예상물량 − 업체 최종분배 = 업체 잔량 → 미우 이관 · 미우 총수량 = 미우
        자체수량 + 업체 잔량 합계 / 최종분배는 업무상 최종 수량이며 전산 확정상태가
        아닙니다. ERP 원장은 변경하지 않습니다.
      </div>
      {message && <div className="msg ok">{message}</div>}
      {error && <div className="msg err">{error}</div>}
      <div className="scroll">
        <div className={groupKey ? "groupbar" : "groupbar overviewbar"}>
          <b title={groupKey ? selected?.baseCustName : "모든 업체를 한 표에서 봅니다."}>
            {groupKey ? selected?.groupName : "전체"}
          </b>
          <span>
            {groupKey ? (
              <span
                title={`${selected?.baseCustName}(CustKey ${selected?.baseCustKey}) → ${selected?.receiverCustName}(CustKey ${selected?.receiverCustKey})`}
              >
                {selected?.baseCustName} → {selected?.receiverCustName}
              </span>
            ) : (
              <span className="chips">
                {activeGroups.map((g) => (
                  <button
                    key={g.groupKey}
                    className={collapsed[g.groupKey] ? "off" : ""}
                    title={`${g.baseCustName} → ${g.receiverCustName} · 클릭하면 이 업체 행을 접습니다.`}
                    onClick={() =>
                      setCollapsed((c) => ({
                        ...c,
                        [g.groupKey]: !c[g.groupKey],
                      }))
                    }
                  >
                    {collapsed[g.groupKey] ? "▶" : "▼"}
                    {g.groupName}
                  </button>
                ))}
              </span>
            )}
          </span>
          <em>행 {totals.lines}</em>
          <span>예상 {fmt(totals.expected)}</span>
          <span>현재 {fmt(totals.current)}</span>
          <span>최종 {fmt(totals.final)}</span>
          <span title="업체 잔량합계 = 미우 이관 합계">
            잔량합계 {fmt(totals.transfer)}
          </span>
          {!groupKey && (
            <>
              <span title="수령업체가 직접 주문·분배한 수량">
                미우자체 {fmt(totals.self)}
              </span>
              <span title="미우총수량 = 미우자체 + 업체 잔량합계">
                미우총수량 {fmt(totals.total)}
              </span>
            </>
          )}
          <span>
            완료 {totals.done}/{totals.lines}
          </span>
        </div>
        {notices.map(({ group, link }) => (
          <div
            key={group.groupKey}
            className={link.warn ? "notice unlinked" : "notice"}
            title={`${group.baseCustName}(CustKey ${group.baseCustKey}) → ${group.receiverCustName}(CustKey ${group.receiverCustKey})`}
          >
            {link.warn && <b className="warn">⚠ 연결확인</b>}
            {group.groupName} — {link.message}
          </div>
        ))}
        <table>
          <colgroup>
            <col className="owner" />
            <col className="product" />
            <col className="unit" />
            <col className="num" />
            <col className="num" />
            <col className="final" />
            <col className="num" />
            <col className="num" />
            <col className="check" />
            <col className="detailBtn" />
          </colgroup>
          <thead>
            <tr>
              <th title="원천 업체(업체관리에서 추가한 업체도 자동으로 나옵니다)">
                업체
              </th>
              <th>품목명</th>
              <th>단위</th>
              <th title="주문등록량">예상물량</th>
              <th title="현재 ERP에 입력된 해당 업체 분배량">현재분배</th>
              <th title="업무상 최종 납품·사용 수량 (웹 전용 저장값)">
                업체최종분배
              </th>
              <th title="예상물량 − 업체 최종분배">업체잔량</th>
              <th title="미우로 이관되는 물량">미우이관</th>
              <th>완료</th>
              <th>세부</th>
            </tr>
          </thead>
          <tbody>
            {!shownBlocks.length && (
              <tr>
                <td colSpan="10" className="empty">
                  해당 차수의 품목이 없습니다.
                </td>
              </tr>
            )}
            {shownBlocks.map((b) => {
              const live = liveOf(b);
              return (
                <Fragment key={b.blockKey}>
                  {b.items.map((it, i) => {
                    const group = it.group,
                      r = it.row,
                      w = it.week,
                      f = flow(group, r, w),
                      key = draftKey(group.groupKey, r.prodKey);
                    return (
                      <Fragment key={key}>
                        <tr className={i ? "" : "blockTop"}>
                          <td
                            className="ownerCell"
                            title={`${group.groupName} · ${group.baseCustName}(CustKey ${group.baseCustKey}) → ${group.receiverCustName}`}
                          >
                            {group.groupName}
                          </td>
                          <td
                            className={i ? "productCell dim" : "productCell"}
                            title={`${group.groupName} · ${r.prodName} · ProdKey ${r.prodKey}${w.legacyMoveQty != null ? ` · 이전 이동입력 ${fmt(w.legacyMoveQty)}` : ""}`}
                          >
                            {r.prodName}
                          </td>
                          <td>{r.unit}</td>
                          <td className={w.expectedQty ? "erp" : ""}>
                            {fmt(w.expectedQty)}
                          </td>
                          <td className={w.currentQty ? "erp" : ""}>
                            {fmt(w.currentQty)}
                          </td>
                          <td className={f.userSet ? "web" : ""}>
                            <input
                              className="qty"
                              type="number"
                              min="0"
                              step="any"
                              placeholder={fmt(w.currentQty)}
                              title={
                                f.userSet
                                  ? "저장된 업체 최종분배"
                                  : "미입력 — 현재분배를 임시로 사용합니다."
                              }
                              value={finalInput(group, r, w)}
                              onChange={(e) =>
                                change(group, r, w, {
                                  finalQty: e.target.value,
                                })
                              }
                            />
                          </td>
                          <td
                            className={
                              f.residualQty < 0
                                ? "over"
                                : f.residualQty > 0
                                  ? "calc"
                                  : "done"
                            }
                            title={
                              f.residualQty < 0
                                ? "최종분배가 예상물량을 초과했습니다."
                                : "예상물량 − 업체 최종분배"
                            }
                          >
                            {f.residualQty < 0
                              ? `초과 ${fmt(-f.residualQty)}`
                              : fmt(f.residualQty)}
                          </td>
                          <td className={f.transferQty ? "move" : ""}>
                            {fmt(f.transferQty)}
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              checked={matched(group, r, w)}
                              onChange={(e) =>
                                change(group, r, w, {
                                  matched: e.target.checked,
                                })
                              }
                            />
                          </td>
                          <td>
                            <button
                              onClick={() =>
                                setOpen((o) => ({ ...o, [key]: !o[key] }))
                              }
                            >
                              {open[key] ? "−" : "+"}
                            </button>
                          </td>
                        </tr>
                        {open[key] && (
                          <tr>
                            <td colSpan="10" className="subweeks">
                              {w.subweeks.map((s) => (
                                <span key={s.orderWeek}>
                                  {s.orderWeek} 예상 {fmt(s.expectedQty)} / 현재{" "}
                                  {fmt(s.currentQty)} / 미우{" "}
                                  {fmt(s.receiverActual)}
                                </span>
                              ))}
                              <span>미우자체분배 {fmt(w.receiverActual)}</span>
                              {w.legacyMoveQty != null && (
                                <span className="legacy">
                                  이전 이동입력 {fmt(w.legacyMoveQty)}
                                </span>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {/* 같은 열 폭을 쓰는 작은 합계 행 — 미우 자체수량과 미우 총수량을 잃지 않는다. */}
                  {hasSumRow(b, live) && (
                    <tr className={b.items.length ? "sumRow" : "sumRow blockTop"}>
                      <td
                        className="ownerCell sumCell"
                        title={`${b.receiverCustName} 자체수량 + 업체 잔량합계`}
                      >
                        미우합계
                      </td>
                      <td
                        className="productCell sumCell"
                        title={`${b.prodName} · 미우자체 ${fmt(live.self)} + 업체잔량합계 ${fmt(live.residual)} = 미우총수량 ${fmt(live.total)}`}
                      >
                        {b.items.length
                          ? "↳ 미우자체 + 업체잔량합계 = 미우총수량"
                          : `${b.prodName} · 미우 자체수량만`}
                      </td>
                      <td className="sumCell">{b.unit}</td>
                      <td
                        className={b.receiver.selfExpected ? "erp" : "sumCell"}
                        title="미우 자체 주문등록량"
                      >
                        {fmt(b.receiver.selfExpected)}
                      </td>
                      <td
                        className={live.self ? "erp" : "sumCell"}
                        title="미우자체 — 수령업체가 직접 분배한 수량"
                      >
                        {fmt(live.self)}
                      </td>
                      <td className="sumCell na">—</td>
                      <td
                        className={live.residual ? "calc" : "sumCell"}
                        title="업체 잔량합계 = 모든 업체의 미우 이관 합계"
                      >
                        {fmt(live.residual)}
                      </td>
                      <td
                        className={live.total ? "web" : "sumCell"}
                        title="미우총수량 = 미우자체 + 업체 잔량합계"
                      >
                        {fmt(live.total)}
                      </td>
                      <td className="sumCell na">—</td>
                      <td className="sumCell na">—</td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {manage && (
        <div className="modal">
          <div>
            <h2>업체 구성</h2>
            {/* 기존 그룹을 골라 기준 CustKey 를 고칠 수 있어야 한다.
                (2026-08-11: 신라 그룹이 실적 0 인 CustKey 에 묶여도 화면에서 되돌릴 방법이 없었다.) */}
            <ul className="grouplist">
              {groups.map((g) => (
                <li key={g.groupKey} className={form.groupKey === g.groupKey ? "on" : ""}>
                  <button onClick={() => editGroup(g)}>수정</button>
                  <span>
                    {g.groupName} · {g.baseCustName}({g.baseCustKey}) →{" "}
                    {g.receiverCustName}({g.receiverCustKey})
                    {g.isActive ? "" : " · 비활성"}
                  </span>
                  <em className={g.baseActivity && !(g.baseActivity.orderQty || g.baseActivity.shipQty) ? "warn" : ""}>
                    {g.baseActivity
                      ? g.baseActivity.orderQty || g.baseActivity.shipQty
                        ? `${year} 주문 ${fmt(g.baseActivity.orderQty)} / 분배 ${fmt(g.baseActivity.shipQty)}`
                        : `${year} 실적 없음 — 연결 확인`
                      : ""}
                  </em>
                </li>
              ))}
            </ul>
            <div>
              <input
                placeholder="Customer 검색"
                value={customerQ}
                onChange={(e) => setCustomerQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && findCustomers()}
              />
              <button onClick={findCustomers}>검색</button>
              <button onClick={() => setForm(emptyForm)}>새 그룹</button>
              <span className="editing">
                {form.groupKey ? `그룹 #${form.groupKey} 수정 중` : "새 그룹 등록"}
              </span>
            </div>
            <label>
              그룹명{" "}
              <input
                value={form.groupName}
                onChange={(e) =>
                  setForm({ ...form, groupName: e.target.value })
                }
              />
            </label>
            <label>
              기준 Customer{" "}
              <select
                value={form.baseCustKey}
                onChange={(e) =>
                  setForm({ ...form, baseCustKey: e.target.value })
                }
              >
                <option value="">선택</option>
                {customers.map((c) => (
                  <option key={c.custKey} value={c.custKey}>
                    {c.custName} ({c.custKey}) — {describeCustomerActivity(c)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              잔량 수령 Customer{" "}
              <select
                value={form.receiverCustKey}
                onChange={(e) =>
                  setForm({ ...form, receiverCustKey: e.target.value })
                }
              >
                <option value="">선택</option>
                {customers.map((c) => (
                  <option key={c.custKey} value={c.custKey}>
                    {c.custName} ({c.custKey}) — {describeCustomerActivity(c)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              표시순서{" "}
              <input
                type="number"
                value={form.displayOrder}
                onChange={(e) =>
                  setForm({ ...form, displayOrder: e.target.value })
                }
              />
            </label>
            <label>
              활성{" "}
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) =>
                  setForm({ ...form, isActive: e.target.checked })
                }
              />
            </label>
            <button className="save" onClick={saveGroup}>
              저장
            </button>
            <button onClick={() => setManage(false)}>닫기</button>
          </div>
        </div>
      )}
      <style jsx>{`
        .page {
          color: #172033;
          font-size: 11px;
        }
        .toolbar {
          display: flex;
          align-items: center;
          gap: 3px;
          min-height: 30px;
          white-space: nowrap;
        }
        .toolbar strong {
          font-size: 15px;
          margin-right: 3px;
        }
        .toolbar i {
          flex: 1;
        }
        .toolbar label,
        .weekbox {
          display: flex;
          align-items: center;
          gap: 2px;
        }
        .toolbar input {
          width: 46px;
        }
        .weekInput {
          width: 34px;
          text-align: right;
        }
        .spin {
          display: flex;
          flex-direction: column;
        }
        .spin button {
          width: 15px;
          height: 12px;
          padding: 0;
          font-size: 7px;
          line-height: 1;
        }
        .toolbar .search {
          width: 145px;
        }
        .toolbar input[type="checkbox"] {
          width: 13px;
          height: 13px;
        }
        .toolbar button {
          padding: 0 6px;
          height: 24px;
        }
        .groupbar button,
        td button {
          padding: 0 4px;
          height: 18px;
          line-height: 1;
        }
        .active,
        .save {
          background: #1d4ed8 !important;
          color: #fff;
        }
        .hint {
          height: 19px;
          line-height: 19px;
          color: #64748b;
          border-bottom: 1px solid #cbd5e1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .msg {
          padding: 3px 6px;
        }
        .ok {
          background: #f0fdf4;
        }
        .err {
          background: #fef2f2;
          color: #b91c1c;
        }
        .scroll {
          max-height: calc(100vh - 111px);
          overflow: auto;
        }
        section {
          margin-top: 2px;
        }
        .groupbar {
          position: sticky;
          top: 0;
          z-index: 4;
          display: flex;
          align-items: center;
          gap: 10px;
          height: 22px;
          /* 표 총 폭(78+360+46+64*4+66+44+44)과 맞춰 가로 스크롤 시에도 머리띠가 표를 덮는다. */
          min-width: 894px;
          padding: 0 4px;
          background: #334155;
          color: #fff;
        }
        .overviewbar {
          background: #1e293b;
        }
        .chips {
          display: inline-flex;
          gap: 3px;
          overflow: hidden;
        }
        .chips button {
          padding: 0 4px;
          height: 17px;
          font-size: 10px;
          line-height: 1;
        }
        .chips button.off {
          opacity: 0.5;
        }
        .notice {
          min-width: 894px;
          height: 18px;
          line-height: 18px;
          padding: 0 6px;
          background: #f1f5f9;
          color: #475569;
        }
        .notice.unlinked {
          background: #fef3c7;
          color: #92400e;
          font-weight: 700;
        }
        .notice .warn {
          margin-right: 6px;
          padding: 0 3px;
          background: #fbbf24;
          color: #7c2d12;
        }
        .groupbar b {
          font-size: 12px;
          max-width: 110px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .groupbar span {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .groupbar span:first-of-type {
          flex: 1;
        }
        .groupbar em {
          font-style: normal;
          color: #bfdbfe;
        }
        /* 표는 내용 폭 기준으로만 넓어진다. width:100% + col.product width:auto 조합은
           품목명 열이 남은 폭을 전부 흡수해 거대한 빈 공간을 만들므로 금지한다. */
        table {
          width: auto;
          table-layout: fixed;
          border-collapse: collapse;
          font-size: 11px;
        }
        col.owner {
          width: 78px;
        }
        col.product {
          width: 360px;
        }
        col.unit {
          width: 46px;
        }
        col.num {
          width: 64px;
        }
        col.final {
          width: 66px;
        }
        col.check {
          width: 44px;
        }
        col.detailBtn {
          width: 44px;
        }
        th,
        td {
          border: 1px solid #cbd5e1;
          padding: 1px 4px;
          height: 22px;
          text-align: right;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        th {
          position: sticky;
          top: 22px;
          z-index: 3;
          background: #e2e8f0;
          text-align: center;
        }
        .productCell {
          text-align: left;
          max-width: 360px;
        }
        .ownerCell {
          text-align: left;
          color: #1e293b;
          font-weight: 600;
        }
        /* 같은 품목의 업체 행 묶음 첫 줄에만 구분선을 둬 반복 품목명을 눈으로 묶는다. */
        tr.blockTop td {
          border-top: 2px solid #94a3b8;
        }
        .productCell.dim {
          color: #64748b;
          font-weight: 400;
        }
        .sumRow td {
          height: 18px;
          font-size: 10px;
        }
        .sumCell {
          background: #eef2ff;
          color: #3730a3;
        }
        .na {
          color: #a5b4fc;
        }
        td input[type="checkbox"] {
          width: 12px;
          height: 12px;
          margin: 0;
          vertical-align: middle;
        }
        .qty {
          box-sizing: border-box;
          width: 100%;
          height: 17px;
          padding: 0 2px;
          font-size: 11px;
          border: 1px solid #a78bfa;
          text-align: right;
        }
        .erp {
          background: #dbeafe;
        }
        .calc {
          background: #ffedd5;
        }
        .web {
          background: #ede9fe;
        }
        .move {
          background: #dcfce7;
          color: #166534;
        }
        .done {
          background: #f1f5f9;
          color: #475569;
        }
        .over {
          background: #fee2e2;
          color: #b91c1c;
          font-weight: 700;
        }
        .empty {
          text-align: center;
          color: #64748b;
        }
        .unlinked {
          background: #fef3c7;
          color: #92400e;
          font-weight: 700;
        }
        .grouplist {
          max-height: 132px;
          margin: 0 0 8px;
          padding: 0;
          overflow: auto;
          list-style: none;
          border: 1px solid #cbd5e1;
        }
        .grouplist li {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 2px 4px;
          border-bottom: 1px solid #e2e8f0;
        }
        .grouplist li.on {
          background: #eff6ff;
        }
        .grouplist span {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .grouplist em {
          font-style: normal;
          color: #64748b;
        }
        .grouplist em.warn {
          color: #b91c1c;
          font-weight: 700;
        }
        .editing {
          margin-left: 6px;
          color: #1d4ed8;
        }
        .subweeks {
          text-align: left;
          background: #f8fafc;
          height: 20px;
          white-space: normal;
        }
        .subweeks span {
          margin-right: 14px;
        }
        .subweeks .legacy {
          color: #92400e;
        }
        .modal {
          position: fixed;
          inset: 0;
          background: #0008;
          z-index: 99;
          display: grid;
          place-items: center;
        }
        .modal > div {
          background: white;
          padding: 14px;
          width: 500px;
        }
        .modal h2 {
          margin: 0 0 8px;
        }
        .modal label {
          display: flex;
          justify-content: space-between;
          margin: 6px 0;
        }
        .modal select,
        .modal label input {
          width: 320px;
          height: 25px;
        }
        @media (max-width: 1400px) {
          .groupbar,
          .notice {
            /* 좁은 화면 표 총 폭(68+300+46+58*4+60+44+44) */
            min-width: 794px;
          }
          .groupbar {
            gap: 6px;
          }
          .groupbar span:first-of-type {
            max-width: 230px;
          }
          col.owner {
            width: 68px;
          }
          col.product {
            width: 300px;
          }
          col.num {
            width: 58px;
          }
          col.final {
            width: 60px;
          }
          .productCell {
            max-width: 300px;
          }
          .toolbar .search {
            width: 115px;
          }
        }
      `}</style>
    </div>
  );
}
