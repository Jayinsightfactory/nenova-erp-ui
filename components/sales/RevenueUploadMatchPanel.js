import { useEffect, useMemo, useState } from 'react';
import { baseCustomersForChannel } from '../../lib/salesRevenueConfig';
import { buildUploadMatchItems, uploadMatchProgress } from '../../lib/salesRevenuePendingMatch';

const fmt = n => Number(n || 0).toLocaleString();

export default function RevenueUploadMatchPanel({
  open,
  pending,
  channel,
  mappings,
  sessionConfirmed,
  onConfirm,
  onMarkNew,
  onClose,
  saving,
}) {
  const [selected, setSelected] = useState(null);
  const [canonicalPick, setCanonicalPick] = useState('');
  const [filter, setFilter] = useState('pending');

  const baseCustomers = useMemo(() => baseCustomersForChannel(channel), [channel]);
  const items = useMemo(
    () => buildUploadMatchItems(pending?.rows, mappings, channel, sessionConfirmed),
    [pending?.rows, mappings, channel, sessionConfirmed]
  );
  const progress = useMemo(() => uploadMatchProgress(items), [items]);

  const visible = useMemo(() => {
    if (filter === 'all') return items;
    if (filter === 'resolved') return items.filter(it => it.resolved);
    return items.filter(it => !it.resolved);
  }, [items, filter]);

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setCanonicalPick('');
    }
  }, [open]);

  useEffect(() => {
    if (selected) {
      setCanonicalPick(selected.canonicalName || '');
    }
  }, [selected]);

  if (!open || !pending) return null;

  const pickItem = (it) => {
    setSelected(it);
    setCanonicalPick(it.suggestedBase || it.canonicalName || '');
  };

  const confirmPick = () => {
    if (!selected || !canonicalPick.trim()) return;
    onConfirm(selected.ecountName, canonicalPick.trim());
    setSelected(null);
    setCanonicalPick('');
  };

  const approveCandidate = (it) => {
    onConfirm(it.ecountName, it.canonicalName);
  };

  return (
    <div style={st.overlay}>
      <div style={st.card} role="dialog" aria-modal="true" aria-label="업로드 업체 매칭">
        <div style={st.head}>
          <div>
            <div style={st.title}>업체 매칭 — 저장 전 필수</div>
            <div style={st.sub}>
              이카운트 엑셀 거래처를 <b>매출 비교표 기준 업체</b>와 맞춘 뒤 저장하세요. 비교표에는 아직 반영되지 않았습니다.
            </div>
            <div style={st.meta}>
              {pending.detected?.year}년 <b>{pending.detected?.week}차</b> / {pending.meta?.channel || channel}
              {' · '}{fmt(pending.rawCount)}건 · 합계 {fmt(pending.rawTotal)}
              {pending.fileName ? ` · ${pending.fileName}` : ''}
            </div>
          </div>
          <button type="button" className="btn" onClick={onClose}>닫기</button>
        </div>

        <div style={st.toolbar}>
          <span style={st.progress}>
            매칭 {progress.resolved}/{progress.total}
            {progress.pending > 0 && <span style={{ color: '#b45309' }}> · {progress.pending}건 남음</span>}
          </span>
          <div style={st.tabs}>
            {[
              ['pending', `미완료 (${progress.pending})`],
              ['resolved', `완료 (${progress.resolved})`],
              ['all', `전체 (${progress.total})`],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                className="btn"
                style={filter === key ? st.tabOn : st.tabOff}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div style={st.body}>
          <div style={st.listCol}>
            <div style={st.colHead}>엑셀 거래처 ({visible.length})</div>
            <div style={st.list}>
              {visible.length === 0 && <div style={st.empty}>표시할 항목이 없습니다.</div>}
              {visible.map(it => (
                <button
                  key={it.ecountName}
                  type="button"
                  onClick={() => pickItem(it)}
                  style={{
                    ...st.listBtn,
                    borderColor: selected?.ecountName === it.ecountName ? '#1166BB' : '#d0d0d0',
                    background: it.resolved ? '#ecfdf5' : selected?.ecountName === it.ecountName ? '#E8F0FF' : '#fff',
                  }}
                >
                  <div style={st.listRowTop}>
                    <b>{it.ecountName}</b>
                    <span style={statusStyle(it.status)}>{it.status}</span>
                  </div>
                  <div style={st.listRowSub}>
                    {fmt(it.amount)} · {it.rowCount}행
                    {it.resolved && <> → <b>{it.canonicalName}</b></>}
                    {!it.resolved && it.suggestedBase && <> · 후보 <b>{it.suggestedBase}</b></>}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div style={st.pickCol}>
            <div style={st.colHead}>비교표 기준 업체에 연결</div>
            {!selected ? (
              <div style={st.empty}>왼쪽에서 엑셀 거래처를 선택하세요.</div>
            ) : (
              <>
                <div style={st.field}>
                  <label style={st.label}>이카운트 거래처명</label>
                  <input className="filter-input" readOnly value={selected.ecountName} style={st.full} />
                </div>
                <div style={st.field}>
                  <label style={st.label}>비교표 통용명 (기준 업체)</label>
                  <input
                    className="filter-input"
                    list="revenue-base-customers"
                    value={canonicalPick}
                    onChange={e => setCanonicalPick(e.target.value)}
                    placeholder="기준 업체 선택 또는 입력"
                    style={st.full}
                  />
                  <datalist id="revenue-base-customers">
                    {baseCustomers.map(n => <option key={n} value={n} />)}
                  </datalist>
                </div>
                <div style={st.chips}>
                  {baseCustomers.slice(0, 12).map(n => (
                    <button key={n} type="button" className="btn" style={st.chip} onClick={() => setCanonicalPick(n)}>{n}</button>
                  ))}
                </div>
                {selected.status === '후보' && !selected.resolved && (
                  <div style={st.hint}>
                    자동 후보: <b>{selected.canonicalName}</b>
                    <button type="button" className="btn btn-primary" style={{ marginLeft: 8 }} onClick={() => approveCandidate(selected)} disabled={saving}>
                      후보 그대로 확정
                    </button>
                  </div>
                )}
                <div style={st.actions}>
                  <button type="button" className="btn btn-primary" onClick={confirmPick} disabled={saving || !canonicalPick.trim()}>
                    이 매칭 확정
                  </button>
                  <button type="button" className="btn" onClick={() => onMarkNew(selected.ecountName)} disabled={saving}>
                    신규 업체로 유지
                  </button>
                </div>
                <div style={st.note}>
                  확정한 매칭은 저장 시 비교표에 반영되며, 같은 이카운트 거래처명에는 다음 업로드부터 자동 적용됩니다.
                </div>
              </>
            )}
          </div>
        </div>

        <div style={st.foot}>
          <span style={{ fontSize: 11, color: '#64748b' }}>
            {progress.pending > 0
              ? '모든 거래처 매칭을 완료해야 비교표에 저장할 수 있습니다.'
              : '매칭 완료 — 상단의 💾 저장을 눌러 비교표에 반영하세요.'}
          </span>
        </div>
      </div>
    </div>
  );
}

function statusStyle(status) {
  const base = { fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4 };
  if (status === '확정') return { ...base, background: '#dcfce7', color: '#166534' };
  if (status === '후보') return { ...base, background: '#ffedd5', color: '#9a3412' };
  if (status === '신규') return { ...base, background: '#dbeafe', color: '#1d4ed8' };
  return { ...base, background: '#fee2e2', color: '#b91c1c' };
}

const st = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1100,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12,
  },
  card: {
    background: 'var(--surface, #fff)', border: '1px solid var(--border2)',
    width: 'min(960px, 96vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column',
  },
  head: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderBottom: '1px solid var(--border)' },
  title: { fontSize: 15, fontWeight: 700 },
  sub: { fontSize: 12, color: '#475569', marginTop: 4 },
  meta: { fontSize: 11, color: '#64748b', marginTop: 4 },
  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' },
  progress: { fontSize: 12, fontWeight: 600 },
  tabs: { display: 'flex', gap: 4 },
  tabOn: { background: '#E8F0FF', borderColor: '#1166BB' },
  tabOff: {},
  body: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: 12, overflow: 'auto', flex: 1 },
  listCol: { minWidth: 0 },
  pickCol: { minWidth: 0, borderLeft: '1px solid var(--border)', paddingLeft: 10 },
  colHead: { fontSize: 12, fontWeight: 700, marginBottom: 6 },
  list: { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: '50vh', overflow: 'auto' },
  listBtn: { border: '1px solid', padding: '8px 10px', textAlign: 'left', cursor: 'pointer', fontSize: 12 },
  listRowTop: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' },
  listRowSub: { fontSize: 11, color: '#64748b', marginTop: 2 },
  field: { marginBottom: 8 },
  label: { display: 'block', fontSize: 11, color: 'var(--text3)', marginBottom: 3 },
  full: { width: '100%', boxSizing: 'border-box' },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 },
  chip: { fontSize: 11, padding: '2px 8px' },
  hint: { fontSize: 12, background: '#fffbeb', border: '1px solid #fcd34d', padding: 8, marginBottom: 8 },
  actions: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  note: { fontSize: 11, color: '#64748b', marginTop: 8 },
  foot: { padding: '8px 14px', borderTop: '1px solid var(--border)' },
  empty: { fontSize: 12, color: 'var(--text3)', padding: 12, border: '1px dashed var(--border)' },
};
