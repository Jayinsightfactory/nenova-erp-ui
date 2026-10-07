import { useRef } from 'react';

export default function ErpMatchPicker({ kind, value, label, options = [], onPick, onOpen, disabled = false, initialQuery = '', country = '', flower = '', entryId = '' }) {
  const buttonRef = useRef(null);
  const isProduct = kind === 'product';
  const resolvedLabel = String(label || '').trim();
  const open = () => onOpen?.({
    kind,
    entryId,
    initialQuery,
    country,
    flower,
    options: isProduct ? [] : options,
    onPick,
    returnFocusElement: buttonRef.current,
  });

  return <div className="picker">
    <button ref={buttonRef} type="button" className={`selected ${value ? 'is-matched' : 'is-unmatched'}`} disabled={disabled}
      aria-label={`${isProduct ? 'ERP 품목' : 'ERP 업체'} 매칭 선택${resolvedLabel ? `, 현재 ${resolvedLabel}` : ', 미매칭'}`}
      aria-haspopup="dialog" title={resolvedLabel || '미매칭 — 눌러서 별도 창에서 선택'} onClick={open}>
      <span>{resolvedLabel || '미매칭 · 선택 필요'}</span>{value ? <small>#{value}</small> : null}
    </button>
    <style jsx>{`.picker{min-width:0;width:100%}.selected{display:flex;align-items:center;gap:4px;width:100%;min-width:0;min-height:34px;box-sizing:border-box;text-align:left;background:#fff;border:1px solid #9db2cc;border-radius:4px;padding:4px 6px;color:#164c94;cursor:pointer}.selected>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:14px;font-weight:700}.selected small{flex:none;font-size:12px;color:#52647c}.selected.is-unmatched{border-color:#d88b80;background:#fff7f5;color:#a61b14}.selected:hover{background:#eaf3ff}.selected:focus-visible{outline:3px solid #8bbcff;outline-offset:1px}.selected:disabled{opacity:.6;cursor:not-allowed}@media(max-width:760px){.selected>span{font-size:13px}}`}</style>
  </div>;
}
