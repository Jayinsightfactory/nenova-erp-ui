// components/pm/ui.js
// /pm UI 키트 — /pm 의 모든 버튼은 여기서만 만든다(raw <button> 금지, __tests__/pmUiKit.test.js 가 검사).
//   사이트 전역 .btn / .btn-primary / .btn-danger (styles/globals.css) 클래스를 그대로 얹고,
//   /pm 전용 차이(터치 높이 32px·모바일 44px, 둥근 모서리, focus ring, 테마 색)는 --pmk-* 토큰 하나에서만 정한다.
//   테마는 lib/pmThemes.js 가 --pmk-* 값만 바꾼다 → 테마별로 버튼 모양이 깨지지 않는다.

const cx = (...a) => a.filter(Boolean).join(' ');

// variant: primary | secondary | ghost | danger · size: sm | md
export function Button({ variant = 'secondary', size = 'md', loading = false, disabled, className, children, ...rest }) {
  const site = variant === 'primary' ? 'btn btn-primary' : variant === 'danger' ? 'btn btn-danger' : variant === 'secondary' ? 'btn' : '';
  return (
    <button type="button" {...rest} disabled={disabled || loading} aria-busy={loading || undefined}
      className={cx(site, 'pmk', 'pmk-btn', `pmk-${variant}`, `pmk-${size}`, className)}>
      {children}
    </button>
  );
}

// 닫기(×) 등 아이콘만 있는 버튼 — 라벨은 aria-label 필수.
export function IconButton({ label, icon = '×', className, ...rest }) {
  return <button type="button" aria-label={label} title={label} {...rest} className={cx('pmk', 'pmk-icon', className)}>{icon}</button>;
}

export function LinkButton({ className, children, ...rest }) {
  return <button type="button" {...rest} className={cx('pmk', 'pmk-link', className)}>{children}</button>;
}

// 필터·상태 선택 칩(aria-pressed). 탭은 Tabs 를 쓴다.
export function ToggleChip({ on, className, children, ...rest }) {
  return <button type="button" aria-pressed={!!on} {...rest} className={cx('pmk', 'pmk-chip', on && 'on', className)}>{children}</button>;
}

// 직원 이름 칩(누르면 그 직원 서랍). plain=배경 없는 굵은 이름(작업 로그 줄).
export function PersonChip({ plain, className, children, ...rest }) {
  return <button type="button" {...rest} className={cx('pmk', plain ? 'pmk-name' : 'pmk-person', className)}>{children}</button>;
}

// 카드·칸처럼 생긴 누르는 영역(복도 칸·학습 카드·꾸미기 옵션). 모양은 className 이 정하고 상태·포커스는 키트가.
export function SelectCard({ on, pressed, expanded, className, children, ...rest }) {
  return (
    <button type="button" {...rest} aria-pressed={pressed === undefined ? undefined : !!pressed} aria-expanded={expanded === undefined ? undefined : !!expanded}
      className={cx('pmk', 'pmk-card', on && 'on', className)}>
      {children}
    </button>
  );
}

export function Tabs({ items, value, onChange, label, className }) {
  return (
    <div className={cx('pmk-tabs', className)} role="tablist" aria-label={label}>
      {items.map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} className={cx('pmk', 'pmk-tab', value === k && 'on')} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

export function Panel({ className, children, ...rest }) {
  return <section {...rest} className={cx('panel', className)}>{children}</section>;
}

export function Badge({ tone = 'plain', className, children, ...rest }) {
  return <span {...rest} className={cx('badge', tone, className)}>{children}</span>;
}

// 페이지에 한 번 렌더. 색 토큰은 테마(lib/pmThemes.js)가 정한다.
export function PmUiStyles() {
  return (
    <style jsx global>{`
      .pm {
        /* 값은 lib/pmThemes.js themeCss() 가 테마별로 --pm-* 토큰에 묶는다(여기엔 hex 금지). */
        --pmk-radius: var(--pm-radius, 8px); --pmk-h: 32px; --pmk-h-sm: 28px;
      }
      .pm .pmk { font: inherit; cursor: pointer; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
      .pm .pmk:focus-visible { outline: 2px solid var(--pmk-focus); outline-offset: 2px; }
      .pm .pmk:disabled { cursor: not-allowed; opacity: .55; }
      .pm .pmk-btn { height: auto; min-height: var(--pmk-h); padding: 0 14px; border-radius: var(--pmk-radius); font-size: 13px; justify-content: center; }
      .pm .pmk-btn.pmk-sm { min-height: var(--pmk-h-sm); padding: 0 10px; font-size: 12px; }
      .pm .pmk-btn.pmk-secondary { background: var(--pmk-sec-bg); color: var(--pmk-sec-ink); border-color: var(--pmk-sec-border); }
      .pm .pmk-btn.pmk-secondary:hover:not(:disabled) { background: var(--pmk-sec-hover); }
      .pm .pmk-btn.pmk-primary { background: var(--pmk-primary); color: var(--pmk-primary-ink); border-color: var(--pmk-primary-hover); font-weight: bold; }
      .pm .pmk-btn.pmk-primary:hover:not(:disabled) { background: var(--pmk-primary-hover); }
      .pm .pmk-btn.pmk-danger { background: var(--pmk-danger); color: var(--pmk-primary-ink); border-color: var(--pmk-danger-hover); }
      .pm .pmk-btn.pmk-danger:hover:not(:disabled) { background: var(--pmk-danger-hover); }
      .pm .pmk-btn.pmk-ghost { display: inline-flex; align-items: center; background: transparent; color: var(--pmk-ink); border: 1px solid transparent; }
      .pm .pmk-btn.pmk-ghost:hover:not(:disabled) { border-color: currentColor; }
      .pm .pmk-btn[aria-busy] { cursor: progress; }
      .pm .pmk-icon { display: inline-flex; align-items: center; justify-content: center; min-width: var(--pmk-h); min-height: var(--pmk-h); padding: 0; background: transparent; border: 0; border-radius: var(--pmk-radius); color: inherit; font-size: 20px; line-height: 1; }
      .pm .pmk-icon:hover { background: rgba(127,127,127,.2); }
      .pm .pmk-link { background: none; border: 0; padding: 4px 0; min-height: var(--pmk-h-sm); color: var(--pmk-link); font-size: 13px; text-decoration: underline; text-underline-offset: 2px; }
      .pm .pmk-chip, .pm .pmk-person { display: inline-flex; align-items: center; min-height: var(--pmk-h-sm); padding: 0 9px; margin: 2px 4px 2px 0; background: var(--pmk-chip-bg); color: var(--pmk-chip-ink); border: 1px solid transparent; border-radius: var(--pmk-radius); font-size: 12px; text-align: left; }
      .pm .pmk-chip:hover, .pm .pmk-person:hover { border-color: currentColor; }
      .pm .pmk-chip.on { background: var(--pmk-on-bg); color: var(--pmk-on-ink); font-weight: bold; }
      .pm .pmk-name { flex: 0 0 auto; background: none; border: 0; padding: 0; color: var(--pmk-ink); font-weight: bold; }
      .pm .pmk-name:hover { text-decoration: underline; }
      .pm .pmk-card { color: inherit; text-align: inherit; }
      .pm .pmk-tabs { display: flex; flex-wrap: wrap; }
      .pm .pmk-tab { flex: 1; min-height: 40px; padding: 0 10px; background: none; border: 0; border-bottom: 3px solid transparent; color: var(--pmk-tab-ink); font-size: 14px; }
      .pm .pmk-tab:hover { color: var(--pmk-ink); }
      .pm .pmk-tab.on { color: var(--pmk-ink); font-weight: bold; border-bottom-color: var(--pmk-tab-on); }
      @media (max-width: 640px) {
        .pm { --pmk-h: 44px; --pmk-h-sm: 36px; }
        .pm .pmk-tab { min-height: 44px; flex: 1 0 33%; }
      }
    `}</style>
  );
}
