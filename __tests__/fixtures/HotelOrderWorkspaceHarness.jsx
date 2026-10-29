import {useState} from 'react';
import buttonStyles from '../../styles/hotelOrderButtons.module.css';
import HotelOrderWorkspace from '../../components/HotelOrderWorkspace';
const products=[{ProdKey:10,DisplayName:'검증 장미',ProdName:'검증 장미',OutUnit:'단',BunchOf1Box:10},{ProdKey:20,DisplayName:'검증 수국',ProdName:'검증 수국',OutUnit:'단',BunchOf1Box:10}];
let saved=new Map(),calls=[],failSecond=false;
export default function Fixture(){const [events,setEvents]=useState([]);const show=()=>setEvents([...calls]);
 const get=async(url,q={})=>{
 if(url==='/api/auth/me')return {user:{userId:'test-only'}};
 if(url==='/api/customers/search')return {customers:[{CustKey:1,CustName:'라움 검증'},{CustKey:2,CustName:'호텔여분 검증'},{CustKey:3,CustName:'선택업체 검증'}]};
 if(url==='/api/products/search')return {products};
 if(url==='/api/sales/hotel-order-drafts'){if(q.id){const record=saved.get(q.id);if(!record)throw Error('없음');return {record:JSON.parse(JSON.stringify(record))};}return {records:[...saved.values()].map(r=>({...r,frozen:r.work.frozen,requestCount:r.work.request.length,purchaseCount:r.work.purchase.length}))};}
 if(url==='/api/orders/my-customers')return {products:products.map(p=>({...p,CurrentOrderRows:1,CurrentQty:5+calls.filter(c=>c.type==='ORDER'&&c.custKey===q.custKey).flatMap(c=>c.items).filter(i=>i.prodKey===p.ProdKey).reduce((n,i)=>n+i.qty,0)}))};
 throw Error('Unexpected GET '+url);
 };
 const post=async(url,body)=>{
 if(url==='/api/sales/hotel-miu-parse')return {success:true,items:String(body.text).trim().split('\n').map((t,i)=>{const [inputName,qty]=t.split(',');return {inputName,qty:Number(qty),unit:'단',prodKey:inputName==='검증 장미'?10:null,prodName:inputName==='검증 장미'?'검증 장미':'',rowNo:i+1};}),products};
 if(url==='/api/sales/hotel-miu-intake'){calls.push({type:'DB_MAPPING'});show();return {success:true};}
 if(url==='/api/sales/hotel-order-drafts'){const old=saved.get(body.id);if((old?.revision||0)!==body.expectedRevision)throw Error('CAS 충돌');const record={id:body.id,revision:body.expectedRevision+1,updatedAt:new Date().toISOString(),work:JSON.parse(JSON.stringify(body.work))};saved.set(body.id,record);return {record};}
 if(url==='/api/orders'){calls.push({type:'ORDER',custKey:body.custKey,year:body.year,week:body.week,mode:body.orderMode,items:body.items});show();if(failSecond&&calls.filter(c=>c.type==='ORDER').length===2)throw Error('모형 응답 유실');return {success:true,verified:true,results:body.items.map(i=>({prodKey:i.prodKey,previousQty:i.expectedCurrentQty,finalQty:i.expectedCurrentQty+i.qty}))};}
 throw Error('Unexpected POST '+url);
 };
 return <div className={buttonStyles.page}><div><strong>격리 UI 검증 · 실제 ERP 호출 없음</strong><button onClick={()=>{failSecond=true;calls=[];show();}}>두번째 업체 응답유실 모형</button><pre aria-label="검증 요청 로그">{JSON.stringify(events)}</pre></div><HotelOrderWorkspace apiGet={get} apiPost={post}/></div>;
}
