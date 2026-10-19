import { validationWindowUrl } from '../lib/profitValidationWindow.mjs';

export default function ProfitValidationLink({ year, major, disabled = false, style }) {
  let href;
  try { href = validationWindowUrl(year, major); } catch { /* selection required */ }
  if (disabled || !href) return <button type="button" style={style} disabled title="연도·차수 조회 후 열 수 있습니다">수익률 검증 새창 ↗</button>;
  return <a href={href} target="_blank" rel="noopener noreferrer" style={style} onClick={(event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const child = window.open(href, 'nenova-profit-validation', 'popup=yes,width=1380,height=900,resizable=yes,scrollbars=yes');
    if (child) { child.opener = null; child.focus(); event.preventDefault(); }
    // If blocked, the ordinary target=_blank link remains usable.
  }}>수익률 검증 새창 ↗</a>;
}
