import styles from './PivotLoadingOverlay.module.css';

export default function PivotLoadingOverlay({ visible, percent = 0, onCancel }) {
  if (!visible) return null;
  const title = percent === 100 ? '피벗 표시 완료' : percent >= 75 ? '화면에 결과 표시 중' : percent >= 50 ? '수량·단가 집계 중' : percent >= 25 ? '필터 적용 중' : '전산 자료 조회 중';
  return <div className={styles.overlay} data-testid="pivot-loading-overlay" role="status" aria-live="polite">
    <div className={styles.card}>
      <div className={styles.logo} aria-hidden="true"><span>N</span></div>
      <strong>{title}</strong>
      <div className={styles.percent}>{percent}%</div>
      <div className={styles.track} role="progressbar" aria-label="피벗 단계 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent}% · ${title}`}><span style={{width:`${percent}%`}} /></div>
      <p>조회 → 필터 → 집계 → 화면 표시</p>
      <small>단계 진행률입니다. 서버 조회 중에는 0%에서 대기합니다.</small>
      {onCancel && <button className="btn btn-sm" style={{marginTop:14}} onClick={onCancel}>조회·집계 취소</button>}
    </div>
  </div>;
}
