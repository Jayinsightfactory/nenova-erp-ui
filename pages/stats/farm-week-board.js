import Head from 'next/head';
import { useEffect, useMemo, useRef, useState } from 'react';
import DailyOrderSheetModal from '../../components/DailyOrderSheetModal';
import { getCurrentWeek } from '../../lib/useWeekInput';
import {
  classifyFarmComparisonRow,
  filterFarmBoardRows,
  formatFarmBoardCell,
  hasFarmRowActivityForTab,
  moveFarmWeek,
  pickActiveVarietySelection,
  summarizeComparisonBoard,
  summarizeFarmRows,
  varietyKey,
} from '../../lib/farmWeekBoard';
import styles from '../../components/FarmWeekBoard.module.css';

const tabs = [['farm', '농장별 입고'], ['order', '주문·입고 비교'], ['distribution', '분배·입고 비교']];

export default function FarmWeekBoard() {
  const [week, setWeek] = useState('');
  const [tab, setTab] = useState('farm');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [widths, setWidths] = useState({});

  const [poOpen, setPoOpen] = useState(false);
  const [poData, setPoData] = useState(null);
  const [poBusy, setPoBusy] = useState(false);
  const [poError, setPoError] = useState('');
  const [poStaffKey, setPoStaffKey] = useState('');
  const [poScope, setPoScope] = useState('all');

  const sequence = useRef(0);
  const poSequence = useRef(0);
  const poTriggerRef = useRef(null);

  useEffect(() => setWeek(moveFarmWeek(getCurrentWeek(), 1)), []);

  useEffect(() => {
    setStatusFilter('all');
  }, [tab, week, selected]);

  useEffect(() => {
    if (!week) return undefined;
    const id = ++sequence.current;
    const controller = new AbortController();
    setBusy(true);
    setError('');
    setData(null);
    const [year, ...parts] = week.split('-');
    fetch(`/api/stats/farm-week-board?orderYear=${year}&orderWeek=${parts.join('-')}`, { signal: controller.signal })
      .then(async response => {
        if (response.status === 401) throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.error || '조회 실패');
        if (id !== sequence.current) return;
        setData(body);
        setSelected(previous => pickActiveVarietySelection(previous, body.rows || [], body.varieties || [], tab));
      })
      .catch(err => {
        if (err.name !== 'AbortError' && id === sequence.current) setError(err.message);
      })
      .finally(() => {
        if (id === sequence.current) setBusy(false);
      });
    return () => {
      controller.abort();
      sequence.current += 1;
    };
  }, [week, refresh]);

  useEffect(() => {
    if (!data) return;
    setSelected(previous => pickActiveVarietySelection(previous, data.rows || [], data.varieties || [], tab));
  }, [tab, data]);

  useEffect(() => {
    const id = ++poSequence.current;
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (poStaffKey) params.set('staffKey', poStaffKey);
    if (poScope === 'direct') params.set('scope', 'direct');
    setPoBusy(true);
    setPoError('');
    fetch(`/api/stats/daily-order-sheet${params.toString() ? `?${params}` : ''}`, { signal: controller.signal })
      .then(async response => {
        if (response.status === 401) return;
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.error || '발주 내역서 조회 실패');
        if (id !== poSequence.current) return;
        setPoData(body);
      })
      .catch(err => {
        if (err.name !== 'AbortError' && id === poSequence.current) setPoError(err.message);
      })
      .finally(() => {
        if (id === poSequence.current) setPoBusy(false);
      });
    return () => {
      controller.abort();
      poSequence.current += 1;
    };
  }, [refresh, poStaffKey, poScope]);

  const baseVarietyRows = useMemo(
    () => filterFarmBoardRows(data?.rows || [], { selected, tab, statusFilter: 'all' }),
    [data, selected, tab],
  );
  const rows = useMemo(
    () => filterFarmBoardRows(data?.rows || [], { selected, tab, statusFilter }),
    [data, selected, tab, statusFilter],
  );
  const farms = useMemo(
    () => [...new Set(baseVarietyRows.flatMap(row => Object.entries(row.incoming).filter(([, qty]) => qty !== 0).map(([farm]) => farm)))].sort((a, b) => a.localeCompare(b, 'ko')),
    [baseVarietyRows],
  );
  const totals = useMemo(() => summarizeFarmRows(rows), [rows]);
  const comparisonSummary = useMemo(
    () => (tab === 'farm' ? null : summarizeComparisonBoard(baseVarietyRows, tab)),
    [baseVarietyRows, tab],
  );

  const varietyStats = useMemo(() => {
    const map = new Map();
    for (const row of data?.rows || []) {
      if (!hasFarmRowActivityForTab(row, tab)) continue;
      const key = varietyKey(row);
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [data, tab]);

  const countries = useMemo(() => {
    const groups = new Map();
    for (const row of data?.varieties || []) {
      const country = row.country || '';
      if (!groups.has(country)) groups.set(country, []);
      groups.get(country).push(row);
    }
    return [...groups.entries()];
  }, [data]);

  const activeCountry = selected ? JSON.parse(selected)[0] : null;
  const activeVarieties = countries.find(([country]) => country === activeCountry)?.[1] || [];

  function selectCountry(country, items) {
    if (country === activeCountry) return;
    const first =
      items.find(item => (data?.rows || []).some(row => varietyKey(row) === varietyKey(item) && hasFarmRowActivityForTab(row, tab))) ||
      items.find(item => (data?.rows || []).some(row => varietyKey(row) === varietyKey(item))) ||
      items[0];
    if (first) setSelected(varietyKey(first));
  }

  const columns = tab === 'farm'
    ? [
        ['name', '품목', 300],
        ['unit', '단위', 65],
        ...farms.map(f => ['farm:' + f, f, 75]),
        ['received', '입고 합계', 110],
        ['adjustment', '재고조정 참고', 110],
      ]
    : [
        ['name', '품목', 300],
        ['unit', '단위', 65],
        [tab, tab === 'order' ? '주문수량(주문등록)' : '분배수량', 120],
        ['received', '입고수량(실제입고)', 120],
        ['difference', tab === 'order' ? '차이(입고 − 주문)' : '차이(입고 − 분배)', 130],
        ['status', '대조상태', 98],
        ...farms.map(f => ['farm:' + f, f, 75]),
        ['adjustment', '재고조정 참고', 110],
      ];

  const nearby = week ? [-2, -1, 0, 1, 2].map(delta => moveFarmWeek(week, delta)).filter(Boolean) : [];
  const activeWeeks = useMemo(() => {
    const all = data?.activeWeeks || [];
    const withIncoming = all.filter(w => w.hasIncoming).slice(0, 6);
    const recentForward = all.filter(w => !w.hasIncoming).slice(0, 4);
    const merged = [...new Map([...recentForward, ...withIncoming].map(w => [w.week, w])).values()];
    return merged.sort((a, b) => b.week.localeCompare(a.week)).slice(0, 10);
  }, [data]);

  function cell(row, key) {
    if (key === 'name') return row.prodName;
    if (key === 'unit') return row.unit;
    if (key.startsWith('farm:')) return row.incoming[key.slice(5)] || 0;
    if (key === 'difference') return Math.round((row.received - row[tab]) * 1000) / 1000;
    if (key === 'status') return classifyFarmComparisonRow(row, tab);
    return row[key];
  }

  function resize(event, key, initial) {
    const start = event.clientX;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const onMove = e => setWidths(prev => ({ ...prev, [key]: Math.max(key === 'name' ? 160 : 65, Math.min(600, initial + e.clientX - start)) }));
    const finish = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', finish);
      target.removeEventListener('pointercancel', finish);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', finish);
    target.addEventListener('pointercancel', finish);
  }

  function resizeKey(event, key, width) {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    setWidths(v => ({ ...v, [key]: Math.max(key === 'name' ? 160 : 65, Math.min(600, (v[key] || width) + (event.key === 'ArrowLeft' ? -10 : 10))) }));
  }

  return (
    <section className={styles.root}>
      <Head><title>차수별 농장표 · 네노바</title></Head>
      <header className={styles.title}>
        <h1 data-desktop-chrome data-ui-page-title>차수별 농장표</h1>
        <span>조회 전용 · 연도·세부차수 격리 원장 대조</span>
        <div className={styles.toolbarRight}>
          {poData?.hasOrders && (
            <button
              ref={poTriggerRef}
              type="button"
              className={styles.poButton}
              onClick={() => setPoOpen(true)}
            >
              담당자별 주문발주 내역서
              <span className={styles.poBadge}>
                {poData.isAdmin
                  ? `당일 ${poData.totalMatchCount}건`
                  : `${poData.selectedStaffName} ${poData.totalMatchCount}건`}
              </span>
            </button>
          )}
          <button type="button" onClick={() => setRefresh(v => v + 1)} disabled={busy}>새로고침</button>
        </div>
      </header>

      <nav className={styles.tabs} aria-label="보기 선택">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      <div className={styles.week} aria-label="세부차수 선택">
        <b>차수</b>
        <button type="button" aria-label="이전 세부차수" disabled={!week || !moveFarmWeek(week, -1)} onClick={() => setWeek(moveFarmWeek(week, -1))}>◀</button>
        {nearby.map(value => (
          <button key={value} type="button" aria-pressed={week === value} onClick={() => setWeek(value)}>{value}</button>
        ))}
        <button type="button" aria-label="다음 세부차수" disabled={!week || !moveFarmWeek(week, 1)} onClick={() => setWeek(moveFarmWeek(week, 1))}>▶</button>
      </div>

      {activeWeeks.length > 0 && (
        <div className={styles.activeWeekBar} role="group" aria-label="입고·주문 활성 차수 바로가기">
          <span className={styles.activeWeekLabel}>데이터 존재 차수</span>
          {activeWeeks.map(item => {
            const stateLabel = item.hasOrder && item.hasIncoming
              ? '주문·입고'
              : item.hasOrder
                ? '주문만'
                : '입고만';
            return (
              <button
                key={item.week}
                type="button"
                aria-pressed={week === item.week}
                onClick={() => setWeek(item.week)}
              >
                {item.week}
                <span className={styles.weekTag}>({stateLabel})</span>
              </button>
            );
          })}
        </div>
      )}

      <div className={styles.selectionPanel}>
        <div className={styles.selectionRow} role="group" aria-label="국가 선택">
          <strong>국가</strong>
          <div>
            {countries.map(([country, items]) => {
              const activeItemCount = items.reduce((sum, item) => sum + (varietyStats.get(varietyKey(item)) || 0), 0);
              return (
                <button
                  key={country}
                  type="button"
                  aria-pressed={activeCountry === country}
                  onClick={() => selectCountry(country, items)}
                >
                  {country || '국가 미지정'}
                  {activeItemCount > 0 && <span className={styles.varietyCount}>({activeItemCount})</span>}
                </button>
              );
            })}
          </div>
        </div>
        <div className={styles.selectionRow} role="group" aria-label="품종 선택">
          <strong>품종</strong>
          <div>
            {activeVarieties.map(row => {
              const count = varietyStats.get(varietyKey(row)) || 0;
              return (
                <button
                  key={varietyKey(row)}
                  type="button"
                  aria-label={`${row.country || '국가 미지정'} · ${row.flower || '미분류'}`}
                  aria-pressed={selected === varietyKey(row)}
                  onClick={() => setSelected(varietyKey(row))}
                >
                  {row.flower || '미분류'}
                  {count > 0 && <span className={styles.varietyCount}>({count})</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className={styles.note}>
        {tab === 'order'
          ? '주문수량: 당차수 주문등록 합계 · 입고수량: 실제 농장 입고 합계 · 차이(입고 − 주문): 음수(-) 입고부족/미입고, 양수(+) 입고초과/미주문 입고 · 재고조정은 별도 참고 열로 표시됩니다.'
          : '입고: 실제 농장 입고 · 분배: 확정/미확정 포함 · 재고조정은 입고와 별도 표시 · 차이는 당차수 비교이며 가용재고가 아닙니다.'}
      </div>

      {busy ? (
        <p role="status">차수별 물량을 불러오는 중…</p>
      ) : error ? (
        <p role="alert" className={styles.error}>{error}</p>
      ) : (
        <>
          {tab !== 'farm' && comparisonSummary && (
            <div className={styles.comparisonStrip} aria-label="주문·입고 비교 요약 및 필터">
              <div className={styles.unitSummaryList}>
                {comparisonSummary.byUnit.length > 0 ? comparisonSummary.byUnit.map(unitRow => (
                  <div key={unitRow.unit} className={styles.unitSummaryCard}>
                    <strong>[{unitRow.unit}]</strong>
                    <span>{tab === 'order' ? '주문등록' : '분배수량'} <strong>{formatFarmBoardCell(unitRow.target, tab, tab)}</strong></span>
                    <span>·</span>
                    <span>실제입고 <strong>{formatFarmBoardCell(unitRow.received, 'received', tab)}</strong></span>
                    <span>·</span>
                    <span>
                      차이{' '}
                      <strong className={unitRow.difference < 0 ? styles.diffNegative : unitRow.difference > 0 ? styles.diffPositive : ''}>
                        {formatFarmBoardCell(unitRow.difference, 'difference', tab)}
                      </strong>
                    </span>
                  </div>
                )) : (
                  <span className={styles.statusFilterLabel}>선택한 차수·품종에 대조할 수량이 없습니다.</span>
                )}
              </div>
              <div className={styles.statusFilterRow} role="group" aria-label="대조 상태 필터">
                <span className={styles.statusFilterLabel}>대조 필터</span>
                {[
                  ['all', `전체 (${comparisonSummary.counts.all})`],
                  ['mismatch', `과부족 전체 (${comparisonSummary.counts.mismatch})`],
                  ['unreceived', `미입고·주문만 (${comparisonSummary.counts.unreceived})`],
                  ['unordered', `${tab === 'order' ? '미주문 입고' : '미분배 입고'} (${comparisonSummary.counts.unordered})`],
                  ['shortage', `입고부족 (${comparisonSummary.counts.shortage})`],
                  ['excess', `입고초과 (${comparisonSummary.counts.excess})`],
                  ['matched', `일치 (${comparisonSummary.counts.matched})`],
                ].map(([filterKey, filterLabel]) => (
                  <button
                    key={filterKey}
                    type="button"
                    aria-pressed={statusFilter === filterKey}
                    onClick={() => setStatusFilter(filterKey)}
                  >
                    {filterLabel}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={styles.caption}>
            <strong>
              {week} · {selected ? JSON.parse(selected).filter(Boolean).join(' · ') : '품종 선택'} · {rows.length}품목
              {farms.length > 0 ? ` · 입고농장 ${farms.length}곳` : tab !== 'farm' ? ' · 당차수 입고농장 0곳 (미입고 대조)' : ''}
            </strong>
            <span>열 경계를 끌어 너비 조절 · {data?.loadedAt && new Date(data.loadedAt).toLocaleTimeString('ko-KR')} 조회</span>
          </div>

          <div className={styles.scroller} tabIndex={0} aria-label="농장별 수량표 가로·세로 스크롤">
            <table style={{ width: columns.reduce((sum, [key, , width]) => sum + (widths[key] || width), 0) }}>
              <colgroup>
                {columns.map(([key, , width]) => <col key={key} style={{ width: widths[key] || width }} />)}
              </colgroup>
              <thead>
                <tr>
                  {columns.map(([key, label, width], index) => (
                    <th key={key} className={index === 0 ? styles.frozen : ''} scope="col" title={label}>
                      {label}
                      <span
                        role="separator"
                        aria-label={`${label} 열 너비`}
                        aria-orientation="vertical"
                        tabIndex={0}
                        className={styles.resize}
                        onPointerDown={e => resize(e, key, widths[key] || width)}
                        onKeyDown={e => resizeKey(e, key, width)}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.prodKey}>
                    {columns.map(([key], index) => {
                      const value = cell(row, key);
                      if (key === 'status' && value && typeof value === 'object') {
                        return (
                          <td key={key}>
                            <span className={`${styles.statusBadge} ${styles[`status_${value.status}`] || ''}`}>
                              {value.label}
                            </span>
                          </td>
                        );
                      }
                      const isCompareCol = tab !== 'farm' && (key === tab || key === 'received');
                      const diffClass = key === 'difference'
                        ? (value < 0 ? styles.shortage : value > 0 ? styles.excess : '')
                        : '';
                      return (
                        <td
                          key={key}
                          className={`${index === 0 ? styles.frozen : ''} ${isCompareCol ? styles.compareCol : ''} ${diffClass}`.trim()}
                          title={index === 0 ? row.prodName : undefined}
                        >
                          {formatFarmBoardCell(value, key, tab)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={columns.length}>선택한 차수·품종의 자료가 없습니다.</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                {totals.map(row => (
                  <tr key={row.unit}>
                    {columns.map(([key], index) => {
                      if (key === 'name') return <td key={key} className={styles.frozen}>{`${row.unit} 합계`}</td>;
                      if (key === 'unit') return <td key={key}>{row.unit}</td>;
                      if (key === 'status') {
                        const diffVal = Math.round((row.received - row[tab]) * 1000) / 1000;
                        const label = diffVal === 0 ? '합계 일치' : diffVal < 0 ? '합계 부족' : '합계 초과';
                        return <td key={key}>{label}</td>;
                      }
                      const totalVal = cell(row, key);
                      const diffClass = key === 'difference'
                        ? (totalVal < 0 ? styles.shortage : totalVal > 0 ? styles.excess : '')
                        : '';
                      return (
                        <td key={key} className={`${index === 0 ? styles.frozen : ''} ${diffClass}`.trim()}>
                          {formatFarmBoardCell(totalVal, key, tab)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tfoot>
            </table>
          </div>
        </>
      )}

      <DailyOrderSheetModal
        open={poOpen}
        onClose={() => setPoOpen(false)}
        triggerRef={poTriggerRef}
        data={poData}
        loading={poBusy}
        error={poError}
        onSelectStaff={nextKey => setPoStaffKey(nextKey)}
        onSelectScope={nextScope => setPoScope(nextScope)}
      />
    </section>
  );
}
