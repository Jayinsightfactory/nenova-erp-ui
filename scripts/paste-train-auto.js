#!/usr/bin/env node
/**
 * paste-train-auto.js — 큐의 명확한 항목을 자동 매핑
 *
 * 규칙:
 *   1) 단일 후보 → 자동 선택
 *   2) 1위 단독 (2위와 격차 ≥ 2) → 자동 선택
 *   3) 1·2위 동점이지만 1위에 변형 키워드(Mini/Jumbo/Big/Pro/Garden/Premium 등)가
 *      있고 토큰에는 해당 키워드가 없을 때 → 변형 없는 후보 선택
 *   4) 그 외 (진짜 모호) → 큐에 남김, 수동 처리 대상
 *
 * 옵션:
 *   --dry       실제 저장 없이 통계만
 *   --apply     실제 매핑 저장 (기본값)
 */

const fs = require('fs');                                                     // 파일 읽기/쓰기
const path = require('path');                                                 // 경로 유틸

const ROOT = path.resolve(__dirname, '..');                                   // 프로젝트 루트
const MAP_FILE = path.join(ROOT, 'data', 'order-mappings.json');              // 학습된 매핑 저장 파일
const QUEUE_FILE = path.join(ROOT, 'data', '.train-queue.json');              // 큐 파일

// ── JSON 로드/저장 헬퍼 ───────────────────────────────────────
function loadJson(file, fallback = {}) {                                      // 안전한 JSON 로드
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveJson(file, data) {                                               // JSON 저장
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
function normalize(s) { return (s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }  // 공백/대소문자 정규화

// 변형 키워드: 후보 이름에 있으면 일반 품목보다 우선순위 낮춤
const VARIANT_KEYWORDS = [
  'mini', 'jumbo', 'big', 'garden', 'premium', 'super', 'large',              // 영문 변형
  '미니', '점보', '빅', '가든', '프리미엄',                                    // 한글 변형
];

// 토큰에 변형 키워드가 있는지 확인 (예: "수국 미니 화이트"면 Mini 후보 허용)
function tokenHasVariant(token, keyword) {
  return normalize(token).includes(normalize(keyword));
}

// 후보 이름에 변형 키워드가 있는지 확인
function candidateHasVariant(cand) {
  const name = normalize([cand.prodName, cand.displayName].filter(Boolean).join(' '));
  for (const kw of VARIANT_KEYWORDS) {
    if (name.includes(normalize(kw))) return kw;                              // 발견된 변형 키워드 반환
  }
  return null;                                                                // 변형 없음
}

// 자동 선택 로직: 성공 시 인덱스, 실패 시 -1 반환
function autoPick(item) {
  const cands = item.candidates;                                              // 후보 목록
  if (!cands || cands.length === 0) return -1;                                // 후보 없으면 패스
  if (cands.length === 1) return 0;                                           // 단일 후보 → 선택

  const top = cands[0];                                                       // 1위 후보
  const second = cands[1];                                                    // 2위 후보

  // 규칙 2: 1위가 단독 (격차 ≥ 2) → 선택
  if (top.score - second.score >= 2) {
    // 다만 1위가 변형인데 토큰에 해당 변형 없으면 주의
    const variant = candidateHasVariant(top);
    if (variant && !tokenHasVariant(item.token, variant)) {
      // 2위가 변형 없으면 2위 선택 (1위 격차 있어도)
      if (!candidateHasVariant(second)) return 1;
      return -1;                                                              // 둘 다 변형이면 모호
    }
    return 0;                                                                 // 1위 선택
  }

  // 규칙 3: 동점에서 변형 회피
  if (top.score === second.score) {
    const topVariant = candidateHasVariant(top);                              // 1위 변형 여부
    const secondVariant = candidateHasVariant(second);                        // 2위 변형 여부
    const tokenVariants = VARIANT_KEYWORDS.filter(kw => tokenHasVariant(item.token, kw));
    const tokenWantsVariant = tokenVariants.length > 0;                       // 토큰이 변형 원함?

    if (tokenWantsVariant) {
      // 토큰이 "미니" 등을 요청 → 변형 있는 후보 우선
      if (topVariant) return 0;
      if (secondVariant) return 1;
      return -1;
    } else {
      // 토큰이 일반 품목 요청 → 변형 없는 후보 우선
      if (!topVariant) return 0;                                              // 1위가 일반이면 1위
      if (!secondVariant) return 1;                                           // 2위가 일반이면 2위
      return -1;                                                              // 둘 다 변형이면 모호
    }
  }

  // 규칙 4: 격차 1점 — 토큰·1위 모두 변형 키워드 없을 때만 1위 선택
  if (top.score - second.score === 1) {
    const topVariant = candidateHasVariant(top);                              // 1위 변형 여부
    const tokenVariants = VARIANT_KEYWORDS.filter(kw => tokenHasVariant(item.token, kw));
    if (!topVariant && tokenVariants.length === 0) return 0;                  // 둘 다 변형 없음 → 1위
  }

  // 그 외 → 모호 (수동 처리)
  return -1;
}

function main() {                                                             // 메인 실행
  const args = process.argv.slice(2);                                         // CLI 인자
  const dry = args.includes('--dry');                                         // 드라이 런 여부

  const queue = loadJson(QUEUE_FILE, null);                                   // 큐 로드
  if (!queue || !Array.isArray(queue.items)) {                                // 큐 없으면 종료
    console.error('❌ 큐 없음:', QUEUE_FILE);
    process.exit(1);
  }
  const mappings = loadJson(MAP_FILE, {});                                    // 기존 매핑 로드
  const initial = Object.keys(mappings).length;                               // 시작 시 매핑 수

  let picked = 0;                                                             // 자동 선택된 수
  let skipped = 0;                                                            // 모호해서 건너뛴 수
  let already = 0;                                                            // 이미 처리된 수
  const ambiguous = [];                                                       // 모호한 항목 목록

  for (const item of queue.items) {                                           // 모든 항목 순회
    if (item.processed) { already++; continue; }                              // 이미 처리됨 → 스킵
    const key = normalize(item.token);                                        // 토큰 키
    if (mappings[key]) {                                                      // 기존 매핑 있으면 재사용
      item.processed = true;
      item.selected = mappings[key].prodKey;
      already++;
      continue;
    }

    const idx = autoPick(item);                                               // 자동 선택 시도
    if (idx === -1) {                                                         // 모호 → 큐에 남김
      skipped++;
      ambiguous.push({
        token: item.token,
        header: item.header,
        top: item.candidates.slice(0, 3).map(c => `[${c.score}] ${c.prodName}`),
      });
      continue;
    }

    const picked_cand = item.candidates[idx];                                 // 선택된 후보
    mappings[key] = {                                                         // 매핑에 저장
      prodKey: picked_cand.prodKey,
      prodName: picked_cand.prodName,
      displayName: picked_cand.displayName,
      flowerName: picked_cand.flowerName,
      counName: picked_cand.counName,
      savedAt: new Date().toISOString(),
      auto: true,                                                             // 자동 선택 마크
    };
    item.processed = true;                                                    // 처리 완료
    item.selected = picked_cand.prodKey;                                      // 선택된 키 저장
    picked++;
  }

  console.log('==================================================');
  console.log(dry ? '드라이런 결과' : '자동 매핑 결과');
  console.log('==================================================');
  console.log(`전체 큐 항목: ${queue.items.length}`);
  console.log(`이미 처리됨 (기존 매핑 포함): ${already}`);
  console.log(`자동 매핑 성공: ${picked}`);
  console.log(`모호 (수동 필요): ${skipped}`);
  console.log(`매핑 증가: ${initial} → ${Object.keys(mappings).length} (+${Object.keys(mappings).length - initial})`);

  if (!dry) {                                                                 // 실제 저장
    saveJson(MAP_FILE, mappings);
    saveJson(QUEUE_FILE, queue);
    console.log(`\n💾 저장: ${MAP_FILE}`);
    console.log(`💾 저장: ${QUEUE_FILE}`);
    console.log(`\n▶ 남은 수동 처리: node scripts/paste-train.js --queue`);
  } else {
    console.log('\n(--dry 모드 — 저장 안 함)');
  }

  // 모호 항목 샘플 출력
  if (ambiguous.length > 0) {
    console.log(`\n── 모호 항목 샘플 (앞 10개) ──`);
    ambiguous.slice(0, 10).forEach((a, i) => {
      console.log(`${i + 1}. "${a.token}" (${a.header})`);
      a.top.forEach(t => console.log(`   ${t}`));
    });
  }
}

main();
