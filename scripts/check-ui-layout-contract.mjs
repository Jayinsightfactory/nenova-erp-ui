import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pagesRoot = path.join(root, 'pages');
const appSource = fs.readFileSync(path.join(pagesRoot, '_app.js'), 'utf8');
const noLayoutBlock = appSource.match(/const NO_LAYOUT = \[([\s\S]*?)\n\];/);
const noLayoutRoutes = new Set([...(noLayoutBlock?.[1] || '').matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]));

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const pageFiles = walk(pagesRoot)
  .filter((file) => /\.(?:js|jsx|ts|tsx)$/.test(file))
  .filter((file) => !file.includes(`${path.sep}api${path.sep}`));
const violations = [];

for (const file of pageFiles) {
  const rel = path.relative(root, file).replaceAll('\\', '/');
  if (rel === 'pages/_app.js') continue;
  const source = fs.readFileSync(file, 'utf8');
  const importsLayout = /import\s+Layout\s+from\s+['"][^'"]*components\/Layout['"]/.test(source);
  const rendersLayout = /<\/?Layout(?:\s|>)/.test(source);
  if (!importsLayout && !rendersLayout) continue;
  const route = `/${rel.replace(/^pages\//, '').replace(/\.(?:js|jsx|ts|tsx)$/, '').replace(/\/index$/, '')}`;
  if (noLayoutRoutes.has(route)) continue;
  violations.push(`${rel}: 페이지가 공통 Layout을 직접 import/render합니다.`);
}

const layoutSource = fs.readFileSync(path.join(root, 'components/Layout.js'), 'utf8');
const backSource = fs.readFileSync(path.join(root, 'components/MenuBackButton.js'), 'utf8');
const menuBlock = layoutSource.match(/export const MENU_ITEMS = \[([\s\S]*?)\n\];/);
let menuHrefs = [];
if (!menuBlock) violations.push('components/Layout.js: MENU_ITEMS를 찾을 수 없습니다.');
else {
  const hrefs = [...menuBlock[1].matchAll(/href:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
  menuHrefs = hrefs;
  const labels = [...menuBlock[1].matchAll(/labelKey:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
  for (const [kind, values] of [['href', hrefs], ['labelKey', labels]]) {
    const duplicates = [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
    if (duplicates.length) violations.push(`MENU_ITEMS 중복 ${kind}: ${duplicates.join(', ')}`);
  }
}
if ((layoutSource.match(/<MenuBackButton\s*\/>/g) || []).length < 2) {
  violations.push('components/Layout.js: 일반/팝업 상단바 모두 뒤로가기 버튼을 제공해야 합니다.');
}
if (!/needsStandaloneBack\s*&&\s*<MenuBackButton standalone\s*\/>/.test(appSource)) {
  violations.push('pages/_app.js: 자체 화면틀 메뉴에도 공통 뒤로가기 버튼이 필요합니다.');
}
if (!/takePreviousMenuRoute/.test(backSource) || !/window\.history\.length>1/.test(backSource) || !/router\.push\('\/dashboard'\)/.test(backSource)) {
  violations.push('components/MenuBackButton.js: 메뉴 이동 이력과 브라우저 이력, 대시보드 fallback이 필요합니다.');
}
if (!/requestContextualMenuBack/.test(backSource)) {
  violations.push('components/MenuBackButton.js: 현재 페이지의 내부 초기 화면 복귀 요청이 메뉴 이동보다 먼저 실행되어야 합니다.');
}
if (!/requestMenuPageReset/.test(backSource) || !/pageInteractedRef/.test(backSource)) {
  violations.push('components/MenuBackButton.js: 모든 메뉴에서 내부 작업 후 최초 화면으로 복귀하는 공통 단계가 필요합니다.');
}
if (!/data-ui-page-content/.test(appSource) || !/MENU_PAGE_RESET_EVENT/.test(appSource)) {
  violations.push('pages/_app.js: 모든 메뉴 페이지를 공통 초기화 대상으로 감싸야 합니다.');
}
if (/window\.close\s*\(/.test(backSource)) {
  violations.push('components/MenuBackButton.js: 뒤로가기 버튼은 새창을 닫으면 안 됩니다.');
}
if (!/navigateInsideChildWindow/.test(layoutSource) || !/rememberMenuRoute/.test(layoutSource)) {
  violations.push('components/Layout.js: 자식창 메뉴는 같은 창에서 이동 기록을 남겨야 합니다.');
}
const standaloneBlock = appSource.match(/const STANDALONE_MENU_BACK_ROUTES = new Set\(\[([^\]]*)\]\)/);
const standaloneRoutes = new Set([...(standaloneBlock?.[1] || '').matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]));
for (const route of menuHrefs.filter(href => noLayoutRoutes.has(href))) {
  const routeFile = [path.join(pagesRoot, `${route.slice(1)}.js`), path.join(pagesRoot, route.slice(1), 'index.js')].find(fs.existsSync);
  const routeSource = routeFile ? fs.readFileSync(routeFile, 'utf8') : '';
  const ownsBackButton = /import\s+Layout\s+from\s+['"][^'"]*components\/Layout['"]/.test(routeSource)
    || /import\s+MenuBackButton\s+from\s+['"][^'"]*components\/MenuBackButton['"]/.test(routeSource);
  if (!ownsBackButton && !standaloneRoutes.has(route)) violations.push(`${route}: 자체 화면틀 메뉴의 뒤로가기 경로가 누락되었습니다.`);
  if (ownsBackButton && standaloneRoutes.has(route)) violations.push(`${route}: 자체 뒤로가기와 standalone 뒤로가기가 중복됩니다.`);
}

const mobileSource = fs.readFileSync(path.join(root, 'pages/m/index.js'), 'utf8');
if (!/import\s*\{\s*MENU_ITEMS\s*\}\s*from\s*['"]\.\.\/\.\.\/components\/Layout['"]/.test(mobileSource)) {
  violations.push('pages/m/index.js: 모바일 메뉴가 공통 MENU_ITEMS를 사용하지 않습니다.');
}
if (/const\s+DESKTOP_MENU\s*=\s*\[/.test(mobileSource)) {
  violations.push('pages/m/index.js: 데스크톱 메뉴 복제본을 만들면 안 됩니다.');
}

console.log(`UI layout audit: ${pageFiles.length} page files checked`);
if (violations.length) {
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}
console.log('UI layout/menu contract passed');
