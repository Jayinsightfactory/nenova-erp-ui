import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../lib/useApi';
import {
  buildSalesPasteRows,
  buildSalesPasteText,
  buildSalesPasteWeekChoices,
  salesManagerCustomers,
  salesManagerOptions,
} from '../../lib/salesPasteOrder';

const productLabel = (row) =>
  row.displayName || row.prodName || row.inputName || '-';

export default function SalesPasteOrderPage() {
  const weekChoices = useMemo(() => buildSalesPasteWeekChoices(new Date()), []);
  const [year, setYear] = useState(
    weekChoices[0]?.year || String(new Date().getFullYear()),
  );
  const [week, setWeek] = useState(weekChoices[0]?.week || '');
  const [user, setUser] = useState({});
  const [customers, setCustomers] = useState([]);
  const [manager, setManager] = useState('');
  const [custKey, setCustKey] = useState('');
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState([]);
  const [text, setText] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [logs, setLogs] = useState([]);
  const submitLock = useRef(false);

  useEffect(() => {
    Promise.all([apiGet('/api/auth/me'), apiGet('/api/orders/my-customers')])
      .then(([me, list]) => {
        const nextUser = me.user || {};
        const nextCustomers = list.customers || [];
        setUser(nextUser);
        setCustomers(nextCustomers);
        const mine = String(nextUser.userName || '').trim();
        setManager(mine);
      })
      .catch((error) => setMessage(error.message));
  }, []);

  const managers = useMemo(
    () => salesManagerOptions(customers, user),
    [customers, user],
  );
  const managerCustomers = useMemo(
    () => salesManagerCustomers(customers, manager),
    [customers, manager],
  );
  const visibleCustomers = useMemo(() => {
    const token = query.trim().toLowerCase();
    return managerCustomers
      .filter(
        (row) =>
          !token ||
          `${row.CustName} ${row.OrderCode || ''} ${row.CustArea || ''}`
            .toLowerCase()
            .includes(token),
      )
      .slice(0, token ? 100 : 40);
  }, [managerCustomers, query]);
  const selectedCustomer = useMemo(
    () => customers.find((row) => String(row.CustKey) === String(custKey)),
    [customers, custKey],
  );
  const currentOrders = useMemo(
    () => products.filter((row) => Number(row.CurrentQty || 0) > 0),
    [products],
  );
  const unmatched = useMemo(
    () =>
      rows.filter(
        (row) => !row.prodKey || !(Number(row.qty) > 0) || row.unitConflict,
      ),
    [rows],
  );

  useEffect(() => {
    setRows([]);
    setText('');
    setMessage('');
    if (!custKey || !year || !week) {
      setProducts([]);
      return;
    }
    let active = true;
    setBusy(true);
    apiGet('/api/orders/my-customers', { custKey, year, week })
      .then((result) => {
        if (active) setProducts(result.products || []);
      })
      .catch((error) => {
        if (active) setMessage(error.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [custKey, year, week]);

  useEffect(() => {
    if (
      custKey &&
      managerCustomers.some((row) => String(row.CustKey) === String(custKey))
    )
      return;
    setCustKey(managerCustomers[0] ? String(managerCustomers[0].CustKey) : '');
  }, [manager, managerCustomers, custKey]);

  async function analyze() {
    if (!selectedCustomer || !text.trim())
      return setMessage('업체를 선택하고 주문 내용을 붙여넣으세요.');
    setBusy(true);
    setMessage('기존 매칭 데이터로 분석 중입니다…');
    setRows([]);
    try {
      const parsed = await apiPost('/api/orders/parse-paste', {
        text: buildSalesPasteText({
          year,
          week,
          customerName: selectedCustomer.CustName,
          text,
        }),
      });
      if ((parsed.orders || []).length !== 1)
        throw new Error(
          '여러 업체 구간이 감지되었습니다. 선택한 한 업체의 품목·수량만 붙여넣으세요.',
        );
      const nextRows = buildSalesPasteRows(parsed.orders || [], products);
      if (!nextRows.length)
        throw new Error('분석된 품목이 없습니다. 붙여넣기 형식을 확인하세요.');
      setRows(nextRows);
      const failed = nextRows.filter(
        (row) => !row.prodKey || !(Number(row.qty) > 0) || row.unitConflict,
      ).length;
      setMessage(
        failed
          ? `분석 ${nextRows.length}건 · 매칭/수량 확인 필요 ${failed}건`
          : `분석 ${nextRows.length}건 · 전부 등록 가능`,
      );
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function register() {
    if (submitLock.current || busy) return;
    if (!selectedCustomer || !rows.length || unmatched.length)
      return setMessage('미매칭 또는 0수량 품목을 모두 해결한 뒤 등록하세요.');
    if (
      !window.confirm(
        `${year}년 ${week} · ${manager} · ${selectedCustomer.CustName}\n${rows.length}개 품목을 주문에만 추가합니다. 분배는 변경하지 않습니다.`,
      )
    )
      return;
    submitLock.current = true;
    setBusy(true);
    setMessage('주문 원장에 등록하고 재조회 중입니다…');
    try {
      const result = await apiPost('/api/orders', {
        source: 'sales-paste',
        orderMode: 'ADD',
        manager,
        custKey: Number(custKey),
        custName: selectedCustomer.CustName,
        year,
        week,
        items: rows.map((row) => ({
          prodKey: Number(row.prodKey),
          prodName: productLabel(row),
          qty: Number(row.qty),
          unit: row.unit,
          expectedCurrentQty: Number(row.currentQty || 0),
        })),
      });
      if (result.success === false || result.verified !== true)
        throw new Error(result.error || '주문등록 검증에 실패했습니다.');
      const refreshed = await apiGet('/api/orders/my-customers', {
        custKey,
        year,
        week,
      });
      setProducts(refreshed.products || []);
      const log = {
        at: new Date().toISOString(),
        customer: selectedCustomer.CustName,
        manager,
        year,
        week,
        count: rows.length,
        results: result.results || [],
      };
      setLogs((previous) => [log, ...previous].slice(0, 20));
      setRows([]);
      setText('');
      setMessage(
        `${result.message || '주문 등록 완료'} · 현재 주문 재조회 완료 · 분배 변경 없음`,
      );
    } catch (error) {
      setMessage(error.message || '주문등록 실패');
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <Head>
        <title>영업부 붙여서 주문등록</title>
      </Head>
      <main className="sales-paste-page">
        <header>
          <div>
            <h1>내 업체 주문등록</h1>
            <p>
              업체를 선택하고 품목·수량만 붙여넣습니다. 주문만 등록하며
              출고분배는 변경하지 않습니다.
            </p>
          </div>
          <strong>{user.userName || user.userId || '로그인 사용자'}</strong>
        </header>
        <nav className="entry-tabs" aria-label="주문 입력 방식">
          <Link href="/orders/my-customers">수량 직접 입력</Link>
          <span aria-current="page">붙여서 주문등록</span>
        </nav>
        <section className="scope">
          <div>
            <b>1. 등록 차수</b>
            <div className="week-groups">
              {[0, 1, 2, 3].map((offset) => (
                <div key={offset}>
                  <small>
                    {offset === 0 ? '베이스 차수' : `베이스 +${offset}`}
                  </small>
                  {weekChoices
                    .filter((choice) => choice.offset === offset)
                    .map((choice) => (
                      <button
                        key={`${choice.year}-${choice.week}`}
                        className={
                          year === choice.year && week === choice.week
                            ? 'active'
                            : ''
                        }
                        onClick={() => {
                          setYear(choice.year);
                          setWeek(choice.week);
                        }}
                      >
                        {choice.year}년 {choice.label}
                      </button>
                    ))}
                </div>
              ))}
            </div>
          </div>
          <label>
            <b>2. 담당자</b>
            <select
              value={manager}
              onChange={(event) => setManager(event.target.value)}
            >
              {managers.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
            <small>로그인 계정 담당자가 기본 선택됩니다.</small>
          </label>
          <div>
            <b>3. 업체</b>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="업체명·클라이언트 번호 검색"
            />
            <div className="customers">
              {visibleCustomers.map((row) => (
                <button
                  key={row.CustKey}
                  className={
                    String(row.CustKey) === String(custKey) ? 'active' : ''
                  }
                  onClick={() => setCustKey(String(row.CustKey))}
                >
                  <span>
                    {row.CustName}
                    {row.OrderCode && <mark>{row.OrderCode}</mark>}
                  </span>
                  <small>
                    {row.CustArea || '-'} · 최근 {row.LastOrderWeek || '없음'}
                  </small>
                </button>
              ))}
            </div>
          </div>
        </section>
        {selectedCustomer && (
          <div className="selected">
            <b>{selectedCustomer.CustName}</b>
            <span>
              {year}년 {week} · 담당 {manager}
            </span>
            <em>주문만 등록 / 분배 보존</em>
          </div>
        )}
        {message && (
          <div className="notice" role="status">
            {message}
          </div>
        )}
        <div className="workspace">
          <section className="paste-box">
            <h2>붙여넣기 입력</h2>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={
                '품목과 수량을 붙여넣으세요.\n예) 돈셀 2박스\n문라이트 3박스'
              }
            />
            <div className="actions">
              <button
                onClick={analyze}
                disabled={busy || !custKey || !text.trim()}
              >
                {busy ? '처리 중' : '기존 매칭으로 분석'}
              </button>
              <button
                className="register"
                onClick={register}
                disabled={busy || !rows.length || Boolean(unmatched.length)}
              >
                주문만 등록
              </button>
            </div>
            <div className="analysis">
              <h2>
                분석 결과 <small>{rows.length}건</small>
              </h2>
              {rows.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>상태</th>
                      <th>품목</th>
                      <th>수량</th>
                      <th>현재 주문</th>
                      <th>등록 후</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr
                        key={`${row.prodKey || row.inputName}-${index}`}
                        className={
                          !row.prodKey || row.unitConflict ? 'bad' : ''
                        }
                      >
                        <td>
                          {row.prodKey &&
                          Number(row.qty) > 0 &&
                          !row.unitConflict
                            ? '매칭'
                            : row.unitConflict
                              ? '단위 충돌'
                              : '확인 필요'}
                        </td>
                        <td>
                          <b>{productLabel(row)}</b>
                          <small>{row.flowerName || row.counName || ''}</small>
                        </td>
                        <td>
                          {row.qty} {row.unit}
                        </td>
                        <td>
                          {row.currentQty} {row.unit}
                        </td>
                        <td>
                          {row.finalQty ?? '-'} {row.unit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="empty">
                  붙여넣기 후 분석하면 기존 품목 매칭 결과와 현재 주문수량이
                  함께 표시됩니다.
                </p>
              )}
            </div>
          </section>
          <aside>
            <section>
              <h2>현재 주문등록 현황</h2>
              <p>
                {selectedCustomer?.CustName || '업체'} · {year}년 {week}
              </p>
              {busy && !products.length ? (
                <div className="empty">조회 중…</div>
              ) : currentOrders.length ? (
                <div className="current-list">
                  {currentOrders.map((row) => (
                    <div key={row.ProdKey}>
                      <span>
                        <small>
                          {row.CountryFlower || row.FlowerName || ''}
                        </small>
                        <b>{row.DisplayName || row.ProdName}</b>
                      </span>
                      <strong>
                        {Number(row.CurrentQty)} {row.OutUnit}
                      </strong>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty">현재 등록된 주문이 없습니다.</div>
              )}
            </section>
            <section>
              <h2>이번 작업 로그</h2>
              {logs.length ? (
                <div className="logs">
                  {logs.map((log, index) => (
                    <div key={`${log.at}-${index}`}>
                      <b>
                        {log.customer} · {log.count}건
                      </b>
                      <span>
                        {new Date(log.at).toLocaleString('ko-KR')} · {log.year}{' '}
                        {log.week}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty">이 화면에서 실행한 작업이 없습니다.</div>
              )}
            </section>
          </aside>
        </div>
      </main>
      <style jsx>{`
        .sales-paste-page {
          max-width: 1880px;
          margin: auto;
          padding: 8px 14px;
          color: #172033;
        }
        header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 14px;
          background: #123b7a;
          color: #fff;
          border-radius: 7px;
        }
        h1 {
          margin: 0;
          font-size: 22px;
        }
        header p {
          margin: 2px 0 0;
          color: #dbeafe;
        }
        header > strong {
          padding: 7px 12px;
          background: #ffffff1f;
          border-radius: 20px;
        }
        .entry-tabs {
          display: flex;
          gap: 4px;
          padding-top: 7px;
        }
        .entry-tabs :global(a),
        .entry-tabs span {
          padding: 7px 14px;
          border: 1px solid #aebbd0;
          border-radius: 6px;
          text-decoration: none;
          color: #344054;
          background: #fff;
          font-weight: 800;
        }
        .entry-tabs span {
          background: #155bd7;
          color: #fff;
          border-color: #155bd7;
        }
        .scope {
          display: grid;
          grid-template-columns: 1.3fr 220px 1.5fr;
          gap: 10px;
          margin-top: 8px;
          padding: 8px;
          background: #f3f6fa;
          border: 1px solid #c9d4e3;
        }
        .scope > div,
        .scope > label {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .scope select,
        .scope input,
        button,
        textarea {
          border: 1px solid #aebbd0;
          border-radius: 5px;
        }
        .scope select,
        .scope input {
          height: 34px;
          padding: 0 8px;
        }
        .week-groups {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 4px;
        }
        .week-groups > div {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 3px;
        }
        .week-groups small {
          grid-column: 1/-1;
        }
        .week-groups button {
          min-height: 30px;
          background: white;
          font-weight: 700;
        }
        .week-groups button.active,
        .customers button.active {
          background: #155bd7;
          color: #fff;
          border-color: #155bd7;
        }
        .customers {
          display: flex;
          gap: 4px;
          overflow-x: auto;
          padding-bottom: 2px;
        }
        .customers button {
          min-width: 135px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          padding: 5px 7px;
          background: white;
        }
        .customers mark {
          margin-left: 5px;
          padding: 1px 3px;
          background: #fff3cd;
          border-radius: 3px;
        }
        .selected {
          display: flex;
          gap: 12px;
          align-items: center;
          padding: 6px 10px;
          background: #eaf2ff;
          border: 1px solid #9fc2f2;
        }
        .selected em {
          margin-left: auto;
          font-style: normal;
          color: #087443;
          font-weight: 800;
        }
        .notice {
          padding: 7px 10px;
          background: #fff5d8;
          border: 1px solid #e9bd50;
        }
        .workspace {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 430px;
          gap: 10px;
          margin-top: 8px;
        }
        .paste-box,
        aside section {
          border: 1px solid #c9d4e3;
          background: #fff;
          padding: 9px;
        }
        h2 {
          font-size: 15px;
          margin: 0 0 6px;
        }
        .paste-box textarea {
          width: 100%;
          height: 130px;
          resize: vertical;
          padding: 9px;
          font: 14px/1.45 sans-serif;
        }
        .actions {
          display: flex;
          justify-content: flex-end;
          gap: 6px;
          margin: 5px 0;
        }
        .actions button {
          padding: 7px 13px;
          background: #eaf2ff;
          font-weight: 800;
        }
        .actions .register {
          background: #087443;
          color: white;
        }
        .actions button:disabled {
          opacity: 0.45;
        }
        .analysis {
          max-height: calc(100vh - 460px);
          overflow: auto;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }
        th,
        td {
          padding: 5px;
          border: 1px solid #d8e0ea;
          text-align: left;
        }
        th {
          position: sticky;
          top: 0;
          background: #e8eef6;
        }
        .bad {
          background: #fff0ee;
          color: #a11;
        }
        .analysis td:nth-child(n + 3) {
          text-align: right;
        }
        .analysis td small {
          display: block;
          color: #65758b;
        }
        .empty {
          padding: 16px;
          text-align: center;
          color: #65758b;
          background: #f8fafc;
        }
        aside {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: calc(100vh - 245px);
          overflow: auto;
        }
        .current-list > div {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          padding: 4px;
          border-bottom: 1px solid #e5eaf0;
        }
        .current-list span {
          display: flex;
          min-width: 0;
          flex-direction: column;
        }
        .current-list b {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .current-list strong {
          color: #155bd7;
          white-space: nowrap;
        }
        .logs > div {
          display: flex;
          flex-direction: column;
          padding: 5px;
          border-bottom: 1px solid #eee;
        }
        .logs span,
        small {
          color: #65758b;
        }
        @media (max-width: 1000px) {
          .scope {
            grid-template-columns: 1fr;
          }
          .workspace {
            grid-template-columns: 1fr;
          }
          aside {
            max-height: none;
          }
          .analysis {
            max-height: none;
          }
        }
      `}</style>
    </>
  );
}
