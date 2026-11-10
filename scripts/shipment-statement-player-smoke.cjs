const assert=require('node:assert/strict'),puppeteer=require('puppeteer-core');
async function main(){const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
 try{const page=await browser.newPage(),base=process.env.GUIDE_BASE||'http://localhost:39461';await page.setRequestInterception(true);page.on('request',r=>{const u=new URL(r.url());if(u.origin!==base)return r.abort();if(u.pathname.startsWith('/api/'))return r.respond({status:200,contentType:'application/json',body:JSON.stringify({success:true,user:{userId:'guide',userName:'연습지원',authority:2},data:[],items:[],favorites:[]})});r.continue();});
 for(const width of [1920,390]){await page.setViewport({width,height:width===1920?1080:844,deviceScaleFactor:1});await page.goto(base+'/shipment/statement?popup=1',{waitUntil:'networkidle0',timeout:120000});
 const summary=await page.$('summary::-p-text(사용 가이드 영상)');await summary.focus();await page.keyboard.press('Enter');await page.waitForSelector('video');await page.$eval('video',v=>v.play());await page.waitForFunction(()=>document.querySelector('video').readyState>=1);
 const dimensions=await page.$eval('video',v=>({width:v.videoWidth,height:v.videoHeight,duration:v.duration,tracks:v.querySelectorAll('track[srclang=ko]').length}));assert.equal(dimensions.width,1920);assert.equal(dimensions.height,1080);assert.equal(dimensions.tracks,1);assert(dimensions.duration>20);
 await page.$eval('video',v=>v.play());await new Promise(r=>setTimeout(r,500));assert.equal(await page.$eval('video',v=>v.paused),false);
 const chapters=await page.$$('nav[aria-label="영업지원 영상 목차"] button');assert.equal(chapters.length,5);await chapters[2].focus();await page.keyboard.press('Space');assert((await page.$eval('video',v=>v.currentTime))>1);assert.equal(await page.evaluate(()=>document.activeElement.tagName),'VIDEO');
 assert.equal(await page.$$eval('a[download]',a=>a.filter(n=>n.href.includes('/guides/shipment-statement/')).length),2);
 await summary.focus();await page.keyboard.press('Space');await new Promise(r=>setTimeout(r,100));assert.equal(await page.$eval('video',v=>v.paused),true);await page.keyboard.press('Tab');await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');
 console.log(JSON.stringify({width,player:true,chapters:5,koreanCaptions:true,downloadLinks:2,keyboard:true}));}
 }finally{await browser.close();}}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
