// lib/pmZoom.js — /pm 장면(2D 배경·3D 베타) 배율 규칙. 휠 확대 없음 — +/−/맞춤 버튼·키보드만.
// 축소는 맞춤(1) 아래 ZOOM_MIN 까지 허용(사장님 지시: 100%에서 더 줄여 전체 보기).
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 3;
export const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(+z).toFixed(3)));
// 2D 뷰포트 {z,x,y} 보정: 확대 시 가장자리 안쪽, 축소(z<1) 시 가운데 정렬
export function clampView(v, hostW, hostH) {
  const z = clampZoom(v.z);
  const ax = (lim, val, size) => (z <= 1 ? (size - size * z) / 2 : Math.min(0, Math.max(lim, val)));
  return { z, x: ax(hostW - hostW * z, v.x, hostW), y: ax(hostH - hostH * z, v.y, hostH) };
}
export function zoomViewAt(v, factor, hostW, hostH, cx = hostW / 2, cy = hostH / 2) {
  const z = clampZoom(v.z * factor); const r = z / v.z;
  return clampView({ z, x: cx - (cx - v.x) * r, y: cy - (cy - v.y) * r }, hostW, hostH);
}
// 배율 바(슬라이더): 1% 단위, 40~300%. 드래그를 놓은 값이 그대로 유지된다(스냅 없음).
export const ZOOM_PCT_MIN = Math.round(ZOOM_MIN * 100);
export const ZOOM_PCT_MAX = Math.round(ZOOM_MAX * 100);
export const clampPct = (p) => Math.min(ZOOM_PCT_MAX, Math.max(ZOOM_PCT_MIN, Math.round(+p || 0)));
export const zoomToPct = (z) => clampPct(z * 100);
export const pctToZoom = (p) => clampZoom(clampPct(p) / 100);
// 2D: 배율을 pct(%)로 직접 지정(가운데 기준 유지)
export function zoomViewTo(v, pct, hostW, hostH, cx = hostW / 2, cy = hostH / 2) {
  const z = pctToZoom(pct); const r = z / (v.z || 1);
  return clampView({ z, x: cx - (cx - v.x) * r, y: cy - (cy - v.y) * r }, hostW, hostH);
}
// 3D 단계형 배율(+/− 0.2 단위)
export const stepZoom = (z, dir) => clampZoom(Math.round((z + dir * (z < 1 || (z === 1 && dir < 0) ? 0.2 : 0.5)) * 10) / 10);
// 장면 pointerup 이 팝오버를 닫아도 되는가: 장면 자체에서 시작된 누름(드래그 아님)일 때만.
// 버튼·팝오버 안에서 시작된 누름(drag 미기록)은 절대 닫지 않음 — 닫으면 버튼이 click 전에 언마운트됨.
export const shouldCloseOnUp = (drag) => !!drag && !drag.moved;
