// pages/mindmap.js — 네노바 ERP/모바일/AI 통합 기능·버튼·고정값 맵
// 🔒 건드리면 안되는 기본값 | ✏ 편집가능 | 🔘 액션버튼 | ⚙️ API
import Head from 'next/head';
import Link from 'next/link';

const GROUPS = [
  {
    name: '주문관리', color: '#ef5350', icon: '📋',
    pages: [
      { href: '/orders', title: '주문 목록', desc: '차수/기간/품목 조회',
        items: [
          { t: '차수 버튼', k: '🔘' }, { t: '업체명 검색', k: '🔘' },
          { t: '수량 인라인 편집', k: '✏' }, { t: '삭제/복원', k: '🔘' },
        ]},
      { href: '/orders/new', title: '주문 신규', desc: '개별 수동 입력',
        items: [ { t: '업체 선택', k: '🔘' }, { t: '품목 추가', k: '🔘' }, { t: '박스/단/송이 선택', k: '✏' } ]},
      { href: '/orders/paste', title: '붙여넣기 주문등록', desc: 'Claude 파싱',
        items: [
          { t: '🤖 Claude로 분석', k: '🔘' },
          { t: '차수 -01/-02/-03', k: '🔘' },
          { t: '📊 차수피벗 이동', k: '🔘' },
          { t: '➕ 기존수량 더하기', k: '✏' },
          { t: '거래처 자동매칭', k: '🤖' },
          { t: '미매칭 질문패널', k: '🤖' },
          { t: '주문등록 + 출고분배 통합', k: '🔘' },
          { t: '일괄/개별 분배저장', k: '🔘' },
          { t: '적용차수 자동감지 배지', k: '🤖' },
          { t: '🔒 Manager=uid', k: '🔒' },
          { t: '🔒 CreateID=admin', k: '🔒' },
          { t: '🔒 LastUpdateID 건드리지않음', k: '🔒' },
        ]},
      { href: '/admin/order-requests', title: '주문 승인 대기', desc: '모바일 요청',
        items: [ { t: '승인', k: '🔘' }, { t: '반려', k: '🔘' } ]},
    ],
  },
  {
    name: '출고/차수피벗', color: '#42a5f5', icon: '🚚',
    pages: [
      { href: '/shipment/view', title: '출고 조회', desc: '차수·업체',
        items: [ { t: '차수 드롭다운', k: '🔘' }, { t: '업체별 출고표', k: '📊' } ]},
      { href: '/shipment/distribute', title: '출고 분배', desc: '업체·품목별',
        items: [
          { t: '업체 선택', k: '🔘' }, { t: 'custItems 로드', k: '⚙️' },
          { t: '품목별 출고수량 입력', k: '✏' },
          { t: '🔒 delta 모드 항상 가산', k: '🔒' },
          { t: 'AppLog 기록', k: '⚙️' },
        ]},
      { href: '/shipment/week-pivot', title: '차수 피벗', desc: '주차별 총괄',
        items: [ { t: '엑셀 다운로드', k: '🔘' }, { t: '셀 편집', k: '✏' }, { t: '일괄 저장', k: '🔘' } ]},
      { href: '/shipment/stock-status', title: '재고 현황', desc: '주문·출고·현재고',
        items: [
          { t: '➕ 주문추가 모달', k: '🔘' },
          { t: '잔량 = 기초+입고-출고', k: '📊' },
          { t: '업체별 출고수량 편집', k: '✏' },
          { t: '차수피벗 탭 통합', k: '📊' },
        ]},
      { href: '/shipment/history', title: '출고 이력', desc: '변경 추적',
        items: [ { t: '필터 날짜', k: '🔘' }, { t: '검색 품목', k: '🔘' } ]},
    ],
  },
  {
    name: '재고·창고·입고', color: '#66bb6a', icon: '📦',
    pages: [
      { href: '/stock', title: '재고 조정', desc: '불량·검역·검수',
        items: [ { t: '차감 사유 선택', k: '🔘' }, { t: '수량 입력', k: '✏' }, { t: 'AppLog 기록', k: '⚙️' } ]},
      { href: '/warehouse', title: '발주 관리', desc: '입고 예정',
        items: [ { t: '발주 추가', k: '🔘' }, { t: '상태 변경', k: '🔘' } ]},
      { href: '/incoming', title: '입고 등록', desc: 'CSV 업로드',
        items: [ { t: '📥 CSV 업로드', k: '🔘' }, { t: '미리보기', k: '📊' }, { t: '일괄 저장', k: '🔘' } ]},
      { href: '/incoming-price', title: '입고 단가', desc: '품목별 단가',
        items: [ { t: '단가 편집', k: '✏' }, { t: '저장', k: '🔘' } ]},
    ],
  },
  {
    name: '운송기준원가', color: '#ab47bc', icon: '✈️',
    pages: [
      { href: '/freight', title: 'BILL/AWB 조회', desc: 'AWB 그룹',
        items: [
          { t: 'AWB 드롭다운', k: '🔘' }, { t: '조회 버튼', k: '🔘' },
          { t: '편집모드 토글', k: '✏' }, { t: '📥 엑셀 다운로드', k: '🔘' },
          { t: '✅ 확정 / 취소', k: '🔘' },
        ]},
      { href: '/freight', title: '차수·항공료', desc: 'GW/CW/Rate',
        items: [
          { t: '총금액 Invoice', k: '✏' }, { t: '환율 (자동)', k: '🤖' },
          { t: 'GW 실중량', k: '✏' }, { t: 'CW 과금중량', k: '✏' },
          { t: 'Rate / 서류', k: '✏' },
          { t: '품목수 (자동/수동)', k: '✏' },
          { t: '🔒 항공료 override', k: '🔒' },
          { t: 'CNY/USD 자동 감지', k: '🤖' },
          { t: 'Gross/Chargeable weigth 자동추출', k: '🤖' },
        ]},
      { href: '/freight', title: '품목별 운임비', desc: '카테고리별',
        items: [
          { t: '콜롬비아=송이, 그외=단', k: '🤖' },
          { t: '단위당 운임비', k: '📊' },
        ]},
      { href: '/freight', title: '그외 통관비', desc: 'KRW',
        items: [
          { t: '🔒 백상단가 460', k: '🔒' },
          { t: '🔒 수수료 33,000', k: '🔒' },
          { t: '🔒 검역 10,000', k: '🔒' },
          { t: '🔒 국내운송 99,000', k: '🔒' },
          { t: '🔒 차감 40,000', k: '🔒' },
          { t: '추가 통관', k: '✏' },
        ]},
      { href: '/freight', title: '운송비 분배 비율', desc: 'GW/CBM',
        items: [
          { t: '콜롬비아 박스기준', k: '📊' },
          { t: '비콜롬비아 단기준', k: '📊' },
          { t: '카테고리 기본값 편집', k: '✏' },
          { t: '관세율 소수 3자리', k: '✏' },
        ]},
      { href: '/freight', title: '품목 상세 원가', desc: '14개 컬럼',
        items: [
          { t: '카테고리 셀 클릭→팝업', k: '🔘' },
          { t: '웹전용 오버라이드', k: '🔒' },
          { t: '🔒 Product.FlowerName 미변경', k: '🔒' },
          { t: '자유입력 가능', k: '✏' },
          { t: '🗑 오버라이드 삭제', k: '🔘' },
          { t: '단당송이(N) 편집', k: '✏' },
          { t: '판매가(Q) 편집', k: '✏' },
        ]},
    ],
  },
  {
    name: '견적/판매/구매/재무', color: '#ec407a', icon: '💸',
    pages: [
      { href: '/estimate', title: '견적서 관리', desc: '업체별',
        items: [ { t: '📄 견적서 생성', k: '🔘' }, { t: '🖨 iframe 인쇄', k: '🔘' }, { t: '💾 PDF', k: '🔘' } ]},
      { href: '/sales/status', title: '판매 현황', desc: '통계',
        items: [ { t: '날짜 범위', k: '🔘' }, { t: '이카운트 연동', k: '⚙️' } ]},
      { href: '/sales/ar', title: '외상 잔액', desc: '미수금' , items: [ { t: '업체별 집계', k: '📊' } ]},
      { href: '/sales/tax-invoice', title: '세금계산서', desc: '발행/관리', items: [ { t: '발행', k: '🔘' } ]},
      { href: '/purchase/status', title: '구매 현황', desc: '매입', items: [ { t: '날짜필터', k: '🔘' } ]},
      { href: '/finance/bank', title: '은행 수수료', desc: '은행별', items: [ { t: '편집', k: '✏' } ]},
      { href: '/finance/exchange', title: '환율 현황', desc: '통화별', items: [ { t: '환율 수동', k: '✏' } ]},
    ],
  },
  {
    name: '통계/분석', color: '#ff7043', icon: '📊',
    pages: [
      { href: '/dashboard', title: '메인 대시보드', desc: 'KPI',
        items: [ { t: '지역별 매출', k: '📊' }, { t: '거래처 TOP5', k: '📊' }, { t: '월별 추세', k: '📊' } ]},
      { href: '/stats/monthly', title: '월별 판매', desc: '성장률' , items: [ { t: '그래프', k: '📊' } ]},
      { href: '/stats/area', title: '지역별 현황', desc: '배송지역', items: [ { t: '지역 필터', k: '🔘' } ]},
      { href: '/stats/manager', title: '담당자별', desc: '담당 KPI', items: [ { t: '담당자 필터', k: '🔘' } ]},
      { href: '/stats/pivot', title: '피벗 테이블', desc: '다차원',
        items: [ { t: '행/열 커스텀', k: '✏' }, { t: '엑셀 다운', k: '🔘' } ]},
      { href: '/stats/analysis', title: '분석 대시보드', desc: '맞춤', items: [ { t: '쿼리 편집', k: '✏' } ]},
    ],
  },
  {
    name: '마스터 데이터', color: '#26a69a', icon: '🗄️',
    pages: [
      { href: '/master/products', title: '품목 관리', desc: '상품 정보',
        items: [
          { t: '단당 무게 (kg)', k: '✏' }, { t: '단당 CBM', k: '✏' },
          { t: '관세율 (%) 소수3자리', k: '✏' },
          { t: '1박스 당 단수', k: '✏' }, { t: '1단 당 송이수', k: '✏' },
          { t: 'DisplayName (한글자연어)', k: '✏' },
          { t: '🔒 ProdName 영문 그대로', k: '🔒' },
        ]},
      { href: '/master/customers', title: '거래처 관리', desc: '업체·출고요일',
        items: [ { t: 'BaseOutDay 설정', k: '✏' }, { t: '주문코드', k: '✏' } ]},
      { href: '/master/codes', title: '코드 관리', desc: '국가·꽃',
        items: [
          { t: '꽃 카테고리', k: '✏' }, { t: '박스당 송이수', k: '✏' },
          { t: '기본관세 %', k: '✏' },
        ]},
      { href: '/master/pricing', title: '단가 매트릭스', desc: '업체×품목', items: [ { t: '일괄 단가 입력', k: '✏' } ]},
      { href: '/master/activity', title: '마스터 이력', desc: '변경추적', items: [ { t: '필터', k: '🔘' } ]},
    ],
  },
  {
    name: '관리자/개발', color: '#78909c', icon: '⚙️',
    pages: [
      { href: '/admin/users', title: '사용자 관리', desc: '계정·권한', items: [ { t: '계정 생성', k: '🔘' }, { t: '권한 변경', k: '✏' } ]},
      { href: '/admin/activity', title: '작업 이력', desc: '변경', items: [ { t: '사용자별', k: '🔘' } ]},
      { href: '/admin/worklog', title: '작업 로그', desc: '시스템',
        items: [ { t: 'AppLog 조회', k: '📊' }, { t: '카테고리별', k: '🔘' }, { t: 'IsError 필터', k: '🔘' } ]},
      { href: '/ecount/dashboard', title: '이카운트 연동', desc: 'ERP 동기',
        items: [ { t: '수동 전송', k: '🔘' }, { t: '동기화 상태', k: '📊' } ]},
      { href: '/dev/action-log', title: '액션 로그', desc: '디버그', items: [ { t: 'SQL 추적', k: '📊' } ]},
      { href: '/dev/history', title: '변경 히스토리', desc: 'Git', items: [ { t: '커밋 로그', k: '📊' } ]},
    ],
  },
  {
    name: '모바일 (m/)', color: '#5c6bc0', icon: '📱',
    pages: [
      { href: '/m', title: '모바일 홈', desc: '빠른 메뉴',
        items: [ { t: 'KPI 요약', k: '📊' }, { t: '빠른 이동', k: '🔘' } ]},
      { href: '/m/orders', title: '주문', desc: '목록',
        items: [ { t: '날짜 필터', k: '🔘' }, { t: '터치 스와이프', k: '🔘' } ]},
      { href: '/m/shipment', title: '출고', desc: '실시간', items: [ { t: '업체별 출고표', k: '📊' } ]},
      { href: '/m/stock', title: '재고', desc: '현황', items: [ { t: '차수별', k: '🔘' } ]},
      { href: '/m/sales', title: '매출', desc: '요약', items: [ { t: '기간 필터', k: '🔘' } ]},
      { href: '/m/customers', title: '거래처', desc: '검색', items: [ { t: '검색창', k: '🔘' } ]},
      { href: '/m/estimate', title: '견적', desc: '모바일 조회', items: [ { t: '상세보기', k: '🔘' } ]},
      { href: '/m/chat', title: '🤖 AI 챗봇', desc: 'Claude',
        items: [
          { t: '자연어 → SQL', k: '🤖' }, { t: '역질문 모드', k: '🤖' },
          { t: 'localStorage 히스토리', k: '⚙️' },
          { t: '🔒 ANTHROPIC_API_KEY', k: '🔒' },
        ]},
      { href: '/m/admin/status', title: '진단 대시보드', desc: '6종 헬스체크',
        items: [
          { t: '환경 체크', k: '📊' }, { t: '카탈로그 체크', k: '📊' },
          { t: '비즈 체크', k: '📊' }, { t: '사용량 체크', k: '📊' },
          { t: '비용 체크', k: '📊' }, { t: '핑 체크', k: '📊' },
        ]},
      { href: '/m/more', title: '더보기', desc: '설정', items: [ { t: '로그아웃', k: '🔘' } ]},
    ],
  },
  {
    name: 'AI 에이전트/API', color: '#ffa726', icon: '🤖',
    pages: [
      { href: '/api/m/chat', title: '챗봇 API', desc: 'Claude Sonnet 4.6',
        items: [
          { t: 'trackLLMCall 비용추적', k: '⚙️' },
          { t: '🔒 모델: claude-sonnet-4-6', k: '🔒' },
        ]},
      { href: '/api/orders/parse-paste', title: '주문 파싱', desc: 'AI 구조화',
        items: [
          { t: 'claude-haiku-4-5', k: '🤖' },
          { t: 'detectedWeek 자동감지', k: '🤖' },
          { t: '품종 한→영 사전', k: '⚙️' },
        ]},
      { href: '/api/orders/mappings', title: '매핑 학습 DB', desc: 'inputName→prodKey',
        items: [ { t: 'data/order-mappings.json', k: '⚙️' }, { t: '자동 학습', k: '🤖' } ]},
      { href: '/api/freight/category-override', title: '카테고리 오버라이드', desc: '웹전용',
        items: [ { t: 'data/category-overrides.json', k: '⚙️' }, { t: '🔒 DB 미변경', k: '🔒' } ]},
      { href: '/api/m/cost', title: '비용 모니터', desc: '24h LLM',
        items: [ { t: '토큰/USD/KRW', k: '📊' }, { t: '일간/월간 추정', k: '📊' } ]},
      { href: '/api/agent/backup', title: '자동 백업', desc: '데이터', items: [ { t: '주기 설정', k: '⚙️' } ]},
      { href: '/api/agent/issues', title: '이상 탐지', desc: '자동', items: [ { t: 'AppLog 스캔', k: '🤖' } ]},
    ],
  },
  {
    name: '인프라/배포/DB 고정', color: '#8d6e63', icon: '🔧',
    pages: [
      { href: 'https://github.com/Jayinsightfactory/nenova-erp-ui', title: 'GitHub', desc: '소스',
        items: [ { t: '🔒 master 브랜치', k: '🔒' }, { t: 'GitHub Actions', k: '⚙️' } ]},
      { href: '#', title: 'Cafe24 VPS', desc: '172.233.89.171',
        items: [ { t: '🔒 SSH_PASSWORD', k: '🔒' }, { t: '/var/www/nenova-erp', k: '⚙️' } ]},
      { href: '#', title: 'SQL Server', desc: 'nenova1_nenova',
        items: [
          { t: '🔒 DB_SERVER', k: '🔒' }, { t: '🔒 DB_PASSWORD', k: '🔒' },
          { t: 'backup J:\\sql backup\\', k: '⚙️' },
        ]},
      { href: '#', title: 'PM2', desc: 'nenova-erp',
        items: [ { t: 'pm2 restart', k: '⚙️' }, { t: 'pm2 logs', k: '⚙️' } ]},
      { href: '#', title: '환경변수', desc: '.env.local',
        items: [
          { t: '🔒 ANTHROPIC_API_KEY', k: '🔒' },
          { t: '🔒 DB_*', k: '🔒' },
          { t: '🔒 ECOUNT_*', k: '🔒' },
          { t: 'deploy.yml 자동주입', k: '⚙️' },
        ]},
      { href: '#', title: 'DB 고정 규칙', desc: '전산 호환',
        items: [
          { t: '🔒 OrderMaster.Manager=uid', k: '🔒' },
          { t: '🔒 CreateID=admin (웹)', k: '🔒' },
          { t: '🔒 LastUpdateID 미기록', k: '🔒' },
          { t: '🔒 OrderWeek WW-SS 형식', k: '🔒' },
          { t: '🔒 OutQuantity=qty (INSERT)', k: '🔒' },
        ]},
      { href: '/api/log', title: 'AppLog', desc: '작업 로그',
        items: [ { t: 'Category/Step/Detail', k: '⚙️' }, { t: 'IsError flag', k: '⚙️' } ]},
      { href: '#', title: '롤백 태그', desc: 'git tag',
        items: [
          { t: 'stable-13-14', k: '🔒' },
          { t: 'stable-2026-04-20', k: '🔒' },
        ]},
    ],
  },
];

// 아이콘 → 색상 + 설명
const KIND_META = {
  '🔒': { color: '#c62828', bg: '#ffebee', label: '고정·건드리지말것' },
  '✏':  { color: '#1565c0', bg: '#e3f2fd', label: '편집가능' },
  '🔘': { color: '#2e7d32', bg: '#e8f5e9', label: '액션버튼' },
  '⚙️': { color: '#6a1b9a', bg: '#f3e5f5', label: 'API/환경' },
  '📊': { color: '#ef6c00', bg: '#fff3e0', label: '표시/차트' },
  '🤖': { color: '#00838f', bg: '#e0f7fa', label: 'AI/자동' },
  '📄': { color: '#5d4037', bg: '#efebe9', label: '문서' },
};

export default function Mindmap() {
  const totalItems = GROUPS.reduce((a, g) => a + g.pages.reduce((b, p) => b + (p.items?.length || 0) + 1, 0), 0);
  return (
    <>
      <Head><title>🗺️ 네노바 통합 기능·버튼·고정값 맵</title></Head>
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0a0e27 0%, #1a1f3a 50%, #0a0e27 100%)',
        color: '#e0e0e0',
        padding: '12px 16px',
        fontFamily: "'Segoe UI', -apple-system, sans-serif",
      }}>
        <header style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, background: 'linear-gradient(90deg,#42a5f5,#ab47bc,#ff7043)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            🗺️ NENOVA UNIFIED MAP
          </h1>
          <span style={{ fontSize: 10, color: '#7a8bb5' }}>
            페이지·버튼·API·고정값 | 총 {totalItems}개
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, fontSize: 9.5, alignItems: 'center' }}>
            {Object.entries(KIND_META).map(([k, m]) => (
              <span key={k} style={{ padding: '2px 6px', borderRadius: 8, background: m.bg, color: m.color, fontWeight: 600 }}>
                {k} {m.label}
              </span>
            ))}
          </div>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {GROUPS.map((g) => (
            <section key={g.name} style={{
              border: `1px solid ${g.color}40`,
              background: `linear-gradient(90deg, ${g.color}14 0%, transparent 100%)`,
              borderRadius: 8,
              padding: '6px 8px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 14 }}>{g.icon}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: g.color, letterSpacing: 0.5 }}>
                  {g.name.toUpperCase()}
                </span>
                <span style={{ fontSize: 9, color: '#7a8bb5' }}>({g.pages.length}페이지)</span>
                <div style={{ flex: 1, height: 1, background: `${g.color}30` }} />
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {g.pages.map((p, i) => <PageCard key={`${g.name}-${i}`} page={p} color={g.color} />)}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}

function PageCard({ page, color }) {
  const isExternal = page.href?.startsWith('http');
  const hrefProps = isExternal ? { href: page.href, target: '_blank', rel: 'noreferrer' }
                   : page.href && page.href !== '#' ? { href: page.href } : {};
  const Comp = isExternal ? 'a' : page.href && page.href !== '#' ? Link : 'div';
  return (
    <div style={{
      minWidth: 180, maxWidth: 220,
      background: 'rgba(20, 25, 50, 0.85)',
      border: `1px solid ${color}60`,
      borderRadius: 6,
      padding: '5px 7px',
    }}>
      <Comp {...hrefProps} style={{
        display: 'block',
        textDecoration: 'none',
        color: '#fff',
        marginBottom: 3,
        borderBottom: `1px solid ${color}30`,
        paddingBottom: 3,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>{page.title}</div>
        <div style={{ fontSize: 8.5, color: '#8b9dc4', lineHeight: 1.25 }}>{page.desc}</div>
      </Comp>
      {page.items && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {page.items.map((it, i) => (
            <div key={i} style={{
              fontSize: 9, lineHeight: 1.35,
              color: KIND_META[it.k]?.color || '#cfd8dc',
              display: 'flex', alignItems: 'flex-start', gap: 3,
            }}>
              <span style={{ minWidth: 12, textAlign: 'center' }}>{it.k}</span>
              <span style={{ flex: 1, wordBreak: 'keep-all' }}>{it.t}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
