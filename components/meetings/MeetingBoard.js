// 회의정리 화이트보드 — 쪽지를 끌어 옮기고, 고치고, 잇고, 지운다. 가볍게 직접 만든 보드(외부 화이트보드 부품 없음).
//   마우스: 쪽지를 잡아 끌기 · 키보드: 쪽지에 초점을 두고 방향키로 옮기기, Enter 고치기, Delete 지우기, Esc 그만두기.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, LinkButton } from '../pm/ui';
import { CARD_TYPE_LABEL, CARD_W, LIMITS } from '../../lib/meetingBoard';

const STEP = 16;

function CardEditor({ card, onApply, onCancel }) {
  const [text, setText] = useState(card.text), [owner, setOwner] = useState(card.owner || ''), [due, setDue] = useState(card.due || '');
  const area = useRef(null);
  useEffect(() => { area.current?.focus(); area.current?.select(); }, []);
  const apply = () => onApply({ text: text.trim(), owner: owner.trim(), due: due.trim() });
  const keys = event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); apply(); }
  };
  return (
    <div className="mtb-edit" onKeyDown={keys} onPointerDown={event => event.stopPropagation()}>
      <textarea ref={area} className="mtb-input" rows={4} maxLength={LIMITS.text} value={text} aria-label="쪽지 글" onChange={event => setText(event.target.value)} />
      {card.type === 'action' && (
        <div className="mtb-edit-row">
          <label>담당<input className="mtb-input" maxLength={LIMITS.owner} value={owner} placeholder="비우면 확인 필요" onChange={event => setOwner(event.target.value)} /></label>
          <label>기한<input className="mtb-input" maxLength={LIMITS.due} value={due} placeholder="비우면 확인 필요" onChange={event => setDue(event.target.value)} /></label>
        </div>
      )}
      <div className="mtb-acts">
        <Button size="sm" variant="primary" data-act="apply" onClick={apply}>고친 글 넣기</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>그만두기</Button>
      </div>
    </div>
  );
}

export default function MeetingBoard({ board, readOnly = false, selectedId, onSelect, onMove, onEdit, onRemove, onAddLink, onRemoveLink, onShowSource, boardRef, autoEditId }) {
  const canvas = useRef(null), nodes = useRef(new Map());
  const [sizes, setSizes] = useState({}), [drag, setDrag] = useState(null), [editing, setEditing] = useState(null);
  const [linkFrom, setLinkFrom] = useState(null), [pickedLink, setPickedLink] = useState(null);

  // 쪽지 높이를 재서 선과 보드 크기를 맞춘다.
  useLayoutEffect(() => {
    const measure = () => {
      const next = {}; let changed = false;
      for (const [id, node] of nodes.current) if (node) next[id] = node.offsetHeight;
      setSizes(previous => {
        const keys = Object.keys(next);
        changed = keys.length !== Object.keys(previous).length || keys.some(id => previous[id] !== next[id]);
        return changed ? next : previous;
      });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    for (const node of nodes.current.values()) if (node) observer.observe(node);
    return () => observer.disconnect();
  }, [board.cards, editing, selectedId]);

  useEffect(() => { if (boardRef) boardRef.current = { canvas: canvas.current, sizes }; }, [boardRef, sizes]);
  useEffect(() => { if (autoEditId) setEditing(autoEditId); }, [autoEditId]);
  useEffect(() => { if (editing && !board.cards.some(card => card.id === editing)) setEditing(null); }, [board.cards, editing]);

  const position = useCallback(card => (drag?.id === card.id ? { x: drag.x, y: drag.y } : { x: card.x, y: card.y }), [drag]);
  const extent = useMemo(() => {
    let width = 1100, height = 520;
    for (const card of board.cards) { const at = position(card); width = Math.max(width, at.x + CARD_W + 80); height = Math.max(height, at.y + (sizes[card.id] || 120) + 96); }
    return { width, height };
  }, [board.cards, sizes, position]);
  const center = card => { const at = position(card); return { x: at.x + CARD_W / 2, y: at.y + (sizes[card.id] || 100) / 2 }; };
  const byId = useMemo(() => new Map(board.cards.map(card => [card.id, card])), [board.cards]);

  const startDrag = (event, card) => {
    if (readOnly || editing === card.id || event.button !== 0 || event.target.closest('button,textarea,input,a')) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({ id: card.id, x: card.x, y: card.y, startX: event.clientX, startY: event.clientY, baseX: card.x, baseY: card.y, moved: false });
  };
  const moveDrag = event => {
    if (!drag) return;
    const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
    setDrag({ ...drag, x: Math.max(0, drag.baseX + dx), y: Math.max(0, drag.baseY + dy), moved: drag.moved || Math.abs(dx) + Math.abs(dy) > 3 });
  };
  // 놓는 순간의 자리로 끝낸다(마지막 움직임 신호가 빠져도 놓은 곳에 놓이게).
  const endDrag = event => {
    if (!drag) return;
    const dx = event?.clientX != null ? event.clientX - drag.startX : drag.x - drag.baseX, dy = event?.clientY != null ? event.clientY - drag.startY : drag.y - drag.baseY;
    if (drag.moved || Math.abs(dx) + Math.abs(dy) > 3) onMove(drag.id, Math.round(Math.max(0, drag.baseX + dx)), Math.round(Math.max(0, drag.baseY + dy)));
    setDrag(null);
  };

  const pick = card => {
    setPickedLink(null);
    if (linkFrom && linkFrom !== card.id) { onAddLink(linkFrom, card.id); setLinkFrom(null); onSelect(card.id); return; }
    onSelect(card.id);
  };
  const cardKeys = (event, card) => {
    if (event.target !== event.currentTarget) return;
    const move = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] }[event.key];
    if (move && !readOnly) { event.preventDefault(); onSelect(card.id); onMove(card.id, Math.max(0, card.x + move[0]), Math.max(0, card.y + move[1])); return; }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (linkFrom) pick(card); else if (selectedId === card.id && !readOnly) setEditing(card.id); else pick(card); }
    if ((event.key === 'Delete' || event.key === 'Backspace') && !readOnly) { event.preventDefault(); onRemove(card.id); }
    if (event.key === 'Escape') { setLinkFrom(null); onSelect(null); }
  };

  return (
    <div className="mtb-wrap" data-board-wrap>
      {linkFrom && <p className="mtb-hint" role="status">이을 쪽지를 누르세요. <LinkButton onClick={() => setLinkFrom(null)}>잇기 그만두기</LinkButton></p>}
      <div ref={canvas} className="mtb-canvas" style={{ width: extent.width, height: extent.height }} data-board-canvas
        onPointerDown={event => { if (event.target === event.currentTarget) { onSelect(null); setPickedLink(null); } }}>
        <svg className="mtb-lines" width={extent.width} height={extent.height} aria-hidden="true">
          {board.links.map(link => {
            const a = byId.get(link.from), b = byId.get(link.to); if (!a || !b) return null;
            const p = center(a), q = center(b), picked = pickedLink === link.id;
            return (
              <g key={link.id} data-link={link.id}>
                <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} className={picked ? 'mtb-line on' : 'mtb-line'} />
                {!readOnly && <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="mtb-line-hit" onPointerDown={event => { event.stopPropagation(); setPickedLink(link.id); onSelect(null); }} />}
                {link.label && <text x={(p.x + q.x) / 2} y={(p.y + q.y) / 2 - 6} textAnchor="middle" className="mtb-line-label">{link.label}</text>}
              </g>
            );
          })}
        </svg>
        {pickedLink && !readOnly && (() => {
          const link = board.links.find(row => row.id === pickedLink); const a = link && byId.get(link.from), b = link && byId.get(link.to);
          if (!a || !b) return null; const p = center(a), q = center(b);
          return <div className="mtb-line-act" style={{ left: (p.x + q.x) / 2 - 40, top: (p.y + q.y) / 2 + 4 }}><Button size="sm" variant="danger" onClick={() => { onRemoveLink(link.id); setPickedLink(null); }}>선 지우기</Button></div>;
        })()}
        {board.cards.map(card => {
          const at = position(card), selected = selectedId === card.id, isEditing = editing === card.id;
          return (
            <div key={card.id} ref={node => { if (node) nodes.current.set(card.id, node); else nodes.current.delete(card.id); }}
              className={`mtb-card mtb-${card.type}${selected ? ' on' : ''}${drag?.id === card.id ? ' drag' : ''}${linkFrom === card.id ? ' linking' : ''}`}
              style={{ left: at.x, top: at.y, width: CARD_W }} data-card={card.id} data-type={card.type}
              tabIndex={0} role="group" aria-label={`${CARD_TYPE_LABEL[card.type]} 쪽지: ${card.text}`}
              onPointerDown={event => startDrag(event, card)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => setDrag(null)}
              onClick={event => { if (!event.target.closest('button,textarea,input')) pick(card); }}
              onDoubleClick={() => { if (!readOnly) { onSelect(card.id); setEditing(card.id); } }}
              onKeyDown={event => cardKeys(event, card)}>
              <div className="mtb-kind">{CARD_TYPE_LABEL[card.type]}</div>
              {isEditing
                ? <CardEditor card={card} onCancel={() => { setEditing(null); nodes.current.get(card.id)?.focus(); }} onApply={patch => { if (patch.text) onEdit(card.id, patch); setEditing(null); nodes.current.get(card.id)?.focus(); }} />
                : <p className="mtb-text">{card.text}</p>}
              {!isEditing && card.type === 'action' && (
                <div className="mtb-meta">
                  {card.owner ? <span>담당 {card.owner}</span> : <span className="mtb-flag">담당 확인 필요</span>}
                  {card.due ? <span>기한 {card.due}</span> : <span className="mtb-flag">기한 확인 필요</span>}
                </div>
              )}
              {!isEditing && card.origin === 'ai' && !card.quote && <div className="mtb-meta"><span className="mtb-flag">원문 확인 필요</span></div>}
              {!isEditing && selected && (
                <div className="mtb-acts">
                  {!readOnly && <LinkButton data-act="edit" onClick={() => setEditing(card.id)}>고치기</LinkButton>}
                  {card.quote && <LinkButton data-act="source" onClick={event => onShowSource(card, event.currentTarget)}>원문 보기</LinkButton>}
                  {!readOnly && <LinkButton data-act="link" onClick={() => setLinkFrom(card.id)}>잇기</LinkButton>}
                  {!readOnly && <LinkButton data-act="remove" onClick={() => onRemove(card.id)}>지우기</LinkButton>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
