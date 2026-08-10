import { Fragment, useEffect, useMemo, useState } from "react";
import Layout from "../../components/Layout";
import { apiGet, apiPost } from "../../lib/useApi";

const fmt = (v) =>
  Number(v || 0).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
export default function Board() {
  const qs = useMemo(
      () =>
        typeof window === "undefined"
          ? {}
          : Object.fromEntries(new URLSearchParams(location.search)),
      [],
    ),
    [year, setYear] = useState(qs.year || ""),
    [week, setWeek] = useState(qs.week || ""),
    [groups, setGroups] = useState([]),
    [groupKey, setGroupKey] = useState(Number(qs.groupKey || 0)),
    [rows, setRows] = useState([]),
    [draft, setDraft] = useState({}),
    [open, setOpen] = useState({}),
    [search, setSearch] = useState(""),
    [unfinished, setUnfinished] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [admin, setAdmin] = useState(false),
    [manage, setManage] = useState(false),
    [customers, setCustomers] = useState([]),
    [customerQ, setCustomerQ] = useState(""),
    [form, setForm] = useState({
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
      const d = await apiGet("/api/sales/shilla-miu-board", {
        ...(year && { year }),
        ...(week && { startWeek: week, endWeek: week }),
        ...(groupKey && { groupKey }),
        ...over,
      });
      setYear(d.year);
      setWeek(d.weeks?.[0] || d.latest?.week);
      setGroups(d.groups || []);
      setGroupKey(d.selectedGroup?.groupKey || 0);
      setRows(d.rows || []);
      setAdmin(!!d.isAdmin);
      setDraft({});
      if (typeof history !== "undefined")
        history.replaceState(
          null,
          "",
          `?year=${d.year}&week=${d.weeks?.[0] || ""}&groupKey=${d.selectedGroup?.groupKey || ""}`,
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
  const selected = groups.find((g) => g.groupKey === groupKey),
    value = (r, w) => draft[r.prodKey] || w.moveQty || "",
    change = (r, w, p) =>
      setDraft((d) => ({
        ...d,
        [r.prodKey]: {
          qty: value(r, w),
          matched: w.matched,
          memo: w.memo,
          ...d[r.prodKey],
          ...p,
        },
      }));
  const save = async () => {
    const allocations = Object.entries(draft).map(([prodKey, x]) => ({
      prodKey: Number(prodKey),
      useWeek: week,
      ...x,
    }));
    if (!allocations.length) return setMessage("변경된 값이 없습니다.");
    try {
      await apiPost("/api/sales/shilla-miu-board", {
        year,
        groupKey,
        allocations,
      });
      setMessage(`${allocations.length}건을 웹 게시판에 저장했습니다.`);
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
      setMessage("업체 구성을 저장했습니다.");
      await load();
    } catch (e) {
      setError(e.message);
    }
  };
  const shown = rows.filter(
    (r) =>
      (!search || r.prodName.toLowerCase().includes(search.toLowerCase())) &&
      (!unfinished || !r.weeks[week]?.matched),
  );
  return (
    <Layout title="업체별 잔량분배 통합게시판">
      <div className="page">
        <header>
          <div>
            <h1>업체별 잔량분배 통합게시판</h1>
            <p>전산 실제 분배와 웹 전용 잔량이동을 구분해 비교합니다.</p>
          </div>
          <div className="actions">
            <label>
              연도{" "}
              <input value={year} onChange={(e) => setYear(e.target.value)} />
            </label>
            <label>
              대차수{" "}
              <input value={week} onChange={(e) => setWeek(e.target.value)} />
            </label>
            <button onClick={() => load()}>
              {loading ? "조회 중…" : "조회"}
            </button>
            <button className="primary" onClick={save}>
              변경 저장
            </button>
            {admin && (
              <button onClick={() => setManage(true)}>업체 추가/관리</button>
            )}
          </div>
        </header>
        <nav>
          {groups
            .filter((g) => g.isActive)
            .map((g) => (
              <button
                key={g.groupKey}
                className={g.groupKey === groupKey ? "active" : ""}
                onClick={() => {
                  setGroupKey(g.groupKey);
                  load({ groupKey: g.groupKey });
                }}
              >
                {g.groupName}
              </button>
            ))}
        </nav>
        <div className="note">
          <b>
            방향: {selected?.baseCustName || "기준 업체"} →{" "}
            {selected?.receiverCustName || "수령 업체"}
          </b>{" "}
          · 파란색=전산 ShipmentDetail 실제 출고 · 주황색=계산 잔량 · 보라색=웹
          저장값. 조회나 저장은 ERP 주문·출고·재고를 변경하지 않습니다.
        </div>
        {message && <div className="ok">{message}</div>}
        {error && <div className="err">{error}</div>}
        <div className="filters">
          <input
            placeholder="품목명 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label>
            <input
              type="checkbox"
              checked={unfinished}
              onChange={(e) => setUnfinished(e.target.checked)}
            />
            미완료만
          </label>
        </div>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>품목명</th>
                <th>단위</th>
                <th>
                  기준업체
                  <br />
                  실제 분배
                </th>
                <th>→ 계산 잔량</th>
                <th>
                  수령업체
                  <br />
                  실제 분배
                </th>
                <th>
                  잔량 이동
                  <br />웹 입력
                </th>
                <th>이동 후 차이</th>
                <th>확인</th>
                <th>세부차수</th>
              </tr>
            </thead>
            <tbody>
              {!shown.length && (
                <tr>
                  <td colSpan="9">
                    선택 기준 업체의 실제 출고 품목이 없습니다.
                  </td>
                </tr>
              )}
              {shown.map((r) => {
                const w = r.weeks[week],
                  v = Number(value(r, w) || 0),
                  diff = v - w.calculatedRemainder;
                  return (
                    <Fragment key={r.prodKey}>
                    <tr>
                      <td title={`Product.ProdKey ${r.prodKey}`}>
                        {r.prodName}
                      </td>
                      <td>{r.unit}</td>
                      <td
                        className={w.baseActual ? "erp" : ""}
                        title="ShipmentDetail.OutQuantity 합계"
                      >
                        {fmt(w.baseActual)}
                      </td>
                      <td
                        className={w.calculatedRemainder ? "calc" : ""}
                        title="max(0, 기준업체 실제분배 - 수령업체 실제분배)"
                      >
                        {fmt(w.calculatedRemainder)}
                      </td>
                      <td
                        className={w.receiverActual ? "erp" : ""}
                        title="ShipmentDetail.OutQuantity 합계"
                      >
                        {fmt(w.receiverActual)}
                      </td>
                      <td className={v ? "web" : ""}>
                        <input
                          type="number"
                          min="0"
                          value={value(r, w)}
                          onChange={(e) =>
                            change(r, w, { qty: e.target.value })
                          }
                        />
                      </td>
                      <td
                        className={
                          diff === 0 && v ? "done" : diff < 0 ? "short" : "over"
                        }
                      >
                        {diff === 0
                          ? "일치"
                          : diff < 0
                            ? `미분배 ${fmt(-diff)}`
                            : `초과 ${fmt(diff)}`}
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={draft[r.prodKey]?.matched ?? w.matched}
                          onChange={(e) =>
                            change(r, w, { matched: e.target.checked })
                          }
                        />
                      </td>
                      <td>
                        <button
                          onClick={() =>
                            setOpen((o) => ({
                              ...o,
                              [r.prodKey]: !o[r.prodKey],
                            }))
                          }
                        >
                          {open[r.prodKey] ? "닫기" : "펼치기"}
                        </button>
                      </td>
                    </tr>
                    {open[r.prodKey] && (
                      <tr>
                        <td colSpan="9" className="detail">
                          {w.subweeks.map((s) => (
                            <span key={s.orderWeek}>
                              {s.orderWeek}: 기준 {fmt(s.baseActual)} / 수령{" "}
                              {fmt(s.receiverActual)}
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
        </div>
        {manage && (
          <div className="modal">
            <div>
              <h2>업체 구성</h2>
              <input
                placeholder="Customer 검색"
                value={customerQ}
                onChange={(e) => setCustomerQ(e.target.value)}
              />
              <button onClick={findCustomers}>검색</button>
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
              <button className="primary" onClick={saveGroup}>
                저장
              </button>
              <button onClick={() => setManage(false)}>닫기</button>
            </div>
          </div>
        )}
      </div>
      <style jsx>{`
        .page {
          min-width: 980px;
          color: #172033;
        }
        header {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: end;
        }
        h1 {
          font-size: 20px;
          margin: 0;
        }
        p {
          font-size: 12px;
          color: #64748b;
        }
        .actions,
        .filters,
        nav {
          display: flex;
          gap: 6px;
          align-items: center;
          flex-wrap: wrap;
        }
        .actions input {
          width: 60px;
        }
        button,
        input,
        select {
          height: 29px;
          border: 1px solid #94a3b8;
          background: white;
        }
        .primary,
        nav .active {
          background: #1d4ed8;
          color: white;
        }
        .note,
        .ok,
        .err {
          margin: 8px 0;
          padding: 8px;
          background: #eff6ff;
          border: 1px solid #bfdbfe;
          font-size: 12px;
        }
        .ok {
          background: #f0fdf4;
        }
        .err {
          background: #fef2f2;
          color: #b91c1c;
        }
        .scroll {
          overflow: auto;
          max-height: calc(100vh - 230px);
          margin-top: 8px;
        }
        table {
          border-collapse: collapse;
          width: 100%;
          font-size: 12px;
        }
        th,
        td {
          border: 1px solid #cbd5e1;
          padding: 6px;
          text-align: center;
        }
        th {
          position: sticky;
          top: 0;
          background: #e2e8f0;
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
        }
        .short {
          background: #fee2e2;
          color: #b91c1c;
        }
        .over {
          background: #fef3c7;
        }
        .detail {
          text-align: left;
          background: #f8fafc;
        }
        .detail span {
          margin-right: 18px;
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
          padding: 20px;
          width: 520px;
        }
        .modal label {
          display: flex;
          justify-content: space-between;
          margin: 10px 0;
        }
        .modal select,
        .modal label input {
          width: 330px;
        }
      `}</style>
    </Layout>
  );
}
