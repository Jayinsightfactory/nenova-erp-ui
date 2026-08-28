import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

const fmt = value => Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 3 });

function tellOpener(message) {
  if (window.opener && !window.opener.closed) window.opener.postMessage({ type: 'CHINA_VOLUME_REVIEW_ACTION', ...message }, window.location.origin);
}

function editDistribution(sourceRow) {
  tellOpener({ action: 'OPEN_DISTRIBUTION', sourceRow });
  window.close();
}

function editMatching(sourceRow) {
  tellOpener({ action: 'OPEN_MATCH', sourceRow });
  window.close();
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

  const isUploadReview = review?.packingPhase === 'REVIEW';
  const mismatches = useMemo(() => {
    if (review?.packingPhase === 'REVIEW') {
      return (review?.invoiceMismatches || []).filter(item => mode === 'all' || (mode === 'shortage' ? Number(item.invoiceDifference || 0) < -0.001 : Number(item.invoiceDifference || 0) > 0.001));
    }
    return (review?.mismatches || []).filter(item => mode === 'all' || (mode === 'packing' ? Math.abs(Number(item.allocationDifference || 0)) >= 0.001 : Math.abs(Number(item.boardAllocationDifference || 0)) >= 0.001));
  }, [review, mode]);
  const unmatched = review?.unmatched || [];
  const BoardKey = review?.boardKey || router.query.boardKey || '';

  return <>
    <Head><title>중국물량표 누락·초과 확인 - nenova ERP</title></Head>
    <main>
      <header><b>{isUploadReview ? '주문수량 ↔ 인보이스 수량 확인' : '적용 결과 확인'}</b><span>{review ? `${review.year}년 ${review.week} · ${review.boardName || '작업본'}${BoardKey ? ` · BoardKey #${BoardKey}` : ''}` : '확인 데이터 불러오는 중'}</span><button onClick={() => window.close()}>닫기</button></header>
      {!review ? <section className="empty">원래 중국물량표 화면에서 [누락·초과 확인]을 다시 열어주세요.</section> : <>
        <section className="guide"><b>{isUploadReview ? '이 화면에서 확인할 내용' : '적용 결과 확인 방법'}</b><span>{isUploadReview ? <>전산에 주문된 수량과 업로드한 인보이스 수량이 다른 항목만 표시합니다. <strong>부족</strong>은 인보이스가 주문보다 적고, <strong>초과</strong>는 인보이스가 주문보다 많다는 뜻입니다. 수량이 같은 항목은 표시하지 않습니다.</> : <>인보이스 수량이 최종 물량표와 박스별 수량에 빠짐없이 반영됐는지 확인합니다. 문제가 있는 셀만 수정하거나 보류할 수 있습니다.</>}</span></section>
        <section className="summary">
          <button className={mode === 'all' ? 'active' : ''} onClick={() => setMode('all')}>{isUploadReview ? '수량이 다른 항목' : '적용 오류 전체'} <b>{isUploadReview ? review.invoiceMismatches?.length || 0 : review.mismatches?.length || 0}</b></button>
          {isUploadReview ? <><button className={mode === 'shortage' ? 'active' : ''} onClick={() => setMode('shortage')}>인보이스 부족</button><button className={mode === 'excess' ? 'active' : ''} onClick={() => setMode('excess')}>인보이스 초과</button></> : <><button className={mode === 'packing' ? 'active' : ''} onClick={() => setMode('packing')}>인보이스↔박스 합계</button><button className={mode === 'display' ? 'active' : ''} onClick={() => setMode('display')}>최종표↔박스 합계</button></>}
          <button className="unmatched" onClick={() => tellOpener({ action: 'OPEN_MATCH' })}>품목 미매칭 <b>{unmatched.filter(row => row.mappingStatus === 'PRODUCT_UNMATCHED').length}</b>건 처리</button>
        </section>
        {unmatched.length > 0 && <section className="card unmatched-card"><h2>업로드 입고원장 미매칭</h2><table><thead><tr><th>원본 행</th><th>Client No.</th><th>패킹 품목</th><th>수량</th><th>상태</th><th>처리</th></tr></thead><tbody>{unmatched.map(row => <tr key={`${row.sourceRow}-${row.sourceItemName}`}><td>{row.sourceRow}</td><td>{row.customerCode}</td><td>{row.sourceItemName}</td><td>{fmt(row.quantity)}</td><td>{row.mappingStatus === 'PRODUCT_UNMATCHED' ? '품목 매칭 필요' : '업체 매칭 필요'}</td><td><button className="primary" onClick={() => editMatching(row.sourceRow)}>업체·품목 매칭 수정</button><button onClick={() => tellOpener({ action: 'HOLD', sourceRow: row.sourceRow })}>보류</button></td></tr>)}</tbody></table></section>}
        {isUploadReview && <section className="card"><h2>인보이스 박스 분배</h2><table><thead><tr><th>원본 행</th><th>Client No.</th><th>인보이스 품목</th><th>박스번호</th><th>인보이스 수량</th><th>현재 분배</th><th>상태</th><th>처리</th></tr></thead><tbody>{(review.packingRows || []).filter(row => row.mappingStatus === 'MATCHED').map(row => { const distributed = (row.distributions || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0); const remaining = Math.round((Number(row.quantity || 0) - distributed) * 1000) / 1000; return <tr key={row.sourceRow}><td>{row.sourceRow}</td><td>{row.customerCode}</td><td>{row.sourceItemName}</td><td>{row.sourceBoxText || '-'}</td><td>{fmt(row.quantity)}</td><td>{fmt(distributed)}</td><td><span className={`result ${Math.abs(remaining) < 0.001 ? 'complete' : 'shortage'}`}>{Math.abs(remaining) < 0.001 ? '전량 분배' : remaining > 0 ? `${fmt(remaining)} 미분배` : `${fmt(Math.abs(remaining))} 초과분배`}</span></td><td><button onClick={() => editMatching(row.sourceRow)}>매칭 수정</button><button className="primary" onClick={() => editDistribution(row.sourceRow)}>박스 직접 분배</button></td></tr>; })}</tbody></table></section>}
        {isUploadReview ? <section className="card"><h2>전산 주문 대비 인보이스 부족·초과</h2><table><thead><tr><th>업체</th><th>품목</th><th>전산 주문수량</th><th>인보이스 수량</th><th>차이</th><th>판정</th><th>처리</th></tr></thead><tbody>{mismatches.map(item => { const diff = Number(item.invoiceDifference || 0); return <tr key={item.cellKey}><td>{item.customerName}</td><td>{item.productName}</td><td>{fmt(item.pivotQuantity)}</td><td>{fmt(item.packingQuantity)}</td><td className="bad">{diff > 0 ? '+' : ''}{fmt(diff)}</td><td><span className={`result ${diff < 0 ? 'shortage' : 'excess'}`}>{diff < 0 ? `인보이스 ${fmt(Math.abs(diff))} 부족` : `인보이스 ${fmt(diff)} 초과`}</span></td><td><button className="primary" onClick={() => tellOpener({ action: 'OPEN_CELL', cellKey: item.cellKey })}>물량표에서 확인</button><button onClick={() => tellOpener({ action: 'HOLD', cellKey: item.cellKey })}>나중에 확인</button></td></tr>; })}{!mismatches.length && <tr><td colSpan="7" className="empty success">✓ 전산 주문수량과 인보이스 수량이 모두 일치합니다.</td></tr>}</tbody></table></section> : <section className="card"><h2>인보이스 적용 결과</h2><table><thead><tr><th>업체</th><th>품목</th><th>인보이스 수량</th><th>박스별 수량 합계</th><th>최종표 수량</th><th>인보이스-박스 차이</th><th>최종표-박스 차이</th><th>처리</th></tr></thead><tbody>{mismatches.map(item => <tr key={item.cellKey}><td>{item.customerName}</td><td>{item.productName}</td><td>{fmt(item.packingQuantity)}</td><td>{fmt(item.allocatedQuantity)}</td><td>{fmt(item.boardQuantity)}</td><td className={Math.abs(Number(item.allocationDifference || 0)) >= 0.001 ? 'bad' : ''}>{fmt(item.allocationDifference)}</td><td className={Math.abs(Number(item.boardAllocationDifference || 0)) >= 0.001 ? 'bad' : ''}>{fmt(item.boardAllocationDifference)}</td><td><button onClick={() => tellOpener({ action: 'KEEP_BOARD', cellKey: item.cellKey })}>현재 수량 유지</button><button onClick={() => tellOpener({ action: 'APPLY_PACKING', cellKey: item.cellKey, packingQuantity: item.packingQuantity })}>인보이스 수량 적용</button><button className="primary" onClick={() => tellOpener({ action: 'OPEN_CELL', cellKey: item.cellKey })}>수량·박스 수정</button><button onClick={() => tellOpener({ action: 'HOLD', cellKey: item.cellKey })}>나중에 확인</button></td></tr>)}{!mismatches.length && <tr><td colSpan="8" className="empty success">✓ 인보이스 수량, 최종표 수량, 박스별 수량이 모두 일치합니다.</td></tr>}</tbody></table></section>}
      </>}
    </main>
    <style jsx global>{`
      *{box-sizing:border-box}html,body,#__next{margin:0;min-height:100%;font-family:Arial,'맑은 고딕',sans-serif;color:#172033;background:#eef1f5}main{min-height:100vh;padding:12px}header{height:34px;background:linear-gradient(90deg,#071780,#087bc2);color:#fff;display:flex;align-items:center;padding:0 11px;font-size:12px;gap:10px}header button{margin-left:auto;border:1px solid #ffffff88;background:transparent;border-radius:3px;color:#fff;padding:3px 10px}.guide{display:flex;gap:12px;align-items:flex-start;margin:8px 0;padding:9px 11px;background:#e9f2ff;border:1px solid #a8c8ef;border-radius:4px;font-size:12px}.guide b{white-space:nowrap;color:#173b72}.guide span{color:#4c6078}.summary{display:flex;gap:5px;margin-bottom:8px}.summary button{border:1px solid #b8c4d5;background:#fff;border-radius:4px;padding:6px 9px;font-size:11px;cursor:pointer}.summary button.active{color:#fff;background:#173b72;border-color:#173b72}.summary .unmatched{margin-left:auto;color:#a93b12;background:#fff5e9;border-color:#eab276}.card{background:#fff;border:1px solid #cbd3de;border-radius:4px;margin-bottom:8px;overflow:auto}.card h2{margin:0;padding:7px 9px;background:#f2f6fb;font-size:12px;color:#173b72}table{width:100%;border-collapse:collapse;font-size:11px}th,td{padding:6px;border-right:1px solid #dde2e8;border-bottom:1px solid #dde2e8;text-align:left;white-space:nowrap}th{background:#e8eef7;font-size:10px}td:nth-child(n+3){text-align:right}.unmatched-card td:nth-child(3),.unmatched-card td:nth-child(5),.unmatched-card td:nth-child(6),td:last-child{text-align:left}.bad{color:#b42318;font-weight:800;background:#fff7f4}.result{display:inline-block;border-radius:10px;padding:3px 7px;font-weight:800}.result.shortage{color:#b42318;background:#fff0ed}.result.excess{color:#9a5b00;background:#fff4d6}.result.complete{color:#08783e;background:#eaf8ef}td button{border:1px solid #aeb9c8;background:#fff;border-radius:3px;padding:3px 6px;font-size:10px;margin-right:3px;cursor:pointer}.primary{background:#155bd7;color:#fff;border-color:#155bd7}.empty{text-align:center;padding:30px;color:#738196}.empty.success{color:#08783e;background:#f2fff7;font-weight:800}
    `}</style>
  </>;
}
