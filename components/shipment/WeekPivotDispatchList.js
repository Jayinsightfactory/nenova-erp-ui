import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import DistributionKakaoFeed from './DistributionKakaoFeed';
import DistributionDateEditor from './DistributionDateEditor';
import {
  WEEKDAY_DISPLAY_ORDER,
  getShipmentRegionStyle,
  parseShipmentDateMeta,
} from '../../lib/shipmentWeekdayFormat';

const MemoizedDispatchRow = memo(function DispatchRow({
  row,
  areaFirst,
  isGroupStart,
  orderYear,
  onOpenEditor,
}) {
  const dateMeta = parseShipmentDateMeta(row.DateLabel);
  const regionStyle = getShipmentRegionStyle(row.Area);
  const qtyText = Number(row.Quantity || 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  const prodDisplay = row.DisplayName || row.ProdName || '';
  const prodSub = [row.CounName, row.FlowerName].filter(Boolean).join(' · ');

  const areaCell = (
    <td className="col-area">
      <span
        className="region-badge"
        style={{ background: regionStyle.fill, color: regionStyle.ink }}
      >
        {regionStyle.label}
      </span>
    </td>
  );

  const dateCell = (
    <td className="col-date">
      {dateMeta.unassigned ? (
        <span className="date-unassigned">출고일 미지정</span>
      ) : (
        <span className="date-iso">{dateMeta.isoDate}</span>
      )}
    </td>
  );

  const weekdayCell = (
    <td className="col-weekday">
      <span
        className="weekday-badge"
        style={{ background: dateMeta.dayColor.fill, color: dateMeta.dayColor.ink }}
        title={dateMeta.weekdayFull}
      >
        {dateMeta.unassigned ? '미지정' : `${dateMeta.weekday}요일`}
      </span>
    </td>
  );

  return (
    <tr className={isGroupStart ? 'is-group-start' : ''}>
      <td className="col-week">
        <span className="week-chip">{row.OrderWeek}</span>
      </td>
      {areaFirst ? (
        <>
          {areaCell}
          {dateCell}
          {weekdayCell}
        </>
      ) : (
        <>
          {dateCell}
          {weekdayCell}
          {areaCell}
        </>
      )}
      <td className="col-cust" title={row.CustName}>
        {row.CustName}
      </td>
      <td className="col-prod" title={[prodSub, prodDisplay].filter(Boolean).join(' · ')}>
        <span className="prod-main">{prodDisplay}</span>
        {prodSub && <span className="prod-sub">{prodSub}</span>}
      </td>
      <td className="quantity">
        <strong>{qtyText}</strong>
        {row.OutUnit ? <span className="unit-label"> {row.OutUnit}</span> : null}
      </td>
      <td className="remarks" title={row.Descr || ''}>
        {row.Descr || '—'}
      </td>
      <td className="col-actions">
        {row.isFix ? <span className="fixed-badge">확정</span> : null}
        <button
          type="button"
          className="edit-date-btn"
          onClick={() =>
            onOpenEditor({
              scope: {
                orderYear,
                orderWeek: row.OrderWeek,
                custKey: row.CustKey,
                prodKey: row.ProdKey,
              },
              label: `${row.CustName} · ${prodDisplay}`,
            })
          }
        >
          출고일 변경
        </button>
      </td>
    </tr>
  );
});

export default function WeekPivotDispatchList({ orderYear, weekFrom, weekTo, revision }) {
  const [groupBy, setGroupBy] = useState('area');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [weekdayFilter, setWeekdayFilter] = useState('');
  const [page, setPage] = useState(0);
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState(null);
  const [showKakao, setShowKakao] = useState(false);
  const [editor, setEditor] = useState(null);

  const params = new URLSearchParams({
    orderYear,
    weekFrom,
    weekTo,
    view: 'dispatchList',
    groupBy,
    search,
    page,
  });
  const request = params.toString();

  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    fetch(`/api/shipment/stock-status?${request}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || '출고 일정을 조회하지 못했습니다.');
        }
        return data;
      })
      .then((data) => {
        if (!controller.signal.aborted) setResult(data);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setResult({ error: error.message });
      });
    return () => controller.abort();
  }, [request, version, revision]);

  const areaFirst = groupBy === 'area';
  const rawRows = useMemo(() => (Array.isArray(result?.rows) ? result.rows : []), [result]);

  const weekdayStats = useMemo(() => {
    const counts = new Map();
    for (const row of rawRows) {
      const meta = parseShipmentDateMeta(row.DateLabel);
      const key = meta.unassigned ? '미지정' : meta.weekday;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return WEEKDAY_DISPLAY_ORDER.filter((d) => counts.has(d)).map((d) => {
      const sampleMeta = d === '미지정' ? parseShipmentDateMeta('') : { dayColor: parseShipmentDateMeta(
        d === '목' ? '2026-11-26'
          : d === '금' ? '2026-11-27'
            : d === '토' ? '2026-11-28'
              : d === '일' ? '2026-11-29'
                : d === '월' ? '2026-11-30'
                  : d === '화' ? '2026-12-01'
                    : '2026-12-02',
      ).dayColor };
      return {
        day: d,
        count: counts.get(d),
        dayColor: sampleMeta.dayColor,
      };
    });
  }, [rawRows]);

  const activeWeekday = weekdayStats.some((s) => s.day === weekdayFilter) ? weekdayFilter : '';

  const visibleRows = useMemo(() => {
    if (!activeWeekday) return rawRows;
    return rawRows.filter((row) => {
      const meta = parseShipmentDateMeta(row.DateLabel);
      const key = meta.unassigned ? '미지정' : meta.weekday;
      return key === activeWeekday;
    });
  }, [rawRows, activeWeekday]);

  const summaryMetrics = useMemo(() => {
    const unitTotals = new Map();
    const custSet = new Set();
    const areaSet = new Set();
    for (const row of visibleRows) {
      const u = String(row.OutUnit || '단위').trim();
      unitTotals.set(u, (unitTotals.get(u) || 0) + (Number(row.Quantity) || 0));
      if (row.CustKey) custSet.add(row.CustKey);
      if (row.Area) areaSet.add(row.Area);
    }
    const unitText = [...unitTotals.entries()]
      .map(([u, q]) => `${q.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}${u}`)
      .join(' · ');
    return {
      rowCount: visibleRows.length,
      custCount: custSet.size,
      areaCount: areaSet.size,
      unitText: unitText || '0',
    };
  }, [visibleRows]);

  const handleOpenEditor = useCallback((payload) => {
    setEditor(payload);
  }, []);

  const weekScopeLabel =
    weekFrom && weekTo && weekFrom !== weekTo ? `${weekFrom} ~ ${weekTo}차` : `${weekFrom || ''}차`;

  return (
    <section className="dispatch-list" aria-label="차수별 출고 일정">
      <header className="dispatch-header">
        <div className="dispatch-title-group">
          <span className="dispatch-scope-pill">
            {orderYear}년 · {weekScopeLabel}
          </span>
          <h2>차수별 분배 출고리스트</h2>
          <span className="dispatch-subtitle">
            분배 출고일 · 출고요일 · 지역별 출고 내역 확인 및 일정 조정
          </span>
        </div>
        <div className="dispatch-kpi-strip" aria-label="출고 일정 요약">
          <span>
            표시 <b>{summaryMetrics.rowCount}</b>건
          </span>
          <span className="kpi-sep">·</span>
          <span>
            거래처 <b>{summaryMetrics.custCount}</b>곳
          </span>
          <span className="kpi-sep">·</span>
          <span>
            지역 <b>{summaryMetrics.areaCount}</b>권역
          </span>
          <span className="kpi-sep">·</span>
          <span>
            수량 <b>{summaryMetrics.unitText}</b>
          </span>
        </div>
      </header>

      <div className="controls">
        <label className="control-label">
          <span>정렬 기준</span>
          <select
            value={groupBy}
            onChange={(event) => {
              setGroupBy(event.target.value);
              setPage(0);
            }}
          >
            <option value="area">지역 → 출고일·요일 → 업체</option>
            <option value="day">출고일·요일 → 지역 → 업체</option>
          </select>
        </label>

        <form
          className="search-form"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(0);
            setSearch(searchInput.trim());
          }}
        >
          <input
            aria-label="품목·업체·지역 검색"
            placeholder="품목 · 업체 · 지역 검색"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            maxLength={100}
          />
          <button type="submit" className="btn-primary">
            검색
          </button>
          {(search || searchInput) && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                setSearch('');
                setPage(0);
              }}
            >
              초기화
            </button>
          )}
        </form>

        {weekdayStats.length > 0 && (
          <div className="weekday-filter-bar" role="group" aria-label="출고요일 빠른 필터">
            <button
              type="button"
              className={'day-chip' + (!activeWeekday ? ' is-active' : '')}
              aria-pressed={!activeWeekday}
              onClick={() => setWeekdayFilter('')}
            >
              전체 요일 ({rawRows.length})
            </button>
            {weekdayStats.map((stat) => {
              const selected = activeWeekday === stat.day;
              return (
                <button
                  key={stat.day}
                  type="button"
                  className={'day-chip' + (selected ? ' is-active' : '')}
                  aria-pressed={selected}
                  style={
                    selected
                      ? { background: stat.dayColor.ink, color: '#ffffff', borderColor: stat.dayColor.ink }
                      : { background: stat.dayColor.fill, color: stat.dayColor.ink }
                  }
                  onClick={() => setWeekdayFilter((prev) => (prev === stat.day ? '' : stat.day))}
                >
                  {stat.day === '미지정' ? '미지정' : `${stat.day}요일`} {stat.count}
                </button>
              );
            })}
          </div>
        )}

        <div className="toolbar-right">
          <button
            type="button"
            aria-expanded={showKakao}
            className={showKakao ? 'is-toggled' : ''}
            onClick={() => setShowKakao((value) => !value)}
          >
            카카오톡 요청
          </button>
          <button type="button" onClick={() => setVersion((value) => value + 1)}>
            다시 조회
          </button>
          <button type="button" className="print-hide" onClick={() => window.print()}>
            리스트 인쇄
          </button>
        </div>
      </div>

      {showKakao && (
        <div className="kakao-drawer print-hide">
          <DistributionKakaoFeed />
        </div>
      )}

      {result?.error ? (
        <p role="alert" className="status-box is-error">
          {result.error}
        </p>
      ) : !result ? (
        <p role="status" className="status-box">
          출고 일정을 불러오는 중…
        </p>
      ) : (
        <>
          <div className="table-card">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col" className="col-week">차수</th>
                    {areaFirst ? (
                      <>
                        <th scope="col" className="col-area">지역</th>
                        <th scope="col" className="col-date">출고일</th>
                        <th scope="col" className="col-weekday">출고요일</th>
                      </>
                    ) : (
                      <>
                        <th scope="col" className="col-date">출고일</th>
                        <th scope="col" className="col-weekday">출고요일</th>
                        <th scope="col" className="col-area">지역</th>
                      </>
                    )}
                    <th scope="col" className="col-cust">업체</th>
                    <th scope="col" className="col-prod">품목</th>
                    <th scope="col" className="quantity">분배수량</th>
                    <th scope="col" className="remarks">비고</th>
                    <th scope="col" className="col-actions print-hide">출고일 변경</th>
                  </tr>
                </thead>
                <tbody>
                  {!visibleRows.length && (
                    <tr>
                      <td colSpan={9} className="empty-cell">
                        조회된 분배 출고 내역이 없습니다.
                      </td>
                    </tr>
                  )}
                  {visibleRows.map((row, idx) => {
                    const prev = idx > 0 ? visibleRows[idx - 1] : null;
                    const isGroupStart = Boolean(
                      prev &&
                        (prev.OrderWeek !== row.OrderWeek ||
                          (areaFirst
                            ? prev.Area !== row.Area
                            : String(prev.DateLabel || '') !== String(row.DateLabel || ''))),
                    );
                    return (
                      <MemoizedDispatchRow
                        key={`${row.SdetailKey}:${row.SdateKey ?? 'unassigned'}`}
                        row={row}
                        areaFirst={areaFirst}
                        isGroupStart={isGroupStart}
                        orderYear={orderYear}
                        onOpenEditor={handleOpenEditor}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <nav className="pagination-bar print-hide" aria-label="출고 일정 페이지">
            <button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>
              이전 100건
            </button>
            <span className="page-indicator">{page + 1} 페이지 (페이지당 최대 100건)</span>
            <button
              type="button"
              disabled={!result.hasMore}
              onClick={() => setPage((value) => value + 1)}
            >
              다음 100건
            </button>
          </nav>
        </>
      )}

      {editor && (
        <DistributionDateEditor
          {...editor}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setVersion((value) => value + 1);
          }}
        />
      )}

      <style jsx>{`
        .dispatch-list {
          color: #0f172a;
          background: #f8fafc;
          padding: 10px 12px 16px;
          font-size: 13.5px;
          line-height: 1.4;
          font-family: 'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont,
            'Malgun Gothic', '맑은 고딕', 'Segoe UI', sans-serif;
          font-variant-numeric: tabular-nums;
        }
        .dispatch-header {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 8px 14px;
          padding: 8px 12px;
          margin-bottom: 8px;
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-left: 4px solid #1e3a8a;
          border-radius: 6px;
        }
        .dispatch-title-group {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
        }
        .dispatch-scope-pill {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 4px;
          background: #eff6ff;
          border: 1px solid #bfdbfe;
          color: #1e3a8a;
          font-size: 12.5px;
          font-weight: 700;
        }
        .dispatch-header h2 {
          margin: 0;
          font-size: 15.5px;
          font-weight: 800;
          color: #0f172a;
        }
        .dispatch-subtitle {
          font-size: 12.5px;
          color: #475569;
        }
        .dispatch-kpi-strip {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
          font-size: 12.5px;
          color: #334155;
        }
        .dispatch-kpi-strip b {
          color: #0f172a;
          font-weight: 800;
        }
        .kpi-sep {
          color: #94a3b8;
        }
        .controls {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          padding: 8px 12px;
          margin-bottom: 8px;
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
        }
        .control-label {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12.5px;
          font-weight: 700;
          color: #334155;
        }
        .search-form {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }
        input,
        select,
        button {
          font: inherit;
          font-size: 13px;
          height: 30px;
          padding: 0 9px;
          border: 1px solid #cbd5e1;
          border-radius: 5px;
          background: #ffffff;
          color: #0f172a;
          box-sizing: border-box;
        }
        input {
          min-width: 190px;
        }
        input:focus,
        select:focus {
          outline: 2px solid #2563eb;
          outline-offset: 1px;
          border-color: #2563eb;
        }
        button {
          cursor: pointer;
          font-weight: 600;
          color: #1e293b;
        }
        button:hover:not(:disabled) {
          background: #f1f5f9;
          border-color: #94a3b8;
        }
        button:disabled {
          opacity: 0.45;
          cursor: default;
        }
        .btn-primary {
          background: #1e3a8a;
          border-color: #1e3a8a;
          color: #ffffff;
        }
        .btn-primary:hover:not(:disabled) {
          background: #1d4ed8;
          border-color: #1d4ed8;
        }
        .is-toggled {
          background: #eff6ff;
          border-color: #3b82f6;
          color: #1d4ed8;
        }
        .weekday-filter-bar {
          display: inline-flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 4px;
        }
        .day-chip {
          height: 26px;
          padding: 0 8px;
          font-size: 12px;
          font-weight: 700;
          border-radius: 999px;
          border: 1px solid rgba(15, 23, 42, 0.14);
        }
        .day-chip.is-active {
          box-shadow: 0 0 0 2px rgba(30, 58, 138, 0.2);
        }
        .toolbar-right {
          margin-left: auto;
          display: inline-flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .kakao-drawer {
          margin-bottom: 8px;
          padding: 8px 10px;
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
        }
        .status-box {
          margin: 0;
          padding: 14px 16px;
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          color: #334155;
        }
        .status-box.is-error {
          background: #fef2f2;
          border-color: #fecaca;
          color: #991b1b;
          font-weight: 600;
        }
        .table-card {
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          overflow: hidden;
        }
        .table-scroll {
          overflow: auto;
          max-height: 74vh;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
          font-size: 13.5px;
        }
        th {
          position: sticky;
          top: 0;
          z-index: 2;
          padding: 6px 8px;
          background: #f1f5f9;
          color: #1e293b;
          font-size: 12.5px;
          font-weight: 700;
          border-bottom: 2px solid #94a3b8;
          white-space: nowrap;
        }
        .dispatch-list :global(tbody tr) {
          content-visibility: auto;
          contain-intrinsic-size: 0 30px;
        }
        .dispatch-list :global(tbody tr:hover) {
          background: #f8fafc;
        }
        .dispatch-list :global(tbody tr.is-group-start td) {
          border-top: 2px solid #94a3b8;
        }
        .dispatch-list :global(td) {
          padding: 4px 8px;
          height: 28px;
          border-bottom: 1px solid #e2e8f0;
          white-space: nowrap;
          vertical-align: middle;
          font-variant-numeric: tabular-nums;
        }
        .dispatch-list :global(.col-week) {
          width: 66px;
          text-align: center;
        }
        .dispatch-list :global(.week-chip) {
          display: inline-block;
          padding: 1px 6px;
          border-radius: 4px;
          background: #f1f5f9;
          color: #334155;
          font-size: 12.5px;
          font-weight: 700;
        }
        .dispatch-list :global(.col-area) {
          width: 96px;
        }
        .dispatch-list :global(.region-badge) {
          display: inline-block;
          padding: 2px 7px;
          border-radius: 4px;
          font-size: 12.5px;
          font-weight: 700;
          line-height: 1.2;
        }
        .dispatch-list :global(.col-date) {
          width: 98px;
        }
        .dispatch-list :global(.date-iso) {
          font-weight: 600;
          color: #0f172a;
        }
        .dispatch-list :global(.date-unassigned) {
          color: #64748b;
          font-size: 12.5px;
        }
        .dispatch-list :global(.col-weekday) {
          width: 78px;
          text-align: center;
        }
        .dispatch-list :global(.weekday-badge) {
          display: inline-block;
          min-width: 48px;
          padding: 2px 7px;
          border-radius: 4px;
          font-size: 12.5px;
          font-weight: 800;
          text-align: center;
          line-height: 1.2;
        }
        .dispatch-list :global(.col-cust) {
          font-weight: 700;
          color: #0f172a;
          max-width: 180px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .dispatch-list :global(.col-prod) {
          max-width: 320px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .dispatch-list :global(.prod-main) {
          font-weight: 600;
          color: #0f172a;
        }
        .dispatch-list :global(.prod-sub) {
          margin-left: 6px;
          font-size: 12px;
          color: #64748b;
        }
        .dispatch-list :global(.quantity) {
          width: 104px;
          text-align: right;
        }
        .dispatch-list :global(.quantity strong) {
          font-weight: 800;
          color: #0f172a;
        }
        .dispatch-list :global(.unit-label) {
          font-size: 12px;
          color: #475569;
        }
        .dispatch-list :global(.remarks) {
          max-width: 240px;
          overflow: hidden;
          text-overflow: ellipsis;
          color: #475569;
          font-size: 12.5px;
        }
        .dispatch-list :global(.col-actions) {
          width: 128px;
          text-align: right;
        }
        .dispatch-list :global(.fixed-badge) {
          display: inline-block;
          margin-right: 6px;
          padding: 1px 6px;
          border-radius: 4px;
          background: #dcfce7;
          color: #166534;
          font-size: 12px;
          font-weight: 700;
        }
        .dispatch-list :global(.edit-date-btn) {
          height: 24px;
          padding: 0 7px;
          font-size: 12px;
          border: 1px solid #cbd5e1;
          border-radius: 4px;
          background: #ffffff;
          color: #1e3a8a;
          font-weight: 600;
          cursor: pointer;
        }
        .dispatch-list :global(.edit-date-btn:hover) {
          background: #eff6ff;
          border-color: #93c5fd;
        }
        .empty-cell {
          padding: 22px 12px !important;
          text-align: center;
          color: #64748b;
        }
        .pagination-bar {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 8px;
        }
        .page-indicator {
          font-size: 12.5px;
          font-weight: 600;
          color: #475569;
        }
        @media print {
          .dispatch-list {
            background: #ffffff;
            padding: 0;
          }
          .controls,
          .print-hide {
            display: none !important;
          }
          .table-scroll {
            max-height: none;
            overflow: visible;
          }
        }
      `}</style>
    </section>
  );
}
