// 회의정리 보드를 그림(PNG)으로 만든다. 화면에 보이는 쪽지의 색·자리·크기를 그대로 읽어 캔버스에 다시 그린다.
import { CARD_TYPE_LABEL, CARD_W } from '../../lib/meetingBoard';

function wrap(ctx, text, maxWidth) {
  const lines = [];
  for (const raw of String(text || '').split('\n')) {
    let line = '';
    for (const ch of raw) {
      if (ctx.measureText(line + ch).width > maxWidth && line) { lines.push(line); line = ch.trim() ? ch : ''; } else line += ch;
    }
    lines.push(line);
  }
  return lines;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export function renderBoardCanvas({ board, canvasNode, meta }) {
  const style = node => window.getComputedStyle(node);
  const base = style(canvasNode), font = base.fontFamily || 'sans-serif';
  const ink = base.color, muted = style(canvasNode.querySelector('.mtb-kind') || canvasNode).color;
  const HEAD = 84, PAD = 24, scale = 2;
  const drawn = board.cards.map(card => {
    const node = canvasNode.querySelector(`[data-card="${card.id}"]`); const css = node ? style(node) : null;
    return { card, height: node ? node.offsetHeight : 120, fill: css?.backgroundColor || 'white', stroke: css?.borderTopColor || ink };
  });
  let width = 900, height = 300;
  for (const { card, height: h } of drawn) { width = Math.max(width, card.x + CARD_W + PAD * 2); height = Math.max(height, card.y + h + PAD * 2); }
  const out = document.createElement('canvas'); out.width = width * scale; out.height = (height + HEAD) * scale;
  const ctx = out.getContext('2d'); ctx.scale(scale, scale);
  ctx.fillStyle = base.backgroundColor && base.backgroundColor !== 'rgba(0, 0, 0, 0)' ? base.backgroundColor : 'white'; ctx.fillRect(0, 0, width, height + HEAD);
  ctx.fillStyle = ink; ctx.textBaseline = 'top'; ctx.font = `700 22px ${font}`; ctx.fillText(meta.title || '회의정리', PAD, 22);
  ctx.fillStyle = muted; ctx.font = `400 13px ${font}`; ctx.fillText([meta.date, meta.attendees && `참석 ${meta.attendees}`].filter(Boolean).join(' · ').slice(0, 120), PAD, 54);
  ctx.translate(0, HEAD);
  const mid = new Map(drawn.map(({ card, height: h }) => [card.id, { x: card.x + CARD_W / 2, y: card.y + h / 2 }]));
  ctx.strokeStyle = muted; ctx.lineWidth = 1.5; ctx.font = `400 12px ${font}`; ctx.textAlign = 'center';
  for (const link of board.links) {
    const p = mid.get(link.from), q = mid.get(link.to); if (!p || !q) continue;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    if (link.label) { ctx.fillStyle = muted; ctx.fillText(link.label, (p.x + q.x) / 2, (p.y + q.y) / 2 - 16); }
  }
  ctx.textAlign = 'left';
  for (const { card, height: h, fill, stroke } of drawn) {
    roundRect(ctx, card.x, card.y, CARD_W, h, 8); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke();
    ctx.save(); roundRect(ctx, card.x, card.y, CARD_W, h, 8); ctx.clip();
    let y = card.y + 10;
    ctx.fillStyle = muted; ctx.font = `700 12px ${font}`; ctx.fillText(CARD_TYPE_LABEL[card.type], card.x + 12, y); y += 22;
    ctx.fillStyle = ink; ctx.font = `${card.type === 'topic' ? 700 : 400} 14px ${font}`;
    for (const line of wrap(ctx, card.text, CARD_W - 24)) { ctx.fillText(line, card.x + 12, y); y += 21; }
    ctx.font = `400 12px ${font}`; ctx.fillStyle = muted;
    if (card.type === 'action') { y += 4; ctx.fillText(`담당 ${card.owner || '확인 필요'} · 기한 ${card.due || '확인 필요'}`.slice(0, 34), card.x + 12, y); }
    ctx.restore();
  }
  return out;
}

export function downloadBoardPng(args, fileName) {
  return new Promise((resolve, reject) => {
    try {
      renderBoardCanvas(args).toBlob(blob => {
        if (!blob) return reject(new Error('empty'));
        const url = URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url; link.download = fileName; document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000); resolve(blob.size);
      }, 'image/png');
    } catch (error) { reject(error); }
  });
}

// 인쇄: 보드 그림 한 장을 숨은 틀에 넣어 종이 너비에 맞춰 인쇄한다(왼쪽 메뉴·버튼은 인쇄되지 않는다).
export function printBoard(args) {
  const data = renderBoardCanvas(args).toDataURL('image/png');
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true'); frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open(); doc.write('<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>회의정리</title><style>@page{size:A4 landscape;margin:10mm}body{margin:0}img{max-width:100%;max-height:185mm}</style></head><body><img alt="회의정리 보드"></body></html>'); doc.close();
  const image = doc.querySelector('img');
  image.onload = () => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 60000); };
  image.src = data;
}
