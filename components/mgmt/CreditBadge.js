// 여신 상태 배지. 다른 화면에 삽입해 쓰는 표시 전용 컴포넌트(저장 로직에 영향 없음).
import { useEffect, useState } from 'react';
import { apiGet } from '../../lib/useApi';

const COLOR = {
  ok: ['#166534', '#dcfce7'],
  warn: ['#92400e', '#fef3c7'],
  over: ['#991b1b', '#fee2e2'],
  none: ['#475569', '#f1f5f9'],
};

export default function CreditBadge({ custKey }) {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!custKey) { setInfo(null); return undefined; }
    apiGet('/api/mgmt/credit-limit', { custKey })
      .then((r) => { if (alive && r?.success) setInfo(r); })
      .catch(() => { if (alive) setInfo(null); });
    return () => { alive = false; };
  }, [custKey]);

  if (!info) return null;
  const [fg, bg] = COLOR[info.status] || COLOR.none;
  const pct = info.pct == null ? '' : ` ${info.pct}%`;
  return (
    <span
      title={`한도 ${info.limitKRW == null ? '-' : Number(info.limitKRW).toLocaleString()}원 / 잔액 ${Number(info.balance || 0).toLocaleString()}원`}
      style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, color: fg, background: bg }}
    >
      {info.statusLabel}{pct}
    </span>
  );
}
