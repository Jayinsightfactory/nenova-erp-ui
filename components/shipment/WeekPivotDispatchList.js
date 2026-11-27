import { useEffect, useState } from 'react';
import DistributionKakaoFeed from './DistributionKakaoFeed';
import DistributionDateEditor from './DistributionDateEditor';

const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
function dateLabel(date) {
  if (!date) return '출고일 미지정';
  return `${date} (${weekdays[new Date(date).getUTCDay()]})`;
}

export default function WeekPivotDispatchList({ orderYear, weekFrom, weekTo, revision }) {
  const [groupBy, setGroupBy] = useState('area');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState(null);
  const [showKakao, setShowKakao] = useState(false);
  const [editor, setEditor] = useState(null);
  const params = new URLSearchParams({ orderYear, weekFrom, weekTo, view: 'dispatchList', groupBy, search, page });
  const request = params.toString();

  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    fetch(`/api/shipment/stock-status?${request}`, { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '출고 일정을 조회하지 못했습니다.');
        return data;
      })
      .then(data => { if (!controller.signal.aborted) setResult(data); })
      .catch(error => { if (!controller.signal.aborted) setResult({ error: error.message }); });
    return () => controller.abort();
  }, [request, version, revision]);

  const areaFirst = groupBy === 'area';

  return (
    <section className="dispatch-list" aria-label="차수별 출고 일정">
      <h2>[핵심 목적 · PURPOSE] 여러 차수의 업체별 출고 일정 확인</h2>
      <div className="controls">
        <label>열 순서 <select value={groupBy} onChange={event => { setGroupBy(event.target.value); setPage(0); }}>
          <option value="area">지역 → 요일 → 업체</option>
          <option value="day">요일 → 지역 → 업체</option>
        </select></label>
        <form onSubmit={event => { event.preventDefault(); setPage(0); setSearch(searchInput.trim()); }}>
          <input aria-label="품목·업체·지역 검색" placeholder="품목·업체·지역 검색" value={searchInput}
            onChange={event => setSearchInput(event.target.value)} maxLength={100} />
          <button type="submit">검색</button>
        </form>
        <button type="button" aria-expanded={showKakao} onClick={() => setShowKakao(value => !value)}>카카오톡 요청</button>
        <button type="button" onClick={() => setVersion(value => value + 1)}>다시 조회</button>
      </div>
      {showKakao && <DistributionKakaoFeed />}
      {result?.error ? <p role="alert">{result.error}</p> : !result ? <p role="status">출고 일정 조회 중…</p> : (
        <>
          <div className="table-scroll">
            <table>
              <thead><tr>
                <th scope="col">차수</th>
                <th scope="col">{areaFirst ? '지역' : '출고일'}</th>
                <th scope="col">{areaFirst ? '출고일' : '지역'}</th>
                <th scope="col">업체</th><th scope="col">품목</th><th scope="col">분배수량</th>
                <th scope="col">비고</th><th scope="col">출고일 변경</th>
              </tr></thead>
              <tbody>
                {!result.rows.length && <tr><td colSpan={8}>조회된 분배가 없습니다.</td></tr>}
                {result.rows.map(row => {
                  const date = dateLabel(row.DateLabel);
                  return <tr key={`${row.SdetailKey}:${row.SdateKey ?? 'unassigned'}`}>
                    <td>{row.OrderWeek}</td><td>{areaFirst ? row.Area : date}</td><td>{areaFirst ? date : row.Area}</td>
                    <td>{row.CustName}</td><td>{row.ProdName}</td>
                    <td className="quantity">{Number(row.Quantity).toLocaleString('ko-KR')} {row.OutUnit}</td>
                    <td className="remarks" title={row.Descr}>{row.Descr || '—'}</td>
                    <td>{row.isFix ? <span className="fixed">확정</span> : null}<button type="button" onClick={() => setEditor({
                      scope: { orderYear, orderWeek: row.OrderWeek, custKey: row.CustKey, prodKey: row.ProdKey },
                      label: `${row.CustName} · ${row.ProdName}`,
                    })}>변경</button></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          <nav className="controls" aria-label="출고 일정 페이지">
            <button type="button" disabled={page === 0} onClick={() => setPage(value => value - 1)}>이전</button>
            <span>{page + 1} 페이지</span>
            <button type="button" disabled={!result.hasMore} onClick={() => setPage(value => value + 1)}>다음</button>
          </nav>
        </>
      )}
      {editor && <DistributionDateEditor {...editor} onClose={() => setEditor(null)} onSaved={async () => {
        setVersion(value => value + 1);
      }} />}
      <style jsx>{`
        .dispatch-list {color: #0f172a; background: #fff; font-size: 14px;
          font-family: 'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', '맑은 고딕', 'Segoe UI', sans-serif;}
        .controls, form {display: flex; align-items: center; flex-wrap: wrap; gap: 8px;}
        .controls, p, h2 {padding: 10px;}
        h2 {margin: 0; font-size: 17px;}
        input, select, button {font: inherit; padding: 4px 8px;}
        .table-scroll {overflow: auto; max-height: 72vh;}
        table {width: 100%; border-collapse: collapse; text-align: left; font-size: inherit;}
        th, td {padding: 6px 10px; border-bottom: 1px solid #cbd5e1;}
        th {position: sticky; top: 0; background: #f1f5f9; color: #334155; white-space: nowrap;}
        td {white-space: nowrap; font-variant-numeric: tabular-nums;}
        .quantity {text-align: right;}
        .fixed {margin-right: 8px; color: #334155;}
        .remarks {max-width: 28ch; overflow: hidden; text-overflow: ellipsis;}
      `}</style>
    </section>
  );
}
