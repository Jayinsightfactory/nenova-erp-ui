const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const { sortCustomerProducts, quantitiesMatch, buildForwardOrderWeeks, productAlphabetInitial } = await import('../lib/myCustomerOrderEntry.js');
  const rows = sortCustomerProducts([{ProdKey:1,FlowerName:'장미',UsageCount:2,ProdName:'B'},{ProdKey:2,FlowerName:'수국',UsageCount:7,ProdName:'A'},{ProdKey:3,FlowerName:'장미',UsageCount:8,ProdName:'A'}]);
  assert.deepEqual(rows.map(x=>x.ProdKey), [3,1,2]);
  const exeGroups = sortCustomerProducts([{ProdKey:4,FlowerName:'장미',CountryFlower:'중국장미',UsageCount:2},{ProdKey:5,FlowerName:'장미',CountryFlower:'콜롬비아장미',UsageCount:5}]);
  assert.deepEqual(exeGroups.map(x=>x.CountryFlower), ['콜롬비아장미','중국장미']);
  assert.equal(productAlphabetInitial({ProdName:'CARNATION Doncel'}), 'D');
  assert.equal(productAlphabetInitial({ProdName:'ROSE / Playa Blanca 50cm'}), 'P');
  assert.equal(productAlphabetInitial({ProdName:'Hydrangea G/ Esmeral'}), 'G');
  assert.equal(quantitiesMatch(2,2.00001), true); assert.equal(quantitiesMatch(2,3), false);
  const choices = buildForwardOrderWeeks(new Date(2026, 7, 11));
  assert.equal(choices[0].week, '30-01');
  assert.equal(choices[0].year, '2026');
  assert.equal(choices.find(c => c.default)?.week, '34-01');
  assert.deepEqual(choices.slice(8, 12), [
    {year:'2026',week:'34-01',label:'34-1',default:true}, {year:'2026',week:'34-02',label:'34-2',default:false},
    {year:'2026',week:'35-01',label:'35-1',default:false}, {year:'2026',week:'35-02',label:'35-2',default:false}
  ]);
  assert.equal(choices.at(-2).week, '39-01');
  const yearWrap = buildForwardOrderWeeks(new Date(2026, 0, 5));
  assert.deepEqual(yearWrap.slice(0, 4), [
    {year:'2025',week:'51-01',label:'51-1',default:false}, {year:'2025',week:'51-02',label:'51-2',default:false},
    {year:'2025',week:'52-01',label:'52-1',default:false}, {year:'2025',week:'52-02',label:'52-2',default:false}
  ]);
  assert.equal(yearWrap.find(c => c.default)?.year, '2026');
  assert.equal(yearWrap.find(c => c.default)?.week, '03-01');
  const api=fs.readFileSync('pages/api/orders/index.js','utf8'), own=fs.readFileSync('pages/api/orders/my-customers.js','utf8'), page=fs.readFileSync('pages/orders/my-customers.js','utf8'), menu=fs.readFileSync('components/Layout.js','utf8');
  assert.match(menu,/\/orders\/my-customers/); assert.match(page,/\/api\/products\/search/); assert.match(page,/expectedCurrentQty/);
  assert.match(page,/aria-pressed/); assert.doesNotMatch(page,/api\/orders\/weeks/);
  assert.match(api,/my-customer/); assert.match(api,/WITH \(UPDLOCK, HOLDLOCK\)/); assert.match(api,/OrderYear = @year/);
  assert.match(own,/xom\.OrderYear=@year AND xom\.OrderWeek=@week/); assert.doesNotMatch(page,/components\/Layout/);
  assert.match(own,/FROM Customer c/); assert.match(own,/ManagerName/); assert.doesNotMatch(own,/본인 담당 업체만 조회/);
  assert.match(api,/activeCustomer/); assert.doesNotMatch(api,/본인 담당 업체의 주문만 등록/);
  assert.match(own,/recent\.LastOrderDtm DESC/); assert.match(page,/visibleCustomers/); assert.match(page,/slice\(0, 30\)/);
  assert.doesNotMatch(own,/SUM\(CASE WHEN p\.OutUnit/); assert.match(own,/SUM\(ISNULL\(xod\.BoxQuantity,0\)\)/);
  assert.match(page,/scrollIntoView/); assert.match(page,/업체명·담당자 검색/);
  assert.match(page,/focusMode/); assert.match(page,/차수·업체 다시 선택/); assert.match(page,/selectedCustomer/);
  assert.match(page,/productGroups/); assert.match(page,/collapsedFlowers/); assert.match(page,/aria-expanded/); assert.match(page,/aria-controls/);
  assert.match(page,/수량 입력/); assert.match(page,/열기/); assert.match(page,/닫기/); assert.match(page,/visibleProducts/);
  assert.match(page,/customerCursor/); assert.match(page,/moveCustomer/); assert.match(page,/ArrowDown/); assert.match(page,/aria-activedescendant/);
  assert.match(page,/loadSequenceRef/); assert.match(page,/sequence !== loadSequenceRef\.current/);
  assert.match(page,/window\.alert\(resultMessage\)/); assert.match(page,/live-order/); assert.match(page,/입력 품목/); assert.match(page,/입력 수량 지우기/);
  assert.match(page,/className="product-name"/); assert.match(page,/white-space:nowrap/); assert.doesNotMatch(page,/<small>\{p\.CounName\} · \{p\.ProdName\}<\/small>/);
  assert.match(page,/entry-layout/); assert.match(page,/grid-template-columns:minmax\(0,1fr\) 280px/); assert.match(page,/flex-direction:column/); assert.match(page,/수량을 입력하면 이곳에 목록으로 표시됩니다/);
  assert.match(page,/filteredProductGroups/); assert.match(page,/현재 품종·품목 검색/); assert.match(page,/ALPHABET/); assert.match(page,/productAlphabetInitial/);
  assert.match(page,/weekChoices\.find\(w => w\.default\)/); assert.match(page,/현재 차수 -2부터 표시합니다/); assert.match(page,/기본 선택은 \+2차/);
  assert.match(page,/alphabet-bar/); assert.match(page,/product-scroll/); assert.match(page,/is-focus/);
  assert.match(page,/position:sticky;top:0;z-index:6/); assert.match(page,/\.product-scroll\{flex:1;min-height:0;overflow:auto\}/);
  assert.match(page,/검색 또는 알파벳 조건에 맞는 품목이 없습니다/);
  assert.match(page,/groupLabel/); assert.match(own,/p\.CountryFlower/); assert.match(own,/COALESCE\(NULLIF\(LTRIM\(RTRIM\(p\.CountryFlower\)\),''\)/);
  assert.match(page,/고정주문 불러오기/); assert.match(page,/ORDER_FAVORITE_PAGE/); assert.match(page,/apiDelete/);
  assert.match(page,/selectedTemplate/); assert.match(page,/주문내역/); assert.match(page,/이 주문 불러오기/);
  assert.match(page,/template-browser/); assert.match(page,/preview-pane/); assert.match(page,/주문을 선택하세요/);
  assert.match(page,/grid-template-columns:minmax\(470px,1fr\) minmax\(430px,1\.15fr\)/);
  assert.match(page,/pinned-favorites/); assert.match(page,/★ 고정 주문/); assert.match(page,/loadCustomerFavorites/);
  assert.match(page,/variety-nav/); assert.match(page,/품종 바로가기/); assert.match(page,/jumpToFlower/);
  assert.match(page,/groupRefs/); assert.match(page,/scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/);
  assert.doesNotMatch(page,/className="template-main" onClick=\{\(\)=>applyTemplate/);
  assert.match(page,/selectedCustomer\.OrderCode/); assert.match(page,/c\.OrderCode&&<mark>/);
  assert.match(own,/req\.query\.view === 'history'/); assert.match(own,/om\.OrderYear=@year AND om\.OrderWeek < @week/);
  assert.match(own,/om\.CustKey=@ck/); assert.doesNotMatch(own,/view === 'history'[\s\S]{0,2000}CustName LIKE/);
  const favoritesApi=fs.readFileSync('pages/api/favorites.js','utf8');
  const getFavoriteBlock=favoritesApi.slice(favoritesApi.indexOf("if (req.method === 'GET')"), favoritesApi.indexOf('await ensureTable();'));
  assert.doesNotMatch(getFavoriteBlock,/CREATE TABLE|ensureTable\(/); assert.match(getFavoriteBlock,/USER_FAVORITE_SCHEMA_MISSING/);
  assert.match(menu,/dashboard-menu/); assert.match(menu,/sidebarFavorites/); assert.match(menu,/favoriteHrefs/);
  const deploy=fs.readFileSync('.github/workflows/deploy.yml','utf8'); assert.match(deploy,/nenova-cafe24-production/); assert.match(deploy,/NEXT_DIST_DIR=\.next-build/); assert.match(deploy,/atomic build swap/); assert.match(deploy,/JWT_SECRET="\$\(grep '\^JWT_SECRET='/);
  const searchApi=fs.readFileSync('pages/api/products/search.js','utf8'); assert.match(searchApi,/p\.CountryFlower/); assert.doesNotMatch(searchApi,/ISNULL\(p\.CounName,''\) \+ ISNULL\(p\.FlowerName,''\) AS CountryFlower/);
  console.log('my customer order entry tests passed');
})().catch(e=>{console.error(e);process.exitCode=1});
