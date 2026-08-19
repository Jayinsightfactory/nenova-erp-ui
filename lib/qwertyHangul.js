// 영문 키보드(두벌식) 입력을 한글로 조립한다.
// 브라우저가 한/영 키를 강제 전환하지 못하므로, 거래처 검색처럼
// 한글 이름이 기본인 입력칸에서 영타를 한글로 바꿔 보여 준다.

const KEY_TO_JAMO = {
  q: 'ㅂ', Q: 'ㅃ', w: 'ㅈ', W: 'ㅉ', e: 'ㄷ', E: 'ㄸ', r: 'ㄱ', R: 'ㄲ',
  t: 'ㅅ', T: 'ㅆ', y: 'ㅛ', u: 'ㅕ', i: 'ㅑ', o: 'ㅐ', O: 'ㅒ', p: 'ㅔ', P: 'ㅖ',
  a: 'ㅁ', s: 'ㄴ', d: 'ㅇ', f: 'ㄹ', g: 'ㅎ', h: 'ㅗ', j: 'ㅓ', k: 'ㅏ', l: 'ㅣ',
  z: 'ㅋ', x: 'ㅌ', c: 'ㅊ', v: 'ㅍ', b: 'ㅠ', n: 'ㅜ', m: 'ㅡ',
};

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const JONG = 'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';

const COMPLEX_VOWEL = {
  ㅗㅏ: 'ㅘ', ㅗㅐ: 'ㅙ', ㅗㅣ: 'ㅚ',
  ㅜㅓ: 'ㅝ', ㅜㅔ: 'ㅞ', ㅜㅣ: 'ㅟ',
  ㅡㅣ: 'ㅢ',
};

const COMPLEX_JONG = {
  ㄱㅅ: 'ㄳ', ㄴㅈ: 'ㄵ', ㄴㅎ: 'ㄶ',
  ㄹㄱ: 'ㄺ', ㄹㅁ: 'ㄻ', ㄹㅂ: 'ㄼ', ㄹㅅ: 'ㄽ', ㄹㅌ: 'ㄾ', ㄹㅍ: 'ㄿ', ㄹㅎ: 'ㅀ',
  ㅂㅅ: 'ㅄ',
};

const JONG_SPLIT = Object.fromEntries(
  Object.entries(COMPLEX_JONG).map(([pair, composed]) => [composed, [pair[0], pair[1]]]),
);

function isJung(j) {
  return JUNG.includes(j);
}

function isCho(j) {
  return CHO.includes(j);
}

function canBeJong(j) {
  return JONG.includes(j);
}

function compose(cho, jung, jong) {
  const ci = CHO.indexOf(cho);
  const ji = JUNG.indexOf(jung);
  const yi = jong ? JONG.indexOf(jong) + 1 : 0;
  if (ci < 0 || ji < 0 || yi < 0) return `${cho || ''}${jung || ''}${jong || ''}`;
  return String.fromCharCode(0xAC00 + ci * 21 * 28 + ji * 28 + yi);
}

function flushSyllable(cho, jung, jong) {
  if (cho && jung) return compose(cho, jung, jong);
  return `${cho || ''}${jung || ''}${jong || ''}`;
}

export function assembleHangulJamo(jamoText = '') {
  let out = '';
  let cho = '';
  let jung = '';
  let jong = '';

  const commit = () => {
    if (!cho && !jung && !jong) return;
    out += flushSyllable(cho, jung, jong);
    cho = '';
    jung = '';
    jong = '';
  };

  for (const j of String(jamoText)) {
    if (isJung(j)) {
      if (cho && jung && jong) {
        const split = JONG_SPLIT[jong];
        if (split) {
          out += compose(cho, jung, split[0]);
          cho = split[1];
          jung = j;
          jong = '';
        } else {
          out += compose(cho, jung, '');
          cho = jong;
          jung = j;
          jong = '';
        }
      } else if (cho && jung && !jong) {
        const comb = COMPLEX_VOWEL[jung + j];
        if (comb) jung = comb;
        else {
          commit();
          jung = j;
        }
      } else if (cho && !jung) {
        jung = j;
      } else {
        commit();
        jung = j;
      }
      continue;
    }

    if (isCho(j)) {
      if (cho && jung && !jong) {
        if (canBeJong(j)) jong = j;
        else {
          commit();
          cho = j;
        }
      } else if (cho && jung && jong) {
        const comb = COMPLEX_JONG[jong + j];
        if (comb) jong = comb;
        else {
          commit();
          cho = j;
        }
      } else if (!cho) {
        cho = j;
      } else {
        out += cho;
        cho = j;
      }
      continue;
    }

    commit();
    out += j;
  }

  commit();
  return out;
}

export function qwertyToHangul(text = '') {
  const mapped = [...String(text)].map((ch) => KEY_TO_JAMO[ch] || ch).join('');
  return assembleHangulJamo(mapped);
}

/** 이미 한글이 있으면 그대로 두고, 영문 키입력만 한글로 바꾼다. */
export function convertQwertyInputToHangul(raw = '') {
  const s = String(raw ?? '');
  if (!s) return s;
  if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(s)) return s;
  if (!/[a-zA-Z]/.test(s)) return s;
  const converted = qwertyToHangul(s);
  return converted || s;
}
