import fs from 'node:fs';
import assert from 'node:assert/strict';

const api = fs.readFileSync(new URL('../pages/api/arrival-cost/index.js', import.meta.url), 'utf8');
const lib = fs.readFileSync(new URL('../lib/arrivalCost.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../pages/arrival-cost.js', import.meta.url), 'utf8');

assert.match(api, /lookup === 'farms'/, '농장 검색은 별도 lookup 모드여야 합니다.');
assert.match(api, /pageSize: req\.query\.pageSize/, '도착원가 목록은 페이지 크기를 API에서 받습니다.');
assert.match(lib, /OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY/, '원가 목록은 서버 페이징을 사용해야 합니다.');
assert.match(lib, /COUNT_BIG\(\*\) OVER\(\)/, '원가 목록은 전체 건수를 함께 반환해야 합니다.');
assert.doesNotMatch(lib, /SELECT l\.\*/, '목록 조회는 RawJson NVARCHAR(MAX)를 포함하면 안 됩니다.');
assert.match(lib, /skipUsageScan/, '품목 검색 시 OrderDetail 사용량 전수 스캔을 건너뛰어야 합니다.');
assert.match(lib, /AutoFarmKey/, '원본 농장명과 일치하는 전산 농장 자동 후보를 표시해야 합니다.');
assert.doesNotMatch(lib, /SELECT ProdKey, ProdCode, ProdName, DisplayName, FlowerName, CounName, OutUnit, SteamOf1Box, BoxWeight, BoxCBM\s+FROM dbo\.Product WHERE isDeleted=0 ORDER BY/, '목록 조회에서 전체 품목 마스터를 내려보내면 안 됩니다.');
assert.doesNotMatch(page, /<datalist id="arrival-product-options">/, '전체 품목 datalist를 렌더링하면 안 됩니다.');
assert.match(page, /\/api\/products\/search\?q=/, '도착원가 품목검색은 공용 사용량 기반 검색 API를 사용해야 합니다.');
assert.match(page, /pageSize.*200/, '도착원가 화면은 한 번에 제한된 행만 렌더링해야 합니다.');
assert.match(api, /lookup === 'varieties'/, '품종 버튼은 distinct 요약 API에서 가져와야 합니다.');
assert.match(lib, /week: \{ type: sql\.NVarChar, value:/, '품종 요약 SQL은 DB 헬퍼용 typed 연도·차수 파라미터를 사용해야 합니다.');
assert.match(lib, /wm\.OrderYear\)=@year AND wm\.OrderWeek=@week/, '입고 기대 품목은 연도와 차수를 함께 제한해야 합니다.');
assert.match(lib, /COST_NOT_UPLOADED/, '입고 기대 품목의 원가 누락 상태를 반환해야 합니다.');
assert.match(lib, /buildArrivalCostProductMatch/, '품목 검색은 매칭데이터 ProdKey를 사용해야 합니다.');
assert.match(lib, /UsageCount,0\)\s*\+\s*ISNULL\(matchStats\.MatchCount,0\)\*2/, '검색 전에는 사용량과 매칭량 우선순위를 적용해야 합니다.');
assert.doesNotMatch(lib, /l\.CountryName LIKE @country/, '국가는 검색 조건이 아니라 표시 컬럼이어야 합니다.');
assert.match(page, /requestRef\.current\.controller\?\.abort\(\)/, '오래된 목록 요청은 취소해야 합니다.');
assert.match(page, /role="tablist"/, '품종은 키보드 접근 가능한 탭으로 표시해야 합니다.');
assert.match(page, /원가 미업로드/, '누락 원가는 숨기거나 0원 처리하지 않고 배지로 표시해야 합니다.');
assert.match(lib, /weekSortSql/, '차수는 오름·내림 숫자 정렬이어야 합니다.');
assert.match(lib, /!hasProductSearch && !week && !flower/, '품종만 선택해도 목록을 조회할 수 있어야 합니다.');
assert.match(page, /weekOrder/, '화면이 차수 정렬 방향을 API에 넘겨야 합니다.');

console.log('arrival cost performance contract tests passed');
