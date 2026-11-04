// lib/pmFaces.js — /pm 캐릭터 표정(얼굴 레이어) 목록·연동 규칙(순수 함수). 급여·평가 무관, 긍정·중립 위주.
//   2D: 표정별 얼굴 레이어 public/pm-char/face/<id>.webp (+ sit) — layers.json faces. 렌더 전이면 기본 smile(face.webp)로 폴백.
//   3D: 같은 id 를 블렌더 face_human(expr) 가 받는다(텍스처 스왑 대신 눈·입 메시 변형 — scripts/pm-char/build.py FACES).
//   연동 우선순위: 춤 > 이모트 > 작업 분위기(vibe) > 직원이 고른 기본 표정(defaultFace) > smile.

export const PM_FACES = Object.freeze([
  ['smile', '기본 미소'],
  ['grin', '활짝 웃음'],
  ['focus', '집중(꾹 다문 입)'],
  ['wow', '놀람'],
  ['wink', '윙크'],
  ['sleepy', '졸림(반쯤 감김)'],
  ['fire', '열정(불타는 눈)'],
  ['proud', '뿌듯'],
  ['shy', '수줍'],
  ['teary', '울상'],
  ['sing', '노래(흥얼)'],
  ['thinking', '생각(올려다봄)'],
]);
export const PM_FACE_IDS = Object.freeze(PM_FACES.map(([id]) => id));

// 작업 분위기(lib/pmMood vibe) → 표정. 울상(teary)은 자동 연동에 쓰지 않는다(부정 과하지 않게 — 직원이 기본 표정으로 고를 때만).
export const VIBE_FACE = Object.freeze({ blaze: 'fire', focus: 'focus', busy: 'focus', work: 'smile', break: 'smile', doze: 'sleepy', idle: '' });
// 이모트 → 표정(머리 위 말풍선과 얼굴이 같이 바뀜)
export const EMOTE_FACE = Object.freeze({
  joy: 'grin', wow: 'wow', heart: 'grin', sweat: 'focus', sparkle: 'proud', think: 'thinking', fighting: 'fire',
  star: 'proud', music: 'sing', idea: 'wow', coffee: 'smile', zzz: 'sleepy', flower: 'shy', party: 'grin',
});
const DANCE_FACE = 'grin'; // 춤추는 동안은 활짝

export function isFaceId(id) { return PM_FACE_IDS.includes(String(id || '')); }

// 지금 보여줄 표정 하나. 모두 비면 '' (렌더러가 defaultFace→smile 처리).
export function faceOf({ dance = '', emote = '', vibe = '', defaultFace = '' } = {}) {
  if (dance) return DANCE_FACE;
  if (emote && EMOTE_FACE[emote]) return EMOTE_FACE[emote];
  if (vibe && VIBE_FACE[vibe]) return VIBE_FACE[vibe];
  return isFaceId(defaultFace) ? defaultFace : '';
}
