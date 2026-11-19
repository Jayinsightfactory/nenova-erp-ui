import sql from 'mssql';
import {withAuth,getJwtSecret} from '../../../../lib/auth';
import {query} from '../../../../lib/db';
import {canManageInvoiceReceipt} from '../../../../lib/invoiceReceiptAccess';
import {createCountryOrderSourceHandler} from '../../../../lib/countryOrderSourceApi';
import {buildCountryOrderMatrix,COUNTRY_ORDER_COUNTRIES,normalizeCountryOrderUnit} from '../../../../lib/countryOrderSource';
import {readCountryOrderEvidence} from '../../../../lib/countryOrderEvidenceApi';
import {createCountryOrderHistoryStore} from '../../../../lib/countryOrderHistoryStore';
import {createCountryOrderHistoryHandler} from '../../../../lib/countryOrderHistoryApi';
import {readImportArchive,offsetImportDay} from '../../../../lib/importKakaoArchive';
import {classifyImportFeed,importCustomerAliases} from '../../../../lib/importKakaoOrderText';
import {todaySeoul} from '../../../../lib/importKakaoAdditions';
import {getKakaoSheetId,readSheetValues} from '../../../../lib/googleSheets';
import {generateCompactCountryOrders} from '../../../../lib/countryOrderPresentation';
import {serializePedidosWorkbook} from '../../../../lib/importPedidos';
import {withCountryOrderEta,countryOrderSourceComplete} from '../../../../lib/countryOrderEta';

const sourceHandler=createCountryOrderSourceHandler({queryFn:query,types:sql});
async function readCurrent(scope){
  let body,status=200;
  await sourceHandler({method:'GET',user:{},query:{country:scope.country,year:String(scope.year),majorWeek:scope.orderWeek.slice(0,2),orderWeek:scope.orderWeek}},
    {setHeader(){},status(value){status=value;return this;},json(value){body=value;}});
  if(status!==200)throw Object.assign(Error(body?.error??'전산 원주문 조회 실패'),{statusCode:status});
  if(!countryOrderSourceComplete(body))throw Object.assign(Error('조회되지 않은 활성 주문이 있어 전체 발주서 생성을 보류합니다.'),{statusCode:409});
  const evidence=await readCountryOrderEvidence({scope,queryFn:query,types:sql});
  const matrix=buildCountryOrderMatrix(body,scope.orderWeek);
  return {...evidence,matrix};
}
function messageAt(value){
  const parts=String(value).match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(오전|오후)\s*(\d{1,2}):(\d{2})$/);
  if(!parts)return '';
  const hour=Number(parts[5])%12+(parts[4]==='오후'?12:0);
  return `${parts[1]}-${parts[2].padStart(2,'0')}-${parts[3].padStart(2,'0')}T${String(hour).padStart(2,'0')}:${parts[6]}:00+09:00`;
}
async function readMessages(scope){
  const through=todaySeoul(),from=offsetImportDay(through,-30);
  const [raw,aliases]=await Promise.all([readImportArchive(from,through),readSheetValues({spreadsheetId:getKakaoSheetId(),range:"'수입방 주문검토'!A:U"})]);
  const feed=classifyImportFeed({from,to:through,messages:raw},importCustomerAliases(aliases));
  return [...feed.messages,...feed.review].map(message=>({...message,items:message.items.filter(item=>Number(item.year)===scope.year&&item.country===COUNTRY_ORDER_COUNTRIES[scope.country]&&String(item.week).split('-').map(v=>v.padStart(2,'0')).join('-')===scope.orderWeek).map(item=>({...item,sourceKey:item.key,scope,at:messageAt(message.time),kind:message.kind,unit:normalizeCountryOrderUnit(item.unit),quantity:Number(item.quantity),sourceLine:item.sourceLine??'',rawCustomer:item.customer,rawProduct:item.product}))})).filter(message=>message.items.length);
}
const store=createCountryOrderHistoryStore();
export const config={api:{bodyParser:{sizeLimit:'2mb'}}};
export default withAuth(createCountryOrderHistoryHandler({store,readCurrent,readMessages,
  secret:getJwtSecret,
  canAccess:user=>canManageInvoiceReceipt(user)&&user?.accountActive!==false&&typeof user?.userId==='string'&&user.service!==true,
  generate:(matrix,options,eta)=>generateCompactCountryOrders(matrix,options).map(output=>{
    const workbook=eta?withCountryOrderEta(output.workbook,matrix.scope.orderWeek,eta):output.workbook;
    return {...output,workbook,bytes:Buffer.from(serializePedidosWorkbook(workbook))};
  })
}));
