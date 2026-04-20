// pages/mindmap.js — 네노바 ERP/모바일/에이전트 통합 기능 맵
import Head from 'next/head';
import Link from 'next/link';

const GROUPS = [
  {
    name: '주문관리', color: '#ef5350', icon: '📋',
    items: [
      { href: '/orders',                   title: '주문 목록',         desc: '차수/기간/품목 조회' },
      { href: '/orders/new',               title: '주문 신규',         desc: '개별 수동 입력' },
      { href: '/orders/paste',             title: '붙여넣기 주문등록', desc: 'Claude AI 파싱' },
      { href: '/orders/paste',             title: '주문+분배 통합',    desc: '주문후 즉시 분배' },
      { href: '/admin/order-requests',     title: '주문 승인 대기',    desc: '모바일 요청 승인' },
      { href: '/api/orders/mappings',      title: '품목 매핑 학습',    desc: '자동 매칭 DB' },
    ],
  },
  {
    name: '출고/차수피벗', color: '#42a5f5', icon: '🚚',
    items: [
      { href: '/shipment/view',            title: '출고 조회',         desc: '차수·거래처별' },
      { href: '/shipment/distribute',      title: '출고 분배',         desc: '업체·품목별 수량' },
      { href: '/shipment/week-pivot',      title: '차수 피벗',         desc: '주차별 총괄' },
      { href: '/shipment/stock-status',    title: '재고 현황',         desc: '주문·출고·현재고' },
      { href: '/shipment/history',         title: '출고 이력',         desc: '변경 추적' },
      { href: '/shipment/distribute',      title: '출고 확정',         desc: '확정/취소' },
    ],
  },
  {
    name: '재고/창고', color: '#66bb6a', icon: '📦',
    items: [
      { href: '/stock',                    title: '재고 조정',         desc: '불량·검역·검수' },
      { href: '/warehouse',                title: '발주 관리',         desc: '입고 예정' },
      { href: '/incoming',                 title: '입고 등록',         desc: 'CSV 일괄 업로드' },
      { href: '/incoming-price',           title: '입고 단가',         desc: '품목별 단가' },
      { href: '/incoming-price/credit-history', title: '신용거래 이력', desc: '외상 추적' },
    ],
  },
  {
    name: '원가/견적', color: '#ab47bc', icon: '💰',
    items: [
      { href: '/freight',                  title: '운송기준원가',       desc: 'BILL·AWB 원가 계산' },
      { href: '/freight',                  title: '품목수/항공료 override', desc: '수동 입력 지원' },
      { href: '/freight',                  title: '카테고리 오버라이드', desc: '기타 품목 재분류' },
      { href: '/estimate',                 title: '견적서 관리',        desc: '업체별 견적' },
      { href: '/finance/exchange',         title: '환율 현황',          desc: '통화별 환율' },
    ],
  },
  {
    name: '판매/구매/재무', color: '#ec407a', icon: '💸',
    items: [
      { href: '/sales/status',             title: '판매 현황',         desc: '업체·품목 통계' },
      { href: '/sales/ar',                 title: '외상 잔액',         desc: '미수금' },
      { href: '/sales/tax-invoice',        title: '세금계산서',        desc: '발행·관리' },
      { href: '/purchase/status',          title: '구매 현황',         desc: '매입 통계' },
      { href: '/finance/bank',             title: '은행 수수료',       desc: '은행별 정산' },
    ],
  },
  {
    name: '통계/분석', color: '#ff7043', icon: '📊',
    items: [
      { href: '/dashboard',                title: '메인 대시보드',     desc: 'KPI·TOP5' },
      { href: '/stats/monthly',            title: '월별 판매',         desc: '성장률 추세' },
      { href: '/stats/area',               title: '지역별 현황',       desc: '배송지별 매출' },
      { href: '/stats/manager',            title: '담당자별 현황',     desc: '담당 KPI' },
      { href: '/stats/pivot',              title: '피벗 테이블',       desc: '다차원 분석' },
      { href: '/stats/analysis',           title: '분석 대시보드',     desc: '맞춤 분석' },
    ],
  },
  {
    name: '마스터 데이터', color: '#26a69a', icon: '🗄️',
    items: [
      { href: '/master/products',          title: '품목 관리',         desc: '단당 무게/CBM/관세' },
      { href: '/master/customers',         title: '거래처 관리',       desc: '업체·출고요일' },
      { href: '/master/codes',             title: '코드 관리',         desc: '국가·꽃·기본관세' },
      { href: '/master/pricing',           title: '단가 매트릭스',     desc: '업체×품목 단가' },
      { href: '/master/activity',          title: '마스터 이력',       desc: '변경 추적' },
    ],
  },
  {
    name: '관리자/시스템', color: '#78909c', icon: '⚙️',
    items: [
      { href: '/admin/users',              title: '사용자 관리',       desc: '계정·권한' },
      { href: '/admin/activity',           title: '작업 이력',         desc: '재고/주문/출고' },
      { href: '/admin/worklog',            title: '작업 로그',         desc: '시스템 감시' },
      { href: '/ecount/dashboard',         title: '이카운트 연동',     desc: 'ERP 동기화' },
      { href: '/dev/action-log',           title: '액션 로그',         desc: '디버그용' },
      { href: '/dev/history',              title: '변경 히스토리',     desc: 'Git 추적' },
    ],
  },
  {
    name: '모바일 (m/)', color: '#5c6bc0', icon: '📱',
    items: [
      { href: '/m',                        title: '모바일 홈',         desc: '빠른 메뉴·KPI' },
      { href: '/m/orders',                 title: '주문 (모바일)',     desc: '목록·상세' },
      { href: '/m/shipment',               title: '출고 (모바일)',     desc: '실시간 조회' },
      { href: '/m/stock',                  title: '재고 (모바일)',     desc: '현황' },
      { href: '/m/sales',                  title: '매출 (모바일)',     desc: '업체·요약' },
      { href: '/m/customers',              title: '거래처 (모바일)',   desc: '목록·검색' },
      { href: '/m/estimate',               title: '견적 (모바일)',     desc: '견적서 조회' },
      { href: '/m/chat',                   title: 'AI 챗봇',           desc: 'Claude 질의' },
      { href: '/m/more',                   title: '더보기',            desc: '설정·로그아웃' },
      { href: '/m/admin/status',           title: '진단 대시보드',     desc: '헬스체크 6종' },
    ],
  },
  {
    name: 'AI 에이전트', color: '#ffa726', icon: '🤖',
    items: [
      { href: '/api/m/chat',               title: '챗봇 API',          desc: 'Claude Sonnet 4.6' },
      { href: '/api/orders/parse-paste',   title: '주문 파싱 에이전트', desc: '붙여넣기 → 구조화' },
      { href: '/api/agent/intelligence',   title: '지능 API',          desc: '의사결정' },
      { href: '/api/agent/issues',         title: '문제 감지',         desc: '이상 탐지' },
      { href: '/api/agent/backup',         title: '자동 백업',         desc: '데이터 백업' },
      { href: '/api/m/cost',               title: '비용 모니터링',     desc: 'LLM 사용량' },
    ],
  },
  {
    name: '인프라/배포', color: '#8d6e63', icon: '🔧',
    items: [
      { href: 'https://github.com/Jayinsightfactory/nenova-erp-ui',
                                           title: 'GitHub',            desc: '배포 소스' },
      { href: '#',                         title: 'Cafe24 VPS',        desc: '172.233.89.171' },
      { href: '#',                         title: 'SQL Server',        desc: 'nenova1_nenova' },
      { href: '#',                         title: 'PM2 (nenova-erp)',  desc: '프로세스 관리' },
      { href: '#',                         title: 'GitHub Actions',    desc: 'SSH 자동 배포' },
      { href: '/api/log',                  title: 'AppLog',            desc: '작업 로그' },
    ],
  },
];

export default function Mindmap() {
  return (
    <>
      <Head><title>🗺️ 네노바 통합 기능 맵</title></Head>
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0a0e27 0%, #1a1f3a 50%, #0a0e27 100%)',
        color: '#e0e0e0',
        padding: '16px 20px',
        fontFamily: "'Segoe UI', -apple-system, sans-serif",
      }}>
        <header style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, background: 'linear-gradient(90deg,#42a5f5,#ab47bc,#ff7043)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            🗺️ NENOVA UNIFIED MAP
          </h1>
          <span style={{ fontSize: 11, color: '#7a8bb5' }}>
            ERP · 모바일 · AI 에이전트 · 인프라 | 총 {GROUPS.reduce((a, g) => a + g.items.length, 0)}개 기능
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href="/dashboard" style={linkBtn}>🏠 대시보드</Link>
            <Link href="/m" style={linkBtn}>📱 모바일</Link>
          </div>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {GROUPS.map((g) => (
            <section key={g.name} style={{
              border: `1px solid ${g.color}40`,
              background: `linear-gradient(90deg, ${g.color}14 0%, transparent 100%)`,
              borderRadius: 10,
              padding: '8px 10px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 16 }}>{g.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: g.color, letterSpacing: 1 }}>
                  {g.name.toUpperCase()}
                </span>
                <span style={{ fontSize: 10, color: '#7a8bb5' }}>({g.items.length})</span>
                <div style={{ flex: 1, height: 1, background: `${g.color}30` }} />
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {g.items.map((it, i) => (
                  <NodeCard key={`${g.name}-${i}`} href={it.href} color={g.color} title={it.title} desc={it.desc} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}

function NodeCard({ href, color, title, desc }) {
  const isExternal = href.startsWith('http');
  const Comp = isExternal || href === '#' ? 'a' : Link;
  const props = isExternal ? { href, target: '_blank', rel: 'noreferrer' } : href === '#' ? { href: '#' } : { href };
  return (
    <Comp {...props} style={{
      display: 'block',
      minWidth: 135,
      maxWidth: 180,
      padding: '6px 10px',
      background: 'rgba(20, 25, 50, 0.85)',
      border: `1px solid ${color}60`,
      borderRadius: 6,
      textDecoration: 'none',
      color: '#e0e0e0',
      transition: 'all 0.15s',
      cursor: 'pointer',
    }}
    onMouseEnter={e => {
      e.currentTarget.style.background = `${color}22`;
      e.currentTarget.style.borderColor = color;
      e.currentTarget.style.transform = 'translateY(-1px)';
    }}
    onMouseLeave={e => {
      e.currentTarget.style.background = 'rgba(20, 25, 50, 0.85)';
      e.currentTarget.style.borderColor = `${color}60`;
      e.currentTarget.style.transform = 'translateY(0)';
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', lineHeight: 1.2, marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: 9.5, color: '#8b9dc4', lineHeight: 1.3 }}>{desc}</div>
    </Comp>
  );
}

const linkBtn = {
  fontSize: 11,
  padding: '4px 10px',
  background: 'rgba(66, 165, 245, 0.15)',
  border: '1px solid #42a5f560',
  borderRadius: 14,
  color: '#42a5f5',
  textDecoration: 'none',
  fontWeight: 600,
};
