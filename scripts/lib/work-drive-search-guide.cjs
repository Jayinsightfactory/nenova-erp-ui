const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createWorkflowGuideRecorder } = require('./workflow-guide-recorder.cjs');

const id = 'work-drive-search';
const entry = {
  id, title: '업무 드라이브에서 파일 찾기', entryPaths: ['/work/drive'],
  sourceFiles: ['pages/work/drive.js'], requiredScenarios: ['scope', 'query', 'detail', 'clear'],
  guides: [{ id: 'staff', role: '직원', title: '검색 범위 선택과 파일 확인', status: 'draft',
    src: '/guides/work-drive-search/staff.mp4', captions: '/guides/work-drive-search/staff.ko.vtt',
    proof: '/guides/work-drive-search/staff.proof.json', chapters: [] }]
};
const registryPath = path.resolve('config/workflow-guides.json');
function saveEntry(guide) {
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const index = registry.workflows.findIndex(item => item.id === id);
  if (index < 0) registry.workflows.push(guide); else registry.workflows[index] = guide;
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n');
}
async function recordDriveGuide(page) {
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  const rec = await createWorkflowGuideRecorder(page, {workflowId:id, guideId:'staff', title:entry.title, sourceFiles:entry.sourceFiles, fixtureOnly:true, includeHeader:true});
  async function step(number, scenario, title, caption, selector, action) {
    rec.chapter(scenario, number + '. ' + title);
    await rec.caption(number + '. ' + caption);
    await rec.pause(2500);
    await rec.focus(selector, number, {badgeLeft:1320});
    await action(); await rec.pause(2600); await rec.unfocus();
  }
  await step(1,'scope','내 파일 선택','왼쪽 위 검색 범위에서 내 파일을 선택합니다. 선택한 범위가 파란색으로 표시됩니다.','.search-tools .seg button:first-child',async()=>{
    await page.click('.search-tools .seg button:first-child');await page.waitForSelector('input[aria-label="내 파일 검색"]');
  });
  await step(2,'query','파일명 검색','범위 오른쪽 검색창에 파일명 일부를 입력합니다. 아래 표에 일치하는 파일이 표시됩니다.','.search input',async()=>{
    await page.type('.search input','fixture-20819',{delay:120});await page.waitForFunction(()=>document.querySelector('.lst tbody')?.textContent.includes('fixture-20819.xlsx'));
  });
  await step(3,'detail','파일 상세 확인','검색 결과의 파일을 누릅니다. 오른쪽 상세 화면에서 파일명과 차수를 확인합니다.','.lst tbody tr',async()=>{
    await page.click('.lst tbody tr');await page.waitForSelector('.right .dn');assert.equal(await page.$eval('.right .dn',n=>n.textContent),'fixture-20819.xlsx');
  });
  await step(4,'clear','검색어 지우기','검색창 오른쪽의 지우기를 누릅니다. 입력창이 비워지고 다음 검색어를 입력할 수 있습니다.','.search .clr',async()=>{
    await page.click('.search .clr');assert(await page.$eval('.search input',e=>!e.value&&e===document.activeElement));
  });
  const result=await rec.stop();
  entry.guides[0].chapters=result.chapters;entry.guides[0].status='ready';saveEntry(entry);
}
module.exports={recordDriveGuide};
