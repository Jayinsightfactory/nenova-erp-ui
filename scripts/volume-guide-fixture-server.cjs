// Local-only real Next page smoke. All API routes terminate here; no ERP connection.
const http = require('node:http');
const next = require('next');
const XLSX = require('xlsx-js-style');
const app = next({ dev: false, hostname: '127.0.0.1', port: 3196 });
const customers=[{custKey:1,custName:'검증업체',orderCode:'CL1',area:'서울'}];
const rows=[{prodKey:9,prodName:'CHINA / Blue',country:'중국',countryFlower:'중국',flower:'수국',unit:'단',ordersByCustKey:{1:5},orders:{검증업체:5},totalIncoming:20,incoming:{검증농장:20}}];
let snapshot;
app.prepare().then(()=>http.createServer(async(req,res)=>{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  if(!path.startsWith('/api/'))return app.getRequestHandler()(req,res);
  const send=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  if(path==='/api/auth/me')return send({success:true,user:{userId:'fixture',userName:'격리 검증',role:'admin',isAdmin:true}});
  if(path==='/api/stats/pivot-weeks')return send({success:true,weeks:['43-02','43-01']});
  if(path==='/api/stats/pivot-data')return send({success:true,rows,customers,customersByKey:customers});
  if(path==='/api/stats/china-volume-products')return send({success:true,products:rows,customers});
  if(path==='/api/customers/search')return send({success:true,customers:[{CustKey:1,CustName:'검증업체',OrderCode:'CL1',CustArea:'서울'}]});
  if(path==='/api/stats/pivot-volume-excel'){
    const wb=XLSX.utils.book_new(),s=XLSX.utils.aoa_to_sheet([['네덜란드','','','서울'],['','','','월'],['꽃','품목명','칼라','검증업체\nCL1','주문','입고','재고','잔량'],['수국','Blue','파랑',5,5,20,0,15],['합계','','',5,5,20,0,15]]);
    s.E4.f='SUM(D4:D4)';s.H4.f='F4-E4+G4';XLSX.utils.book_append_sheet(wb,s,'네덜란드');
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');return res.end(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}));
  }
  if(path==='/api/shipment/dutch-volume-work'){
    if(req.method==='POST') {let raw='';for await(const b of req)raw+=b;const p=JSON.parse(raw);snapshot={...p,id:'fixture',name:'격리 작업',savedAt:new Date().toISOString(),savedBy:'fixture'};return send({success:true,snapshot});}
    return send({success:true,items:[],nextCursor:null});
  }
  if(path==='/api/shipment/dutch-volume-preview')return send({success:true,rows:[],unmatched:[{reason:'격리 fixture 미매칭'}],entryMatches:[],blockers:['격리 검증: ERP 적용 금지'],customerOptions:customers,productOptions:[]});
  if(path.includes('-apply')){res.statusCode=403;return send({success:false,error:'Fixture never applies ERP'});}
  return send({success:true,items:[],boards:[],favorites:[],productMappings:{}});
}).listen(3196,'127.0.0.1',()=>console.log('Fixture only http://127.0.0.1:3196 ; no production API')));
