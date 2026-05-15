// pages/dev/project-plan.js — 작업내역 / 페이지 기획 / 남은 구현 현황

const updatedAt = '2026-05-15';

const workItems = [
  { area: 'EXE 분석', detail: 'Nenova.exe Forms, 메뉴, 주요 SP, DB 흐름 분석', status: '완료' },
  { area: '메뉴 검증', detail: 'EXE와 웹 메뉴/버튼/데이터 매칭 감사 문서 작성', status: '완료' },
  { area: '주문등록', detail: '붙여넣기 주문등록 후 실제 OrderDetail 필수값, 히스토리, 재고계산 보강', status: '완료' },
  { area: '출고분배', detail: 'ShipmentMaster/Detail, ShipmentDate, ShipmentHistory 실제 흐름 보강', status: '완료' },
  { area: '차수피벗', detail: '주문등록 후 차수피벗/엑셀로 바로 이동', status: '완료' },
  { area: '재고관리', detail: 'StockHistory와 usp_StockCalculation 기준으로 보강', status: '완료' },
  { area: '경영지원/Ecount', detail: '웹 계산값과 ERP 원본 차이 문서화', status: '진행중' },
  { area: '차수 확정 현황', detail: '구간 확정취소, 확정상태, 음수재고 품목 표시', status: '완료' },
  { area: '빌드 환경', detail: 'node_modules 생성, npm run build 통과', status: '완료' },
];

const pages = [
  { path: '/orders/paste', purpose: '붙여넣기 주문등록', status: '완료', remaining: '실제 DB 케이스 반복 검증' },
  { path: '/shipment/distribute', purpose: '출고분배/출고일 지정/확정', status: '진행중', remaining: '부분확정/출고일 지정 사용성 정리' },
  { path: '/shipment/fix-status', purpose: '차수 확정 현황/구간 취소', status: '완료', remaining: '운영 DB 실측 테스트' },
  { path: '/shipment/week-pivot', purpose: '차수피벗/엑셀', status: '완료', remaining: '히스토리 표시 방식 확정' },
  { path: '/stock', purpose: '재고관리', status: '진행중', remaining: 'Product.Stock vs ProductStock 차이 진단' },
  { path: '/sales/status', purpose: '판매현황', status: '검증필요', remaining: '이카운트 판매전표 원본 비교' },
  { path: '/sales/ar', purpose: '채권현황', status: '검증필요', remaining: '이카운트 미수/수금 원장 비교' },
  { path: '/sales/tax-invoice', purpose: '세금계산서 진행', status: '검증필요', remaining: 'ERP 진행상태 원본 연동' },
  { path: '/purchase/status', purpose: '구매현황', status: '검증필요', remaining: '이카운트 구매 원장/코드 매핑' },
  { path: '/finance/bank', purpose: '입출금 조회', status: '미완료', remaining: '신한은행 또는 ERP 원본 연동' },
  { path: '/finance/exchange', purpose: '환율 관리', status: '검증필요', remaining: 'ERP/회사 기준환율 결정' },
  { path: '/ecount/dashboard', purpose: '이카운트 연결/전송 현황', status: '진행중', remaining: '원본 pull/비교 현황 추가' },
  { path: '/dev/project-plan', purpose: '작업내역/기획/남은구현 현황판', status: '완료', remaining: '작업 때마다 업데이트' },
];

const remaining = [
  '이카운트 ERP 원본과 웹 경영지원 숫자의 100% 매칭',
  '판매/채권/세금계산서/구매 원본 조회 또는 ERP 엑셀 업로드 대조',
  'Nenova.exe 전체 메뉴별 화면/버튼/데이터값 실측 검증',
  '운영 DB에서 차수 구간 확정취소 테스트',
  'Product.Stock과 ProductStock 차이 진단 및 보정',
  '신한은행 입출금 API 또는 대체 원본 연동',
  'Railway 운영환경 DB 접속/IP 화이트리스트 점검',
  'npm audit 보안 경고 처리',
  '경영지원 화면에 ERP 검증전/불일치/일치 상태 표시',
  '주요 쓰기 작업의 복구/롤백 시나리오 정리',
];

const nextSteps = [
  '운영 DB에서 /shipment/fix-status 조회만 먼저 확인',
  '1개 좁은 구간으로 확정취소 테스트',
  'Product.Stock vs ProductStock 차이 리포트 추가',
  '이카운트 판매전표/채권 데이터 대조 방식 결정',
  '경영지원 화면에 ERP 검증상태 컬럼 추가',
  'Railway 배포 전 보안/환경변수/빌드 재검증',
];

function Badge({ status }) {
  const map = {
    완료: ['#d1fae5', '#065f46'],
    진행중: ['#fef3c7', '#92400e'],
    검증필요: ['#dbeafe', '#1d4ed8'],
    미완료: ['#fee2e2', '#991b1b'],
  };
  const [bg, color] = map[status] || ['#e5e7eb', '#374151'];
  return <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: 10, background: bg, color, fontSize: 11, fontWeight: 800 }}>{status}</span>;
}

export default function ProjectPlan() {
  const doneCount = pages.filter(p => p.status === '완료').length;
  const activeCount = pages.filter(p => p.status === '진행중').length;
  const verifyCount = pages.filter(p => p.status === '검증필요').length;
  const todoCount = pages.filter(p => p.status === '미완료').length + remaining.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, margin: '0 0 6px', letterSpacing: 0 }}>작업내역 / 페이지 기획 / 남은 구현</h1>
          <div style={{ color: 'var(--text3)', fontSize: 13 }}>최신 업데이트: {updatedAt}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a className="btn btn-secondary btn-sm" href="/nenova-workflow-overview.svg" target="_blank" rel="noreferrer">SVG 흐름도</a>
          <a className="btn btn-secondary btn-sm" href="/shipment/fix-status">차수 확정 현황</a>
          <a className="btn btn-secondary btn-sm" href="/full-flow-audit-2026-05-15.md" target="_blank" rel="noreferrer">전체 감사 문서</a>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(130px, 1fr))', gap: 10 }}>
        {[
          ['완료 페이지', doneCount, '#065f46'],
          ['진행중', activeCount, '#92400e'],
          ['검증필요', verifyCount, '#1d4ed8'],
          ['남은 항목', todoCount, '#991b1b'],
        ].map(([label, value, color]) => (
          <div key={label} className="card" style={{ padding: '12px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 5 }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'var(--mono)', color }}>{value}</div>
          </div>
        ))}
      </div>

      <section className="card">
        <div className="card-header"><span className="card-title">최근 작업내역</span></div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>구분</th><th>내용</th><th>상태</th></tr></thead>
            <tbody>
              {workItems.map((w, i) => (
                <tr key={i}><td className="name">{w.area}</td><td>{w.detail}</td><td><Badge status={w.status} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-header"><span className="card-title">페이지 기획/구현 현황</span></div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>페이지</th><th>목적</th><th>상태</th><th>남은 작업</th></tr></thead>
            <tbody>
              {pages.map(p => (
                <tr key={p.path}>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{p.path}</td>
                  <td>{p.purpose}</td>
                  <td><Badge status={p.status} /></td>
                  <td>{p.remaining}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <section className="card">
          <div className="card-header"><span className="card-title">아직 구현/검증 못한 것</span></div>
          <ol style={{ margin: 0, padding: '14px 18px 18px 34px', fontSize: 13, lineHeight: 1.8 }}>
            {remaining.map(item => <li key={item}>{item}</li>)}
          </ol>
        </section>
        <section className="card">
          <div className="card-header"><span className="card-title">다음 추천 순서</span></div>
          <ol style={{ margin: 0, padding: '14px 18px 18px 34px', fontSize: 13, lineHeight: 1.8 }}>
            {nextSteps.map(item => <li key={item}>{item}</li>)}
          </ol>
        </section>
      </div>
    </div>
  );
}
