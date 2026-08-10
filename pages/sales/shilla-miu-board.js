import { Fragment, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../../lib/useApi";

const fmt = (v) =>
  Number(v || 0).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
const draftKey = (groupKey, prodKey) => `${groupKey}|${prodKey}`;

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

  const load = async (over = {}) => {
    setLoading(true);
    setError("");
    try {
      const nextGroup = Object.prototype.hasOwnProperty.call(over, "groupKey")
        ? Number(over.groupKey)
        : groupKey;
      const data = await apiGet("/api/sales/shilla-miu-board", {
        ...(year && { year }),
        ...(week && { startWeek: week, endWeek: week }),
        ...(nextGroup && { groupKey: nextGroup }),
      });
      setYear(data.year);
      setWeek(data.weeks?.[0] || data.latest?.week);
      setGroups(data.groups || []);
      setBoards(data.boards || []);
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

  const activeGroups = groups.filter((g) => g.isActive);
  const selected = activeGroups.find((g) => g.groupKey === groupKey);
  const displayedBoards = groupKey ? [{ group: selected, rows }] : boards;
  const value = (g, r, w) =>
    drafts[draftKey(g.groupKey, r.prodKey)]?.qty ?? w.moveQty ?? "";
  const matched = (g, r, w) =>
    drafts[draftKey(g.groupKey, r.prodKey)]?.matched ?? w.matched;
  const change = (g, r, w, patch) =>
    setDrafts((d) => ({
      ...d,
      [draftKey(g.groupKey, r.prodKey)]: {
        qty: value(g, r, w),
        matched: matched(g, r, w),
        memo: w.memo || "",
        ...d[draftKey(g.groupKey, r.prodKey)],
        ...patch,
      },
    }));
  const visibleRows = (list) =>
    list.filter((r) => {
      const w = r.weeks[week];
      return (
        (!search || r.prodName.toLowerCase().includes(search.toLowerCase())) &&
        (!unfinished || !w.matched) &&
        (!hideZero || w.baseActual || w.receiverActual || w.moveQty)
      );
    });

  const save = async () => {
    const byGroup = {};
    Object.entries(drafts).forEach(([key, data]) => {
      const [g, prodKey] = key.split("|");
      (byGroup[g] ||= []).push({
        prodKey: Number(prodKey),
        useWeek: week,
        ...data,
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
      setMessage(`${Object.keys(drafts).length}건을 웹 게시판에 저장했습니다.`);
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
            title={g.baseCustName}
            onClick={() => load({ groupKey: g.groupKey })}
          >
            {g.groupName}
          </button>
        ))}
        <i />
        <label>
          연도 <input value={year} onChange={(e) => setYear(e.target.value)} />
        </label>
        <label>
          대차수{" "}
          <input value={week} onChange={(e) => setWeek(e.target.value)} />
        </label>
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
        전산 실제분배(파랑) · 계산잔량(주황) · 웹 이동값(보라) / ERP 원장은
        변경하지 않습니다.
      </div>
      {message && <div className="msg ok">{message}</div>}
      {error && <div className="msg err">{error}</div>}
      <div className="scroll">
        {displayedBoards.map(({ group, rows: groupRows }) => {
          if (!group) return null;
          const shown = visibleRows(groupRows || []);
          const totals = shown.reduce(
            (a, r) => {
              const w = r.weeks[week];
              a.base += w.baseActual;
              a.receiver += w.receiverActual;
              a.remain += w.calculatedRemainder;
              a.move += Number(value(group, r, w) || 0);
              a.done += matched(group, r, w) ? 1 : 0;
              return a;
            },
            { base: 0, receiver: 0, remain: 0, move: 0, done: 0 },
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
                <span>기준 {fmt(totals.base)}</span>
                <span>아이엠 {fmt(totals.receiver)}</span>
                <span>잔량 {fmt(totals.remain)}</span>
                <span>이동 {fmt(totals.move)}</span>
                <span>
                  완료 {totals.done}/{shown.length}
                </span>
              </div>
              {!collapsed[group.groupKey] && (
                <table>
                  <colgroup>
                    <col className="product" />
                    <col className="unit" />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col className="diff" />
                    <col className="check" />
                    <col className="detailBtn" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>품목명</th>
                      <th>단위</th>
                      <th>기준분배</th>
                      <th>계산잔량</th>
                      <th>아이엠분배</th>
                      <th>이동입력</th>
                      <th>차이</th>
                      <th>완료</th>
                      <th>세부</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!shown.length && (
                      <tr>
                        <td colSpan="9" className="empty">
                          기준 업체 실제 출고 품목 없음
                        </td>
                      </tr>
                    )}
                    {shown.map((r) => {
                      const w = r.weeks[week],
                        move = Number(value(group, r, w) || 0),
                        diff = move - w.calculatedRemainder,
                        key = draftKey(group.groupKey, r.prodKey);
                      return (
                        <Fragment key={r.prodKey}>
                          <tr>
                            <td
                              className="productCell"
                              title={`${group.groupName} · ${r.prodName} · ProdKey ${r.prodKey}`}
                            >
                              {r.prodName}
                            </td>
                            <td>{r.unit}</td>
                            <td className={w.baseActual ? "erp" : ""}>
                              {fmt(w.baseActual)}
                            </td>
                            <td className={w.calculatedRemainder ? "calc" : ""}>
                              {fmt(w.calculatedRemainder)}
                            </td>
                            <td className={w.receiverActual ? "erp" : ""}>
                              {fmt(w.receiverActual)}
                            </td>
                            <td className={move ? "web" : ""}>
                              <input
                                className="qty"
                                type="number"
                                min="0"
                                value={value(group, r, w)}
                                onChange={(e) =>
                                  change(group, r, w, { qty: e.target.value })
                                }
                              />
                            </td>
                            <td
                              className={
                                diff < 0
                                  ? "short"
                                  : diff > 0
                                    ? "over"
                                    : move
                                      ? "done"
                                      : ""
                              }
                            >
                              {diff < 0
                                ? `-${fmt(-diff)}`
                                : diff > 0
                                  ? `+${fmt(diff)}`
                                  : "="}
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
                                    {s.orderWeek} 기준 {fmt(s.baseActual)} /
                                    아이엠 {fmt(s.receiverActual)}
                                  </span>
                                ))}
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
        .toolbar label {
          display: flex;
          align-items: center;
          gap: 2px;
        }
        .toolbar input {
          width: 46px;
        }
        .toolbar .search {
          width: 145px;
        }
        .toolbar input[type="checkbox"] {
          width: 13px;
          height: 13px;
        }
        .toolbar button,
        .groupbar button,
        td button {
          padding: 0 6px;
          height: 24px;
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
          max-height: calc(100vh - 113px);
          overflow: auto;
        }
        section {
          margin-top: 3px;
        }
        .groupbar {
          position: sticky;
          top: 0;
          z-index: 4;
          display: flex;
          align-items: center;
          gap: 10px;
          height: 25px;
          padding: 0 4px;
          background: #334155;
          color: #fff;
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
        table {
          width: 100%;
          table-layout: fixed;
          border-collapse: collapse;
          font-size: 11px;
        }
        col.product {
          width: auto;
        }
        col.unit {
          width: 42px;
        }
        col:not(.product):not(.unit) {
          width: 82px;
        }
        col.diff {
          width: 70px;
        }
        col.check {
          width: 42px;
        }
        col.detailBtn {
          width: 38px;
        }
        th,
        td {
          border: 1px solid #cbd5e1;
          padding: 2px 4px;
          height: 23px;
          text-align: right;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        th {
          position: sticky;
          top: 25px;
          z-index: 3;
          background: #e2e8f0;
          text-align: center;
        }
        .productCell {
          text-align: left;
          min-width: 180px;
        }
        .qty {
          box-sizing: border-box;
          width: 100%;
          height: 19px;
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
        .done {
          background: #dcfce7;
          color: #166534;
        }
        .short {
          background: #fee2e2;
          color: #b91c1c;
          font-weight: 700;
        }
        .over {
          background: #fef3c7;
          color: #92400e;
          font-weight: 700;
        }
        .empty {
          text-align: center;
          color: #64748b;
        }
        .subweeks {
          text-align: left;
          background: #f8fafc;
          height: 22px;
        }
        .subweeks span {
          margin-right: 14px;
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
          }
          .groupbar span:first-of-type {
            max-width: 230px;
          }
          col:not(.product):not(.unit) {
            width: 70px;
          }
          .toolbar .search {
            width: 115px;
          }
        }
      `}</style>
    </div>
  );
}
