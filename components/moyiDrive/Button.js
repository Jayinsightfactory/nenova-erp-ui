import { useId } from 'react';

// 기존 ERP .btn 스타일 그대로 재사용. disabled일 때는 title(마우스)과
// aria-describedby(스크린리더) 양쪽에 같은 쉬운 이유를 노출한다 — 색상만으로 상태를 전달하지 않는다.
export default function Button({ children, variant, disabled, reason, className = '', ...rest }) {
  const reasonId = useId();
  const classes = ['btn', variant ? `btn-${variant}` : '', className].filter(Boolean).join(' ');
  const showReason = Boolean(disabled && reason);
  return (
    <>
      <button
        type="button"
        className={classes}
        disabled={disabled}
        title={showReason ? reason : undefined}
        aria-describedby={showReason ? reasonId : undefined}
        {...rest}
      >
        {children}
      </button>
      {showReason && <span id={reasonId} className="moyi-sr-only">{reason}</span>}
      <style jsx>{`
        .moyi-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
        button:focus-visible { outline: 2px solid var(--blue); outline-offset: 1px; }
      `}</style>
    </>
  );
}
