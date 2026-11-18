// lib/commercialSuiteDemo.js — NOWLINK · MOYI 상용 판매·시연용 업종별 가상 샘플 데이터 및 계산기
// 외부 고객사 시연 전용: 100% 가상 대표 샘플만 사용하며 사내 실명·계좌·사업자번호·실거래 정보를 포함하지 않습니다.

export const PRICING_PLANS = [
  {
    id: 'watch',
    name: 'Watch',
    badge: '1단계 · PC 관찰·점검',
    subtitle: 'PC 업무 수집 · 대시보드 · 스냅샷 점검',
    monthlyBaseKrw: 390000,
    perSeatKrw: 19000,
    weeklyHoursSavedPerSeat: 3.2,
    highlights: ['PC 작업 흐름 자동 수집', '일일 예외·누락 점검 대시보드', '읽기 전용 스냅샷 보고서'],
  },
  {
    id: 'build',
    name: 'Build',
    badge: '2단계 · 업종 ERP 코어',
    subtitle: '업종별 3단위 웹 ERP · 데스크톱앱 · 승인 큐',
    monthlyBaseKrw: 890000,
    perSeatKrw: 29000,
    weeklyHoursSavedPerSeat: 6.4,
    highlights: ['mapping.json 3단위 품목·차수 엔진', '도착원가(Landed Cost) 자동 배부', '데스크톱앱 통합 탭 · 즐겨찾기'],
  },
  {
    id: 'team',
    name: 'Team',
    badge: '3단계 · 메신저 폐루프',
    subtitle: 'MOYI 승인 카드 · 카톡/위챗 이중화 · RACI 핸드오프',
    monthlyBaseKrw: 1490000,
    perSeatKrw: 39000,
    weeklyHoursSavedPerSeat: 9.8,
    highlights: ['MOYI 모바일 2FA 원터치 승인 카드', '카톡·위챗 Dual-Path 수집 + 중복 제거', '부서 간 RACI 핸드오프 자동화'],
  },
];

export const DEVICE_HUB_ADDON = {
  id: 'device-hub',
  name: 'Device Hub Add-on',
  subtitle: '사전 세팅 Edge Box + 공용폰 연동 + 30~40fps 원격 개입',
  monthlyPerDeviceKrw: 120000,
  extraWeeklyHoursPerDevice: 4.5,
  features: ['Read-Only 공용폰(Phone Harness)', '독점 Lease 잠금 · 고위험 발송 차단', 'WAITING_HUMAN 30fps 원격 개입'],
};

export const INDUSTRY_PRESETS = [
  {
    id: 'flower',
    label: '화훼 직수입 · 도매',
    shortLabel: '화훼 직수입',
    badge: '원예 · 화훼 도매',
    accent: '#0284c7',
    accentSoft: '#e0f2fe',
    tenantCode: 'demo-flower-wholesale',
    sampleCompany: '한빛플라워 홀세일(가상 시연사)',
    sourceLabel: '국가·농장',
    units: ['박스', '단', '송이'],
    bucketLabel: '주간 차수',
    sampleBucket: '46-01차',
    headline: '해외 농장 위챗 발주부터 3단위(박스·단·송이) 분배와 항공 도착원가 배부까지 1분 내 시연',
    catalogItems: [
      {
        sku: 'SKU-FL-101',
        name: '콜롬비아 장미 프리덤 50cm',
        originSource: '콜롬비아 · 안데스블룸(가상)',
        bucket: '46-01차',
        defaultLargeQty: 6,
        ratioMidPerLarge: 20,
        ratioSmallPerMid: 25,
        midUnitPriceKrw: 14500,
        allocations: [
          { buyer: '서초 가든플라워', largeQty: 3, midQty: 60, status: '분배 확정' },
          { buyer: '청담 아틀리에', largeQty: 2, midQty: 40, status: '출고 대기' },
          { buyer: '분당 플로리스트', largeQty: 1, midQty: 20, status: '예약 배정' },
        ],
      },
      {
        sku: 'SKU-FL-108',
        name: '네덜란드 수국 화이트 70cm',
        originSource: '네덜란드 · 알스미어팜(가상)',
        bucket: '46-01차',
        defaultLargeQty: 4,
        ratioMidPerLarge: 15,
        ratioSmallPerMid: 10,
        midUnitPriceKrw: 28000,
        allocations: [
          { buyer: '청담 아틀리에', largeQty: 2, midQty: 30, status: '분배 확정' },
          { buyer: '여의도 이벤트플라워', largeQty: 1, midQty: 15, status: '출고 대기' },
          { buyer: '판교 보태닉숍', largeQty: 1, midQty: 15, status: '검수 중' },
        ],
      },
      {
        sku: 'SKU-FL-115',
        name: '에콰도르 카네이션 핑크 60cm',
        originSource: '에콰도르 · 쏠라플로라(가상)',
        bucket: '46-01차',
        defaultLargeQty: 8,
        ratioMidPerLarge: 25,
        ratioSmallPerMid: 20,
        midUnitPriceKrw: 9800,
        allocations: [
          { buyer: '서초 가든플라워', largeQty: 4, midQty: 100, status: '분배 확정' },
          { buyer: '송파 플라워마켓', largeQty: 3, midQty: 75, status: '출고 대기' },
          { buyer: '분당 플로리스트', largeQty: 1, midQty: 25, status: '예약 배정' },
        ],
      },
    ],
    phoneHarness: {
      deviceId: 'dev-ph-wechat-01',
      channel: 'WeChat 수입단톡방 (Read-Only)',
      roomTitle: '남미 직수입 파트너방(가상)',
      sender: 'ANDES_BLOOM_EXPORT',
      receivedAt: '오후 16:30',
      rawMessage: 'ROSE FREEDOM 50CM +6 BOX ADD (46-01차) / 서초 가든 3박스 · 청담 2박스 · 분당 1박스',
      dedupKey: 'sha256:9f84b2c17e...demo01',
      ocrHighlight: '품목=장미 프리덤 50cm · +6박스 → 120단 / 3,000송이 자동 환산',
      moyiCard: {
        room: 'MOYI 발주·분배 승인 게이트',
        title: '46-01차 추가발주 원장 반영 승인 요청',
        item: '콜롬비아 장미 프리덤 50cm (SKU-FL-101)',
        qtyText: '6박스 · 120단 · 3,000송이',
        proposedBy: 'phone-harness-01 (자동 수집)',
        approvedBy: '영업/수입 관리자 (2FA 승인)',
        receiptId: 'RCPT-FL-4601-881',
        ledgerSummary: 'Bucket=46-01차 · Large=6박스 · Mid=120단 · Small=3,000송이 · 승인분리 확인',
      },
    },
    landedCost: {
      batchLabel: '항공 B/L 1컨테이너 · 60박스 (1,200단 / 30,000송이)',
      largeQty: 60,
      midQty: 1200,
      smallQty: 30000,
      fobTotalKrw: 11592000,
      freightKrw: 3120000,
      customsKrw: 1480000,
      domesticKrw: 540000,
      suggestedMarginPct: 22,
      costLabels: ['해외 농장 FOB 매입가', '항공 운임 · 유류할증', '관세 · 식물검역 · 통관비', '국내 냉장 입고 · 배송비'],
    },
  },
  {
    id: 'fresh',
    label: '신선 식자재 · 청과 유통',
    shortLabel: '신선 식자재',
    badge: '청과 · 콜드체인 유통',
    accent: '#059669',
    accentSoft: '#d1fae5',
    tenantCode: 'demo-fresh-produce',
    sampleCompany: '프레시브릿지 청과(가상 시연사)',
    sourceLabel: '원산지·산지출하자',
    units: ['박스', '소분팩', '낱개EA'],
    bucketLabel: '일일 경매차수',
    sampleBucket: '1118-새벽경매',
    headline: '새벽 경매·산지 카톡 출하를 소분팩·낱개EA 단위로 즉시 환산하고 콜드체인 원가를 자동 배부',
    catalogItems: [
      {
        sku: 'SKU-FR-204',
        name: '제주 노지감귤 로얄과 10kg',
        originSource: '제주 서귀포 · 한라산지영농(가상)',
        bucket: '1118-새벽경매',
        defaultLargeQty: 12,
        ratioMidPerLarge: 10,
        ratioSmallPerMid: 8,
        midUnitPriceKrw: 6200,
        allocations: [
          { buyer: '그린테이블 마트', largeQty: 6, midQty: 60, status: '분배 확정' },
          { buyer: '센트럴 급식센터', largeQty: 4, midQty: 40, status: '출고 대기' },
          { buyer: '마켓오션 강남점', largeQty: 2, midQty: 20, status: '예약 배정' },
        ],
      },
      {
        sku: 'SKU-FR-211',
        name: '남해 보물초 시금치 4kg 벌크',
        originSource: '경남 남해 · 바닷바람농협(가상)',
        bucket: '1118-새벽경매',
        defaultLargeQty: 10,
        ratioMidPerLarge: 16,
        ratioSmallPerMid: 1,
        midUnitPriceKrw: 3400,
        allocations: [
          { buyer: '센트럴 급식센터', largeQty: 5, midQty: 80, status: '분배 확정' },
          { buyer: '그린테이블 마트', largeQty: 3, midQty: 48, status: '출고 대기' },
          { buyer: '델리키친 물류', largeQty: 2, midQty: 32, status: '검수 중' },
        ],
      },
      {
        sku: 'SKU-FR-219',
        name: '수입 아보카도 24과 (후숙 2단계)',
        originSource: '페루 라리베르타드 · 솔그린팜(가상)',
        bucket: '1118-새벽경매',
        defaultLargeQty: 8,
        ratioMidPerLarge: 6,
        ratioSmallPerMid: 4,
        midUnitPriceKrw: 11800,
        allocations: [
          { buyer: '마켓오션 강남점', largeQty: 4, midQty: 24, status: '분배 확정' },
          { buyer: '그린테이블 마트', largeQty: 2, midQty: 12, status: '출고 대기' },
          { buyer: '센트럴 급식센터', largeQty: 2, midQty: 12, status: '예약 배정' },
        ],
      },
    ],
    phoneHarness: {
      deviceId: 'dev-ph-kakao-02',
      channel: '카카오톡 산지발주방 (Read-Only)',
      roomTitle: '새벽 경매 · 산지출하 연동방(가상)',
      sender: 'JEJU_HALLA_COOP',
      receivedAt: '오전 05:42',
      rawMessage: '1118-새벽경매 제주 로얄과 감귤 12박스(소분 120팩) 출하 확정 / 마트 6박스·급식 4박스·강남 2박스',
      dedupKey: 'sha256:4d19a7e35b...demo02',
      ocrHighlight: '품목=제주 노지감귤 10kg · 12박스 → 120소분팩 / 960낱개EA 자동 환산',
      moyiCard: {
        room: 'MOYI 청과 입고·분배 승인 게이트',
        title: '1118-새벽경매 산지 출하 원장 반영 승인 요청',
        item: '제주 노지감귤 로얄과 10kg (SKU-FR-204)',
        qtyText: '12박스 · 120소분팩 · 960낱개EA',
        proposedBy: 'phone-harness-02 (자동 수집)',
        approvedBy: '청과 MD / 물류팀장 (2FA 승인)',
        receiptId: 'RCPT-FR-1118-304',
        ledgerSummary: 'Bucket=1118-새벽경매 · Large=12박스 · Mid=120소분팩 · Small=960EA · 승인분리 확인',
      },
    },
    landedCost: {
      batchLabel: '새벽 경매+수입 혼적 100박스 (1,000소분팩 / 8,000낱개EA)',
      largeQty: 100,
      midQty: 1000,
      smallQty: 8000,
      fobTotalKrw: 4200000,
      freightKrw: 680000,
      customsKrw: 310000,
      domesticKrw: 490000,
      suggestedMarginPct: 24,
      costLabels: ['산지 경매 · 선별 매입가', '냉장 간선 · 도선료', '잔류농약검사 · 수수료', '소분패킹 · 새벽배송비'],
    },
  },
  {
    id: 'wine',
    label: '수입 와인 · 식음료 도매',
    shortLabel: '수입 와인·F&B',
    badge: '주류 · F&B 직수입',
    accent: '#7c3aed',
    accentSoft: '#ede9fe',
    tenantCode: 'demo-wine-beverage',
    sampleCompany: '루나셀러 와인임포트(가상 시연사)',
    sourceLabel: '와이너리·BL번호',
    units: ['케이스', '병', '용량ml'],
    bucketLabel: '통관 로트',
    sampleBucket: 'LOT-2611-W04',
    headline: '와이너리 B/L 통관 로트별 주세·교육세·운임을 병·용량ml 단가까지 정밀 배부하고 업장 배차 승인',
    catalogItems: [
      {
        sku: 'SKU-WN-309',
        name: '나파 카베르네 리저브 750ml',
        originSource: '미국 나파밸리 · BL-NAPA-8821(가상)',
        bucket: 'LOT-2611-W04',
        defaultLargeQty: 15,
        ratioMidPerLarge: 12,
        ratioSmallPerMid: 750,
        midUnitPriceKrw: 52000,
        allocations: [
          { buyer: '비스트로 루나', largeQty: 8, midQty: 96, status: '분배 확정' },
          { buyer: '메종 다이닝', largeQty: 4, midQty: 48, status: '출고 대기' },
          { buyer: '바 오로라', largeQty: 3, midQty: 36, status: '예약 배정' },
        ],
      },
      {
        sku: 'SKU-WN-314',
        name: '토스카나 키안티 클라시코 750ml',
        originSource: '이탈리아 피렌체 · BL-FLR-4410(가상)',
        bucket: 'LOT-2611-W04',
        defaultLargeQty: 10,
        ratioMidPerLarge: 12,
        ratioSmallPerMid: 750,
        midUnitPriceKrw: 31000,
        allocations: [
          { buyer: '메종 다이닝', largeQty: 5, midQty: 60, status: '분배 확정' },
          { buyer: '비스트로 루나', largeQty: 3, midQty: 36, status: '출고 대기' },
          { buyer: '테이블 24', largeQty: 2, midQty: 24, status: '검수 중' },
        ],
      },
      {
        sku: 'SKU-WN-322',
        name: '상파뉴 브뤼 NV 750ml (6본입)',
        originSource: '프랑스 랭스 · BL-RNS-9012(가상)',
        bucket: 'LOT-2611-W04',
        defaultLargeQty: 12,
        ratioMidPerLarge: 6,
        ratioSmallPerMid: 750,
        midUnitPriceKrw: 68000,
        allocations: [
          { buyer: '바 오로라', largeQty: 6, midQty: 36, status: '분배 확정' },
          { buyer: '비스트로 루나', largeQty: 4, midQty: 24, status: '출고 대기' },
          { buyer: '메종 다이닝', largeQty: 2, midQty: 12, status: '예약 배정' },
        ],
      },
    ],
    phoneHarness: {
      deviceId: 'dev-ph-whatsapp-03',
      channel: '보세·통관 메신저 채널 (Read-Only)',
      roomTitle: '와인 보세창고 통관·배차방(가상)',
      sender: 'CELLAR_CUSTOMS_HUB',
      receivedAt: '오후 14:15',
      rawMessage: 'LOT-2611-W04 나파 카베르네 15케이스(180병) 보세반출 완료 · 비스트로 루나 8케이스 우선 배차',
      dedupKey: 'sha256:7a61c0f82c...demo03',
      ocrHighlight: '품목=나파 카베르네 750ml · 15케이스 → 180병 / 135,000용량ml 자동 환산',
      moyiCard: {
        room: 'MOYI 통관·주류 출고 승인 게이트',
        title: 'LOT-2611-W04 통관 로트 출고 승인 요청',
        item: '나파 카베르네 리저브 750ml (SKU-WN-309)',
        qtyText: '15케이스 · 180병 · 135,000용량ml',
        proposedBy: 'phone-harness-03 (자동 수집)',
        approvedBy: '수입·주류 관리책임자 (2FA 승인)',
        receiptId: 'RCPT-WN-2611-502',
        ledgerSummary: 'Bucket=LOT-2611-W04 · Large=15케이스 · Mid=180병 · Small=135,000ml · 제세 배부 완료',
      },
    },
    landedCost: {
      batchLabel: '해상 리퍼 120케이스 (1,440병 / 1,080,000용량ml)',
      largeQty: 120,
      midQty: 1440,
      smallQty: 1080000,
      fobTotalKrw: 38400000,
      freightKrw: 4200000,
      customsKrw: 11520000,
      domesticKrw: 960000,
      suggestedMarginPct: 28,
      costLabels: ['와이너리 EXW/FOB 매입가', '해상 리퍼 운임 · 보험', '관세 · 주세 · 교육세 · 통관', '보세창고 · 항온배송비'],
    },
  },
  {
    id: 'apparel',
    label: '의류 · 공산품 B2B 유통',
    shortLabel: '의류·공산품',
    badge: '패션 · 공산품 홀세일',
    accent: '#d97706',
    accentSoft: '#fef3c7',
    tenantCode: 'demo-apparel-b2b',
    sampleCompany: '모던루프 B2B 어패럴(가상 시연사)',
    sourceLabel: '제조공장·시즌코드',
    units: ['카톤', '묶음', '피스'],
    bucketLabel: '프리오더 차수',
    sampleBucket: '26FW-PO-03',
    headline: '해외 봉제공장 위챗 선적패킹 알림을 카톤·묶음·피스 단위로 즉시 풀고 B2B 편집숍 물량 배분',
    catalogItems: [
      {
        sku: 'SKU-AP-412',
        name: '헤비코튼 오버핏 후디 (M/L)',
        originSource: '베트남 호치민 제2봉제 · 26FW-S03(가상)',
        bucket: '26FW-PO-03',
        defaultLargeQty: 20,
        ratioMidPerLarge: 5,
        ratioSmallPerMid: 10,
        midUnitPriceKrw: 185000,
        allocations: [
          { buyer: '모던스튜디오 편집숍', largeQty: 10, midQty: 50, status: '분배 확정' },
          { buyer: '어반마켓 온라인몰', largeQty: 6, midQty: 30, status: '출고 대기' },
          { buyer: '노스엔드 셀렉트', largeQty: 4, midQty: 20, status: '예약 배정' },
        ],
      },
      {
        sku: 'SKU-AP-418',
        name: '울 블렌드 니트 가디건',
        originSource: '중국 항저우 니트팩토리 · 26FW-S03(가상)',
        bucket: '26FW-PO-03',
        defaultLargeQty: 12,
        ratioMidPerLarge: 6,
        ratioSmallPerMid: 8,
        midUnitPriceKrw: 210000,
        allocations: [
          { buyer: '어반마켓 온라인몰', largeQty: 6, midQty: 36, status: '분배 확정' },
          { buyer: '모던스튜디오 편집숍', largeQty: 4, midQty: 24, status: '출고 대기' },
          { buyer: '노스엔드 셀렉트', largeQty: 2, midQty: 12, status: '검수 중' },
        ],
      },
      {
        sku: 'SKU-AP-425',
        name: '캔버스 유틸리티 토트백',
        originSource: '국내 성수 제1공방 · 26FW-S03(가상)',
        bucket: '26FW-PO-03',
        defaultLargeQty: 15,
        ratioMidPerLarge: 4,
        ratioSmallPerMid: 12,
        midUnitPriceKrw: 132000,
        allocations: [
          { buyer: '노스엔드 셀렉트', largeQty: 7, midQty: 28, status: '분배 확정' },
          { buyer: '모던스튜디오 편집숍', largeQty: 5, midQty: 20, status: '출고 대기' },
          { buyer: '어반마켓 온라인몰', largeQty: 3, midQty: 12, status: '예약 배정' },
        ],
      },
    ],
    phoneHarness: {
      deviceId: 'dev-ph-wechat-04',
      channel: '해외 봉제공장 위챗방 (Read-Only)',
      roomTitle: '26FW 생산·선적 검수방(가상)',
      sender: 'HCM_GARMENT_FACTORY2',
      receivedAt: '오전 11:20',
      rawMessage: '26FW-PO-03 헤비코튼 후디 20카톤(100묶음/1,000피스) 선적패킹 완료 · 검수사진 첨부',
      dedupKey: 'sha256:2e93f4d59a...demo04',
      ocrHighlight: '품목=헤비코튼 오버핏 후디 · 20카톤 → 100묶음 / 1,000피스 자동 환산',
      moyiCard: {
        room: 'MOYI 프리오더 입고·배분 승인 게이트',
        title: '26FW-PO-03 프리오더 입고 원장 반영 승인 요청',
        item: '헤비코튼 오버핏 후디 (SKU-AP-412)',
        qtyText: '20카톤 · 100묶음 · 1,000피스',
        proposedBy: 'phone-harness-04 (자동 수집)',
        approvedBy: '소싱·물류 총괄 (2FA 승인)',
        receiptId: 'RCPT-AP-2603-719',
        ledgerSummary: 'Bucket=26FW-PO-03 · Large=20카톤 · Mid=100묶음 · Small=1,000피스 · 승인분리 확인',
      },
    },
    landedCost: {
      batchLabel: 'FCL 혼적 80카톤 (400묶음 / 4,000피스)',
      largeQty: 80,
      midQty: 400,
      smallQty: 4000,
      fobTotalKrw: 36000000,
      freightKrw: 2800000,
      customsKrw: 4680000,
      domesticKrw: 880000,
      suggestedMarginPct: 32,
      costLabels: ['공장 FOB 생산단가', '해상 LCL/FCL 운임', '관세 · 원산지증명 · 통관', '3PL 물류센터 분류·출고비'],
    },
  },
];

export function getIndustryPreset(industryId) {
  return INDUSTRY_PRESETS.find((preset) => preset.id === industryId) || INDUSTRY_PRESETS[0];
}

export function buildMappingJson(preset) {
  const [largeUnit, midUnit, smallUnit] = preset.units;
  return {
    $schema: 'https://nowlink.kr/schemas/mapping.v1.json',
    tenantCode: preset.tenantCode,
    sampleCompany: preset.sampleCompany,
    industry: preset.id,
    terminology: {
      sourceLabel: preset.sourceLabel,
      timeBucketLabel: preset.bucketLabel,
      sampleBucket: preset.sampleBucket,
      unitHierarchy: {
        large: largeUnit,
        mid: midUnit,
        small: smallUnit,
      },
    },
    captureChannels: {
      deviceId: preset.phoneHarness.deviceId,
      mode: 'READ_ONLY_PHONE_HARNESS',
      outboundBlock: true,
      dedupHashAlgorithm: 'sha256',
      primaryChannel: preset.phoneHarness.channel,
    },
    landedCostAllocation: {
      basisUnit: midUnit,
      subUnit: smallUnit,
      costBuckets: preset.landedCost.costLabels,
      targetGrossMarginPct: preset.landedCost.suggestedMarginPct,
    },
    approvalGate: {
      provider: 'MOYI_MOBILE_2FA',
      enforceSeparationOfDuties: true,
      idempotencyPolicy: 'UNIQUE_WORKSPACE_KEY',
    },
  };
}

export function calculateThreeUnitTotals(item, largeQtyInput) {
  const largeQty = Math.max(1, Math.min(500, Math.round(Number(largeQtyInput) || item.defaultLargeQty || 1)));
  const midQty = largeQty * item.ratioMidPerLarge;
  const smallQty = midQty * item.ratioSmallPerMid;
  const baseLarge = Math.max(1, item.defaultLargeQty || 1);
  const scale = largeQty / baseLarge;
  const allocations = (item.allocations || []).map((row) => {
    const scaledMid = Math.round(row.midQty * scale);
    const scaledLarge = Number((scaledMid / item.ratioMidPerLarge).toFixed(1));
    return {
      ...row,
      largeQty: scaledLarge,
      midQty: scaledMid,
      smallQty: scaledMid * item.ratioSmallPerMid,
      amountKrw: scaledMid * item.midUnitPriceKrw,
    };
  });
  const allocatedMid = allocations.reduce((sum, row) => sum + row.midQty, 0);
  return {
    largeQty,
    midQty,
    smallQty,
    allocatedMid,
    remainingMid: Math.max(0, midQty - allocatedMid),
    totalSalesKrw: midQty * item.midUnitPriceKrw,
    allocations,
  };
}

export function calculateLandedCost(preset, { supplyAdjustPct = 0, logisticsAdjustPct = 0 } = {}) {
  const lc = preset.landedCost;
  const supplyFactor = 1 + Number(supplyAdjustPct || 0) / 100;
  const logisticsFactor = 1 + Number(logisticsAdjustPct || 0) / 100;

  const adjustedFobKrw = Math.round(lc.fobTotalKrw * supplyFactor);
  const adjustedFreightKrw = Math.round(lc.freightKrw * logisticsFactor);
  const adjustedCustomsKrw = Math.round(lc.customsKrw * supplyFactor);
  const adjustedDomesticKrw = Math.round(lc.domesticKrw * logisticsFactor);
  const totalLandedKrw = adjustedFobKrw + adjustedFreightKrw + adjustedCustomsKrw + adjustedDomesticKrw;

  const unitCostLarge = Math.round(totalLandedKrw / Math.max(1, lc.largeQty));
  const unitCostMid = Math.round(totalLandedKrw / Math.max(1, lc.midQty));
  const unitCostSmall = Number((totalLandedKrw / Math.max(1, lc.smallQty)).toFixed(1));
  const marginPct = lc.suggestedMarginPct;
  const suggestedSupplyMid = Math.round(unitCostMid / (1 - marginPct / 100));

  return {
    adjustedFobKrw,
    adjustedFreightKrw,
    adjustedCustomsKrw,
    adjustedDomesticKrw,
    totalLandedKrw,
    unitCostLarge,
    unitCostMid,
    unitCostSmall,
    suggestedSupplyMid,
    marginPct,
  };
}

export function calculateCommercialRoi({
  staffCount = 12,
  deviceCount = 2,
  planId = 'team',
  includeDeviceHub = true,
  hourlyWageKrw = 24000,
} = {}) {
  const seats = Math.max(1, Math.min(200, Math.round(Number(staffCount) || 1)));
  const devices = includeDeviceHub ? Math.max(1, Math.min(30, Math.round(Number(deviceCount) || 1))) : 0;
  const plan = PRICING_PLANS.find((p) => p.id === planId) || PRICING_PLANS[2];

  const monthlyPlanKrw = plan.monthlyBaseKrw + seats * plan.perSeatKrw;
  const monthlyDeviceKrw = includeDeviceHub ? devices * DEVICE_HUB_ADDON.monthlyPerDeviceKrw : 0;
  const totalMonthlyKrw = monthlyPlanKrw + monthlyDeviceKrw;

  const weeklyHoursSaved = Number(
    (seats * plan.weeklyHoursSavedPerSeat + devices * DEVICE_HUB_ADDON.extraWeeklyHoursPerDevice).toFixed(1)
  );
  const monthlyHoursSaved = Number((weeklyHoursSaved * 4.33).toFixed(1));
  const monthlyLaborSavingsKrw = Math.round(monthlyHoursSaved * hourlyWageKrw);
  const netMonthlyBenefitKrw = monthlyLaborSavingsKrw - totalMonthlyKrw;
  const roiMultiple = totalMonthlyKrw > 0 ? Number((monthlyLaborSavingsKrw / totalMonthlyKrw).toFixed(2)) : 0;
  const paybackDays =
    monthlyLaborSavingsKrw > 0 ? Math.max(1, Math.round((totalMonthlyKrw / monthlyLaborSavingsKrw) * 30)) : 30;

  return {
    plan,
    seats,
    devices,
    includeDeviceHub,
    monthlyPlanKrw,
    monthlyDeviceKrw,
    totalMonthlyKrw,
    weeklyHoursSaved,
    monthlyHoursSaved,
    monthlyLaborSavingsKrw,
    netMonthlyBenefitKrw,
    roiMultiple,
    paybackDays,
  };
}
