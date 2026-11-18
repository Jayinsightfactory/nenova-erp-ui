// components/manuals/ManualAdminBriefing.js
// 관리자(nenovaSS3) 전용 — 부서별 매뉴얼 커버리지 & 에이전트 미보고·보완 필요 항목 브리핑.
// 비관리자(isAdmin=false)에게는 API·화면 양쪽에서 비노출. 색은 /pm 토큰(var(--pm-*))만 사용.
import { Badge } from '../pm/ui';

const PRIORITY_BADGE = Object.freeze({
  high: { label: '우선 확인', tone: 'err' },
  medium: { label: '보완 권장', tone: 'est' },
  normal: { label: '참고', tone: 'plain' },
});

export default function ManualAdminBriefing({ isAdmin, briefing }) {
  if (!isAdmin || !briefing) return null;
  const t = briefing.totals || {};
  const depts = briefing.departments || [];
  const gaps = briefing.gaps || [];

  return (
    <details className="wm-brief-fold">
      <summary>
        <Badge tone="est">관리자 전용</Badge>
        <span>매뉴얼 커버리지 · 보완 필요 브리핑</span>
        <small className="muted">
          매뉴얼 {t.manualsTotal || 0}편(확정 {t.manualsConfirmed || 0}) · 업무표 연결 {t.coveragePct || 0}% · 확인·보완 {gaps.length}건
        </small>
      </summary>
      <div className="wm-brief-body" role="region" aria-label="관리자 전용 매뉴얼 커버리지 및 보완 브리핑">
        <div className="wm-brief-kpis">
          <div className="wm-brief-kpi">
            <span className="muted">부서 인수인계 매뉴얼</span>
            <b>{t.manualsTotal || 0}편</b>
            <small className="muted">확정 {t.manualsConfirmed || 0} · 영상 {t.manualsWithVideo || 0}</small>
          </div>
          <div className="wm-brief-kpi">
            <span className="muted">업무표 → 매뉴얼 연결</span>
            <b>{t.coveragePct || 0}%</b>
            <small className="muted">{t.linkedRows || 0} / {t.scheduleRows || 0}행</small>
          </div>
          <div className="wm-brief-kpi">
            <span className="muted">미해결 질문 · 미작성</span>
            <b>{(t.ownerFollowUps || 0) + (t.notYet || 0)}건</b>
            <small className="muted">재확인 {t.ownerFollowUps || 0} · 미작성 {t.notYet || 0} · 질문 {t.questions || 0}</small>
          </div>
          <div className="wm-brief-kpi">
            <span className="muted">초안 · 루틴 · 라이브</span>
            <b>{t.drafts?.total || 0} / {t.routines?.confirmed || 0} / {t.livePipelines?.total || 0}</b>
            <small className="muted">초안 확인 {t.drafts?.confirmed || 0} · 지침 확인대기 {t.knowledgeCheck || 0}</small>
          </div>
        </div>

        <div className="wm-brief-tblwrap">
          <table className="wm-brief-tbl">
            <thead>
              <tr>
                <th>부서</th>
                <th>상태</th>
                <th>매뉴얼 (확정/추정)</th>
                <th>영상 보유</th>
                <th>업무표 연결</th>
                <th>재확인 · 질문</th>
                <th>미작성 · 근거보강</th>
              </tr>
            </thead>
            <tbody>
              {depts.map((d) => (
                <tr key={d.id}>
                  <td><b>{d.name}</b></td>
                  <td><Badge tone={d.ready ? 'ok' : 'plain'}>{d.ready ? '게시됨' : '준비 중'}</Badge></td>
                  <td>{d.manualsTotal}편 ({d.manualsConfirmed}/{d.manualsEstimated})</td>
                  <td>{d.manualsWithVideo}편</td>
                  <td>{d.linkedRows}/{d.scheduleRows} ({d.coveragePct}%)</td>
                  <td>{d.ownerFollowUps} / {d.questions}</td>
                  <td>{d.notYet} / {d.weakEvidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h4>에이전트 작업데이터 미보고 · 보완 필요 항목</h4>
        <div className="wm-brief-gaps">
          {gaps.map((g) => {
            const pb = PRIORITY_BADGE[g.priority] || PRIORITY_BADGE.normal;
            return (
              <div key={g.id} className="wm-brief-gap">
                <div className="wm-brief-gap-top">
                  <Badge tone={pb.tone}>{pb.label}</Badge>
                  <Badge tone="plain">{g.category}</Badge>
                  <b>{g.title}</b>
                </div>
                <p>{g.detail}</p>
                {g.href && <a className="wm-brief-link" href={g.href}>해당 화면에서 확인 →</a>}
              </div>
            );
          })}
        </div>
      </div>

      <style jsx global>{`
        .wm-brief-fold { margin: 6px 0 0; border: 1px solid var(--pm-line); border-radius: var(--pm-radius); background: var(--pm-surface); }
        .wm-brief-fold > summary { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-height: 40px; padding: 6px 14px; font-size: 13.5px; font-weight: 700; cursor: pointer; list-style: none; color: var(--pm-ink); }
        .wm-brief-fold > summary::-webkit-details-marker { display: none; }
        .wm-brief-fold > summary small { margin-left: auto; font-weight: 400; }
        .wm-brief-body { padding: 12px 14px 14px; border-top: 1px solid var(--pm-line); display: flex; flex-direction: column; gap: 12px; }
        .wm-brief-body h4 { margin: 4px 0 0; font-size: 13.5px; }
        .wm-brief-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; }
        .wm-brief-kpi { background: var(--pm-surface2); border: 1px solid var(--pm-line); border-radius: var(--pm-radius); padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
        .wm-brief-kpi b { font-size: 17px; color: var(--pm-ink); }
        .wm-brief-tblwrap { overflow-x: auto; }
        .wm-brief-tbl { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        .wm-brief-tbl th, .wm-brief-tbl td { border-bottom: 1px solid var(--pm-line); padding: 6px 8px; text-align: left; white-space: nowrap; }
        .wm-brief-tbl th { background: var(--pm-surface2); color: var(--pm-muted); font-weight: 600; }
        .wm-brief-gaps { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px; }
        .wm-brief-gap { background: var(--pm-surface2); border: 1px solid var(--pm-line); border-radius: var(--pm-radius); padding: 10px; display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; }
        .wm-brief-gap-top { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
        .wm-brief-gap p { margin: 2px 0 0; color: var(--pm-muted); line-height: 1.5; }
        .wm-brief-link { font-size: 12px; color: var(--pm-link); text-decoration: underline; margin-top: auto; }
        @media (max-width: 760px) {
          .wm-brief-fold { margin: 6px 0 0; }
          .wm-brief-fold > summary small { margin-left: 0; flex-basis: 100%; }
        }
      `}</style>
    </details>
  );
}
