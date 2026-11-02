import {parseLedgerBase} from '../../lib/kakaoStockLedger';

export default function StockInputRemarks({text,ledger,pending,disabled,onChange,onOpen}) {
  let lines;
  try{lines=parseLedgerBase(text);}catch{lines=String(text).split(/\r?\n/).map((raw,index)=>({raw,index}));}
  const count=Math.max(8,lines.length);
  return <div className="input-pair">
    <div><h3>기초재고</h3><textarea aria-label="시작재고 입력" wrap="off" spellCheck={false} disabled={disabled} value={text} onChange={e=>onChange(e.target.value)} style={{height:count*28+38}} placeholder={'문라이트 3\n노비아 2\n쥬리고 1\n---------------\n화이트 10\n블루 3\n버건디 1'}/></div>
    <div className="remarks"><h3>비고 · 변경내역</h3><div className="remark-lines">{lines.map(line=>{
      const row=line.key?ledger.rows.find(r=>r.key===line.key):null;
      const latest=row?.history.at(-1);
      const note=latest?`${latest.customer} ${latest.before}→${latest.after}${latest.unit} (${latest.stockBefore}→${latest.stockAfter}) ${latest.memo||''}`:pending&&line.key?'입력한 기초재고를 먼저 적용하세요.':'';
      return <div className="remark-row" key={line.index} data-line={line.index}>
        {row?<><button className="latest" title={note||`${row.name} 변경 입력`} aria-label={`${row.name} 변경 입력`} disabled={disabled||pending} onClick={click=>onOpen(row,click)}>{note||'변경 입력'}</button>{row.history.length>0&&<details onKeyDown={e=>{if(e.key==='Escape'){e.currentTarget.open=false;e.currentTarget.querySelector('summary')?.focus();}}}><summary>전체본</summary><div className="history" role="region" aria-label={`${row.name} 전체 변경내역`}><strong>{row.name} · 현재 {row.remaining}{row.unit}</strong>{row.history.map(h=><p key={h.id}>{h.customer} {h.before}→{h.after}{h.unit} ({h.stockBefore}→{h.stockAfter}) {h.memo}</p>)}</div></details>}</>:<span title={note}>{note}</span>}
      </div>;
    })}</div></div>
    <style jsx>{`.input-pair{display:grid;grid-template-columns:minmax(140px,1fr) minmax(180px,1.35fr);gap:8px;align-items:start}h3{font-size:14px;margin:0 0 6px;line-height:20px}textarea{display:block;width:100%;box-sizing:border-box;margin:0;border:1px solid #bbc8d8;border-radius:5px;padding:8px;font:14px/28px monospace;resize:none;white-space:pre;overflow-x:auto;overflow-y:hidden;background:#fff;color:#203047}.remarks{min-width:0}.remark-lines{padding-top:9px}.remark-row{height:28px;box-sizing:border-box;display:flex;align-items:center;gap:4px;min-width:0;font-size:13px}.remark-row>span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#718096}button{font:inherit;border:1px solid #b8c9da;background:#eff6ff;color:#164b7d;border-radius:4px;cursor:pointer}.latest{height:26px;line-height:24px;padding:0 5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;max-width:100%;flex:0 1 auto}button:disabled{opacity:.5;cursor:default}details{position:relative;flex:none}summary{cursor:pointer;white-space:nowrap;color:#164b7d;font-size:12px;line-height:26px}.history{position:absolute;top:28px;right:0;width:min(370px,65vw);max-height:300px;overflow:auto;z-index:20;border:1px solid #adc4de;background:#fff;padding:10px;border-radius:6px;box-shadow:0 5px 20px #18345033;line-height:1.6;overflow-wrap:anywhere}.history p{margin:6px 0}:focus-visible{outline:3px solid #3184de;outline-offset:2px}@media(max-width:500px){.input-pair{grid-template-columns:minmax(110px,1fr) minmax(130px,1.2fr);gap:5px}.latest{font-size:11px}}`}</style>
  </div>;
}
