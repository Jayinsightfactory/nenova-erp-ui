import {useState} from 'react';
import {CLOUD_CATEGORIES,cloudCategory} from '../../lib/chinaCloudCost.js';
import styles from '../../styles/InvoiceReceiptCost.module.css';

export default function CloudCostCategories({lines,inputs,onChange,disabled}){
  const [showAll,setShowAll]=useState(false);
  const pending=lines.filter(line=>Number(line.outQuantity)>0&&!cloudCategory(inputs.find(i=>i.lineId===line.lineId)?.categoryCode));
  const visible=showAll?lines:pending;
  return <section className={styles.cloudCategories} aria-label="CLOUD 품종 카테고리">
    <h4>CLOUD 품종 카테고리 · 확인 필요 {pending.length}개</h4>
    <p>매칭된 품목은 자동 적용합니다. 전체 품목 보기에서 기존 매칭도 언제든 변경할 수 있습니다. 카테고리를 바꾸면 운임·관세·원가를 다시 계산합니다.</p>
    <button type="button" aria-pressed={showAll} onClick={()=>setShowAll(v=>!v)}>{showAll?'미매칭만 보기':'전체 품목 보기 · 기존 매칭 수정'}</button>
    {!visible.length&&<p role="status">모든 품목의 카테고리가 연결되었습니다.</p>}
    {visible.map(line=>{
      const selected=cloudCategory(inputs.find(i=>i.lineId===line.lineId)?.categoryCode);
      return <div key={line.lineId} className={styles.result}>
        <strong>{line.originalName}</strong><p aria-live="polite">현재: {selected?.label||'카테고리 선택 필요'}</p>
        <div role="group" aria-label={`${line.originalName} 카테고리 선택`} style={{display:'flex',flexWrap:'wrap',gap:8}} onKeyDown={event=>{
          if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
          const buttons=Array.from(event.currentTarget.querySelectorAll('button'));
          const index=buttons.indexOf(document.activeElement);if(index<0)return;
          event.preventDefault();buttons[(index+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)+buttons.length)%buttons.length].focus();
        }}>
          {CLOUD_CATEGORIES.map(category=><button type="button" key={category.code} disabled={disabled} aria-pressed={selected?.code===category.code}
            className={selected?.code===category.code?styles.primary:undefined} onClick={()=>onChange(line.lineId,'categoryCode',category.code)}>{category.label}</button>)}
          <button type="button" disabled={disabled} onClick={()=>onChange(line.lineId,'categoryCode','')}>매칭 해제</button>
        </div>
      </div>;
    })}
  </section>;
}
