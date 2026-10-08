const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {extractMenuItems,parseGitLog,buildSnapshot,querySnapshot} = require('../lib/menuDevelopmentHistory.cjs');
const hash = n => String(n).padStart(40,'0');
const menus = [{href:'/alpha',label:'알파',group:'업무'},{href:'/beta',label:'베타',group:'업무'}];
const c = (n,changes,extra={}) => ({hash:hash(n),date:`2026-01-01T0${n}:00:00+09:00`,subject:`변경 ${n}`,body:'',changes,...extra});
const f = (status,path,oldPath) => ({status,path,...(oldPath?{oldPath}:{})});
test('메뉴/기능/전체 고유 커밋 중복 제거 및 실제 A 이후 수정 횟수',()=>{
 const snapshot=buildSnapshot({menus,commits:[c(3,[f('M','pages/alpha.js'),f('M','pages/beta.js'),f('M','lib/helper.js')]),c(2,[f('M','pages/alpha.js'),f('A','pages/beta.js')]),c(1,[f('A','pages/alpha.js')],{date:'2025-12-31T23:00:00+09:00'})],catalog:{features:[{route:'/alpha',id:'helper',title:'도우미',description:'기능',paths:['lib/helper.js'],anchorPaths:['lib/helper.js']}]}});
 const result=querySnapshot(snapshot,{menu:'/alpha'});
 assert.equal(snapshot.uniqueCommitCount,3);assert.equal(result.selectedMenu.changeCount,3);assert.equal(result.timeline.length,3);assert.equal(querySnapshot(snapshot).timeline.length,3);
 const page=result.features.find(x=>x.id==='page');assert.equal(page.firstAddedKnown,true);assert.equal(page.modificationCount,2);assert.match(page.firstAddedAt,/2025/);
 assert.equal(result.features.find(x=>x.id==='helper').modificationCount,null);
});
test('관련 파일 추가와 이전 수정은 최초 추가/추가 이후 수정으로 오인하지 않음',()=>{
 const snapshot=buildSnapshot({menus,commits:[c(4,[f('M','lib/feature.js')]),c(3,[f('A','lib/feature.js')]),c(2,[f('A','lib/related.js')]),c(1,[f('M','lib/feature.js')])],catalog:{features:[{route:'/alpha',id:'x',title:'기능',anchorPaths:['lib/feature.js'],paths:['lib/feature.js','lib/related.js']}]}});
 const x=querySnapshot(snapshot,{menu:'/alpha'}).features.find(x=>x.id==='x');assert.equal(x.changeCount,4);assert.equal(x.modificationCount,1);assert.equal(x.firstAddedAt,'2026-01-01T03:00:00+09:00');
});
test('rename의 old/new 경로 연결과 실제 A 없는 최초 추가 미확인',()=>{
 const snapshot=buildSnapshot({menus,commits:[c(2,[f('R100','pages/beta.js','pages/alpha.js')]),c(1,[f('A','pages/alpha.js')])]});
 assert.equal(snapshot.uniqueCommitCount,2);assert.equal(querySnapshot(snapshot,{menu:'/alpha'}).selectedMenu.changeCount,2);assert.equal(querySnapshot(snapshot,{menu:'/beta'}).features[0].firstAddedKnown,false);
});
test('MENU_ITEMS 전체와 query variant 보존',()=>{
 const source=fs.readFileSync('components/Layout.js','utf8');const parsed=extractMenuItems(source);const start=source.indexOf('export const MENU_ITEMS');const block=source.slice(start,source.indexOf('\n];',start));const hrefs=new Set([...block.matchAll(/href:\s*['"]([^'"]+)['"]/g)].map(x=>x[1]));
 assert.equal(parsed.length,hrefs.size);assert.equal(parsed.filter(x=>x.href==='/dev/history').length,1);assert.equal(parsed.find(x=>x.href==='/m/executive?preview=1').route,'/m/executive');
});
test('Git delimiter/header/name-status rename 검증',()=>{
 const raw=`\x1e${hash(1)}\x1f2025-12-31T23:00:00+09:00\x1f제목\x1f본문\x1d\nR100\tpages/alpha.js\tpages/beta.js\nM\tlib/example.js\n`;
 assert.equal(parseGitLog(raw)[0].changes[0].oldPath,'pages/alpha.js');assert.throws(()=>parseGitLog('bad'));
});
test('merge PR 의미 제목 검색, pagination, shallow 한계 안내',()=>{
 const snapshot=buildSnapshot({menus,commits:[c(2,[f('M','pages/alpha.js')],{subject:'Merge pull request #123 from branch',body:'Merge pull request #123 from branch\n\n품목 검색 보완\n\n설명'}),c(1,[f('A','pages/alpha.js')])],isShallow:true});
 const result=querySnapshot(snapshot,{q:'품목 검색',limit:1});assert.ok(result.menus.some(x=>x.href==='/alpha'));assert.match(result.timeline[0].subject,/품목 검색/);assert.match(result.coverageNote,/불완전/);assert.equal(querySnapshot(snapshot,{page:2,limit:1}).timeline.length,1);
});
test('API 인증 GET/정적 데이터/원장 및 shell 미접근, 생성기는 고정 Git 호출',()=>{
 const api=fs.readFileSync('pages/api/dev/menu-history.js','utf8');assert.match(api,/withAuth/);assert.match(api,/GET/);assert.match(api,/private, no-store/);assert.doesNotMatch(api,/child_process|execSync|execFileSync|lib\/db|writeFile|INSERT|UPDATE|DELETE FROM/);
 const script=fs.readFileSync('scripts/generate-menu-development-history.cjs','utf8');assert.match(script,/first-parent/);assert.match(script,/diff-merges=first-parent/);assert.match(script,/execFileSync/);
});
test('기존 탭 보존/중복 shell 없음/abort 및 오류 상태',()=>{
 const page=fs.readFileSync('pages/dev/history.js','utf8');assert.match(page,/MenuDevelopmentHistory/);assert.match(page,/useState\('full'\)/);assert.match(page,/\['full', '전체 개발 이력'\]/);assert.match(page,/\['menu', '메뉴별 기능'\]/);assert.match(page,/\['legacy', '기존 작업 히스토리'\]/);for(const key of ['commits','pending','plans','memory'])assert.ok(page.includes(key));assert.doesNotMatch(page,/import Layout|<Layout/);
 const ui=fs.readFileSync('components/dev/MenuDevelopmentHistory.js','utf8');for(const re of [/AbortController/,/Asia\/Seoul/,/button/,/다시 시도/,/확인 불가/])assert.match(ui,re);
});
test('상이한 시간대의 실제 시간 순서 및 안전한 페이지 한도',()=>{
 const later=c(2,[f('M','pages/alpha.js')],{date:'2026-01-01T01:00:00Z'});const earlier=c(1,[f('A','pages/beta.js')],{date:'2026-01-01T09:30:00+09:00'});const snapshot=buildSnapshot({menus,commits:[later,earlier]});const result=querySnapshot(snapshot,{sort:'recent'});
 assert.equal(result.menus[0].href,'/alpha');assert.equal(result.timeline[0].hash,later.hash);assert.equal(querySnapshot(snapshot,{q:'베타'}).timeline.length,1);assert.equal(querySnapshot(snapshot,{limit:999,page:-1}).limit,100);
});
test('catalog anchor 존재 및 메뉴 내 기능 ID 유일성',()=>{
 const catalog=JSON.parse(fs.readFileSync('config/menu-development-history.json','utf8'));const seen=new Set();for(const x of catalog.features){const key=`${x.route}:${x.id}`;assert.ok(!seen.has(key));seen.add(key);for(const path of x.anchorPaths)assert.ok(fs.existsSync(path),path);}
});
test('shallow 경계의 가짜 root A는 최초 추가/수정/변경 건수 모두에서 제외',()=>{
 const snapshot=buildSnapshot({menus,commits:[c(3,[f('M','pages/alpha.js')]),c(2,[f('A','pages/beta.js')]),c(1,[f('A','pages/alpha.js'),f('A','pages/beta.js')])],isShallow:true,shallowBoundaryHashes:[hash(1)]});
 assert.equal(snapshot.uniqueCommitCount,2);
 const alpha=querySnapshot(snapshot,{menu:'/alpha'});assert.equal(alpha.selectedMenu.changeCount,1);assert.equal(alpha.features[0].firstAddedKnown,false);assert.equal(alpha.features[0].modificationCount,null);
 const beta=querySnapshot(snapshot,{menu:'/beta'});assert.equal(beta.features[0].firstAddedKnown,true);assert.equal(beta.features[0].modificationCount,0);
});
test('git 바이너리/메타데이터 없는 빌드만 tracked fallback, 다른 오류는 숨기지 않음',()=>{
 const vm=require('node:vm');const path=require('node:path');const source=fs.readFileSync('scripts/generate-menu-development-history.cjs','utf8');
 const saved=buildSnapshot({menus,commits:[c(1,[f('A','pages/alpha.js')])]});
 const run=(failure)=>{let written;const fakeFs={readFileSync(p){if(p.endsWith('Layout.js'))return "export const MENU_ITEMS = [\n{group:'업무',items:[{href:'/alpha',labelKey:'알파'}]}\n];";if(p.endsWith('config/menu-development-history.json'))return '{"features":[]}';return JSON.stringify(saved);},existsSync(){return true;},mkdirSync(){},writeFileSync(p,value){written=JSON.parse(value);}};
 vm.runInNewContext(source,{require(name){if(name==='node:fs')return fakeFs;if(name==='node:path')return path;if(name==='node:child_process')return {execFileSync(){throw failure;}};return require('../lib/menuDevelopmentHistory.cjs');},__dirname:path.resolve('scripts'),process:{stdout:{write(){}}}});return written;};
 assert.equal(run(Object.assign(new Error('missing'),{code:'ENOENT'})).sourceStatus,'tracked-fallback');
 assert.equal(run(Object.assign(new Error('no repo'),{status:128,stderr:'fatal: not a git repository'})).sourceStatus,'tracked-fallback');
 assert.throws(()=>run(Object.assign(new Error('corrupt git'),{status:128,stderr:'fatal: bad object HEAD'})),/corrupt git/);
});
