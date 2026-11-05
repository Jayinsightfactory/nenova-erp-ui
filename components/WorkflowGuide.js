import { useId, useRef, useState } from 'react';
import { workflowGuide, guideTime } from '../lib/workflowGuides.cjs';
import styles from '../styles/WorkflowGuide.module.css';

// Static, local media only. Opening or playing a guide never submits an ERP action.
export default function WorkflowGuide({ workflowId, initialRole }) {
  const workflow = workflowGuide(workflowId);
  const [selected, setSelected] = useState(() => workflow?.guides.find(guide => guide.role === initialRole)?.id ?? workflow?.guides[0]?.id);
  const [error, setError] = useState(false);
  const player = useRef(null);
  const labelId = useId();
  if (!workflow) return null;
  const guide = workflow.guides.find(item => item.id === selected) ?? workflow.guides[0];
  const choose = id => { player.current?.pause(); setError(false); setSelected(id); };
  const seek = seconds => {
    if (!player.current) return;
    player.current.currentTime = seconds;
    player.current.focus();
  };
  return <details className={styles.guide} onToggle={event => { if (!event.currentTarget.open) player.current?.pause(); }}>
    <summary>사용 가이드 영상 <span>수정 방법을 화면으로 따라하기</span></summary>
    <section aria-labelledby={labelId} className={styles.body}>
      <h3 id={labelId}>{workflow.title}</h3>
      <div className={styles.roles} aria-label="가이드 대상 선택">
        {workflow.guides.map(item => <button key={item.id} type="button" aria-pressed={guide.id === item.id} onClick={() => choose(item.id)}>{item.role}용</button>)}
      </div>
      <h4>{guide.role} · {guide.title}</h4>
      {guide.status === 'ready' ? <>
        <p className={styles.note}>연습용 자료로 촬영한 실제 업무 화면이며 한국어 설명이 영상에 표시됩니다. 재생해도 입고·분배 자료는 바뀌지 않습니다. 전체 화면으로 보면 글씨를 더 크게 볼 수 있습니다.</p>
        <video key={guide.id} ref={player} controls playsInline preload="none" className={styles.video} aria-label={`${guide.role} ${guide.title}`} onError={() => setError(true)}>
          <source src={guide.src} type="video/mp4" />
          <track kind="captions" src={guide.captions} srcLang="ko" label="한국어 설명" />
          브라우저에서 동영상을 재생할 수 없습니다. 아래 영상 다운로드를 이용하세요.
        </video>
        {error && <p role="alert">영상을 불러오지 못했습니다. 페이지를 새로고침하거나 영상 다운로드를 이용하세요.</p>}
        <nav aria-label={`${guide.role} 영상 목차`} className={styles.chapters}>{guide.chapters.map(chapter => <button key={`${chapter.scenario}-${chapter.seconds}`} type="button" onClick={() => seek(chapter.seconds)}><time>{guideTime(chapter.seconds)}</time> {chapter.title}</button>)}</nav>
        <p className={styles.downloads}><a href={guide.src} download>영상 다운로드</a><a href={guide.captions} download>한국어 설명 자막</a></p>
      </> : <p role="status">이 가이드는 제작 중입니다. 영상 검증을 마친 뒤 제공됩니다.</p>}
    </section>
  </details>;
}
