import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

const fmt = value => Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 3 });

function tellOpener(message) {
  if (window.opener && !window.opener.closed) window.opener.postMessage({ type: 'CHINA_VOLUME_REVIEW_ACTION', ...message }, window.location.origin);
}

export default function ChinaVolumeBoardReview() {
  const router = useRouter();
  const [review, setReview] = useState(null);
  const [mode, setMode] = useState('all');

  useEffect(() => {
    if (!router.isReady) return;
    try {
      const key = String(router.query.key || '');
      const raw = key && sessionStorage.getItem(key);
      setReview(raw ? JSON.parse(raw) : null);
    } catch (_) { setReview(null); }
  }, [router.isReady, router.query.key]);

  const mismatches = useMemo(() => (review?.mismatches || []).filter(item => mode === 'all' || (mode === 'packing' ? Math.abs(Number(item.allocationDifference || 0)) >= 0.001 : Math.abs(Number(item.boardAllocationDifference || 0)) >= 0.001)), [review, mode]);
  const unmatched = review?.unmatched || [];
  const BoardKey = review?.boardKey || router.query.boardKey || '';

  return <>
    <Head><title>중국물량표 누락·초과 확인 - nenova ERP</title></Head>
    <main>
      <header><b>누락·초과 확인</b><span>{review ? `${review.year}년 ${review.week} · ${review.boardName || '작업본'}${BoardKey ? ` · BoardKey #${BoardKey}` : ''}` : '확인 데이터 불러오는 중'}</span><button onClick={() => window.close()}>닫기</button></header>
      {!review ? <section className="empty">원래 중국물량표 화면에서 [누락·초과 확인]을 다시 열어주세요.</section> : <>
        <section className="guide"><b>처리 방법을 선택하세요.</b><span>각 행에서 <strong>현재 표시수량 유지</strong>, <strong>매칭된 패킹수량 적용</strong>, <strong>셀 수정</strong>, <strong>보류</strong> 중 필요한 작업을 선택합니다. 적용·유지·보류 선택도 저장 전 작업이력에 남습니다.</span></section>
        <section className="summary">
          <button className={mode === 'all' ? 'active' : ''} onClick={() => setMode('all')}>전체 불일치 <b>{review.mismatches?.length || 0}</b></button>
          <button className={mode === 'packing' ? 'active' : ''} onClick={() => setMode('packing')}>패킹↔박스 배정</button>
          <button className={mode === 'display' ? 'active' : ''} onClick={() => setMode('display')}>표시↔박스 배정</button>
          <button className="unmatched" onClick={() => tellOpener({ action: 'OPEN_MATCH' })}>품목 미매칭 <b>{unmatched.filter(row => row.mappingStatus === 'PRODUCT_UNMATCHED').length}</b>건 처리</button>
        </section>
        {unmatched.length > 0 && <section className="card unmatched-card"><h2>업로드 입고원장 미매칭</h2><table><thead><tr><th>원본 행</th><th>Client No.</th><th>패킹 품목</th><th>수량</th><th>상태</th><th>처리</th></tr></thead><tbody>{unmatched.map(row => <tr key={`${row.sourceRow}-${row.sourceItemName}`}><td>{row.sourceRow}</td><td>{row.customerCode}</td><td>{row.sourceItemName}</td><td>{fmt(row.quantity)}</td><td>{row.mappingStatus === 'PRODUCT_UNMATCHED' ? '품목 매칭 필요' : '업체 매칭 필요'}</td><td><button className="primary" onClick={() => tellOpener({ action: 'OPEN_MATCH', sourceRow: row.sourceRow })}>품목 매칭</button><button onClick={() => tellOpener({ action: 'HOLD', sourceRow: row.sourceRow })}>보류</button></td></tr>)}</tbody></table></section>}
        <section className="card"><h2>업체·품목별 수량 차이</h2><table><thead><tr><th>업체</th><th>품목</th><th>패킹</th><th>박스배정</th><th>표시수량</th><th>패킹-배정</th><th>표시-배정</th><th>처리</th></tr></thead><tbody>{mismatches.map(item => <tr key={item.cellKey}><td>{item.customerName}</td><td>{item.productName}</td><td>{fmt(item.packingQuantity)}</td><td>{fmt(item.allocatedQuantity)}</td><td>{fmt(item.boardQuantity)}</td><td className={Math.abs(Number(item.allocationDifference || 0)) >= 0.001 ? 'bad' : ''}>{fmt(item.allocationDifference)}</td><td className={Math.abs(Number(item.boardAllocationDifference || 0)) >= 0.001 ? 'bad' : ''}>{fmt(item.boardAllocationDifference)}</td><td><button onClick={() => tellOpener({ action: 'KEEP_BOARD', cellKey: item.cellKey })}>표시 유지</button><button onClick={() => tellOpener({ action: 'APPLY_PACKING', cellKey: item.cellKey, packingQuantity: item.packingQuantity })}>패킹 적용</button><button className="primary" onClick={() => tellOpener({ action: 'OPEN_CELL', cellKey: item.cellKey })}>셀 수정</button><button onClick={() => tellOpener({ action: 'HOLD', cellKey: item.cellKey })}>보류</button></td></tr>)}{!mismatches.length && <tr><td colSpan="8" className="empty">선택한 조건의 차이가 없습니다.</td></tr>}</tbody></table></section>
      </>}
    </main>
    <style jsx global>{`
      *{box-sizing:border-box}html,body,#__next{margin:0;min-height:100%;font-family:Arial,'맑은 고딕',sans-serif;color:#172033;background:#eef1f5}main{min-height:100vh;padding:12px}header{height:34px;background:linear-gradient(90deg,#071780,#087bc2);color:#fff;display:flex;align-items:center;padding:0 11px;font-size:12px;gap:10px}header button{margin-left:auto;border:1px solid #ffffff88;background:transparent;border-radius:3px;color:#fff;padding:3px 10px}.guide{display:flex;gap:12px;align-items:flex-start;margin:8px 0;padding:9px 11px;background:#e9f2ff;border:1px solid #a8c8ef;border-radius:4px;font-size:12px}.guide b{white-space:nowrap;color:#173b72}.guide span{color:#4c6078}.summary{display:flex;gap:5px;margin-bottom:8px}.summary button{border:1px solid #b8c4d5;background:#fff;border-radius:4px;padding:6px 9px;font-size:11px;cursor:pointer}.summary button.active{color:#fff;background:#173b72;border-color:#173b72}.summary .unmatched{margin-left:auto;color:#a93b12;background:#fff5e9;border-color:#eab276}.card{background:#fff;border:1px solid #cbd3de;border-radius:4px;margin-bottom:8px;overflow:auto}.card h2{margin:0;padding:7px 9px;background:#f2f6fb;font-size:12px;color:#173b72}table{width:100%;border-collapse:collapse;font-size:11px}th,td{padding:6px;border-right:1px solid #dde2e8;border-bottom:1px solid #dde2e8;text-align:left;white-space:nowrap}th{background:#e8eef7;font-size:10px}td:nth-child(n+3){text-align:right}.unmatched-card td:nth-child(3),.unmatched-card td:nth-child(5),.unmatched-card td:nth-child(6),td:last-child{text-align:left}.bad{color:#b42318;font-weight:800;background:#fff7f4}td button{border:1px solid #aeb9c8;background:#fff;border-radius:3px;padding:3px 6px;font-size:10px;margin-right:3px;cursor:pointer}.primary{background:#155bd7;color:#fff;border-color:#155bd7}.empty{text-align:center;padding:30px;color:#738196}
    `}</style>
  </>;
}
