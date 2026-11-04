// lib/pmFxShop.js — 상점 manifest 에 스킬·탈것 품목을 붙이고(withFx), 성장 단계 해금을 검사한다(순수 함수).
//   가격·해금은 서버 lib 데이터에서만(클라이언트 값 무시). 자유이용권 중엔 단계 잠금도 풀린다(꾸미기와 같은 규칙).
import { skillShopItems } from './pmSkills';
import { mountShopItems } from './pmMounts';

export function withFx(manifest) {
  if (!manifest) return manifest;
  return { ...manifest, skills: skillShopItems(), mounts: mountShopItems() };
}
// items 중 아직 단계가 안 된 스킬·탈것 id 목록
export function fxStageLocked(items, stage, passActive) {
  if (passActive) return [];
  const all = new Map([...skillShopItems(), ...mountShopItems()].map((x) => [x.id, x]));
  return Object.values(items || {}).filter((id) => all.has(id) && all.get(id).unlockStage > (Number(stage) || 1));
}
