// Isolated full-page regression fixture for per-row saved base-stock mappings.
// Every API is intercepted; only mocked favorites/mapping writes are permitted.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');

const products=[
 {ProdKey:4101,ProdName:'Rosewood fixture',DisplayName:'로즈우드 품목',CounName:'fixture',FlowerName:'장미',OutUnit:'박스',EstUnit:'박스',isDeleted:false},
 {ProdKey:4102,ProdName:'Ruscus fixture',DisplayName:'루스커스 품목',CounName:'fixture',FlowerName:'그린',OutUnit:'박스',EstUnit:'박스',isDeleted:false},
 {ProdKey:4103,ProdName:'Hydrangea Pink fixture',DisplayName:'수국 연핑크',CounName:'fixture',FlowerName:'수국',OutUnit:'박스',EstUnit:'박스',isDeleted:false},
 {ProdKey:4104,ProdName:'Alstroemeria Dubai fixture',DisplayName:'알스트로메리아 두바이',CounName:'fixture',FlowerName:'알스트로메리아',OutUnit:'박스',EstUnit:'박스',isDeleted:false},
 {ProdKey:4105,ProdName:'Mix Box Rose fixture',DisplayName:'믹스박스 장미',CounName:'fixture',FlowerName:'믹스',OutUnit:'박스',EstUnit:'박스',isDeleted:false},
 {ProdKey:4106,ProdName:'Mix Box Tulip fixture',DisplayName:'믹스박스 튤립',CounName:'fixture',FlowerName:'믹스',OutUnit:'박스',EstUnit:'박스',isDeleted:false},
 {ProdKey:4107,ProdName:'Blue Steam fixture',DisplayName:'블루 3+20스팀 품목',CounName:'fixture',FlowerName:'수국',OutUnit:'박스',EstUnit:'박스',isDeleted:false},
];
const inputText='41-2 잔량\n로즈우드2\n루스커스12\n연핑크1\n두바이8단\n믹스박스1\n믹스박스10\n블루３+20스팀 (주광여분 3)';
const expected=[4101,4102,4103,4104,4105,4106,4107];
const rowFixtures=[
 {idx:1,name:'로즈우드',qty:2},
 {idx:2,name:'루스커스',qty:12},
 {idx:3,name:'연핑크',qty:1},
 {idx:4,name:'두바이',qty:8,unit:'단'},
 {idx:5,name:'믹스박스',qty:1},
 {idx:6,name:'믹스박스',qty:10},
 {idx:7,name:'블루',matchName:'블루',qty:3,boxQty:3,detailQty:20,detailUnit:'스팀',unit:'박스'},
];
const favorite={FavoriteKey:941,FavName:'기존재고 41-2 잔량',FilterData:JSON.stringify({baseWeek:'2026-41-02',orderWeek:'2026-41-02',pasteText:'',baseStockText:inputText,remainStockText:'',baseStockMatches:rowFixtures.map((row,index)=>({...row,prodKey:expected[index],prodName:products.find(p=>p.ProdKey===expected[index]).ProdName,displayName:products.find(p=>p.ProdKey===expected[index]).DisplayName,matchStatus:'manual',fromMapping:false})),pasteExcludedLines:[],baseStockExcludedLines:[],changeLogs:[],savedAt:'2026-10-12T00:00:00.000Z'})};

(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1}),writes=[],unexpectedWrites=[],errors=[],favorites=[favorite],savedPayloads=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('nenovaUser',JSON.stringify({userId:'fixture',userName:'검증',authority:1}));localStorage.setItem('nenova_paste_stock_base_week','2026-41-02');});
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url()),method=req.method(),path=url.pathname;let data={success:true,data:[],rows:[],items:[],operations:[],applications:[],mappings:{},favorites:[],hasMore:false};
   if(method!=='GET'){
    writes.push({method,path});
    if(path==='/api/favorites'&&(method==='POST'||method==='PUT')){
     const body=req.postDataJSON();savedPayloads.push(body);favorites[0]={...favorite,FavName:body.name,FilterData:body.filterData};data={success:true,favoriteKey:favorite.FavoriteKey};
    }else if(path==='/api/orders/mappings'&&method==='POST')data={success:true};
    else unexpectedWrites.push({method,path});
   }
   if(path.endsWith('/auth/me'))data={success:true,user:{userId:'fixture',userName:'검증',authority:1,accountActive:true}};
   else if(path.endsWith('/orders/weeks'))data={success:true,weeks:['2026-41-02']};
   else if(path==='/api/master')data={success:true,data:url.searchParams.get('entity')==='products'?products:[]};
   else if(path.endsWith('/sales-feed'))data={ok:true,messages:[],hasMore:false,nextAfterKey:null};
   else if(path==='/api/favorites')data=method==='GET'?{success:true,favorites}:data;
   await route.fulfill({json:data});
  });
  await page.goto(process.argv[2]||'http://localhost:3228/orders/paste?popup=1');
  const input=page.getByTestId('base-stock-input');await input.waitFor();
  await page.getByTestId('stock-base-week').fill('2026-41-02');
  await page.getByRole('button',{name:'저장본 불러오기',exact:true}).click();
  await page.waitForFunction(text=>document.querySelector('[data-testid="base-stock-input"]')?.value===text,inputText);
  const panel=page.locator('text=기초재고 입력 = 매칭결과').locator('..').locator('..');
  const assertDisplayed=async()=>{
   const content=await panel.innerText();
   for(const name of ['로즈우드 품목','루스커스 품목','수국 연핑크','알스트로메리아 두바이','믹스박스 장미','믹스박스 튤립','블루 3+20스팀 품목'])assert(content.includes(name),`expected matched product ${name}`);
   assert.equal((content.match(/믹스박스 장미/g)||[]).length,1,'first duplicate input keeps its distinct product');
   assert.equal((content.match(/믹스박스 튤립/g)||[]).length,1,'second duplicate input keeps its distinct product');
   assert(content.includes('수국 연핑크')&&content.includes('알스트로메리아 두바이'),'pink hydrangea and Dubai remain distinct products');
  };
  await assertDisplayed();
  await panel.getByRole('button',{name:/다시 매칭/}).click();await assertDisplayed();
  await page.getByRole('button',{name:/현재 값 저장|현재 저장본 덮어쓰기/}).click();
  const review=page.getByTestId('stock-note-match-dialog');await review.waitFor();
  await page.waitForFunction(()=>!document.querySelector('[data-testid="stock-note-match-dialog"]'));
  await page.waitForFunction(()=>document.body.innerText.includes('재조회 확인:'));
  assert.equal(savedPayloads.length,1,'saved fixture was persisted exactly once');
  const payload=JSON.parse(savedPayloads[0].filterData);assert.equal(payload.baseStockText,inputText);
  assert.deepEqual(payload.baseStockMatches.map(row=>Number(row.prodKey)),expected,'save payload preserves each original row product ID independently');
  assert.deepEqual(payload.baseStockMatches.slice(4,6).map(row=>[row.name,Number(row.prodKey)]),[['믹스박스',4105],['믹스박스',4106]]);
  assert.equal(payload.baseStockMatches[2].prodKey,4103,'연핑크 remains the correct hydrangea');assert.equal(payload.baseStockMatches[3].prodKey,4104,'두바이 remains distinct');
  assert.equal(payload.baseStockMatches[6].name,'블루','fullwidth quantity is not part of the product name');
  assert.equal(payload.baseStockMatches[6].boxQty,3);assert.equal(payload.baseStockMatches[6].detailQty,20);assert.equal(payload.baseStockMatches[6].detailUnit,'스팀');
  const output='outputs/base-stock-row-mapping-smoke';fs.mkdirSync(output,{recursive:true});
  for(const [width,height] of [[1920,1080],[1366,768]]){await page.setViewportSize({width,height});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`no horizontal overflow at ${width}x${height}`);await page.screenshot({path:`${output}/${width}x${height}.png`});}
  assert.deepEqual(unexpectedWrites,[],'no unexpected write endpoint was called');assert.deepEqual(errors,[],'no browser runtime errors');
  console.log(JSON.stringify({viewport:'1920x1080 / 1366x768',favorite:'기존재고 41-2 잔량',savedAndRestored:true,rematchRetainsPerRowChoices:true,fullwidthRawNamePreserved:true,savedProdKeys:payload.baseStockMatches.map(row=>Number(row.prodKey)),writes,unexpectedWrites,errors,screenshots:output}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
