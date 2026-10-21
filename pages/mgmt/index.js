// 경영관리 홈. 공백 보고서 상위 10 기능의 진입점. 기능이 구현되면 카드가 활성화된다.
import Link from 'next/link';

const FEATURES = [
  { id: 'credit-limit', no: 1, label: '여신한도', desc: '거래처별 한도·잔액 대비 %·초과 경고', href: '/mgmt/credit-limit', ready: true },
  { id: 'ar-aging', no: 2, label: '채권 aging(일수 구간)', desc: '0-30 / 31-60 / 61-90 / 90+', href: '/mgmt/ar-aging', ready: true },
  { id: 'receipt-match', no: 3, label: '입금 대사', desc: '입금 → 거래처 후보 → 확정(승인)', href: '/mgmt/receipt-match', ready: false, group: 'B' },
  { id: 'fx-gain-loss', no: 4, label: '환차손익', desc: '인보이스 환율 vs 송금 환율 차이', href: '/mgmt/fx-gain-loss', ready: false, group: 'B' },
  { id: 'remit-approval', no: 5, label: '송금 결재선', desc: '요청 → 승인 → 완료', href: '/mgmt/approvals?targetKind=remittance', ready: true, group: 'B' },
  { id: 'price-history', no: 6, label: '단가 변경이력', desc: '전·후 단가, 시각, 적용순서', href: '/mgmt/price-history', ready: false },
  { id: 'claim-codes', no: 7, label: '클레임 사유코드', desc: '불량차감 사유 사전·농장별 클레임율', href: '/mgmt/claim-codes', ready: false },
  { id: 'week-close', no: 8, label: '차수 마감 체크리스트', desc: '불변식·미견적·미입금·미송금 건수', href: '/mgmt/week-close', ready: false },
  { id: 'customer-profit', no: 9, label: '거래처별 이익·목표', desc: '거래처 축 이익 + 월 목표 달성률', href: '/mgmt/customer-profit', ready: false },
  { id: 'audit-view', no: 10, label: '변경 감사로그 통합뷰', desc: '단가·수량·확정 변경만 전후값으로', href: '/mgmt/audit-view', ready: false },
];

export default function MgmtHome() {
  return (
    <div className="mgmt-home">
      <h2>경영관리</h2>
      <p className="mgmt-note">ERP 공백 3축 대조(2026-10-21) 필요 공백 상위 10. ECOUNT 이관 작업과 분리된 web_mgmt 영역에서 동작합니다. 원장은 읽기만 합니다.</p>
      <div className="mgmt-grid">
        {FEATURES.map((f) => (
          <div key={f.id} className={`mgmt-card ${f.ready ? 'ready' : 'pending'}`}>
            <div className="mgmt-no">{f.no}{f.group === 'B' ? ' · 연계' : ''}</div>
            <strong>{f.label}</strong>
            <span>{f.desc}</span>
            {f.ready ? <Link href={f.href}>열기 →</Link> : <em>준비 중</em>}
          </div>
        ))}
      </div>
      <style jsx>{`
        .mgmt-home{padding:8px 4px}.mgmt-note{font-size:12px;color:var(--text3,#64748b)}
        .mgmt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;margin-top:10px}
        .mgmt-card{border:1px solid var(--border,#cbd5e1);border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:4px;font-size:13px;background:var(--surface,#fff)}
        .mgmt-card.pending{opacity:.65}.mgmt-no{font-size:11px;color:var(--text3,#64748b)}.mgmt-card em{font-size:11px;color:var(--text3,#64748b)}
        .mgmt-card a{font-size:12px;margin-top:4px}
      `}</style>
    </div>
  );
}
