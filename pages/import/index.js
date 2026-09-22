// pages/import/index.js
// 수입부 허브 — 흩어져 있던 수입부 메뉴를 한 화면의 탭으로. 첫 탭(입고 인사이트)은 내장, 나머지는 해당 화면으로 이동.
// 기획 근거(2026-09-22): 수입부 일과가 입고 원장 → 발주·입고 비교 → 농장 정산·송금 → 도착원가 → 피벗 순으로 흐르는데 메뉴가 4개 그룹에 흩어져 있었음.
import { useEffect, useState } from 'react';
import { IncomingInsight } from '../incoming/insight';

const INNER = [['board', '차수 보드'], ['reconcile', '발주·입고 비교'], ['ledger', '농장 정산·송금'], ['farm', '농장'], ['product', '품목'], ['eta', '입고 예정']];
const LINKS = [
  ['/incoming', '입고 원장', '원장·상세·패킹 업로드'],
  ['/incoming-price', '입고단가·송금 입력', '농장별 단가 피벗 · 크레딧 · 송금 기록'],
  ['/arrival-cost', '도착원가', '운임·관세 반영 도착원가'],
  ['/freight', '운송기준원가', 'BILL → 카테고리/품목 원가'],
  ['/stats/pivot-import', '수입 피벗·정산서', '차수별 농장 정산서'],
  ['/stats/pivot-import-farm-settings', '농장 결제일 설정', '농장별 결제 조건'],
  ['/sales/farm-quality', '농장 품질·클레임', '불량 공제·피드백'],
  ['/incoming/kakao-summary', '수입방 카톡 수량집계', '카톡 메시지 수량 집계'],
];

export default function ImportHub() {
  const [inner, setInner] = useState('board');
  useEffect(() => { const t = new URLSearchParams(window.location.search).get('tab'); if (t && INNER.some(([k]) => k === t)) setInner(t); }, []);
  return (
    <div className="ih">
      <div className="hub">
        <div className="ttl"><b>수입부</b><span>입고 → 비교 → 정산·송금 → 원가</span></div>
        <div className="inner">{INNER.map(([k, l]) => <button key={k} className={inner === k ? 'on' : ''} onClick={() => { setInner(k); window.history.replaceState(null, '', `/import?tab=${k}`); }}>{l}</button>)}</div>
        <div className="links">{LINKS.map(([h, l, d]) => <a key={h} href={h} title={d}>{l}</a>)}</div>
      </div>
      <IncomingInsight key={inner} initialTab={inner} hideTabs />
      <style jsx>{`
        .hub{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:6px 8px;background:#fff;border:1px solid var(--border);margin-bottom:6px}
        .ttl{display:flex;flex-direction:column;margin-right:6px}.ttl b{font-size:14px}.ttl span{font-size:10.5px;color:var(--text3)}
        .inner{display:inline-flex;gap:2px;padding:2px;background:#e7e9ee;border-radius:8px}.inner button{border:0;background:transparent;padding:4px 10px;border-radius:6px;cursor:pointer;color:#555;font:inherit;font-size:12px}.inner button.on{background:#fff;color:#1166BB;font-weight:700;box-shadow:0 1px 2px rgba(0,0,0,.1)}
        .links{display:flex;gap:4px;flex-wrap:wrap;margin-left:auto}.links a{font-size:11.5px;padding:3px 9px;border:1px solid var(--border2);border-radius:12px;background:#f7f8fa;color:var(--text1);text-decoration:none}.links a:hover{border-color:#1166BB;color:#1166BB}
      `}</style>
    </div>
  );
}
