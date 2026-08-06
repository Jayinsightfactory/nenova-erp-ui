import fs from 'node:fs';
import assert from 'node:assert/strict';

const api = fs.readFileSync(new URL('../pages/api/arrival-cost/index.js', import.meta.url), 'utf8');
const lib = fs.readFileSync(new URL('../lib/arrivalCost.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../pages/arrival-cost.js', import.meta.url), 'utf8');

assert.match(api, /lookup === 'farms'/, '농장 검색은 별도 lookup 모드여야 합니다.');
assert.match(api, /pageSize: req\.query\.pageSize/, '도착원가 목록은 페이지 크기를 API에서 받습니다.');
assert.match(lib, /OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY/, '원가 목록은 서버 페이징을 사용해야 합니다.');
assert.match(lib, /COUNT_BIG\(\*\) OVER\(\) AS TotalCount/, '원가 목록은 전체 건수를 함께 반환해야 합니다.');
assert.match(lib, /AutoFarmKey/, '원본 농장명과 일치하는 전산 농장 자동 후보를 표시해야 합니다.');
assert.doesNotMatch(lib, /SELECT ProdKey, ProdCode, ProdName, DisplayName, FlowerName, CounName, OutUnit, SteamOf1Box, BoxWeight, BoxCBM\s+FROM dbo\.Product WHERE isDeleted=0 ORDER BY/, '목록 조회에서 전체 품목 마스터를 내려보내면 안 됩니다.');
assert.doesNotMatch(page, /<datalist id="arrival-product-options">/, '전체 품목 datalist를 렌더링하면 안 됩니다.');
assert.match(page, /\/api\/products\/search\?q=/, '도착원가 품목검색은 공용 사용량 기반 검색 API를 사용해야 합니다.');
assert.match(page, /pageSize.*200/, '도착원가 화면은 한 번에 제한된 행만 렌더링해야 합니다.');

console.log('arrival cost performance contract tests passed');
