import { customerMarginUrl } from '../lib/profitCustomerMarginPresentation.mjs';

export default function ProfitCustomerMarginLink({ year, major, disabled = false, style }) {
  let href;
  try { href = customerMarginUrl(year, major); } catch { /* Explicit selection required. */ }
  if (disabled || !href) return <button type="button" disabled style={style} title="연도·차수 조회 후 열 수 있습니다">업체비중·판매마진 새창 ↗</button>;
  return <a href={href} target="_blank" rel="noopener noreferrer" style={style} onClick={event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const child = window.open(href, 'nenova-profit-customer-margin', 'popup=yes,width=1380,height=900,resizable=yes,scrollbars=yes');
    if (child) { child.opener = null; child.focus(); event.preventDefault(); }
  }}>업체비중·판매마진 새창 ↗</a>;
}
