// 잔량분배 게시판 — 예상물량 → 현재분배 → 업체 최종분배 → 업체 잔량 → 미우 이관 흐름
// '업체 최종분배'는 전산(nenova.exe)의 확정(isFix) 상태가 아니라 업무상 최종 납품·사용 수량이다.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost } from "../../lib/useApi";
import { roundQty, stepMajorWeek } from "../../lib/shillaMiuBoard";

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
    [hideZero, setHideZero] = useState(true);
  const [loading, setLoading] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [admin, setAdmin] = useState(false),
    [manage, setManage] = useState(false),
    [customers, setCustomers] = useState([]),
    [customerQ, setCustomerQ] = useState("");
  const [form, setForm] = useState({
    groupName: "",
    baseCustKey: "",
    receiverCustKey: "",
    displayOrder: 0,
    isActive: true,
  });
  const weekBoxRef = useRef(null);
  const stateRef = useRef({ year, week, groupKey });
  stateRef.current = { year, week, groupKey };

  const load = async (over = {}) => {
    setLoading(true);
    setError("");
    const base = stateRef.current;
    const nextGroup = Object.prototype.hasOwnProperty.call(over, "groupKey")
      ? Number(over.groupKey)
      : base.groupKey;
    const nextWeek = over.week ?? base.week;
    const nextYear = over.year ?? base.year;
    try {
      const data = await apiGet("/api/sales/shilla-miu-board", {
        ...(nextYear && { year: nextYear }),
        ...(nextWeek && { startWeek: nextWeek, endWeek: nextWeek }),
        ...(nextGroup && { groupKey: nextGroup }),
      });
      setYear(data.year);
      setWeek(data.weeks?.[0] || data.latest?.week || "");
      setGroups(data.groups || []);
      setBoards(data.boards || []);
      setOverview(data.overview || []);
      setRows(data.rows || []);
      setAdmin(!!data.isAdmin);
      setGroupKey(data.selectedGroup?.groupKey || 0);
      setDrafts({});
      history.replaceState(
        null,
        "",
        `?year=${data.year}&week=${data.weeks?.[0] || ""}${data.selectedGroup ? `&groupKey=${data.selectedGroup.groupKey}` : ""}`,
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 차수 스피너: ▲▼ 클릭 · 키보드 위/아래 · 입력칸 위에서의 휠. 1 미만으로 내려가지 않고 즉시 조회한다.
  const stepWeek = (delta) => {
    const next = stepMajorWeek(stateRef.current.week || "01", delta);
    if (next === stateRef.current.week) return;
    setWeek(next);
    load({ week: next });
  };
  useEffect(() => {
    const el = weekBoxRef.current;
    if (!el) return;
    // 휠은 이 입력칸에서만 처리하고 페이지 스크롤로 전파하지 않는다.
    const onWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      stepWeek(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeGroups = groups.filter((g) => g.isActive);
  const selected = activeGroups.find((g) => g.groupKey === groupKey);
  const displayedBoards = groupKey ? [{ group: selected, rows }] : boards;

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

  const visibleRows = (list) =>
    (list || []).filter((r) => {
      const w = r.weeks?.[week];
      if (!w) return false;
      return (
        (!search || r.prodName.toLowerCase().includes(search.toLowerCase())) &&
        (!unfinished || !w.matched) &&
        (!hideZero || w.expectedQty || w.currentQty || w.finalIsUserSet)
      );
    });
  const visibleOverviewRows = (list) =>
    (list || []).filter(
      (r) =>
        (!search || r.prodName.toLowerCase().includes(search.toLowerCase())) &&
        (!hideZero || r.residualTotal || r.receiverSelfQty || r.receiverTotal),
    );

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
  const saveGroup = async () => {
    try {
      await apiPost("/api/sales/shilla-miu-board", {
        action: "save-group",
        ...form,
        baseCustKey: Number(form.baseCustKey),
        receiverCustKey: Number(form.receiverCustKey),
        displayOrder: Number(form.displayOrder),
      });
      setManage(false);
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
            onChange={(e) => setWeek(e.target.value)}
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
        {!groupKey &&
          overview.map((section) => {
            const shown = visibleOverviewRows(section.rows);
            const totals = shown.reduce(
              (a, r) => {
                a.residual = roundQty(a.residual + r.residualTotal);
                a.self = roundQty(a.self + r.receiverSelfQty);
                a.total = roundQty(a.total + r.receiverTotal);
                return a;
              },
              { residual: 0, self: 0, total: 0 },
            );
            return (
              <section key={section.receiverCustKey}>
                <div className="groupbar overviewbar">
                  <b title={section.receiverCustName}>전체</b>
                  <span title={`잔량 수령: ${section.receiverCustName}`}>
                    수령 {section.receiverCustName}
                  </span>
                  <em>품목 {shown.length}</em>
                  <span>업체잔량합 {fmt(totals.residual)}</span>
                  <span>미우자체 {fmt(totals.self)}</span>
                  <span>미우총수량 {fmt(totals.total)}</span>
                </div>
                <table className="overview">
                  <colgroup>
                    <col className="product" />
                    <col className="unit" />
                    {section.groups.map((g) => (
                      <col className="num" key={g.groupKey} />
                    ))}
                    <col className="sum" />
                    <col className="num" />
                    <col className="total" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>품목명</th>
                      <th>단위</th>
                      {section.groups.map((g) => (
                        <th key={g.groupKey} title={`${g.baseCustName} 잔량`}>
                          {g.groupName}잔량
                        </th>
                      ))}
                      <th>잔량합계</th>
                      <th title={`${section.receiverCustName} 자체 주문·분배 수량`}>
                        미우자체
                      </th>
                      <th>미우총수량</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!shown.length && (
                      <tr>
                        <td colSpan={section.groups.length + 5} className="empty">
                          해당 차수의 품목이 없습니다.
                        </td>
                      </tr>
                    )}
                    {shown.map((r) => (
                      <tr key={r.rowKey}>
                        <td
                          className="productCell"
                          title={`${r.prodName} · ProdKey ${r.prodKey} · 단위 ${r.unit || "-"}`}
                        >
                          {r.prodName}
                        </td>
                        <td>{r.unit}</td>
                        {section.groups.map((g) => {
                          const cell = r.byGroup[g.groupKey];
                          return (
                            <td
                              key={g.groupKey}
                              className={cell?.transferQty ? "calc" : ""}
                              title={
                                cell
                                  ? `예상 ${fmt(cell.expectedQty)} − 최종분배 ${fmt(cell.finalQty)}${cell.finalIsUserSet ? "" : "(미입력·현재분배 기준)"} = 잔량 ${fmt(cell.residualQty)}`
                                  : "해당 업체 물량 없음"
                              }
                            >
                              {cell ? fmt(cell.transferQty) : "-"}
                            </td>
                          );
                        })}
                        <td className={r.residualTotal ? "calc" : ""}>
                          {fmt(r.residualTotal)}
                        </td>
                        <td
                          className={r.receiverSelfQty ? "erp" : ""}
                          title={`미우 자체 주문 ${fmt(r.receiverSelfExpected)} · 자체 분배 ${fmt(r.receiverSelfQty)}`}
                        >
                          {fmt(r.receiverSelfQty)}
                        </td>
                        <td className={r.receiverTotal ? "web" : ""}>
                          {fmt(r.receiverTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            );
          })}
        {displayedBoards.map(({ group, rows: groupRows }) => {
          if (!group) return null;
          const shown = visibleRows(groupRows);
          const totals = shown.reduce(
            (a, r) => {
              const w = r.weeks[week];
              const f = flow(group, r, w);
              a.expected = roundQty(a.expected + w.expectedQty);
              a.current = roundQty(a.current + w.currentQty);
              a.final = roundQty(a.final + f.finalQty);
              a.transfer = roundQty(a.transfer + f.transferQty);
              a.done += matched(group, r, w) ? 1 : 0;
              return a;
            },
            { expected: 0, current: 0, final: 0, transfer: 0, done: 0 },
          );
          return (
            <section key={group.groupKey}>
              <div className="groupbar">
                <button
                  onClick={() =>
                    setCollapsed((c) => ({
                      ...c,
                      [group.groupKey]: !c[group.groupKey],
                    }))
                  }
                >
                  {collapsed[group.groupKey] ? "▶" : "▼"}
                </button>
                <b title={group.baseCustName}>{group.groupName}</b>
                <span
                  title={`${group.baseCustName} → ${group.receiverCustName}`}
                >
                  {group.baseCustName} → {group.receiverCustName}
                </span>
                <em>품목 {shown.length}</em>
                <span>예상 {fmt(totals.expected)}</span>
                <span>현재 {fmt(totals.current)}</span>
                <span>최종 {fmt(totals.final)}</span>
                <span>이관 {fmt(totals.transfer)}</span>
                <span>
                  완료 {totals.done}/{shown.length}
                </span>
              </div>
              {!collapsed[group.groupKey] && (
                <table>
                  <colgroup>
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
                    {!shown.length && (
                      <tr>
                        <td colSpan="9" className="empty">
                          기준 업체 주문·분배 품목 없음
                        </td>
                      </tr>
                    )}
                    {shown.map((r) => {
                      const w = r.weeks[week],
                        f = flow(group, r, w),
                        key = draftKey(group.groupKey, r.prodKey);
                      return (
                        <Fragment key={r.prodKey}>
                          <tr>
                            <td
                              className="productCell"
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
                              <td colSpan="9" className="subweeks">
                                {w.subweeks.map((s) => (
                                  <span key={s.orderWeek}>
                                    {s.orderWeek} 예상 {fmt(s.expectedQty)} /
                                    현재 {fmt(s.currentQty)} / 미우{" "}
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
                  </tbody>
                </table>
              )}
            </section>
          );
        })}
      </div>
      {manage && (
        <div className="modal">
          <div>
            <h2>업체 구성</h2>
            <div>
              <input
                placeholder="Customer 검색"
                value={customerQ}
                onChange={(e) => setCustomerQ(e.target.value)}
              />
              <button onClick={findCustomers}>검색</button>
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
                    {c.custName} ({c.custKey})
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
                    {c.custName} ({c.custKey})
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
          /* 표 총 폭(420+46+64*4+66+44+44)과 맞춰 가로 스크롤 시에도 머리띠가 표를 덮는다. */
          min-width: 876px;
          padding: 0 4px;
          background: #334155;
          color: #fff;
        }
        .overviewbar {
          background: #1e293b;
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
        col.product {
          width: 420px;
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
        col.sum {
          width: 70px;
        }
        col.total {
          width: 76px;
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
          max-width: 420px;
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
          .groupbar {
            gap: 6px;
            /* 좁은 화면 표 총 폭(360+46+58*4+60+44+44) */
            min-width: 786px;
          }
          .groupbar span:first-of-type {
            max-width: 230px;
          }
          col.product {
            width: 360px;
          }
          col.num {
            width: 58px;
          }
          col.final {
            width: 60px;
          }
          .productCell {
            max-width: 360px;
          }
          .toolbar .search {
            width: 115px;
          }
        }
      `}</style>
    </div>
  );
}
