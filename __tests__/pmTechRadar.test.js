// __tests__/pmTechRadar.test.js — /pm/radar 기술 레이더: 파일 전용·읽기 전용·메뉴 등록·UI 키트 버튼만 사용
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const api = read('pages/api/pm/radar.js');
assert.ok(/featureFilePath\('tech-radar'\)/.test(api), 'runtime 파일 읽기');
assert.ok(/verifyReqUser/.test(api), '로그인 필요');
assert.ok(!/lib\/db|mssql|query\(/.test(api), 'MSSQL 미접근');
assert.ok(/'GET only'/.test(api), 'GET 전용');
const page = read('pages/pm/radar.js');
assert.ok(!/<button/.test(page), 'raw <button> 금지(UI 키트만)');
assert.ok(/from '\.\.\/\.\.\/components\/pm\/ui'/.test(page), 'UI 키트 import');
assert.ok(!/components\/Layout/.test(page), '공통 Layout 직접 import 금지');
assert.ok(/href: '\/pm\/radar'/.test(read('components/Layout.js')), '메뉴 등록');
assert.ok(/'tech-radar'/.test(read('lib/workFeatureData.js')), '수신 이름 등록');
// 수집기 추가 필드(2026-11-12): 찾은 곳·이미 사용 중·재평가·시험 후보(대기) 꼬리표 + 시험 결과 요약. 모두 선택 필드.
for (const f of ['sourceLabel', 'inUse', 'resurfaced', 'actionLlm', 'pilotResult']) assert.ok(page.includes('x.' + f), f + ' 표시');
for (const t of ['이미 사용 중', '재평가', '시험 후보(대기)', '찾은 곳', '시험 결과', 'GitHub 에서 보기']) assert.ok(page.includes(t), t + ' 문구');
assert.ok(page.includes("typeof x.sourceLabel === 'string'"), 'sourceLabel 없는 예전 항목 방어');
assert.ok(page.includes('if (!hasTags(x)) return null'), '새 필드 없는 항목은 꼬리표 줄 없음');
// 업로드·조회 경로는 모르는 필드를 걸러내지 않는다(받은 그대로 저장·전달) — 필드 허용 목록이 생기면 위 필드를 통과시켜야 한다.
assert.ok(read('lib/workFeatureData.js').includes('fs.writeFileSync(tmp, buffer)'), '업로드는 원본 그대로 저장(필드 미변형)');
assert.ok(api.includes('json({ success: true, data })'), '조회도 원본 그대로 전달');
console.log('pmTechRadar ok');
