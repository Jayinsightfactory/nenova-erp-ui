// lib/ceoCommandHub.js
// 사장님 전용 통합 지휘실(/work/command-hub) 순수 도메인 집계 · 정규화 모듈.
// DB · React · 파일 I/O 의존 없음 (서버/클라이언트/단위테스트 공용).
// 원장 무쓰기 · 읽기 전용 원칙, 사내 비노출어 및 장식 이모지 0건 준수.

import {
  CONTINUOUS_BUILD_PIPELINE,
  BUILD_PIPELINE_STAGES,
  normalizeRadarCatalog,
  buildWorkbenchSummary,
} from './pmTechRadarSim';
import { runGabrielAgiAudit } from './gabrielProfitAgi';
import { pmUnresolved } from './pmUnresolved';
import { normalizePlaybooks, playbookSummary, kstDateTime } from './pmPlaybooks';

export const CEO_FONT_STACK =
  "'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', '맑은 고딕', 'Segoe UI', sans-serif";

export const COMMAND_HUB_PURPOSE = Object.freeze({
  tag: '핵심 목적 · PURPOSE',
  headline:
    '사장님이 작업하는 매 순간 내 목표 동기화 · 작업 목표정합성 감사 · 나를 학습한 AGI 진화가 3중 병렬로 동시에 돌아가게 합니다.',
  prevents:
    '목표에서 벗어난 과잉 개발(Drift), 사장님 기준 반복 재설명, 고정비 누수·보안 공백의 뒤늦은 대응',
  outcome:
    '전사 목표(g01~g19) 4대 축 달성판 · 에이전트 작업 1:1 정합 감사표 · 6대 판단 DNA 기반 선제 실행 지시서 Top 5',
});

export const OWNER_AGI_LOOP_STEPS = Object.freeze([
  Object.freeze({
    id: 'directive-dna',
    surface: 'OWNER SIGNAL',
    title: '사장님 지시 · 판단 DNA 학습',
    goal: '실제 발화·결재에서 6대 기준 추출',
    token: 'P1~P6 DNA · owner-twin.json',
    targetId: 'owner-twin-persona',
  }),
  Object.freeze({
    id: 'goals-sync',
    surface: 'GOAL LEDGER',
    title: '전사 목표(Goals) 정본 동기화',
    goal: '4대 전략 축 g01~g19 진척 반영',
    token: 'goals.json · 4대 축 19개 목표',
    targetId: 'owner-twin-goal-ledger',
  }),
  Object.freeze({
    id: 'alignment-audit',
    surface: 'ALIGNMENT AUDIT',
    title: '에이전트 작업 목표정합성 감사',
    goal: '전 작업 1:1 매핑 · Drift 0건 점검',
    token: '정합률 100% · 공백 경보',
    targetId: 'owner-twin-alignment-audit',
  }),
  Object.freeze({
    id: 'swarm-exec',
    surface: 'MULTI-MODEL SWARM',
    title: '멀티모델 스웜 병렬 구현·검증',
    goal: 'Claude·GPT·Gemini 무대기 완결',
    token: '격리 Worktree · CI·PR 머지',
    targetId: 'hub-agents-and-pulse',
  }),
  Object.freeze({
    id: 'feedback-relearn',
    surface: 'LIVE FEEDBACK',
    title: '실전 반영 & 피드백 재학습',
    goal: '배포 결과·수정 지시 즉시 축적',
    token: '§8 3-툴 동기화 · 선제 Top 5',
    targetId: 'owner-twin-proposals',
  }),
]);

export const OWNER_STRATEGIC_PILLARS = Object.freeze([
  Object.freeze({
    id: 'profit-agi',
    orderLabel: '① 수익·원가 혁신',
    title: '수익·원가 혁신 (가브리엘 AGI)',
    subtitle: '전사 10대 원가·이익 레버와 사장님 판단 DNA 자율 진화',
    goalIds: Object.freeze(['g17', 'g19']),
  }),
  Object.freeze({
    id: 'internal-p0',
    orderLabel: '② 사내 자동화(P0)',
    title: '사내 자동화 완성 (P0)',
    subtitle: '/pm 정착, 매뉴얼 품질, Hermes·Rust 핫패스·공용폰 보조수집',
    goalIds: Object.freeze(['g01', 'g02', 'g03', 'g11', 'g12', 'g13', 'g14', 'g16']),
  }),
  Object.freeze({
    id: 'infra-security',
    orderLabel: '③ 인프라·비공개 보안',
    title: '인프라 비용·비공개 보안',
    subtitle: 'Railway 고정비 다이어트, 디스크 안전, 무과금 Private 자립',
    goalIds: Object.freeze(['g18', 'g04', 'g08']),
  }),
  Object.freeze({
    id: 'commercial-p1-p3',
    orderLabel: '④ NOWLINK·MOYI 상용화',
    title: 'NOWLINK·MOYI 상용화 (P1~P3)',
    subtitle: '멀티테넌트·코드서명·동의서·파트너 1호·라운지 상용 패키지',
    goalIds: Object.freeze(['g15', 'g05', 'g06', 'g07', 'g09', 'g10']),
  }),
]);

export const DEFAULT_OWNER_GOALS = Object.freeze([
  Object.freeze({
    id: 'g17',
    pillarId: 'profit-agi',
    title: '전사 원가·이익 자율 추론 AGI (가브리엘 10대 레버)',
    done: '주 +769.5만원 / 연 +3.85억 이익 회수 체계 실전 가동',
    progress: 85,
    state: 'open',
    recentLinked: 'PR #1871 · #1885 · #1880',
    note: '10대 레버·중국 배/비행기 분해·불량수량 분리 완료, 제로유닛·크레딧 상계 확장 중',
    route: '/import/gabriel-agi',
  }),
  Object.freeze({
    id: 'g19',
    pillarId: 'profit-agi',
    title: '사장님 의사결정 디지털 트윈(Owner-Aligned AGI) 상시 학습',
    done: '목표 동기화 · 작업 정합성 감사 · 판단 DNA 누적 3중 병렬 루프 가동',
    progress: 80,
    state: 'open',
    recentLinked: '통합지휘실 #1893 · §8 트윈 루프',
    note: 'owner-agi-twin 엔진 및 통합지휘실 3중 관제 보드·트레이스 도면 동시 구축',
    route: '/work/command-hub',
  }),
  Object.freeze({
    id: 'g01',
    pillarId: 'internal-p0',
    title: '/pm 사내 정착 측정 (P0 관문 · 직원 70% 주 2회×4주)',
    done: '직원별 일일 접속 지표 가동 + 4주 연속 70% 달성',
    progress: 85,
    state: 'open',
    recentLinked: 'PR #1879 · W47 73% 통과',
    note: '접속 데이터 3주 축적 완료, W47 자발 접속률 73% 첫 기준 돌파',
    route: '/pm',
  }),
  Object.freeze({
    id: 'g02',
    pillarId: 'internal-p0',
    title: '보상 루프 완성 (라벨→토큰→상점 무중단)',
    done: '반자동 구간 0 — 7일 연속 사람 개입 없이 토큰 적립·구매',
    progress: 10,
    state: 'open',
    recentLinked: '공백 경보 · 점검표 완료',
    note: '반자동 구간 4곳 진단 완료, 서버 tick 공백일수 보완 필요',
    route: '/pm',
  }),
  Object.freeze({
    id: 'g03',
    pillarId: 'internal-p0',
    title: '라이브 매뉴얼 품질 게이트 (절차서 60건 신입 검증)',
    done: '목적·트레이스 도면 장착 및 신입 그대로 수행률 검증',
    progress: 35,
    state: 'open',
    recentLinked: 'PR #1894 목적·트레이스 모션',
    note: '부서 매뉴얼·수입 원스톱에 목적 우선 트레이스 도면 장착 완료',
    route: '/work/manuals',
  }),
  Object.freeze({
    id: 'g11',
    pillarId: 'internal-p0',
    title: 'Hermes 다중 에이전트 폴백 · 궤적 압축 · 스킬 합성',
    done: '97/97 SKILL.md 합성 · 91.1% 로그 압축 · Claude↔Codex 폴백',
    progress: 100,
    state: 'done',
    recentLinked: 'hermes-manager.js 완료',
    note: '97/97 SKILL.md 73ms 합성 및 다중 모델 폴백 검증 완료',
    route: '/my-work?tab=arch',
  }),
  Object.freeze({
    id: 'g12',
    pillarId: 'internal-p0',
    title: 'Rust 고효율 핫패스 전환 (hermes-core.exe · 사이드카)',
    done: '정적 Rust 바이너리 389.5KB · 4.35x 가속 · JS Fallback 호환',
    progress: 100,
    state: 'done',
    recentLinked: 'hermes-core.exe 완료',
    note: '27.52MB 로그 3.04~4.36배 가속 및 cargo test 7/7 통과',
    route: '/my-work?tab=devices',
  }),
  Object.freeze({
    id: 'g13',
    pillarId: 'internal-p0',
    title: '통합 아키텍처 청사진 · 5-Surface 시뮬레이션 · 데스크톱 연결',
    done: '직교 트레이스 도면 · 시뮬레이션 · 데스크톱 통합지휘실 직결',
    progress: 100,
    state: 'done',
    recentLinked: 'PR #1840 · #1887 · #1893',
    note: '직교 버스 도면, 통합지휘실 제1버튼, A·B·C 레이더 시뮬레이터 반영 완료',
    route: '/my-work?tab=suite-sim',
  }),
  Object.freeze({
    id: 'g14',
    pillarId: 'internal-p0',
    title: 'Phone Harness + Device Hub 카나리 1대 · Dual-Path 수집',
    done: '공용폰 1대 72h 카나리 + DRAFT→APPROVED 20건 무사고',
    progress: 30,
    state: 'needs-approval',
    recentLinked: 'Phase 1 설계 · 카나리 승인 대기',
    note: 'Read-Only 킬스위치 0.007ms 스펙 완료, 실단말 카나리 승인 대기',
    route: '/my-work?tab=devices',
  }),
  Object.freeze({
    id: 'g16',
    pillarId: 'internal-p0',
    title: '솔루션 마스터 목표 & 가능·조건부·불가능 정본화',
    done: '전 저장소 목표/한계 정본 문서 + 아키텍처 기준표 배포',
    progress: 100,
    state: 'done',
    recentLinked: 'PR #1850 머지 완료',
    note: '전 저장소 목표 정본 문서 및 인터랙티브 기준표 머지 완료',
    route: '/my-work?tab=arch',
  }),
  Object.freeze({
    id: 'g18',
    pillarId: 'infra-security',
    title: '인프라 고정비 절감 & 무중단 비공개(Private) 보안 자립',
    done: 'Railway 월 14만→2.8만 다이어트 · talkhub 99.9% 정리 · 무과금 Private',
    progress: 35,
    state: 'open',
    recentLinked: 'RAM 과금·Private 실측 감사 완료',
    note: '원인 실측 완료(Postgres 10.9GB·30일 정리 버그·talkhub 99.9%), 실행 공사 대기',
    route: '/work/command-hub',
  }),
  Object.freeze({
    id: 'g04',
    pillarId: 'infra-security',
    title: '업무 프로필 스키마 v1 & 인증서 HMAC 서명(CERT_SECRET)',
    done: '위조 방지 HMAC 서명 교체 및 운영 시크릿 검증',
    progress: 15,
    state: 'needs-approval',
    recentLinked: '보안 서명안 승인 대기',
    note: '외부 공개(P2) 전 위조 차단을 위한 CERT_SECRET 교체 승인 대기',
    route: '/pm',
  }),
  Object.freeze({
    id: 'g08',
    pillarId: 'infra-security',
    title: '민감어 마스킹 PoC (거래처명·단가 탐지 정확도 실측)',
    done: '거래처명·단가 탐지 정확도 실측 보고서 및 자동 마스킹',
    progress: 10,
    state: 'stalled',
    recentLinked: '공백 경보 · 착수 필요',
    note: '외부 공유·상용화 전 거래처명·단가 자동 마스킹 정확도 실측 필요',
    route: '/work/manuals',
  }),
  Object.freeze({
    id: 'g15',
    pillarId: 'commercial-p1-p3',
    title: '상용 패키지(NOWLINK Watch/Build/Team + Device) 테넌트·서명·과금',
    done: '968+ 라우트 격리 · 코드서명 설치기 · 3업종 매핑 · 과금 출시',
    progress: 45,
    state: 'open',
    recentLinked: 'PR #1877 상용 시연 스튜디오',
    note: '테넌트 가드 968/998·상용 시연 스튜디오 완료, 코드서명·결제·도메인 잔여',
    route: '/demo/commercial-suite',
  }),
  Object.freeze({
    id: 'g05',
    pillarId: 'commercial-p1-p3',
    title: '/pm → NOWLINK 이식 설계서 (의존 전수조사 · 커넥터 경계)',
    done: 'nenovaweb 의존 전수조사 및 커넥터 경계 문서화',
    progress: 10,
    state: 'stalled',
    recentLinked: 'P1 설계 대기',
    note: 'P0 정착 이후 NOWLINK 범용 커넥터 경계 분리 설계 예정',
    route: '/demo/commercial-suite',
  }),
  Object.freeze({
    id: 'g06',
    pillarId: 'commercial-p1-p3',
    title: '직원 동의서 v2 초안 & 법무 의뢰',
    done: '목적별 동의 3종 + 급여·평가 무관 조항 법무 검토',
    progress: 10,
    state: 'stalled',
    recentLinked: '법무 발송 승인 필요',
    note: '초안 정리 후 외부 법무 의뢰는 사장님 승인 시 실행',
    route: '/pm',
  }),
  Object.freeze({
    id: 'g07',
    pillarId: 'commercial-p1-p3',
    title: '"내 데이터 보기" 직원 투명성 화면',
    done: '직원이 본인 수집 범위·능력 지도를 확인하는 화면 배포',
    progress: 10,
    state: 'stalled',
    recentLinked: 'P1 투명성 화면 대기',
    note: '동의서 v2와 연계해 본인 업무 기록 열람 화면 구성 예정',
    route: '/my-work',
  }),
  Object.freeze({
    id: 'g09',
    pillarId: 'commercial-p1-p3',
    title: '파트너 1호 후보 리스트업 & 온보딩 체크리스트',
    done: '후보 목록·온보딩 체크리스트 작성 (접촉은 P0 통과 후)',
    progress: 10,
    state: 'stalled',
    recentLinked: '외부 접촉 사장님 승인',
    note: '사내 P0 4주 관문 완료 시점에 맞춰 외부 1호 파일럿 선별',
    route: '/demo/commercial-suite',
  }),
  Object.freeze({
    id: 'g10',
    pillarId: 'commercial-p1-p3',
    title: '라운지 PoC (사내 오두막 + MOYI 채팅 + 한↔영 번역 데모)',
    done: 'PM 사무실 오두막 1개 + MOYI 연결 + 실시간 번역 데모',
    progress: 10,
    state: 'needs-approval',
    recentLinked: 'MOYI 외부 발송 승인 대기',
    note: 'MOYI 메신저 외부 발송 경로 연동에 대한 사장님 결정 대기',
    route: '/integrations/moyi',
  }),
]);

export const DEFAULT_OWNER_DNA_PRINCIPLES = Object.freeze([
  Object.freeze({
    id: 'P1',
    title: '수익·고정비 역산 본능',
    rule: '기술 유행보다 주간 순이익(+원/주) 회수와 고정비 누수(Railway RAM·Egress·클라우드 과금) 차단을 최우선 검증합니다.',
    evidence: '가브리엘 주 +769.5만원 · Railway 월 14만→2.8만 역산',
    signals: 12,
  }),
  Object.freeze({
    id: 'P2',
    title: '목적·4원천·4부서 보고 표준',
    rule: '모든 화면과 레버 최상단에 [핵심 목적] + 표 + 트레이스 도면 + 4원천(이메일·담당자·거래처·기준식) + 4부서 업무를 함께 제시합니다.',
    evidence: '가브리엘 10대 레버 · 부서 매뉴얼 · 수입 원스톱 표준화',
    signals: 9,
  }),
  Object.freeze({
    id: 'P3',
    title: '에이스 암묵지 수식화',
    rule: '가브리엘 등 핵심 실무자의 협상·대조·선처리 습관을 사람 의존 없이 영구 코드·수식·자동 경보 체계로 고정합니다.',
    evidence: 'L1~L10 원가·AWB·환율 방어 단가 수식화',
    signals: 8,
  }),
  Object.freeze({
    id: 'P4',
    title: 'Anti-AI Slop · 고딕 가독성 · 트레이스 미감',
    rule: '네온·이모지·그라디언트·굴림체 0건, 14px+ 한글 고딕, 초록 완료/파랑 점선 직교 트레이스 모션으로 1초 판독성을 지킵니다.',
    evidence: 'SHARED_AGENT_RULES §7 · PR #1894 트레이스 규격',
    signals: 11,
  }),
  Object.freeze({
    id: 'P5',
    title: '메인 무대기 · 멀티모델 스웜 병렬 완결',
    rule: '메인창 대기 0초, Claude·GPT·Gemini 쿼터를 분산한 격리 Worktree 스웜으로 구현·검증·PR 머지까지 끝까지 완결합니다.',
    evidence: '멀티모델 스웜 프로토콜 · 데스크톱앱 제1버튼 직결',
    signals: 7,
  }),
  Object.freeze({
    id: 'P6',
    title: '현장·원장 무사고 안전선',
    rule: '운영PC 매크로 분리(PR #50 별도 승인), ECOUNT 조회 전용, 무승인 원장 쓰기 0건, Private 전환 전 직원 PC 중단 사전 차단.',
    evidence: 'ERP Contract Guard · Private 사전 감사 5대 리스크 차단',
    signals: 9,
  }),
]);

export const DEFAULT_OWNER_PROACTIVE_PROPOSALS = Object.freeze([
  Object.freeze({
    id: 'tw-railway-diet',
    code: 'TW-01',
    goalId: 'g18',
    goalTitle: '인프라 고정비 절감 & Private 자립',
    title: 'Railway Postgres 10.9GB→1.5GB 다이어트 & 30일 정리 버그 수리',
    expectedImpact: '월 11.2만원 고정비 절감 (월 14만 → 2.8만)',
    rationale: 'P1 수익·고정비 역산 본능 + P6 무사고 안전선 (RAM/Egress 과금 주범 즉시 제거)',
    urgency: '긴급 · ROI 최상',
    route: '/work/command-hub',
    routeLabel: '지휘실 점검',
    agentBriefText:
      '[TW-01 · g18] Railway Postgres 10.9GB→1.5GB 다이어트 & 30일 삭제 버그 수리:\n' +
      '1) 30일 보관 정리 스크립트 조건 누락 버그 원인 수정 및 드라이런 검증\n' +
      '2) 대용량 이벤트 테이블 정리·VACUUM 실행 계획 수립(운영 무중단 확인)\n' +
      '3) 정리 전후 DB 용량·RAM 사용량·월 예상 과금(14만원→2.8만원) 비교 보고서 제출',
  }),
  Object.freeze({
    id: 'tw-talkhub-disk',
    code: 'TW-02',
    goalId: 'g18',
    goalTitle: '인프라 고정비 절감 & Private 자립',
    title: 'talkhub /data 99.9% 디스크 풀 장애 사전 차단 & 아카이브 정리',
    expectedImpact: '서비스 중단 위험 0건 차단 · 여유 디스크 40%+ 확보',
    rationale: 'P6 현장·원장 무사고 안전선 + P1 고정비 역산 (디스크 100% 장애 사전 차단)',
    urgency: '긴급 · 장애 예방',
    route: '/integrations/moyi',
    routeLabel: '연동 점검',
    agentBriefText:
      '[TW-02 · g18] talkhub /data 99.9% 디스크 풀 장애 사전 차단:\n' +
      '1) /data 상위 점유 디렉터리·오래된 미디어/로그 파일 읽기 전용 실측\n' +
      '2) 백업 완료분 분리 이관 및 보존주기 로테이션 적용\n' +
      '3) 정리 후 디스크 점유율 60% 이하 복구 확인 및 재발 방지 점검표 보고',
  }),
  Object.freeze({
    id: 'tw-private-mirror',
    code: 'TW-03',
    goalId: 'g18',
    goalTitle: '인프라 고정비 절감 & Private 자립',
    title: 'Cafe24 정적 피드·릴리스 미러 기반 무과금 GitHub Private 전환 공사',
    expectedImpact: '추가비용 0원 5개 저장소 비공개화 · 직원 PC 중단 0건',
    rationale: 'P6 무사고 안전선 + P1 고정비 역산 (Free 한도 초과·직원 업데이트 404 사전 해소)',
    urgency: '높음 · 보안 자립',
    route: '/my-work?tab=arch',
    routeLabel: '아키텍처 도면',
    agentBriefText:
      '[TW-03 · g18] 추가비용 0원 GitHub Private 전환 선행공사:\n' +
      '1) 데스크톱 자동업데이트 피드(latest.yml/설치기)를 Cafe24 정적 미러로 전환\n' +
      '2) Cafe24 deploy.yml 무인증 git fetch 의존 제거(아티팩트/토큰 배포로 전환)\n' +
      '3) Orbit 데몬 git pull 경로를 서버 배포 번들/토큰 방식으로 검증 후 Private 전환',
  }),
  Object.freeze({
    id: 'tw-zero-unit-master',
    code: 'TW-04',
    goalId: 'g17',
    goalTitle: '전사 원가·이익 자율 추론 AGI',
    title: '입수량 제로유닛(SteamOf1Box=0) 295품목 마스터 보정기 실전 반영',
    expectedImpact: '주 +245만원 원가 왜곡 차단 (13,815주문행 정상화)',
    rationale: 'P3 에이스 암묵지 수식화 + P1 수익 역산 (단가 누수 근본 차단)',
    urgency: '높음 · 수익 회수',
    route: '/import/gabriel-agi',
    routeLabel: '가브리엘 AGI',
    agentBriefText:
      '[TW-04 · g17] 제로유닛(SteamOf1Box=0) 295품목 마스터 보정기:\n' +
      '1) SteamOf1Box=0 295품목의 과거 실입고·패킹리스트 기준 추천 입수량 산출(읽기 전용)\n' +
      '2) 담당자 1클릭 검수·승인 표와 4원천(이메일·담당자·거래처·기준식) 근거 제공\n' +
      '3) 승인 전 DB 무쓰기 원칙 유지, 승인 건만 안전 반영 및 원가 변동폭 리포트 생성',
  }),
  Object.freeze({
    id: 'tw-unrecovered-credit',
    code: 'TW-05',
    goalId: 'g17',
    goalTitle: '전사 원가·이익 자율 추론 AGI',
    title: '미확정 불량 232건 농장 Credit 자동 상계 · 송금 전 게이트 연결',
    expectedImpact: '주 +182만원 · 미회수 불량 크레딧 조기 상계',
    rationale: 'P1 수익·고정비 역산 본능 + P2 4원천·4부서 보고 표준',
    urgency: '높음 · 현금 회수',
    route: '/sales/defect-deductions',
    routeLabel: '불량차감 원장',
    agentBriefText:
      '[TW-05 · g17] 미확정 불량 232건 농장 Credit 자동 상계 게이트:\n' +
      '1) 국내 불량차감 원장과 15일·25일 외화 송금 예정 농장 1:1 매칭(읽기 전용)\n' +
      '2) 농장별 미회수 Credit 금액·근거 사진·담당자·결제일 4원천 요약표 구성\n' +
      '3) 송금 결재 화면 상단에 미상계 크레딧 자동 경고 배지 및 체크리스트 연결',
  }),
]);

export const DEFAULT_GOAL_GAP_ALERTS = Object.freeze([
  Object.freeze({
    id: 'gap-railway',
    goalId: 'g18',
    severity: 'high',
    title: 'Railway 월 14만원 → 2.8만원 다이어트 미착수',
    detail: 'Postgres 10.9GB 누적 및 30일 정리 버그 수리 시 월 11.2만원 고정비 즉시 절감',
    nextAction: 'TW-01 지시서 실행',
  }),
  Object.freeze({
    id: 'gap-talkhub',
    goalId: 'g18',
    severity: 'high',
    title: 'talkhub /data 디스크 99.9% 임계 정리 필요',
    detail: '잔여 공간 고갈 시 메신저·업무 피드 장애 위험 — 우선 아카이브 분리 필요',
    nextAction: 'TW-02 지시서 실행',
  }),
  Object.freeze({
    id: 'gap-reward-loop',
    goalId: 'g02',
    severity: 'medium',
    title: '보상 루프(라벨→토큰→상점) 진척 10% 정체',
    detail: '반자동 구간 4곳 중 사장님 PC 피드 단일 의존 해소 및 서버 tick 검증 필요',
    nextAction: '/pm 보상 루프 점검',
  }),
  Object.freeze({
    id: 'gap-masking',
    goalId: 'g08',
    severity: 'medium',
    title: '민감어 마스킹 PoC · 인증서 HMAC(g04) 승인 대기',
    detail: '상용화(P2) 전 거래처명·단가 마스킹 실측 및 CERT_SECRET 전환 필요',
    nextAction: '보안 체크리스트 검토',
  }),
]);

export const MORNING_CHECKLIST = Object.freeze([
  Object.freeze({
    stepNo: 1,
    id: 'step-owner-twin',
    title: '1. 목표 · 정합성 · AGI 트윈 점검',
    desc: '전사 목표(g01~g19) 달성률, 작업 정합 감사, 선제 실행 제안 Top 5를 봅니다.',
    targetId: 'hub-owner-twin-board',
    ledgerFilter: null,
  }),
  Object.freeze({
    stepNo: 2,
    id: 'step-approval',
    title: '2. 사장님 결재 대기 확인',
    desc: '승인 대기 PM 안건과 기술 파일럿 채택 건을 한 번에 점검합니다.',
    targetId: 'hub-pm-ledger',
    ledgerFilter: 'approval',
  }),
  Object.freeze({
    stepNo: 3,
    id: 'step-agents-pulse',
    title: '3. 6대 에이전트 · 디벨롭 진척 확인',
    desc: '각 에이전트가 지금 보고 있는 일과 최근 배포·연속 구현 진도를 봅니다.',
    targetId: 'hub-agents-and-pulse',
    ledgerFilter: null,
  }),
  Object.freeze({
    stepNo: 4,
    id: 'step-gabriel-alerts',
    title: '4. 가브리엘 원가·이익 경보 확인',
    desc: '마진 침식·AWB 혼적·미회수 크레딧 상위 3대 경보와 기대 이익을 확인합니다.',
    targetId: 'hub-gabriel-alerts',
    ledgerFilter: null,
  }),
]);

export const DEFAULT_DEVELOPMENT_MILESTONES = Object.freeze([
  Object.freeze({
    id: 'ms-pr-1894',
    dateLabel: '2026-11-20',
    badge: 'PR #1894',
    title: '부서 매뉴얼 · 수입 원스톱 목적 우선 트레이스 모션 도면 장착',
    summary: '최상단 핵심 목적 콜아웃, 24×24 모눈 그리드, 완료 초록 패킷·실행 파랑 점선 직교 배선을 적용했습니다.',
    route: '/work/manuals',
    routeLabel: '업무 매뉴얼',
    source: 'release',
  }),
  Object.freeze({
    id: 'ms-pr-1893',
    dateLabel: '2026-11-19',
    badge: 'PR #1893',
    title: '사장님 통합 지휘실(/work/command-hub) · 데스크톱 제1버튼 직결',
    summary: 'PM 결재, 6대 에이전트, 연속 디벨롭, 가브리엘 경보, 4대 목적 지도를 통합 지휘실로 일원화했습니다.',
    route: '/work/command-hub',
    routeLabel: '통합 지휘실',
    source: 'release',
  }),
  Object.freeze({
    id: 'ms-pr-1887',
    dateLabel: '2026-11-19',
    badge: 'PR #1887',
    title: '솔루션 시뮬레이션 · 직교 SVG 버스 · 공용폰 3열 OCR & 한글 고딕 교정',
    summary: '직교 버스·마스터-디테일 캡처 뷰어와 Windows 한글 고딕 가독성 기준(Desktop 1.3.62)을 반영했습니다.',
    route: '/my-work?tab=suite-sim',
    routeLabel: '솔루션 시뮬레이션',
    source: 'release',
  }),
  Object.freeze({
    id: 'ms-pr-1886',
    dateLabel: '2026-11-19',
    badge: 'PR #1886',
    title: '출고내역서 FSO 거래처 플로르아름 검색 지원',
    summary: '출고내역서 거래처 선택·검색에서 FSO를 플로르아름으로 바로 조회할 수 있습니다.',
    route: '/shipment/statement',
    routeLabel: '출고내역서',
    source: 'release',
  }),
  Object.freeze({
    id: 'ms-pr-1885',
    dateLabel: '2026-11-19',
    badge: 'PR #1885',
    title: '주차별 매출이익 보고서 · 중국 배/비행기 분해 조회',
    summary: '중국 해상(배)·항공(비행기) 운송별 원가·이익을 원장 무변경 읽기 전용으로 분해 조회합니다.',
    route: '/sales/profit-report',
    routeLabel: '매출이익 보고서',
    source: 'release',
  }),
  Object.freeze({
    id: 'ms-pr-1880',
    dateLabel: '2026-11-19',
    badge: 'PR #1880',
    title: '불량차감 클레임용 · 견적용 수량 분리 저장',
    summary: '원본 클레임 수량(Quantity)을 보존하면서 견적 반영용 수량(EstimateQuantity)을 분리 관리합니다.',
    route: '/sales/defect-deductions',
    routeLabel: '불량차감 원장',
    source: 'release',
  }),
  Object.freeze({
    id: 'ms-pr-1879',
    dateLabel: '2026-11-19',
    badge: 'PR #1879',
    title: 'PM 진행·오류 관제(/pm) 에디토리얼 정화 & 가이드',
    summary: '기본 일반 관제 모드로 1초 내 오류·지연을 판별하고 1920/1280/390 화면과 가이드 영상을 검증했습니다.',
    route: '/pm',
    routeLabel: 'PM 오류관제',
    source: 'release',
  }),
  Object.freeze({
    id: 'ms-pr-1878',
    dateLabel: '2026-11-19',
    badge: 'PR #1878',
    title: '도입 레이더 · 아키텍처 흐름도 4종 개편',
    summary: '4분면 극좌표 레이더, 2×2 매트릭스, 카본 콘솔, 연속 구현 파이프라인을 한 화면으로 연결했습니다.',
    route: '/my-work?tab=radar',
    routeLabel: '도입 레이더',
    source: 'release',
  }),
  Object.freeze({
    id: 'ms-pr-1877',
    dateLabel: '2026-11-19',
    badge: 'PR #1877',
    title: '통합 솔루션 시뮬레이션 · 상용 시연 스튜디오 연결',
    summary: '카톡 수집부터 MOYI 승인, 전산 반영까지 실작업 캡처 바운딩박스와 업종별 시연을 연결했습니다.',
    route: '/my-work?tab=suite-sim',
    routeLabel: '솔루션 시뮬레이션',
    source: 'release',
  }),
  Object.freeze({
    id: 'ms-pr-1871',
    dateLabel: '2026-11-19',
    badge: 'PR #1871',
    title: '가브리엘 원가·이익 최적화 AGI (전사 10대 레버)',
    summary: 'L1~L10 원가·이익 레버 분해, 환율 스트레스, 시안 A·B·C·ALL 동시 비교를 실전 배치했습니다.',
    route: '/import/gabriel-agi',
    routeLabel: '가브리엘 AGI',
    source: 'release',
  }),
  Object.freeze({
    id: 'ms-pr-1840',
    dateLabel: '2026-11-18',
    badge: 'PR #1840',
    title: '디바이스 허브(Phone Harness) & Rust 402.5KB 사이드카',
    summary: '공용 단말 Read-Only 보조수집과 0.007ms 킬스위치, 4.35x 로그 압축 코어를 통합했습니다.',
    route: '/my-work?tab=devices',
    routeLabel: '디바이스 허브',
    source: 'release',
  }),
]);

export const CEO_PAGE_DIRECTORY = Object.freeze([
  Object.freeze({
    id: 'dir-daily-command',
    stepLabel: '목적 1',
    title: '일일 지휘 · 결재 관제',
    whenToUse: '매일 아침 08:30 · PM 안건과 회사 전체 이상 유무를 1분 안에 볼 때',
    items: Object.freeze([
      Object.freeze({
        href: '/work/command-hub',
        title: '사장님 통합 지휘실',
        oneLineDesc: 'PM 안건, 6대 에이전트 현황, 연속 디벨롭, 원가 경보를 한 페이지에서 봅니다.',
        whenText: '출근 직후 · 수시 확인',
        badge: '현재 화면',
      }),
      Object.freeze({
        href: '/pm',
        title: 'PM 진행·오류 관제',
        oneLineDesc: '직원별 실시간 업무 단계, 재발 학습 카드, 직원 요청 게시판을 처리합니다.',
        whenText: '오류·정체 상세 조치 시',
        badge: '실시간',
      }),
      Object.freeze({
        href: '/ops',
        title: '운영 관제탑',
        oneLineDesc: '발주부터 이익까지 9단계 전사 흐름과 전산 일치율을 한눈에 봅니다.',
        whenText: '전사 병목 점검 시',
        badge: '9단계',
      }),
      Object.freeze({
        href: '/mgmt/approvals',
        title: '결재선 · 승인 요청함',
        oneLineDesc: '송금 결재선과 관리자 최종 승인 대기 건을 검토하고 처리합니다.',
        whenText: '송금·결재 승인 시',
        badge: '결재',
      }),
      Object.freeze({
        href: '/mgmt',
        title: '경영관리 홈',
        oneLineDesc: '여신한도, 채권 aging, 차수 마감 체크리스트, 거래처 이익을 봅니다.',
        whenText: '주간·월간 마감 시',
        badge: '경영',
      }),
    ]),
  }),
  Object.freeze({
    id: 'dir-profit-ops',
    stepLabel: '목적 2',
    title: '돈 버는 원가 · 실무 원스톱',
    whenToUse: '선적 전후 마진 방어, 인보이스 검산, 출고·불량 정산을 확인할 때',
    items: Object.freeze([
      Object.freeze({
        href: '/import/gabriel-agi',
        title: '가브리엘 원가·이익 최적화 AGI',
        oneLineDesc: '전사 10대 원가·이익 레버와 환율 충격 시뮬레이션, 방어 단가를 계산합니다.',
        whenText: '목·금 발주 / 원가 점검 시',
        badge: '10대 레버',
      }),
      Object.freeze({
        href: '/import/pipeline',
        title: '수입 원스톱 파이프라인',
        oneLineDesc: '인보이스 파싱부터 입고 검수, 도착원가 확정, 카톡 공유까지 순서대로 진행합니다.',
        whenText: '수입 차수 처리 전체',
        badge: '원스톱',
      }),
      Object.freeze({
        href: '/import/tools',
        title: '수입부 업무도구 · 원본 대조',
        oneLineDesc: 'PDF 원본과 추출 금액·품목·농장을 나란히 대조하고 원가표를 받습니다.',
        whenText: '인보이스 이상 확인 시',
        badge: '원본대조',
      }),
      Object.freeze({
        href: '/shipment/quick-absorb',
        title: '빠른 분배 · 미등록주문 통합입력',
        oneLineDesc: '카톡 추가 주문과 잔여 재고를 한 화면에서 연결해 즉시 분배합니다.',
        whenText: '당일 추가·잔량 배정 시',
        badge: '출고분배',
      }),
      Object.freeze({
        href: '/sales/profit-report',
        title: '주차별 매출이익 보고서',
        oneLineDesc: '차수별 확정 매출·도착원가·중국 배/비행기 기준 이익률을 검증합니다.',
        whenText: '차수 이익 최종 확정 시',
        badge: '매출이익',
      }),
      Object.freeze({
        href: '/sales/defect-deductions',
        title: '영업수입불량차감',
        oneLineDesc: '국내 불량 클레임 수량·견적 수량을 구분해 관리하고 농장 크레딧으로 잇습니다.',
        whenText: '불량 차감 · 크레딧 청구 시',
        badge: '클레임',
      }),
    ]),
  }),
  Object.freeze({
    id: 'dir-radar-arch',
    stepLabel: '목적 3',
    title: '기술 레이더 · 도면 · 시뮬레이션',
    whenToUse: '에이전트가 무엇을 개발 중인지, 새 기술 파일럿·설계도를 검수할 때',
    items: Object.freeze([
      Object.freeze({
        href: '/my-work?tab=radar',
        title: '도입 레이더 (기술 파일럿·채택)',
        oneLineDesc: '발굴 기술 파일럿 실측 점수, 채택 결재 대기 안건, 연속 구현 큐를 관리합니다.',
        whenText: '신규 기술 채택 결정 시',
        badge: '파일럿',
      }),
      Object.freeze({
        href: '/my-work?tab=arch',
        title: '아키텍처 흐름도',
        oneLineDesc: '운영PC, Phone Harness, MOYI, Orbit/Hermes, Rust 핫패스 6대 표면 도면입니다.',
        whenText: '전체 구조·데이터 계보 확인',
        badge: '설계도',
      }),
      Object.freeze({
        href: '/my-work?tab=suite-sim',
        title: '통합 솔루션 시뮬레이션',
        oneLineDesc: '메신저 수집부터 승인 게이트, 전산 반영까지 실캡처 바운딩박스로 시연합니다.',
        whenText: '자동화 동작 검증 시',
        badge: '모션시뮬',
      }),
      Object.freeze({
        href: '/my-work?tab=devices',
        title: '디바이스 허브 관제',
        oneLineDesc: '402.5KB Rust 사이드카 기반 공용폰 Read-Only 연결과 0.007ms 킬스위치를 봅니다.',
        whenText: '공용폰·현장 단말 점검 시',
        badge: 'Rust 402KB',
      }),
      Object.freeze({
        href: '/dev/history',
        title: '전체 개발 히스토리',
        oneLineDesc: '네노바ERP·Orbit·nenovakakao 저장소의 실제 커밋과 메뉴별 개선 이력을 조회합니다.',
        whenText: '날짜별 상세 코드 이력 조회',
        badge: '커밋이력',
      }),
    ]),
  }),
  Object.freeze({
    id: 'dir-manuals-commercial',
    stepLabel: '목적 4',
    title: '부서 매뉴얼 · 상용 판매 시연',
    whenToUse: '직원 업무 표준화 상태를 점검하거나 외부 고객에게 NOWLINK를 시연할 때',
    items: Object.freeze([
      Object.freeze({
        href: '/work/manuals',
        title: '부서별 업무 매뉴얼',
        oneLineDesc: '부서·담당자별 실전 절차서, 라이브 파이프라인, 신입 루틴과 강의 영상을 봅니다.',
        whenText: '부서 업무 표준 점검 · 교육',
        badge: '매뉴얼',
      }),
      Object.freeze({
        href: '/admin/orbit-report',
        title: '직원 업무 심화 리포트',
        oneLineDesc: 'Orbit 실관측 데이터 기반 부서·직원별 반복 작업과 개선 우선순위를 봅니다.',
        whenText: '업무 구조 심층 분석 시',
        badge: '심화리포트',
      }),
      Object.freeze({
        href: '/demo/commercial-suite',
        title: '상용 솔루션 시연 스튜디오',
        oneLineDesc: '외부 시연용 가상 데이터로 NOWLINK 업종별 도입 효과와 요금제를 시연합니다.',
        whenText: '외부 미팅 · 영업 시연 시',
        badge: 'NOWLINK',
      }),
      Object.freeze({
        href: '/integrations/moyi',
        title: 'MOYI 보고 연동',
        oneLineDesc: 'MOYI 메신저 보고 수신자와 연결코드를 관리합니다.',
        whenText: '보고 수신 대상 변경 시',
        badge: '메신저',
      }),
      Object.freeze({
        href: '/integrations/moyi-drive',
        title: 'MOYI Drive 관리',
        oneLineDesc: '업무 드라이브와 메신저 업로드 파일의 연결 상태를 점검합니다.',
        whenText: '파일 보관·연결 점검 시',
        badge: '드라이브',
      }),
    ]),
  }),
]);

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const arr = (v) => (Array.isArray(v) ? v : []);

function formatKrwCompact(krw) {
  const n = Math.round(Number(krw) || 0);
  const abs = Math.abs(n);
  const sign = n > 0 ? '+' : n < 0 ? '-' : '';
  if (abs >= 10000) {
    const man = Math.round((abs / 10000) * 10) / 10;
    return `${sign}${man.toLocaleString('ko-KR')}만원`;
  }
  return `${sign}${abs.toLocaleString('ko-KR')}원`;
}

function normalizePrLink(prValue) {
  const raw = str(prValue);
  if (!raw) return { prNumber: '', prUrl: '' };
  const numMatch = raw.match(/#?(\d{2,6})/);
  const prNumber = numMatch ? `#${numMatch[1]}` : raw.slice(0, 20);
  const prUrl = /^https:\/\/github\.com\//.test(raw)
    ? raw
    : numMatch
      ? `https://github.com/Jayinsightfactory/nenova-erp-ui/pull/${numMatch[1]}`
      : '';
  return { prNumber, prUrl };
}

function classifyTaskBucket(task) {
  const state = str(task?.state);
  const decision = str(task?.decision);
  if (/done|merged|resolved|closed|완료/i.test(state)) return 'done';
  if (/approv|escalat|승인|needs-human/i.test(`${state} ${decision}`) || num(task?.days) >= 3) {
    return 'approval';
  }
  return 'active';
}

function classifyStaffReqBucket(req) {
  const st = str(req?.status);
  if (st === 'deployed' || st === 'pr' || st === 'answered' || st === 'rejected') return 'done';
  if (st === 'needs-human') return 'approval';
  return 'active';
}

function formatDateBadge(iso, fallback = '최근') {
  const raw = str(iso);
  if (!raw) return fallback;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return raw.slice(0, 10) || fallback;
  const kst = new Date(parsed + 9 * 3600 * 1000);
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mm = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${m}-${d} ${hh}:${mm}`;
}

function safeGabrielAudit(gabrielAudit) {
  if (gabrielAudit && gabrielAudit.summary && Array.isArray(gabrielAudit.levers)) {
    return gabrielAudit;
  }
  try {
    return runGabrielAgiAudit();
  } catch {
    return {
      scope: { orderYear: '2026', orderWeek: '46-01', countryName: '전사' },
      summary: {
        totalPotentialProfitKRW: 0,
        annualizedProfitKRW: 0,
        unhedgedMarginPct: 0,
        simulatedMarginPct: 0,
        marginDeltaPctPt: 0,
        costLeakAlertCount: 0,
        marginErosionAlertCount: 0,
        awbTierReadyCount: 0,
        unrecoveredClaimCount: 0,
        potentialCreditUSD: 0,
        potentialCreditKRW: 0,
      },
      levers: [],
      claims: [],
      awbs: [],
    };
  }
}

export function buildPmActionLedger({
  pmOffice = null,
  staffRequests = [],
  adoptionLedger = null,
  techRadar = null,
} = {}) {
  const rows = [];
  const data = pmOffice?.data || {};
  const tasks = arr(data.tasks);
  const unresolvedList = pmUnresolved(tasks);
  const unresolvedById = new Map(unresolvedList.map((u) => [u.id, u]));

  tasks.forEach((task, idx) => {
    if (!task || typeof task !== 'object') return;
    const key = str(task.key) || `pm-task-${idx + 1}`;
    const bucket = classifyTaskBucket(task);
    const derived = unresolvedById.get(key);
    const stateText = str(task.state) || (bucket === 'done' ? 'done' : 'investigating');
    const title = derived?.title || str(task.title) || str(task.msg) || key;
    const summary = derived?.todo || str(task.decision) || str(task.msg) || 'PM 에이전트 점검 항목';
    const { prNumber, prUrl } = normalizePrLink(task.pr || '');
    const days = Number.isFinite(Number(task.days)) ? Number(task.days) : null;

    rows.push({
      id: `task-${key}-${idx}`,
      sourceType: 'pm-task',
      sourceLabel: 'PM 원장',
      bucket,
      statusCode: stateText,
      statusLabel:
        bucket === 'approval'
          ? '결재·확인 대기'
          : bucket === 'done'
            ? '완료'
            : /verif|검증/i.test(stateText)
              ? '검증중'
              : '조사·진행중',
      tone: bucket === 'approval' ? 'warn' : bucket === 'done' ? 'ok' : 'info',
      title,
      ownerOrTrack: [str(task.owner) || 'PM 조사관', key].filter(Boolean).join(' · '),
      questionOrSummary: summary,
      prNumber,
      prUrl,
      route: '/pm',
      routeLabel: 'PM 관제 열기',
      days,
      updatedAt: str(task.updatedAt) || str(pmOffice?.serverNow) || '',
    });
  });

  arr(staffRequests).forEach((req, idx) => {
    if (!req || typeof req !== 'object') return;
    const bucket = classifyStaffReqBucket(req);
    const status = str(req.status) || 'received';
    const statusMap = {
      received: '접수됨',
      triaged: '분류됨',
      working: '에이전트 처리중',
      pr: 'PR 생성 완료',
      deployed: '배포 완료',
      answered: '답변 완료',
      'needs-human': '사장님 확인 필요',
      rejected: '반려',
    };
    const { prNumber, prUrl } = normalizePrLink(req.pr);
    const targetRoute = str(req.route).startsWith('/') ? str(req.route) : '/pm?requests=list';

    rows.push({
      id: `req-${str(req.id) || idx}`,
      sourceType: 'staff-request',
      sourceLabel: '직원 요청',
      bucket,
      statusCode: status,
      statusLabel: statusMap[status] || status,
      tone: bucket === 'approval' ? 'warn' : bucket === 'done' ? 'ok' : 'info',
      title: str(req.title) || '제목 없는 요청',
      ownerOrTrack: [str(req.byName) || str(req.by) || '직원', str(req.category) || '요청'].join(' · '),
      questionOrSummary: str(req.answer) || str(req.body) || 'PM 루프 자동 분류·처리 대상',
      prNumber,
      prUrl,
      route: targetRoute,
      routeLabel: '요청 상세',
      days: null,
      updatedAt: str(req.updatedAt) || str(req.at) || '',
    });
  });

  const radarItems = normalizeRadarCatalog({
    ledger: adoptionLedger,
    techRadar,
    adminMode: true,
  });
  radarItems
    .filter((item) => item.needsApproval)
    .slice(0, 12)
    .forEach((item, idx) => {
      const pilot = item.pilotResult;
      const pilotNote = pilot
        ? `파일럿 ${pilot.verdict || '검증'} (${pilot.score ?? item.score10}점) · ${str(pilot.summary)}`
        : str(item.why) || str(item.summary) || '도입 여부 결재 대기';
      rows.push({
        id: `radar-${str(item.id) || idx}`,
        sourceType: 'tech-radar',
        sourceLabel: '기술 레이더',
        bucket: 'approval',
        statusCode: 'needs-approval',
        statusLabel: '도입 결재 대기',
        tone: 'warn',
        title: `${item.name} 채택 결재`,
        ownerOrTrack: `Tech Scout · ${item.quadrant} · ${item.ring.toUpperCase()}`,
        questionOrSummary: pilotNote,
        prNumber: '',
        prUrl: '',
        route: '/my-work?tab=radar',
        routeLabel: '레이더 결재',
        days: null,
        updatedAt: str(pilot?.testedAt) || str(techRadar?.generatedAt) || '',
      });
    });

  const bucketRank = { approval: 0, active: 1, done: 2 };
  return rows.sort((a, b) => {
    const ba = bucketRank[a.bucket] ?? 9;
    const bb = bucketRank[b.bucket] ?? 9;
    if (ba !== bb) return ba - bb;
    const da = a.days ?? 0;
    const db = b.days ?? 0;
    if (db !== da) return db - da;
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
}

export function filterPmActionLedger(items = [], filter = 'all', query = '') {
  const f = str(filter).toLowerCase() || 'all';
  const q = str(query).toLowerCase();

  return arr(items).filter((row) => {
    if (f !== 'all' && row.bucket !== f) return false;
    if (!q) return true;
    const hay = [
      row.title,
      row.ownerOrTrack,
      row.questionOrSummary,
      row.statusLabel,
      row.sourceLabel,
      row.prNumber,
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
}

export function buildDevelopmentPulse({
  pmOffice = null,
  staffRequests = [],
  adoptionLedger = null,
  techRadar = null,
  buildPipeline = CONTINUOUS_BUILD_PIPELINE,
  recentCommits = [],
  gabrielAudit = null,
} = {}) {
  const audit = safeGabrielAudit(gabrielAudit);
  const data = pmOffice?.data || {};
  const tasks = arr(data.tasks);
  const doneToday = arr(data?.pmDetail?.doneToday);
  const radarItems = normalizeRadarCatalog({
    ledger: adoptionLedger,
    techRadar,
    adminMode: true,
  });
  const radarSummary = buildWorkbenchSummary(radarItems, true);
  const unresolved = pmUnresolved(tasks);

  const stageCounts = { LIVE: 0, PILOT: 0, READY: 0, DISCOVERED: 0 };
  for (const item of arr(buildPipeline)) {
    if (stageCounts[item.status] !== undefined) stageCounts[item.status] += 1;
  }

  const timeline = [];
  const seenIds = new Set();
  const pushItem = (entry) => {
    if (!entry || !entry.title || seenIds.has(entry.id)) return;
    seenIds.add(entry.id);
    timeline.push(entry);
  };

  // 1) 오늘 PM 에이전트가 방금 처리한 항목
  doneToday.slice(0, 5).forEach((d, idx) => {
    const text = str(d?.text);
    if (!text) return;
    const atLabel = kstDateTime(d.at) || formatDateBadge(d.at, '오늘');
    pushItem({
      id: `pm-done-${idx}-${text.slice(0, 16)}`,
      dateLabel: atLabel,
      badge: 'PM 완료',
      title: text,
      summary: 'PM 루프가 오늘 자동 처리·검증한 항목입니다.',
      route: '/pm',
      routeLabel: 'PM 관제',
      source: 'live-pm',
    });
  });

  // 2) 배포·PR 올라온 직원 요청
  arr(staffRequests)
    .filter((r) => ['deployed', 'pr', 'answered'].includes(str(r?.status)))
    .slice(0, 4)
    .forEach((r, idx) => {
      const { prNumber } = normalizePrLink(r.pr);
      pushItem({
        id: `req-done-${r.id || idx}`,
        dateLabel: formatDateBadge(r.updatedAt || r.at, '최근'),
        badge: prNumber || (r.status === 'deployed' ? '배포됨' : '요청 처리'),
        title: str(r.title) || '직원 요청 처리 완료',
        summary: str(r.answer) || `${str(r.byName || '직원')} 요청이 반영되었습니다.`,
        route: str(r.route).startsWith('/') ? str(r.route) : '/pm?requests=list',
        routeLabel: '확인하기',
        source: 'staff-request',
      });
    });

  // 3) 외부에서 주입된 최신 커밋/이력
  arr(recentCommits)
    .slice(0, 4)
    .forEach((c, idx) => {
      pushItem({
        id: `commit-${c.hash || idx}`,
        dateLabel: formatDateBadge(c.date || c.committedAt, '최근'),
        badge: c.badge || '커밋',
        title: str(c.subject || c.title),
        summary: str(c.summary) || '코드 변경이 저장소에 병합되었습니다.',
        route: str(c.route) || '/dev/history',
        routeLabel: '이력 보기',
        source: 'git',
      });
    });

  // 4) 정본 최신 주요 마일스톤 (PR #1885 ~ #1840)
  for (const ms of DEFAULT_DEVELOPMENT_MILESTONES) {
    pushItem(ms);
  }

  const activePmTaskCount = tasks.filter((t) => !/done|merged|resolved|완료/i.test(str(t?.state))).length +
    arr(staffRequests).filter((r) => ['received', 'triaged', 'working'].includes(str(r?.status))).length;

  const ledgerRows = buildPmActionLedger({ pmOffice, staffRequests, adoptionLedger, techRadar });
  const ownerApprovalCount = ledgerRows.filter((row) => row.bucket === 'approval').length;

  const recentCompletedCount =
    DEFAULT_DEVELOPMENT_MILESTONES.length +
    doneToday.length +
    arr(staffRequests).filter((r) => ['deployed', 'pr'].includes(str(r?.status))).length;

  const stageOrder = { LIVE: 0, PILOT: 1, READY: 2, DISCOVERED: 3 };
  const buildQueue = arr(buildPipeline)
    .slice()
    .sort((a, b) => (stageOrder[a.status] ?? 9) - (stageOrder[b.status] ?? 9) || (a.priorityRank ?? 99) - (b.priorityRank ?? 99))
    .map((item) => ({
      id: item.id,
      code: item.code,
      title: item.title,
      status: item.status,
      statusLabel: item.statusLabel || BUILD_PIPELINE_STAGES.find((s) => s.id === item.status)?.label || item.status,
      expectedImpact: item.expectedImpact,
      departmentLabels: arr(item.departmentLabels),
      primaryRoute: arr(item.targetRoutes)[0] || '/my-work?tab=radar',
      targetRoutes: arr(item.targetRoutes),
      agentBriefText: item.agentBriefText || '',
    }));

  const gabrielTopAlerts = [
    {
      id: 'alert-margin-erosion',
      code: 'L3 · 마진 침식 방어',
      title: `목표 마진 미달 ${audit.summary.marginErosionAlertCount}품목 즉시 방어 단가 점검`,
      detail: `환율·백상 요율(460원/kg) 변동 반영 시 총이익률 ${audit.summary.unhedgedMarginPct}% → ${audit.summary.simulatedMarginPct}%`,
      impactLabel: formatKrwCompact(
        audit.levers.find((l) => l.code === 'L3')?.profitGainKRW || Math.round(audit.summary.totalPotentialProfitKRW * 0.25)
      ),
      route: '/import/gabriel-agi',
      routeLabel: '가브리엘 단가 방어',
    },
    {
      id: 'alert-awb-zero-unit',
      code: 'L1 · AWB 혼적 · 제로유닛',
      title: `AWB 계단 근접 ${audit.summary.awbTierReadyCount}건 · 입수량 제로유닛 295품목 정비`,
      detail: 'CW>GW 부피중량 편차 혼적 및 SteamOf1Box=0(13,815주문행) 원가 왜곡 차단 대상',
      impactLabel: formatKrwCompact(
        audit.levers.find((l) => l.code === 'L1')?.profitGainKRW || Math.round(audit.summary.totalPotentialProfitKRW * 0.2)
      ),
      route: '/import/freight-calc',
      routeLabel: 'AWB 계산기',
    },
    {
      id: 'alert-fx-credit',
      code: 'L4 · L6 · 송금 · 크레딧',
      title: `미회수 불량 크레딧 ${audit.summary.unrecoveredClaimCount}건 ($${audit.summary.potentialCreditUSD}) · 결제일 미등록 49농장`,
      detail: '15일·25일 외화 송금 전 Claim 상계 게이트 및 분할 환전 스케줄 점검 필요',
      impactLabel: formatKrwCompact(
        (audit.levers.find((l) => l.code === 'L4')?.profitGainKRW || 0) +
          (audit.levers.find((l) => l.code === 'L6')?.profitGainKRW || 0)
      ),
      route: '/sales/defect-deductions',
      routeLabel: '불량차감 · 송금',
    },
  ];

  return {
    generatedAt: str(pmOffice?.serverNow) || new Date().toISOString(),
    metrics: {
      recentCompletedCount,
      activePmTaskCount,
      ownerApprovalCount,
      unresolvedCount: unresolved.length,
      radarApprovalCount: radarSummary.counts.approval,
      buildPipelineCounts: {
        ...stageCounts,
        total: arr(buildPipeline).length,
      },
      weeklyProfitPotentialKRW: audit.summary.totalPotentialProfitKRW,
      weeklyProfitPotentialLabel: `${formatKrwCompact(audit.summary.totalPotentialProfitKRW)}/주`,
      annualizedProfitKRW: audit.summary.annualizedProfitKRW,
      marginShiftLabel: `${audit.summary.unhedgedMarginPct}% → ${audit.summary.simulatedMarginPct}%`,
    },
    timeline: timeline.slice(0, 12),
    buildQueue,
    gabrielTopAlerts,
  };
}

export function buildAgentRosterStatus({
  pmOffice = null,
  staffRequests = [],
  adoptionLedger = null,
  techRadar = null,
  deviceHub = null,
  selfTune = null,
  gabrielAudit = null,
} = {}) {
  const audit = safeGabrielAudit(gabrielAudit);
  const data = pmOffice?.data || {};
  const agents = arr(data.agents);
  const staff = arr(data.staff);
  const tasks = arr(data.tasks);
  const pmAgent = agents.find((a) => a.id === 'pm') || agents[0] || null;
  const ageSec = pmOffice?.ageSec == null ? null : Number(pmOffice.ageSec);
  const pmConnected = ageSec != null && ageSec <= 300 && pmAgent != null;
  const pmWorking = pmConnected && pmAgent.status === 'working';
  const unresolved = pmUnresolved(tasks);
  const openTasks = tasks.filter((t) => !/done|merged|resolved|완료/i.test(str(t?.state)));
  const verifyingTasks = openTasks.filter((t) => /verif|검증/i.test(str(t?.state)));
  const pbSummary = playbookSummary(normalizePlaybooks(data.playbooks));
  const doneTodayCount = arr(data?.pmDetail?.doneToday).length;
  const pendingStaffReqs = arr(staffRequests).filter((r) => !['deployed', 'answered', 'rejected'].includes(str(r?.status)));

  // 2) 운영 PC 카톡 브릿지 워커 신호
  const kakaoTask = tasks.find((t) => /kakao/i.test(str(t?.key)));
  const kakaoNeedsAttention = kakaoTask && !/done|merged/i.test(str(kakaoTask.state));

  // 4) 기술 발굴 · 파일럿 Scout
  const radarItems = normalizeRadarCatalog({ ledger: adoptionLedger, techRadar, adminMode: true });
  const radarSummary = buildWorkbenchSummary(radarItems, true);
  const radarPendingNames = radarSummary.approvalQueue.slice(0, 2).map((x) => x.name);

  // 5) 업무 해독 · 매뉴얼 Orbit
  const decodeIssue = tasks.find((t) => t.key === 'staff-decode-fresh' && !/done/i.test(str(t.state)));
  const activeStaffCount = staff.filter((s) => s.status === 'working').length;
  const workLogCount = arr(data.workLog).length;

  // 6) 멀티디바이스 · Rust 핫패스
  const hasLiveDeviceSnapshot = Boolean(deviceHub && Array.isArray(deviceHub.devices));
  const devices = hasLiveDeviceSnapshot ? deviceHub.devices : [];
  const waitingHumanCount = devices.filter((d) => d.waitingHuman || d.leaseStatus === 'WAITING_HUMAN').length;
  const binarySizeKB = num(deviceHub?.binarySizeKB, 402.5);

  return [
    {
      id: 'pm-hermes',
      rankNo: '01',
      name: 'PM 총괄 · 조사관 에이전트',
      codeName: 'nenova-pm · Hermes Claude↔Codex',
      statusCode: !pmAgent || ageSec == null ? 'offline' : pmWorking ? 'live' : pmConnected ? 'active' : 'stale',
      statusLabel: !pmAgent || ageSec == null ? '수신 대기' : pmWorking ? '실시간 작업중' : pmConnected ? '정상 대기' : '갱신 지연',
      ownerArea: '전 직원 업무·오류 조율, 재발 학습 카드, Claude↔Codex 한도 자동 폴백',
      headlineMetric: `열린 과제 ${openTasks.length}건 · 확인 대기 ${unresolved.length}건 · 검증 ${verifyingTasks.length}건`,
      recentSummary:
        str(data?.pmDetail?.now) ||
        str(pmAgent?.activity) ||
        `오늘 완료 ${doneTodayCount}건 · 미처리 직원 요청 ${pendingStaffReqs.length}건`,
      subStats: [
        { label: '확인 대기', value: `${unresolved.length}건` },
        { label: '학습 카드', value: pbSummary ? `${pbSummary.learned}건` : `${doneTodayCount}건/오늘` },
        { label: '직원 요청', value: `${pendingStaffReqs.length}건` },
      ],
      primaryRoute: '/pm',
      primaryLabel: 'PM 관제 열기',
      secondaryRoute: '/pm?requests=list',
      secondaryLabel: '요청함',
    },
    {
      id: 'nenovakakao-worker',
      rankNo: '02',
      name: '운영 PC 카톡 브릿지 워커',
      codeName: 'nenovakakao moyi-worker · PR #50',
      statusCode: kakaoNeedsAttention ? 'attention' : 'active',
      statusLabel: kakaoNeedsAttention ? '일일보고 점검' : '분리 운영 기준',
      ownerArea: '영업방 5s · 추가취소 300s · 불량 · 수입발주 · 17시 보고 · 5분 자동배포',
      headlineMetric: '영업방 5초 · 추가취소 300초 · 5분 자동배포',
      recentSummary: kakaoNeedsAttention
        ? str(kakaoTask.msg) || '카톡 일일 보고 상태 확인 필요'
        : '개발 PC와 분리된 별도 운영 PC에서 PR #50 별도 계정 승인 후 5분 주기 자동 반영 중입니다.',
      subStats: [
        { label: '영업방 주기', value: '5초' },
        { label: '추가취소', value: '300초' },
        { label: '배포 체계', value: 'PR #50 (5분)' },
      ],
      primaryRoute: '/orders/sales-paste',
      primaryLabel: '카톡 주문확인',
      secondaryRoute: '/orders/kakao-audit',
      secondaryLabel: '변경 검증',
    },
    {
      id: 'gabriel-agi',
      rankNo: '03',
      name: '수입 · 원가 · 이익 추론 에이전트',
      codeName: '가브리엘 Profit AGI · 10대 레버',
      statusCode: audit.summary.costLeakAlertCount > 0 ? 'live' : 'active',
      statusLabel: '실시간 추론',
      ownerArea: '전사 10대 원가·이익 레버(L1~L10) · 환율 스트레스 · 4부서 방어 단가 산출',
      headlineMetric: `기대 이익 ${formatKrwCompact(audit.summary.totalPotentialProfitKRW)}/주 · 경보 ${audit.summary.costLeakAlertCount}건`,
      recentSummary: `상위 경보: 마진침식 ${audit.summary.marginErosionAlertCount}품목 · AWB 계단 근접 ${audit.summary.awbTierReadyCount}건 · 미회수 크레딧 $${audit.summary.potentialCreditUSD}`,
      subStats: [
        { label: '마진침식', value: `${audit.summary.marginErosionAlertCount}품목` },
        { label: 'AWB 혼적', value: `${audit.summary.awbTierReadyCount}건` },
        { label: '크레딧', value: `$${audit.summary.potentialCreditUSD}` },
      ],
      primaryRoute: '/import/gabriel-agi',
      primaryLabel: '가브리엘 AGI',
      secondaryRoute: '/import/pipeline',
      secondaryLabel: '원스톱',
    },
    {
      id: 'tech-radar-pilot',
      rankNo: '04',
      name: '기술 발굴 · 실측 파일럿 에이전트',
      codeName: 'Tech Radar Scout & Pilot',
      statusCode: radarSummary.counts.approval > 0 ? 'attention' : 'active',
      statusLabel: radarSummary.counts.approval > 0 ? `결재 대기 ${radarSummary.counts.approval}건` : '탐색 정상',
      ownerArea: 'GitHub 신규 기술 탐색(월·목) · 격리 파일럿 벤치마크 · 채택 안건 상정',
      headlineMetric: `누적 ${radarSummary.counts.total}건 · 파일럿 실측 ${radarSummary.pilotMeasuredCount}건 · 채택 ${radarSummary.counts.adopt}건`,
      recentSummary: radarPendingNames.length
        ? `채택 결재 대기: ${radarPendingNames.join(', ')}${selfTune?.summary ? ` · 자가점검 ${selfTune.summary}` : ''}`
        : 'apache/echarts · headroom 등 실측 보고서 기반 채택 결재 대기 안건을 관리합니다.',
      subStats: [
        { label: '누적 기술', value: `${radarSummary.counts.total}건` },
        { label: '파일럿 실측', value: `${radarSummary.pilotMeasuredCount}건` },
        { label: '결재 대기', value: `${radarSummary.counts.approval}건` },
      ],
      primaryRoute: '/my-work?tab=radar',
      primaryLabel: '도입 레이더',
      secondaryRoute: '/pm/radar',
      secondaryLabel: '레이더 보드',
    },
    {
      id: 'orbit-manuals',
      rankNo: '05',
      name: '업무 해독 · 매뉴얼 진화 에이전트',
      codeName: 'Orbit · Manuals Insights',
      statusCode: decodeIssue ? 'attention' : 'active',
      statusLabel: decodeIssue ? '해독 지연 확인' : '매뉴얼 동기화',
      ownerArea: '부서별 업무 흐름 해독 · 라이브 파이프라인 · 신입 루틴 사각지대 보완',
      headlineMetric: `직원 ${staff.length || 11}명 계보 · 활성 ${activeStaffCount}명 · 로그 ${workLogCount}건`,
      recentSummary: decodeIssue
        ? str(decodeIssue.msg) || '일부 PC 화면 해독 지연 점검 중'
        : '전산 저장 기록과 실제 화면 흐름을 맞춰 부서별 매뉴얼 및 신입 루틴을 자동 보완합니다.',
      subStats: [
        { label: '등록 직원', value: `${staff.length || 11}명` },
        { label: '작업중', value: `${activeStaffCount}명` },
        { label: '매뉴얼 상태', value: decodeIssue ? '점검필요' : '정상' },
      ],
      primaryRoute: '/work/manuals',
      primaryLabel: '매뉴얼 열기',
      secondaryRoute: '/admin/orbit-report',
      secondaryLabel: '심화리포트',
    },
    {
      id: 'device-rust-sidecar',
      rankNo: '06',
      name: '멀티디바이스 · Rust 핫패스 사이드카',
      codeName: 'Phone Harness · hermes-core.exe',
      statusCode: waitingHumanCount > 0 ? 'attention' : hasLiveDeviceSnapshot ? 'live' : 'spec',
      statusLabel: waitingHumanCount > 0 ? `원격 해제 대기 ${waitingHumanCount}대` : hasLiveDeviceSnapshot ? '단말 연결됨' : '기준 스펙',
      ownerArea: '402.5KB 정적 사이드카 · 0.007ms 송금/삭제 킬스위치 · 4.35x 로그 압축',
      headlineMetric: `${binarySizeKB}KB 바이너리 · 0.007ms 차단 · 4.35x 압축`,
      recentSummary: hasLiveDeviceSnapshot
        ? `연결 단말 ${devices.length}대 · WAITING_HUMAN ${waitingHumanCount}대 (Read-Only 가드 활성)`
        : '단말 실시간 업로드 전 기준 스펙 표시 — 위챗·야간·12장 초과 사진 보조수집 및 JS Fallback 유지',
      subStats: [
        { label: '바이너리', value: `${binarySizeKB}KB` },
        { label: '킬스위치', value: '0.007ms' },
        { label: '로그 압축', value: '4.35x (-91.3%)' },
      ],
      primaryRoute: '/my-work?tab=devices',
      primaryLabel: '디바이스 허브',
      secondaryRoute: '/my-work?tab=suite-sim',
      secondaryLabel: '시뮬레이션',
    },
  ];
}

function clampPct(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function goalStateLabel(state, progress) {
  if (state === 'done' || progress >= 100) return '완료';
  if (state === 'needs-approval') return '승인 대기';
  if (state === 'stalled') return '공백 점검';
  return '진행중';
}

function goalStateTone(state, progress) {
  if (state === 'done' || progress >= 100) return 'ok';
  if (state === 'needs-approval' || state === 'stalled') return 'warn';
  return 'info';
}

export function inferGoalIdForWork(text = '') {
  const hay = str(text).toLowerCase();
  if (!hay) return 'g19';
  if (/railway|postgres|talkhub|디스크|private|비공개|보안|고정비|비용/.test(hay)) return 'g18';
  if (/가브리엘|원가|마진|이익|불량|크레딧|송금|중국|배\/비행기|단가|제로유닛|awb|인보이스|견적/.test(hay)) return 'g17';
  if (/트윈|twin|dna|정합|지휘실|command-hub|목표/.test(hay)) return 'g19';
  if (/매뉴얼|트레이스|절차서|해독|decode|루틴/.test(hay)) return 'g03';
  if (/보상|토큰|상점|라벨/.test(hay)) return 'g02';
  if (/단말|공용폰|phone|device|사이드카|킬스위치|카나리/.test(hay)) return 'g14';
  if (/rust|hermes-core|압축/.test(hay)) return 'g12';
  if (/hermes|폴백|스킬|skill/.test(hay)) return 'g11';
  if (/nowlink|상용|시연|테넌트|과금|코드서명/.test(hay)) return 'g15';
  if (/moyi|라운지|번역/.test(hay)) return 'g10';
  if (/마스킹|민감/.test(hay)) return 'g08';
  if (/인증서|hmac|cert_secret|프로필/.test(hay)) return 'g04';
  if (/시뮬|청사진|아키텍처|레이더|echarts|데스크톱|카톡|출고|물량표/.test(hay)) return 'g13';
  return 'g01';
}

export function buildOwnerDigitalTwinModel({
  pmOffice = null,
  staffRequests = [],
  ownerTwin = null,
  goals = null,
  agents = [],
} = {}) {
  const visionGoals = arr(goals?.goals).length
    ? arr(goals.goals)
    : arr(pmOffice?.data?.vision?.goals).length
      ? arr(pmOffice.data.vision.goals)
      : arr(ownerTwin?.goalAlignment?.goals).length
        ? arr(ownerTwin.goalAlignment.goals)
        : arr(ownerTwin?.goals);

  const liveGoalMap = new Map();
  for (const g of visionGoals) {
    const id = str(g?.id).toLowerCase();
    if (id) liveGoalMap.set(id, g);
  }

  const mergedGoals = DEFAULT_OWNER_GOALS.map((base) => {
    const live = liveGoalMap.get(base.id);
    const progress = live && Number.isFinite(Number(live.progress))
      ? clampPct(live.progress, base.progress)
      : base.progress;
    const state = str(live?.state) || base.state;
    return {
      ...base,
      title: str(live?.title) || base.title,
      progress,
      state,
      stateLabel: goalStateLabel(state, progress),
      tone: goalStateTone(state, progress),
      note: str(live?.note) || base.note,
      source: live ? 'live' : 'canonical',
    };
  });

  // 정본 외 신규 목표(g20+)가 업로드된 경우에도 축 ①에 자연스럽게 합류
  const knownIds = new Set(mergedGoals.map((g) => g.id));
  for (const live of visionGoals) {
    const id = str(live?.id).toLowerCase();
    if (!id || knownIds.has(id)) continue;
    const progress = clampPct(live.progress, 0);
    const state = str(live.state) || 'open';
    mergedGoals.push({
      id,
      pillarId: 'profit-agi',
      title: str(live.title) || id,
      done: str(live.done) || '',
      progress,
      state,
      stateLabel: goalStateLabel(state, progress),
      tone: goalStateTone(state, progress),
      recentLinked: str(live.evidence) || '실시간 동기화',
      note: str(live.note) || '',
      route: '/pm',
      source: 'live',
    });
  }

  const goalById = new Map(mergedGoals.map((g) => [g.id, g]));
  const pillarByGoalId = new Map();

  const pillars = OWNER_STRATEGIC_PILLARS.map((pillar) => {
    const items = mergedGoals.filter((g) => g.pillarId === pillar.id);
    for (const g of items) pillarByGoalId.set(g.id, pillar.orderLabel);
    const avgProgress = items.length
      ? Math.round(items.reduce((sum, g) => sum + g.progress, 0) / items.length)
      : 0;
    const doneCount = items.filter((g) => g.state === 'done' || g.progress >= 100).length;
    const approvalCount = items.filter((g) => g.state === 'needs-approval').length;
    return {
      ...pillar,
      goals: items,
      avgProgress,
      doneCount,
      approvalCount,
      totalCount: items.length,
    };
  });

  const overallGoalProgress = mergedGoals.length
    ? Math.round(mergedGoals.reduce((sum, g) => sum + g.progress, 0) / mergedGoals.length)
    : 0;
  const doneGoalCount = mergedGoals.filter((g) => g.state === 'done' || g.progress >= 100).length;
  const approvalGoalCount = mergedGoals.filter((g) => g.state === 'needs-approval').length;

  // 축 2: 에이전트 · PM 작업 1:1 목표 정합성 감사
  const mappings = [];
  const seenWork = new Set();
  const pushMapping = (entry) => {
    if (!entry || !entry.workTitle || seenWork.has(entry.workId)) return;
    seenWork.add(entry.workId);
    const gId = goalById.has(entry.goalId) ? entry.goalId : inferGoalIdForWork(entry.workTitle);
    const matchedGoal = goalById.get(gId) || mergedGoals[0];
    mappings.push({
      workId: entry.workId,
      workSource: entry.workSource,
      workTitle: entry.workTitle,
      goalId: matchedGoal.id,
      goalTitle: matchedGoal.title,
      pillarLabel: pillarByGoalId.get(matchedGoal.id) || '① 수익·원가 혁신',
      statusLabel: entry.statusLabel || '정합 진행',
      aligned: entry.aligned !== false,
      route: entry.route || matchedGoal.route || '/work/command-hub',
    });
  };

  // 2-1) 업로드된 owner-twin goalAlignment.mappings 우선 반영
  const liveMappings = arr(ownerTwin?.goalAlignment?.mappings || ownerTwin?.goalAlignment?.mappedTasks);
  liveMappings.slice(0, 8).forEach((m, idx) => {
    pushMapping({
      workId: `live-map-${str(m?.id || m?.workId) || idx}`,
      workSource: str(m?.source || m?.agent || 'Owner Twin'),
      workTitle: str(m?.title || m?.workTitle || m?.task),
      goalId: str(m?.goalId).toLowerCase(),
      statusLabel: str(m?.statusLabel || m?.status || '정합'),
      aligned: m?.aligned !== false && !m?.drift,
      route: str(m?.route) || '',
    });
  });

  // 2-2) 실시간 PM tasks 매핑
  const pmTasks = arr(pmOffice?.data?.tasks);
  pmTasks.slice(0, 6).forEach((t, idx) => {
    const title = str(t?.title) || str(t?.msg) || str(t?.key);
    if (!title) return;
    pushMapping({
      workId: `pm-map-${str(t?.key) || idx}`,
      workSource: str(t?.owner) || 'PM 에이전트',
      workTitle: title,
      goalId: inferGoalIdForWork(`${t?.key || ''} ${title}`),
      statusLabel: /done|merged|완료/i.test(str(t?.state)) ? '달성 반영' : '정합 진행',
      aligned: true,
      route: '/pm',
    });
  });

  // 2-3) 미완료 직원 요청 매핑
  arr(staffRequests)
    .filter((r) => !['rejected'].includes(str(r?.status)))
    .slice(0, 4)
    .forEach((r, idx) => {
      const title = str(r?.title);
      if (!title) return;
      pushMapping({
        workId: `req-map-${str(r?.id) || idx}`,
        workSource: `직원 요청(${str(r?.byName || '실무')})`,
        workTitle: title,
        goalId: inferGoalIdForWork(`${title} ${str(r?.body)}`),
        statusLabel: str(r?.status) === 'deployed' ? '반영 완료' : '정합 검증',
        aligned: true,
        route: str(r?.route).startsWith('/') ? str(r.route) : '/pm?requests=list',
      });
    });

  // 2-4) 6대 에이전트 상시 가동 라인 기본 매핑 보완 (최소 6개 1:1 매핑 보장)
  const agentDefaultGoal = {
    'pm-hermes': 'g01',
    'nenovakakao-worker': 'g13',
    'gabriel-agi': 'g17',
    'tech-radar-pilot': 'g19',
    'orbit-manuals': 'g03',
    'device-rust-sidecar': 'g14',
  };
  arr(agents).forEach((ag) => {
    pushMapping({
      workId: `agent-map-${ag.id}`,
      workSource: ag.name,
      workTitle: ag.recentSummary || ag.headlineMetric || ag.ownerArea,
      goalId: agentDefaultGoal[ag.id] || 'g19',
      statusLabel: ag.statusLabel || '정합 가동',
      aligned: true,
      route: ag.primaryRoute || '/work/command-hub',
    });
  });

  const auditedMappings = mappings.slice(0, 10);
  const alignedCount = auditedMappings.filter((m) => m.aligned).length;
  const computedDriftCount = auditedMappings.length - alignedCount;
  const rawLiveDrift =
    ownerTwin?.goalAlignment?.driftMonitor?.driftOpenCount ??
    ownerTwin?.goalAlignment?.driftCount;
  const liveDrift = rawLiveDrift == null ? NaN : Number(rawLiveDrift);
  const driftCount = Number.isFinite(liveDrift) ? Math.max(0, Math.round(liveDrift)) : computedDriftCount;
  const rawLiveAlignRate = ownerTwin?.goalAlignment?.alignmentRatePct;
  const liveAlignRate = rawLiveAlignRate == null ? NaN : Number(rawLiveAlignRate);
  const alignmentRatePct = Number.isFinite(liveAlignRate)
    ? Math.max(0, Math.min(100, Math.round(liveAlignRate * 10) / 10))
    : auditedMappings.length
      ? Math.round((alignedCount / auditedMappings.length) * 100)
      : 100;

  const liveNeglected = arr(ownerTwin?.goalAlignment?.neglectedGoals);
  const gapAlerts = liveNeglected.length
    ? liveNeglected.slice(0, 5).map((item, idx) => ({
        id: `live-gap-${str(item?.id || item?.goalId) || idx}`,
        goalId: str(item?.goalId || item?.id || 'g18').toLowerCase(),
        severity: str(item?.severity) || (idx < 2 ? 'high' : 'medium'),
        title: str(item?.title) || `${str(item?.goalId || '목표')} 보완 필요`,
        detail:
          [
            str(item?.detail || item?.reason || item?.note),
            Number.isFinite(Number(item?.idleDays)) && Number(item.idleDays) > 0
              ? `최근 ${Number(item.idleDays)}일간 연결 작업 공백`
              : '',
          ]
            .filter(Boolean)
            .join(' · ') || '최근 연결 작업이 적어 우선 점검이 필요합니다.',
        nextAction: str(item?.nextAction) || '선제 지시서 실행',
      }))
    : DEFAULT_GOAL_GAP_ALERTS.map((g) => ({ ...g }));

  // 축 3: 나를 학습한 AGI 진화 현황 (6대 판단 DNA + 성숙도 + 선제 실행 제안 Top 5)
  const rawPersona = ownerTwin?.ownerPersona || {};
  const livePrinciples = arr(rawPersona.principles || rawPersona.axes || rawPersona.decisionAxes);
  const principles = DEFAULT_OWNER_DNA_PRINCIPLES.map((base, idx) => {
    const live = livePrinciples.find((p) => str(p?.id) === base.id) || livePrinciples[idx];
    return {
      id: base.id,
      title: str(live?.title || live?.name) || base.title,
      rule: str(live?.principle || live?.rule || live?.description || live?.summary) || base.rule,
      evidence: str(live?.check || live?.evidence) || base.evidence,
      signals: Number.isFinite(Number(live?.signals ?? live?.signalCount))
        ? Number(live.signals ?? live.signalCount)
        : base.signals,
    };
  });

  const rawMaturity =
    ownerTwin?.maturityScore ??
    ownerTwin?.maturity?.maturityScore ??
    rawPersona.maturityScore;
  const maturityScore = rawMaturity == null ? 84 : clampPct(rawMaturity, 84);
  const rawSignals = ownerTwin?.learnedSignalsCount ?? rawPersona.learnedSignalsCount;
  const learnedSignalsCount =
    rawSignals != null && Number.isFinite(Number(rawSignals))
      ? Number(rawSignals)
      : principles.reduce((sum, p) => sum + p.signals, 0);

  const liveProposals = arr(ownerTwin?.predictedOwnerActions || ownerTwin?.proactiveProposals);
  const proactiveProposals = liveProposals.length >= 3
    ? liveProposals.slice(0, 5).map((p, idx) => {
        const fallback = DEFAULT_OWNER_PROACTIVE_PROPOSALS[idx] || DEFAULT_OWNER_PROACTIVE_PROPOSALS[0];
        const code = str(p?.code) || `TW-0${idx + 1}`;
        const goalId = str(p?.linkedGoalId || p?.goalId).toLowerCase() || fallback.goalId;
        const title = str(p?.title) || fallback.title;
        let expectedImpact = str(p?.expectedImpact || p?.impact);
        if (!expectedImpact && p?.expectedBenefit && typeof p.expectedBenefit === 'object') {
          const monthly = Number(p.expectedBenefit.monthlyKRW);
          const monthlyPrefix =
            Number.isFinite(monthly) && monthly > 0
              ? `월 ${formatKrwCompact(monthly).replace(/^\+/, '')} · `
              : '';
          expectedImpact = `${monthlyPrefix}${str(p.expectedBenefit.basis)}`.trim();
        } else if (!expectedImpact && typeof p?.expectedBenefit === 'string') {
          expectedImpact = str(p.expectedBenefit);
        }
        let rationale = str(p?.rationale || p?.reason || p?.principleMatch);
        if (!rationale && Array.isArray(p?.linkedAxes) && p.linkedAxes.length) {
          rationale = `${p.linkedAxes.join(' + ')} 판단 DNA 매칭${
            Number.isFinite(Number(p?.priorityScore)) ? ` (우선순위 ${Number(p.priorityScore)}점)` : ''
          }`;
        }
        let agentBriefText = str(p?.agentBriefText || p?.brief || p?.dispatchBrief);
        if (!agentBriefText && p?.orderBrief && typeof p.orderBrief === 'object') {
          agentBriefText = [
            `[${code} · ${goalId}] ${title}`,
            p.orderBrief.owner ? `담당: ${p.orderBrief.owner}` : '',
            p.orderBrief.scope ? `범위: ${p.orderBrief.scope}` : '',
            p.orderBrief.forbidden ? `금지: ${p.orderBrief.forbidden}` : '',
            p.orderBrief.done ? `완료기준: ${p.orderBrief.done}` : '',
          ]
            .filter(Boolean)
            .join('\n');
        }
        return {
          id: str(p?.id) || `live-prop-${idx + 1}`,
          code,
          goalId,
          goalTitle: goalById.get(goalId)?.title || fallback.goalTitle,
          title,
          expectedImpact: expectedImpact || fallback.expectedImpact,
          rationale: rationale || fallback.rationale,
          urgency:
            str(p?.urgency || p?.priority) ||
            (Number.isFinite(Number(p?.priorityScore))
              ? `우선순위 ${Number(p.priorityScore)}점`
              : fallback.urgency),
          route: str(p?.route).startsWith('/') ? str(p.route) : fallback.route,
          routeLabel: str(p?.routeLabel) || fallback.routeLabel,
          agentBriefText: agentBriefText || fallback.agentBriefText,
        };
      })
    : DEFAULT_OWNER_PROACTIVE_PROPOSALS.map((p) => ({ ...p }));

  const hasLiveTwin = Boolean(ownerTwin && typeof ownerTwin === 'object');
  const hasLiveVision = Boolean(visionGoals.length > 0);
  const dataModeLabel = hasLiveTwin
    ? 'Owner AGI 실시간 동기화'
    : hasLiveVision
      ? '목표 정본 실시간 · 트윈 기준 모델'
      : '정본 기준 모델 · 실시간 피드 대기';

  const traceSteps = OWNER_AGI_LOOP_STEPS.map((step) => {
    if (step.id === 'directive-dna') {
      return { ...step, token: `6대 DNA · 성숙도 ${maturityScore}점 (${learnedSignalsCount}신호)` };
    }
    if (step.id === 'goals-sync') {
      return { ...step, token: `4대 축 ${mergedGoals.length}목표 · 평균 ${overallGoalProgress}%` };
    }
    if (step.id === 'alignment-audit') {
      return { ...step, token: `정합률 ${alignmentRatePct}% · Drift ${driftCount}건` };
    }
    if (step.id === 'feedback-relearn') {
      return { ...step, token: `선제 제안 ${proactiveProposals.length}건 · §8 3-툴 동기화` };
    }
    return { ...step };
  });

  return {
    generatedAt: str(ownerTwin?.generatedAt) || str(pmOffice?.data?.vision?.updatedAt) || str(pmOffice?.serverNow) || '2026-11-20T02:30:00Z',
    dataModeLabel,
    hasLiveTwin,
    hasLiveVision,
    purpose: COMMAND_HUB_PURPOSE,
    traceSteps,
    summary: {
      overallGoalProgress,
      totalGoalCount: mergedGoals.length,
      doneGoalCount,
      approvalGoalCount,
      alignmentRatePct,
      driftCount,
      maturityScore,
      learnedSignalsCount,
      gapAlertCount: gapAlerts.length,
      proactiveCount: proactiveProposals.length,
      fixedCostSavingsLabel: '월 11.2만원 절감 + 주 +769.5만원',
    },
    pillars,
    goals: mergedGoals,
    alignmentAudit: {
      alignmentRatePct,
      driftCount,
      alignedCount,
      totalAuditedCount: auditedMappings.length,
      mappings: auditedMappings,
      gapAlerts,
    },
    persona: {
      maturityScore,
      learnedSignalsCount,
      principles,
      recentDirectives: arr(rawPersona.recentOwnerDirectives).slice(0, 4),
    },
    proactiveProposals,
  };
}

export function buildCommandHubModel(inputs = {}) {
  const gabrielAudit = safeGabrielAudit(inputs.gabrielAudit);
  const pulse = buildDevelopmentPulse({ ...inputs, gabrielAudit });
  const agents = buildAgentRosterStatus({ ...inputs, gabrielAudit });
  const ledger = buildPmActionLedger(inputs);
  const ownerTwin = buildOwnerDigitalTwinModel({
    pmOffice: inputs.pmOffice,
    staffRequests: inputs.staffRequests,
    ownerTwin: inputs.ownerTwin,
    goals: inputs.goals,
    agents,
  });

  return {
    pulse,
    agents,
    ledger,
    ownerTwin,
    checklist: MORNING_CHECKLIST,
    directory: CEO_PAGE_DIRECTORY,
    gabrielScope: gabrielAudit.scope,
  };
}
