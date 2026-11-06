// Actual local page; caller owns all synthetic API routing. Run after recorder.stop().
const assert=require('node:assert/strict');
async function runProfitAuxScopeSmoke({page,click,financial}){
 const settle=()=>new Promise(resolve=>setTimeout(resolve,300));
 const fill=async value=>{
  const input=await page.$('input[placeholder="31"]');assert(input,'aux week input');
  await input.click();await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await input.type(value,{delay:40});await input.dispose();await settle();
 };
 const mounted=marker=>page.evaluate(marker=>document.body.textContent.includes(marker),marker);
 const results=[];
 await settle();
 for(const [tab,endpoint,marker]of [['원인분석','/api/sales/profit-analysis','이익률 원인분석'],['원천시트','/api/sales/profit-workbook','매출원가 양식 원천시트']]){
  const beforeTab=financial.length;await click(tab);await fill('44');assert.equal(financial.length,beforeTab,'tab/select cannot fetch');assert.equal(await mounted(marker),false);
  await click('조회');await page.waitForFunction(marker=>document.body.textContent.includes(marker),{},marker);await settle();
  const queried=financial.length;assert.equal(financial.filter(r=>r.path===endpoint).length,1,'first explicit auxiliary query');
  await fill('45');assert.equal(await mounted(marker),false);assert.equal(financial.length,queried,'45 selection cannot fetch');
  await fill('44');assert.equal(await mounted(marker),false);assert.equal(financial.length,queried,'return44 cannot revive previous query intent');
  await page.screenshot({path:`.verify/profit-aux-${results.length}-roundtrip-empty.png`});
  await click('조회');await page.waitForFunction(marker=>document.body.textContent.includes(marker),{},marker);await settle();
  assert.equal(financial.filter(r=>r.path===endpoint).length,2,'only next explicit query remounts/fetches');
  results.push({tab,roundtripFinancialRequests:0,explicitRequests:2,returnedUnMounted:true});
 }
 console.log(JSON.stringify({auxScopeSmoke:'PASS',results,allApisSynthetic:true,productionWrites:0}));
}
module.exports={runProfitAuxScopeSmoke};
