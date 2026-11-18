// components/manuals/ManualSearchBar.js
// /work/manuals 상단 빠른 키워드 검색 · 부서 필터 · 핵심 주의 지침(/operations-knowledge) · 원스톱 도구 바로가기 스트립.
// 색은 /pm 토큰(var(--pm-*))만 사용(hex·rgba 금지), 버튼은 components/pm/ui 키트 사용.
import { useMemo, useState } from 'react';
import { Badge, Button, ToggleChip } from '../pm/ui';
import { matchKnowledgeForContext, resolveToolShortcuts, searchManualWorkspace } from '../../lib/workManualsInsights';

const KIND_LABEL = Object.freeze({
  manual: '매뉴얼',
  schedule: '업무표',
  trouble: '문제 해결',
  knowledge: '업무 지침',
  draft: '절차 초안',
});

const STATUS_BADGE = Object.freeze({
  confirmed: { label: '확정', tone: 'ok' },
  estimated: { label: '추정', tone: 'est' },
  CURRENT: { label: '현재 적용', tone: 'ok' },
  CHECK: { label: '확인 필요', tone: 'est' },
  edited: { label: '수정 중', tone: 'idle' },
  ai_draft: { label: 'AI 초안', tone: 'plain' },
});

export default function ManualSearchBar({
  handovers = [],
  curDept,
  knowledge = [],
  drafts = [],
  routines,
  onOpenManual,
  onOpenDrafts,
  onOpenLive,
  onOpenRoutines,
}) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('all'); // 'all' | 'current'

  const deptFilter = scope === 'current' && curDept?.id ? curDept.id : 'all';

  const results = useMemo(() => {
    if (!query.trim()) return [];
    return searchManualWorkspace({
      handovers,
      knowledgeItems: knowledge,
      drafts,
      deptFilter,
      query,
      limit: 18,
    });
  }, [handovers, knowledge, drafts, deptFilter, query]);

  const contextKnowledge = useMemo(() => matchKnowledgeForContext({
    knowledgeItems: knowledge,
    deptId: curDept?.id || 'all',
    query,
    limit: 3,
  }), [knowledge, curDept?.id, query]);

  const deptShortcuts = useMemo(() => {
    const curManuals = curDept?.data?.manuals || [];
    const seen = new Set();
    const out = [];
    for (const m of curManuals) {
      for (const sc of resolveToolShortcuts(m, { limit: 3 })) {
        if (seen.has(sc.href)) continue;
        seen.add(sc.href);
        out.push(sc);
        if (out.length >= 6) return out;
      }
    }
    return out;
  }, [curDept]);

  return (
    <section className="wm-hub" aria-label="매뉴얼 빠른 검색과 도구 연결">
      <div className="wm-hub-row">
        <label className="wm-search-box">
          <span className="wm-search-lbl">빠른 검색</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="패킹리스트, 세금계산서, 불량, 발주, 정산 등으로 찾기"
            aria-label="전체 부서 매뉴얼과 지침 빠른 검색"
          />
          {query && (
            <Button size="sm" variant="ghost" onClick={() => setQuery('')}>지우기</Button>
          )}
        </label>
        <div className="wm-scope" role="group" aria-label="검색 부서 범위">
          <ToggleChip on={scope === 'all'} onClick={() => setScope('all')}>전 부서</ToggleChip>
          <ToggleChip on={scope === 'current'} onClick={() => setScope('current')}>
            {curDept?.name || '현재 부서'}만
          </ToggleChip>
        </div>
        <div className="wm-views" role="group" aria-label="보기 전환">
          {routines && (
            <Button size="sm" variant="secondary" onClick={onOpenRoutines}>신입 루틴</Button>
          )}
          <Button size="sm" variant="secondary" onClick={onOpenLive}>라이브 매뉴얼</Button>
          <Button size="sm" variant="secondary" onClick={onOpenDrafts}>내 절차 초안</Button>
          <a className="pmk pmk-btn pmk-secondary pmk-sm wm-linkbtn" href="/operations-knowledge">주의·이슈 지침</a>
        </div>
      </div>

      {query.trim() ? (
        <div className="wm-results" role="region" aria-label="매뉴얼 검색 결과">
          <div className="wm-res-head">
            <b>검색 결과 {results.length}건</b>
            <small className="muted">
              {scope === 'all' ? '전 부서 매뉴얼·업무표·문제해결·지침 통합' : `${curDept?.name || '현재 부서'} 범위`}
            </small>
          </div>
          {results.length === 0 ? (
            <p className="empty">일치하는 매뉴얼이나 지침이 없습니다. 다른 단어나 「전 부서」로 찾아보세요.</p>
          ) : (
            <div className="wm-res-grid">
              {results.map((item, idx) => {
                const sb = STATUS_BADGE[item.status] || { label: item.status || '참고', tone: 'plain' };
                const targetManualId = item.kind === 'manual' ? item.id : item.manualId;
                return (
                  <article key={`${item.kind}-${item.deptId}-${item.id}-${idx}`} className="wm-res-card">
                    <div className="wm-res-meta">
                      <Badge tone="plain">{item.deptName}</Badge>
                      <Badge tone="idle">{KIND_LABEL[item.kind] || item.kind}</Badge>
                      <Badge tone={sb.tone}>{sb.label}</Badge>
                      {item.hasVideo && <Badge tone="ok">영상</Badge>}
                    </div>
                    <h4 className="wm-res-title">{item.title}</h4>
                    {item.snippet && <p className="wm-res-snip">{item.snippet}</p>}
                    <div className="wm-res-foot">
                      {targetManualId && (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => onOpenManual?.(item.deptId, targetManualId)}
                        >
                          매뉴얼 열기
                        </Button>
                      )}
                      {item.kind === 'knowledge' && item.href && (
                        <a className="pmk pmk-btn pmk-primary pmk-sm wm-linkbtn" href={item.href}>지침 원문</a>
                      )}
                      {item.kind === 'draft' && (
                        <Button size="sm" variant="secondary" onClick={onOpenDrafts}>초안 보기</Button>
                      )}
                      {(item.shortcuts || []).map((sc) => (
                        <a key={sc.href} className="pmk pmk-chip wm-sc-link" href={sc.href}>
                          {sc.kind === 'auto' ? '자동화 · ' : '원스톱 · '}{sc.label}
                        </a>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="wm-strip">
          <div className="wm-strip-col">
            <div className="wm-strip-head">
              <b>{curDept?.name || '부서'} 원스톱 · 자동화 도구</b>
              <small className="muted">매뉴얼에서 바로 실행</small>
            </div>
            <div className="wm-chips">
              {deptShortcuts.length > 0 ? deptShortcuts.map((sc) => (
                <a key={sc.href} className="pmk pmk-chip wm-sc-link" href={sc.href}>
                  <Badge tone={sc.kind === 'auto' ? 'ok' : 'plain'}>{sc.kind === 'auto' ? '자동' : '웹'}</Badge>
                  <span>{sc.label}</span>
                </a>
              )) : (
                <a className="pmk pmk-chip wm-sc-link" href="/import/tools">수입부 업무도구 열기</a>
              )}
            </div>
          </div>

          <div className="wm-strip-col">
            <div className="wm-strip-head">
              <b>핵심 주의·이슈 지침 연계</b>
              <a className="wm-more-link" href="/operations-knowledge">전체 지침 보기 →</a>
            </div>
            {contextKnowledge.length > 0 ? (
              <ul className="wm-klist">
                {contextKnowledge.map((k) => (
                  <li key={k.id}>
                    <a href={`/operations-knowledge?itemId=${encodeURIComponent(k.id)}`}>
                      <Badge tone={k.priority === 'IMPORTANT' ? 'err' : k.status === 'CURRENT' ? 'ok' : 'est'}>
                        {k.priority === 'IMPORTANT' ? '중요' : k.statusLabel}
                      </Badge>
                      <b>{k.title}</b>
                      {k.caution && <small className="muted"> — {k.caution}</small>}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted wm-kempty">
                등록된 실시간 주의 지침은 「주의·이슈 및 업무처리 지침」 화면에서 확인·등록할 수 있으며, 각 매뉴얼 안의 「⑤ 자주 틀리는 곳」과 함께 보실 수 있습니다.
              </p>
            )}
          </div>
        </div>
      )}

      <style jsx global>{`
        .wm-hub { background: var(--pm-surface); border: 1px solid var(--pm-line); border-radius: var(--pm-radius); padding: 12px 14px; margin: 4px 0 6px; display: flex; flex-direction: column; gap: 10px; }
        .wm-hub-row { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; }
        .wm-search-box { display: flex; align-items: center; gap: 8px; flex: 1 1 300px; min-width: 240px; }
        .wm-search-lbl { font-size: 12px; font-weight: 700; color: var(--pm-muted); white-space: nowrap; }
        .wm-search-box input { flex: 1; min-width: 140px; min-height: 34px; padding: 5px 10px; border: 1px solid var(--pm-line); border-radius: var(--pm-radius); background: var(--pm-bg); color: var(--pm-ink); font: inherit; font-size: 13px; }
        .wm-search-box input:focus-visible { outline: 2px solid var(--pm-accent); outline-offset: 1px; }
        .wm-scope, .wm-views { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
        .wm-linkbtn { text-decoration: none; display: inline-flex; align-items: center; }
        .wm-sc-link { text-decoration: none; gap: 5px; }
        .wm-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; border-top: 1px solid var(--pm-line); padding-top: 10px; }
        .wm-strip-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 6px; font-size: 13px; }
        .wm-more-link { font-size: 12px; color: var(--pm-link); text-decoration: underline; }
        .wm-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .wm-klist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; }
        .wm-klist a { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; color: var(--pm-ink); text-decoration: none; padding: 3px 0; }
        .wm-klist a:hover b { text-decoration: underline; color: var(--pm-link); }
        .wm-kempty { margin: 0; font-size: 12px; line-height: 1.5; }
        .wm-results { border-top: 1px solid var(--pm-line); padding-top: 10px; }
        .wm-res-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 8px; font-size: 13px; }
        .wm-res-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 8px; }
        .wm-res-card { background: var(--pm-surface2); border: 1px solid var(--pm-line); border-radius: var(--pm-radius); padding: 10px; display: flex; flex-direction: column; gap: 6px; }
        .wm-res-meta { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
        .wm-res-title { margin: 0; font-size: 14px; font-weight: 700; color: var(--pm-ink); }
        .wm-res-snip { margin: 0; font-size: 12.5px; color: var(--pm-muted); line-height: 1.5; }
        .wm-res-foot { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: auto; padding-top: 4px; }
        @media (max-width: 760px) {
          .wm-hub { margin: 4px 0; padding: 10px; }
        }
      `}</style>
    </section>
  );
}
