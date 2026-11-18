// components/pm/ArchFlowChart.js
// 자가발전형 직원 업무 분석 · 자동화 솔루션 아키텍처 흐름도 (/my-work?tab=arch 및 /pm 공용).
// 규칙: __tests__/pmNoHexColor.test.js(#hex 금지) · __tests__/pmUiKit.test.js(UI 키트 사용) · __tests__/workflowReview.test.js(금지어 미사용) 준수.
import { useEffect, useState } from 'react';
import { Badge, Button, SelectCard } from './ui';

const LOOPS = [
  {
    id: 'detail',
    no: '1',
    badge: '자기보강',
    tone: 'accent',
    title: '데이터 디테일 자가발전',
    summary: '빈칸·미확증 구간을 역방향 대조해 매칭 사전과 추출 정밀도를 스스로 끌어올립니다.',
    trigger: '일일 작업 기록·전산 DB 대조에서 확증% 하락 또는 미분류 구간 발견',
    engine: '전산/카톡/파일 근거 대조 → 키워드·거래처·품목 별칭 자동 확장 → 차기 프롬프트 반영',
    outcome: '직원별 워크플로우·소요시간·자동화 후보 해상도 지속 상승',
    beforeSteps: [
      '화면 제목·카톡 문구 누락 시 미확인/기타로 분류',
      '거래처·품목 표기 차이로 전산 기록과 연결 단절',
      '수동 보정 없이는 매일 같은 빈칸 반복',
    ],
    afterSteps: [
      '채택 장부(adoption-ledger)로 일일 확증%·파일% 자동 계측',
      '연결 실패 패턴을 추출해 사전·앵커·프롬프트에 자동 편입',
      '오류 한도/빈 응답 차단 가드로 기존 분석 자산 손실 방지',
    ],
    caseTitle: '실제 사례: 10명 일일 업무분석 자기보강 루프',
    caseDetail: '관찰 근거(화면 해독 · 전산 저장 · 카톡 · 엑셀 필드)를 4중 대조해 매 회차 미확인 지점을 줄이고, 한도·용량 초과 시 안전 예산 분할과 직전 유효본 보존으로 무중단 갱신.',
    tabTarget: 'workflows',
    tabLabel: '업무 흐름 보기',
  },
  {
    id: 'heal',
    no: '2',
    badge: '자가치유',
    tone: 'err',
    title: '실시간 로그 관제 · 자가치유',
    summary: '웹·수집기·API 오류 로그를 즉시 포착해 원인을 수정하고 재검증까지 완료합니다.',
    trigger: 'HTTP 413/500, 수집 스크립트 셀렉터 실패, 데이터 갱신 지연·정체 로그 발생',
    engine: '로그 원인 분석 → 가드/셀렉터/용량 제한 패치 → 즉시 재실행·GREEN 100점 검수 → 홈 요약 전파',
    outcome: '장애 방치 제로화 + 사장님 데스크톱 홈 「PM 라이브 확인」에 미해결 건만 즉시 노출',
    beforeSteps: [
      '수집 실패·업로드 413 오류 발생 시 다음 날까지 공백 방치',
      '오인 클릭이나 빈 조회가 실패로 오인되어 파이프라인 중단',
      '원인 파악과 재실행을 사람이 수동으로 반복 확인',
    ],
    afterSteps: [
      '수집 데몬·API 응답 로그를 상시 확인해 실패 원인 즉시 격리',
      '예: ECOUNT 셀렉터 오인 클릭/빈 행 정상처리 수정 후 775건 즉시 재수집',
      '유효성·회귀 가드 추가 후 데스크톱 「PM 라이브 확인」·오류관제 연동',
    ],
    caseTitle: '실제 사례: 이카운트 3화면 · 스토리보드 413 즉시 복구',
    caseDetail: '스토리보드 30MB 초과(413)에 크기 예산 분할(fitBudget) 적용, ECOUNT 구매현황 행 문자열 오인 클릭에 정확 셀렉터 보정 및 즉시 트리거(.run-once)로 100점 회복.',
    tabTarget: 'proposals',
    tabLabel: '기능 후보 보기',
  },
  {
    id: 'pipeline',
    no: '3',
    badge: '연쇄압축',
    tone: 'ok',
    title: '연속 파이프라인 압축 기획',
    summary: '여러 화면·앱을 순서대로 오가는 긴 작업 연쇄를 감지해 단일 원스톱 흐름으로 묶습니다.',
    trigger: '복수의 직무·화면이 고정 순서로 이어지며 파일 다운로드/복붙이 반복되는 체인 포착',
    engine: '앞 단계 산출물과 뒷 단계 입력 스키마 자동 결합 → 중간 수기 옮겨적기 제거 → 시간 단축 실측 시뮬레이션',
    outcome: '여러 화면을 건너뛰던 수작업을 네노바웹 단일 작업 흐름으로 통합 기획',
    beforeSteps: [
      '1단계: 인보이스(PDF/엑셀) 확인 후 품목·단가 대조',
      '2단계: 입고관리 화면에서 엑셀/수량 업로드',
      '3단계: 도착원가 계산·생성 후 파일 저장',
      '4단계: 카톡방 공유 및 구글 드라이브 폴더 업로드',
    ],
    afterSteps: [
      '1단계 인보이스 확정 데이터가 곧바로 입고·원가 입력으로 직결',
      '중간 파일 다운로드·재업로드·수동 대조 단계 제거',
      '도착원가 확정에 맞춰 카톡·드라이브 공유까지 원클릭 연계 기획',
    ],
    caseTitle: '대표 기획 사례: 수입 인보이스 → 입고 → 도착원가 → 공유 일괄 파이프라인',
    caseDetail: '인보이스 확인 → 입고 업로드 → 도착원가 생성 → 카톡/드라이브 업로드까지 4분절 작업을 하나의 연결된 파이프라인으로 재설계하여 누락·지연을 차단.',
    tabTarget: 'pipeline',
    tabLabel: '전체 파이프라인 보기',
  },
  {
    id: 'roundtrip',
    no: '4',
    badge: '우회제거',
    tone: 'warn',
    title: '왕복 우회동작(A→B→A) 흡수 설계',
    summary: '선행 등록 때문에 다른 화면으로 나갔다 돌아오는 왕복 패턴을 현재 화면에 흡수합니다.',
    trigger: '작업 A 중 미등록 대상 발견 → 화면 B 이동·생성 → 화면 A 복귀 재입력 루프 반복 관측',
    engine: 'B의 선행 조건(레코드 생성/연결)을 A의 입력·저장 트랜잭션에 원자적(Upsert)으로 결합 설계',
    outcome: '화면 이탈 없는 직관 처리(예: 분배 입력만으로 미등록 업체 주문 자동 생성)',
    beforeSteps: [
      '분배 화면(A) 작업 중 업체가 주문 목록에 없음을 발견',
      '주문등록 화면(B)으로 이동해 업체·주문을 수동 등록',
      '다시 분배 화면(A)으로 복귀·새로고침 후 수량 재입력',
    ],
    afterSteps: [
      '분배 화면(A)에서 업체 선택·분배 수량 입력 즉시 검사',
      '해당 주차 주문이 없으면 저장 트랜잭션 안에서 주문 헤더·상세 자동 생성(Upsert)',
      '기존 주문·재고 잠금 가드(dnSpy 기준)는 유지한 채 왕복 동작 완전 제거',
    ],
    caseTitle: '핵심 로직 설계: 분배 입력 → 미등록 업체 주문등록 자동 흡수',
    caseDetail: '출고 분배 시 주문등록 화면을 오가며 업체를 먼저 만들던 우회 루프를, 분배 저장 시점의 조건부 주문 자동생성 + 이력 기록 로직으로 단순화 설계.',
    tabTarget: 'erp',
    tabLabel: '전산 실제 처리 비교',
  },
];

const PIPELINE_NODES = [
  { key: 'collect', label: '1. 현장 관측', sub: 'PC 화면 · 창제목 · 카톡 · 전산DB' },
  { key: 'evolve', label: '2. 4대 자가발전 엔진', sub: '디테일 · 자가치유 · 연쇄압축 · 우회제거' },
  { key: 'design', label: '3. 로직·UX 자동 기획', sub: '시뮬레이션 · 전산 가드 · 안전 이식' },
  { key: 'deploy', label: '4. 웹·앱 반영 & 실측', sub: '네노바웹 · 데스크톱 · 시간 단축 재계측' },
];

export default function ArchFlowChart({
  timesave = null,
  workflows = null,
  office = null,
  onSelectTab = null,
  mineOnly = false,
  compact = false,
}) {
  const [selectedId, setSelectedId] = useState('pipeline');
  const [liveTs, setLiveTs] = useState(timesave);
  const [liveWf, setLiveWf] = useState(workflows);

  useEffect(() => {
    if (timesave) setLiveTs(timesave);
  }, [timesave]);

  useEffect(() => {
    if (workflows) setLiveWf(workflows);
  }, [workflows]);

  useEffect(() => {
    if (mineOnly) return undefined;
    let alive = true;
    if (!timesave) {
      fetch('/api/my-work/feature?name=timesave', { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (alive && j?.success && j.data) setLiveTs(j.data);
        })
        .catch(() => {});
    }
    if (!workflows) {
      fetch('/api/my-work/feature?name=workflows', { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (alive && j?.success && j.data) setLiveWf(j.data);
        })
        .catch(() => {});
    }
    return () => { alive = false; };
  }, [mineOnly, timesave, workflows]);

  const activeLoop = LOOPS.find((item) => item.id === selectedId) || LOOPS[0];
  const peopleCount = Array.isArray(liveWf?.people) ? liveWf.people.length : null;
  const workflowCount = Array.isArray(liveWf?.people)
    ? liveWf.people.reduce((sum, p) => sum + (Array.isArray(p.workflows) ? p.workflows.length : 0), 0)
    : null;
  const totals = liveTs?.totals || null;
  const topFeatures = Array.isArray(liveTs?.features) ? liveTs.features.slice(0, 4) : [];
  const unresolvedCount = Array.isArray(office?.tasks)
    ? office.tasks.filter((t) => /승인|3일|오류|실패|미완료/.test(String(t?.state || t?.title || ''))).length
    : null;

  return (
    <section className={`arch-root ${compact ? 'is-compact' : ''}`} aria-label="자가발전 솔루션 아키텍처 흐름도">
      <header className="arch-head">
        <div>
          <div className="arch-eyebrow">SELF-EVOLVING WORK INTELLIGENCE ARCHITECTURE</div>
          <h2>직원 업무 관측 → 자가발전 · 자가치유 → 네노바웹 자동 반영 아키텍처</h2>
          <p className="arch-lede">
            단순 화면 기록 조회를 넘어, 매일 데이터의 빈칸을 스스로 메우고(①), 실시간 오류 로그를 직접 고치며(②),
            긴 수작업 연쇄(③)와 불필요한 화면 왕복(④)을 찾아 실제 전산·웹 로직으로 재설계하는 순환 구조입니다.
          </p>
        </div>
        <div className="arch-kpis">
          {peopleCount != null && (
            <div className="arch-kpi">
              <span>관찰 인원</span>
              <b>{peopleCount}명</b>
              <small>업무 {workflowCount}건 구조화</small>
            </div>
          )}
          {totals && (
            <div className="arch-kpi">
              <span>주간 활성 / 절감 후보</span>
              <b>{totals.activeHoursPerWeek}h → -{totals.saveHoursPerWeek}h</b>
              <small>주 {totals.assignedHoursPerWeek}h 업무 특정</small>
            </div>
          )}
          {unresolvedCount != null && (
            <div className="arch-kpi">
              <span>PM 관제 연결</span>
              <b>확인 필요 {unresolvedCount}건</b>
              <small>실시간 오류 · 정체 확인</small>
            </div>
          )}
          {!peopleCount && !totals && (
            <div className="arch-kpi">
              <span>순환 엔진</span>
              <b>4대 자가발전 루프</b>
              <small>관측 · 치유 · 압축 · 흡수</small>
            </div>
          )}
        </div>
      </header>

      {/* 전체 아키텍처 SVG/플로우 다이어그램 */}
      <div className="arch-diagram" role="region" aria-label="전체 아키텍처 단계 연결도">
        <div className="arch-nodes">
          {PIPELINE_NODES.map((node, idx) => (
            <div key={node.key} className="arch-node-wrap">
              <div className={`arch-node arch-node-${node.key}`}>
                <div className="arch-node-title">{node.label}</div>
                <div className="arch-node-sub">{node.sub}</div>
              </div>
              {idx < PIPELINE_NODES.length - 1 && (
                <div className="arch-arrow" aria-hidden="true">→</div>
              )}
            </div>
          ))}
        </div>

        {/* 닫힌 피드백 루프 바 */}
        <svg className="arch-feedback-svg" viewBox="0 0 920 46" preserveAspectRatio="none" aria-hidden="true">
          <path
            d="M 830 4 L 830 28 L 90 28 L 90 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="6 5"
          />
          <polygon points="84,12 90,2 96,12" fill="currentColor" />
        </svg>
        <div className="arch-feedback-label">
          닫힌 피드백 루프(Closed Loop): 반영 후 실측 단축 시간(timesave) · 확증% 변화 · 오류 로그를 다음 관측 주기에 즉시 재투입
        </div>
      </div>

      {/* 4대 자가발전 엔진 카드 선택기 */}
      <div className="arch-loops-grid" role="group" aria-label="4대 자가발전 루프 선택">
        {LOOPS.map((loop) => {
          const active = loop.id === activeLoop.id;
          return (
            <SelectCard
              key={loop.id}
              on={active}
              pressed={active}
              className={`arch-loop-card tone-${loop.tone} ${active ? 'is-on' : ''}`}
              onClick={() => setSelectedId(loop.id)}
            >
              <div className="arch-loop-top">
                <span className="arch-loop-no">LOOP {loop.no}</span>
                <Badge className="arch-loop-badge" tone={loop.tone === 'err' ? 'warn' : 'plain'}>{loop.badge}</Badge>
              </div>
              <div className="arch-loop-title">{loop.title}</div>
              <div className="arch-loop-summary">{loop.summary}</div>
            </SelectCard>
          );
        })}
      </div>

      {/* 선택한 루프의 상세 동작 + Before -> After 설계 흐름 */}
      <article className="arch-detail" aria-live="polite">
        <div className="arch-detail-head">
          <div>
            <span className="arch-detail-pill">LOOP {activeLoop.no} · {activeLoop.badge}</span>
            <h3>{activeLoop.caseTitle}</h3>
            <p>{activeLoop.caseDetail}</p>
          </div>
          {!mineOnly && onSelectTab && activeLoop.tabTarget && (
            <Button className="arch-jump-btn" variant="primary" size="sm" onClick={() => onSelectTab(activeLoop.tabTarget)}>
              {activeLoop.tabLabel} ↗
            </Button>
          )}
        </div>

        <div className="arch-spec-row">
          <div className="arch-spec">
            <b>감지 트리거 (Input)</b>
            <span>{activeLoop.trigger}</span>
          </div>
          <div className="arch-spec-arrow" aria-hidden="true">→</div>
          <div className="arch-spec">
            <b>자가발전 판단·설계 엔진</b>
            <span>{activeLoop.engine}</span>
          </div>
          <div className="arch-spec-arrow" aria-hidden="true">→</div>
          <div className="arch-spec">
            <b>시스템 반영 · 기대 결과 (Output)</b>
            <span>{activeLoop.outcome}</span>
          </div>
        </div>

        <div className="arch-compare">
          <div className="arch-col arch-before">
            <div className="arch-col-title">AS-IS · 관측된 기존 수작업 / 오류</div>
            <ol>
              {activeLoop.beforeSteps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>
          <div className="arch-col-mid" aria-hidden="true">⟹</div>
          <div className="arch-col arch-after">
            <div className="arch-col-title">TO-BE · 자가발전 압축 · 흡수 구조</div>
            <ol>
              {activeLoop.afterSteps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>
        </div>

        {topFeatures.length > 0 && (
          <div className="arch-live-features">
            <div className="arch-live-title">
              실측 절감 상위 후보 ({liveTs?.generatedAt ? String(liveTs.generatedAt).slice(0, 10) : '최신'} 기준)
            </div>
            <div className="arch-live-chips">
              {topFeatures.map((feat, idx) => (
                <div key={feat.title + idx} className="arch-live-chip">
                  <b>{feat.title}</b>
                  <span>주 {feat.saveHoursPerWeek}h 절감 후보{feat.menu ? ` · ${feat.menu}` : ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </article>

      <style jsx>{`
        .arch-root {
          --arch-bg: var(--pm-bg, rgb(14, 16, 22));
          --arch-surface: var(--pm-surface, rgb(18, 21, 28));
          --arch-surface-2: var(--pm-surface2, rgb(24, 28, 38));
          --arch-ink: var(--pm-ink, rgb(231, 234, 240));
          --arch-muted: var(--pm-muted, rgb(152, 161, 178));
          --arch-line: var(--pm-line, rgb(44, 51, 64));
          --arch-accent: var(--pm-accent, rgb(88, 166, 255));
          --arch-ok: var(--pm-ok, rgb(63, 185, 80));
          --arch-warn: var(--pm-idle, rgb(227, 179, 65));
          --arch-err: var(--pm-err, rgb(248, 81, 73));
          color: var(--arch-ink);
          padding: 18px 22px 36px;
          max-width: 1440px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .arch-root.is-compact {
          padding: 12px 14px 18px;
          max-width: none;
          background: var(--arch-surface);
          border: 1px solid var(--arch-line);
          border-radius: 10px;
          margin-bottom: 12px;
        }
        .arch-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          flex-wrap: wrap;
          background: var(--arch-surface);
          border: 1px solid var(--arch-line);
          border-radius: 12px;
          padding: 16px 18px;
        }
        .arch-eyebrow {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: var(--arch-accent);
          margin-bottom: 4px;
        }
        .arch-head h2 {
          margin: 0 0 6px;
          font-size: 19px;
          line-height: 1.35;
        }
        .arch-lede {
          margin: 0;
          color: var(--arch-muted);
          font-size: 13px;
          line-height: 1.55;
          max-width: 78ch;
        }
        .arch-kpis {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        .arch-kpi {
          background: var(--arch-surface-2);
          border: 1px solid var(--arch-line);
          border-radius: 10px;
          padding: 8px 12px;
          min-width: 145px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .arch-kpi span {
          font-size: 11px;
          color: var(--arch-muted);
        }
        .arch-kpi b {
          font-size: 15px;
          color: var(--arch-ink);
        }
        .arch-kpi small {
          font-size: 11px;
          color: var(--arch-accent);
        }
        .arch-diagram {
          background: var(--arch-surface);
          border: 1px solid var(--arch-line);
          border-radius: 12px;
          padding: 16px 18px 12px;
        }
        .arch-nodes {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
          align-items: stretch;
        }
        .arch-node-wrap {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }
        .arch-node {
          flex: 1 1 auto;
          min-width: 0;
          background: var(--arch-surface-2);
          border: 1px solid var(--arch-line);
          border-top: 3px solid var(--arch-accent);
          border-radius: 10px;
          padding: 10px 12px;
        }
        .arch-node-evolve { border-top-color: var(--arch-warn); }
        .arch-node-design { border-top-color: var(--arch-ok); }
        .arch-node-deploy { border-top-color: var(--arch-err); }
        .arch-node-title {
          font-weight: 700;
          font-size: 13.5px;
          margin-bottom: 4px;
        }
        .arch-node-sub {
          font-size: 12px;
          color: var(--arch-muted);
          line-height: 1.4;
        }
        .arch-arrow {
          flex: 0 0 auto;
          font-size: 18px;
          font-weight: 700;
          color: var(--arch-accent);
        }
        .arch-feedback-svg {
          width: 100%;
          height: 36px;
          color: var(--arch-accent);
          opacity: 0.85;
          display: block;
        }
        .arch-feedback-label {
          text-align: center;
          font-size: 12px;
          color: var(--arch-muted);
          margin-top: -4px;
        }
        .arch-loops-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
        }
        :global(.arch-loop-card) {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          text-align: left;
          gap: 6px;
          padding: 12px 14px !important;
          border-radius: 10px !important;
          border: 1px solid var(--arch-line) !important;
          background: var(--arch-surface) !important;
          color: var(--arch-ink) !important;
          cursor: pointer;
          height: auto !important;
        }
        :global(.arch-loop-card.is-on) {
          background: var(--arch-surface-2) !important;
          border-color: var(--arch-accent) !important;
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--arch-accent) 25%, transparent);
        }
        :global(.arch-loop-badge) {
          font-size: 11px;
          font-weight: 700;
          padding: 1px 8px;
          border-radius: 999px;
          border: 1px solid var(--arch-line);
          color: var(--arch-muted);
          background: var(--arch-surface-2);
        }
        :global(.arch-jump-btn) {
          background: var(--arch-accent);
          color: rgb(255, 255, 255);
          border: 1px solid var(--arch-accent);
          border-radius: 6px;
          padding: 6px 12px;
          font: inherit;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
        }
        :global(.arch-jump-btn:hover) {
          opacity: 0.92;
        }
        .arch-loop-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 6px;
        }
        .arch-loop-no {
          font-size: 11px;
          font-weight: 700;
          color: var(--arch-accent);
        }
        .arch-loop-title {
          font-weight: 700;
          font-size: 14px;
          line-height: 1.35;
        }
        .arch-loop-summary {
          font-size: 12px;
          color: var(--arch-muted);
          line-height: 1.45;
        }
        .arch-detail {
          background: var(--arch-surface);
          border: 1px solid var(--arch-line);
          border-radius: 12px;
          padding: 16px 18px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .arch-detail-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          flex-wrap: wrap;
        }
        .arch-detail-pill {
          display: inline-block;
          font-size: 11px;
          font-weight: 700;
          color: var(--arch-accent);
          border: 1px solid var(--arch-accent);
          border-radius: 999px;
          padding: 1px 9px;
          margin-bottom: 6px;
        }
        .arch-detail-head h3 {
          margin: 0 0 4px;
          font-size: 16px;
        }
        .arch-detail-head p {
          margin: 0;
          font-size: 13px;
          color: var(--arch-muted);
          line-height: 1.5;
        }
        .arch-spec-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 24px minmax(0, 1fr) 24px minmax(0, 1fr);
          gap: 8px;
          align-items: center;
        }
        .arch-spec {
          background: var(--arch-surface-2);
          border: 1px solid var(--arch-line);
          border-radius: 8px;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          height: 100%;
          box-sizing: border-box;
        }
        .arch-spec b {
          font-size: 11.5px;
          color: var(--arch-accent);
        }
        .arch-spec span {
          font-size: 12.5px;
          line-height: 1.45;
        }
        .arch-spec-arrow {
          text-align: center;
          font-size: 16px;
          font-weight: 700;
          color: var(--arch-muted);
        }
        .arch-compare {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 30px minmax(0, 1fr);
          gap: 10px;
          align-items: stretch;
        }
        .arch-col {
          background: var(--arch-surface-2);
          border: 1px solid var(--arch-line);
          border-radius: 10px;
          padding: 12px 14px;
        }
        .arch-before { border-left: 4px solid var(--arch-err); }
        .arch-after { border-left: 4px solid var(--arch-ok); }
        .arch-col-title {
          font-size: 12px;
          font-weight: 700;
          margin-bottom: 8px;
        }
        .arch-before .arch-col-title { color: var(--arch-err); }
        .arch-after .arch-col-title { color: var(--arch-ok); }
        .arch-col ol {
          margin: 0;
          padding-left: 18px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 12.5px;
          line-height: 1.45;
        }
        .arch-col-mid {
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          font-weight: 700;
          color: var(--arch-accent);
        }
        .arch-live-features {
          border-top: 1px solid var(--arch-line);
          padding-top: 12px;
        }
        .arch-live-title {
          font-size: 12px;
          font-weight: 700;
          color: var(--arch-muted);
          margin-bottom: 8px;
        }
        .arch-live-chips {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          gap: 8px;
        }
        .arch-live-chip {
          background: var(--arch-surface-2);
          border: 1px solid var(--arch-line);
          border-radius: 8px;
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          font-size: 12px;
        }
        .arch-live-chip span {
          color: var(--arch-ok);
          font-size: 11.5px;
        }
        @media (max-width: 1040px) {
          .arch-nodes, .arch-loops-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .arch-arrow, .arch-feedback-svg {
            display: none;
          }
          .arch-spec-row, .arch-compare {
            grid-template-columns: 1fr;
          }
          .arch-spec-arrow, .arch-col-mid {
            display: none;
          }
        }
        @media (max-width: 640px) {
          .arch-nodes, .arch-loops-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </section>
  );
}
