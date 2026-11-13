import { useEffect, useState } from 'react';
import { Alert, Button, Input, Select, Space, Table } from 'antd';
import { apiGet } from '../lib/useApi';

const endpoint = '/api/warehouse/stock-investigation';
const columns = (fields) => fields.map(([dataIndex,title]) => ({dataIndex,title}));
const qty = value => value == null ? '—' : Number(value).toLocaleString('ko-KR',{maximumFractionDigits:2});

function Evidence({year,row}) {
  const [result,setResult] = useState(null);
  const [error,setError] = useState('');
  useEffect(() => {
    let active=true;
    apiGet(endpoint,{year,week:row.week,pk:row.prodKey})
      .then(data=>active && setResult(data)).catch(e=>active && setError(e.message));
    return ()=>{active=false;};
  },[year,row.week,row.prodKey]);
  if(error) return <Alert type="error" message={error}/>;
  if(!result) return <p>근거 조회 중…</p>;
  return <div><h4>입고 원장</h4><Table size="small" rowKey="id" pagination={{pageSize:8,hideOnSinglePage:true}} dataSource={result.receipts}
    columns={[...columns([['id','원장 번호'],['time','업로드 시각'],['qty','수량']]),{title:'상태',render:(_,r)=>r.deleted?'삭제':'활성'}]}/>
    <h4>입고가 현재고에 반영된 이력</h4><Table size="small" rowKey="id" pagination={{pageSize:8,hideOnSinglePage:true}} dataSource={result.events}
    columns={columns([['time','기록 시각'],['kind','작업'],['beforeQty','변경 전'],['afterQty','변경 후'],['delta','증감']])}/></div>;
}

export default function WarehouseStockInvestigation() {
  const [year,setYear]=useState(()=>String(new Date().getFullYear()));
  const [mode,setMode]=useState('ledger');
  const [day,setDay]=useState(()=>new Date().toLocaleDateString('sv-SE'));
  const [filter,setFilter]=useState('');
  const [version,reload]=useState(0);
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    setLoading(true);setRows([]);setError('');
    apiGet(endpoint,mode==='match'?{year,day}:{year}).then(data=>active && setRows(data.rows))
      .catch(e=>active && setError(e.message)).finally(()=>active && setLoading(false));
    return ()=>{active=false;};
  },[year,version,mode,day]);
  const selected=rows.filter(r=>[r.name,r.week,r.reason].some(s=>String(s).toLowerCase().includes(filter.trim().toLowerCase())));
  return <section><p>차수별 활성 입고량과 재고이력의 입고 순증감을 비교합니다. 행을 펼쳐 삭제 원장과 수정 이력을 확인하세요.</p>
    <Space wrap><Select aria-label="진단 방식" value={mode} onChange={setMode} options={[{value:"ledger",label:"입고 원장 대조"},{value:"match",label:"동기화 수량 일치 차수"}]}/>{mode==="match" && <input aria-label="동기화 작업일" type="date" value={day} onChange={e=>{if(e.target.value)setDay(e.target.value);}}/>}<Select aria-label="진단 연도" value={year} onChange={setYear} options={Array.from({length:Math.max(1,new Date().getFullYear()-2018)},(_,i)=>({value:String(new Date().getFullYear()+1-i)}))}/>
    <Input.Search aria-label="진단 결과 검색" placeholder="차수·품목·진단 결과" allowClear value={filter} onChange={e=>setFilter(e.target.value)}/>
    <Button onClick={()=>reload(v=>v+1)} loading={loading}>다시 조회</Button></Space>
    {error&&<Alert type="error" message={error}/>}
    <Table key={[year,version,mode,day].join('-')} size="small" loading={loading} rowKey={r=>r.week+'-'+r.prodKey} dataSource={selected} pagination={{pageSize:25,showTotal:n=>n+'건'}}
      locale={{emptyText:error?'조회 실패':'조건에 해당하는 입고 차이가 없습니다.'}} scroll={{x:800}}
      expandable={{expandedRowRender:r=><Evidence year={year} row={r}/>}}
      columns={mode==='match'?columns([['matches','차수 일치 품목 수'],['week','입고 차수'],['name','품목'],['unit','단위'],['delta','당일 동기화 증감'],['received','입고량'],['alternatives','동일수량 차수 수']]):[...columns([['week','차수'],['name','품목'],['unit','단위'],['activeQty','활성 입고량'],['recordedQty','입고이력 순증감']]),
        {title:'검토 보정량',dataIndex:'correction',render:v=>v>0?'+'+qty(v):qty(v),sorter:(a,b)=>Math.abs(a.correction)-Math.abs(b.correction)},
        ...columns([['reason','근거'],['lastEvent','마지막 입고이력']])]}/>
    {mode==="match"?<p>동기화 순증감의 절댓값과 입고량이 같은 차수를 표시합니다. 수량 일치는 원인 확인을 위한 후보입니다.</p>:<p>검토 보정량 = 활성 입고량 − 입고이력 순증감. 이미 재고조정·현재고동기화로 해소된 차이도 포함되므로 실제 보정 전 해당 이력을 확인하세요.</p>}
  </section>;
}
