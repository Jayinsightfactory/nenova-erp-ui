import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pagesRoot = path.join(root, 'pages');
const concurrentException = 'pages/sales/shilla-miu-board.js';
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
const deferred = [];

for (const file of pageFiles) {
  const rel = path.relative(root, file).replaceAll('\\', '/');
  if (rel === 'pages/_app.js') continue;
  const source = fs.readFileSync(file, 'utf8');
  const importsLayout = /import\s+Layout\s+from\s+['"][^'"]*components\/Layout['"]/.test(source);
  const rendersLayout = /<\/?Layout(?:\s|>)/.test(source);
  if (!importsLayout && !rendersLayout) continue;
  const route = `/${rel.replace(/^pages\//, '').replace(/\.(?:js|jsx|ts|tsx)$/, '').replace(/\/index$/, '')}`;
  if (noLayoutRoutes.has(route)) continue;
  if (rel === concurrentException) deferred.push(rel);
  else violations.push(`${rel}: 페이지가 공통 Layout을 직접 import/render합니다.`);
}

const layoutSource = fs.readFileSync(path.join(root, 'components/Layout.js'), 'utf8');
const menuBlock = layoutSource.match(/export const MENU_ITEMS = \[([\s\S]*?)\n\];/);
if (!menuBlock) violations.push('components/Layout.js: MENU_ITEMS를 찾을 수 없습니다.');
else {
  const hrefs = [...menuBlock[1].matchAll(/href:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
  const labels = [...menuBlock[1].matchAll(/labelKey:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
  for (const [kind, values] of [['href', hrefs], ['labelKey', labels]]) {
    const duplicates = [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
    if (duplicates.length) violations.push(`MENU_ITEMS 중복 ${kind}: ${duplicates.join(', ')}`);
  }
}

const mobileSource = fs.readFileSync(path.join(root, 'pages/m/index.js'), 'utf8');
if (!/import\s*\{\s*MENU_ITEMS\s*\}\s*from\s*['"]\.\.\/\.\.\/components\/Layout['"]/.test(mobileSource)) {
  violations.push('pages/m/index.js: 모바일 메뉴가 공통 MENU_ITEMS를 사용하지 않습니다.');
}
if (/const\s+DESKTOP_MENU\s*=\s*\[/.test(mobileSource)) {
  violations.push('pages/m/index.js: 데스크톱 메뉴 복제본을 만들면 안 됩니다.');
}

console.log(`UI layout audit: ${pageFiles.length} page files checked`);
if (deferred.length) console.warn(`동시 작업 보호(수정 안 함): ${deferred.join(', ')}`);
if (violations.length) {
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}
console.log('UI layout/menu contract passed');
