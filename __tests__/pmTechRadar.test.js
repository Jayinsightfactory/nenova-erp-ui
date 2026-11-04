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
console.log('pmTechRadar ok');
