import {useState} from 'react';
import grouping from '../lib/shipmentStatementGroups.cjs';
import styles from '../styles/ShipmentStatement.module.css';
export default function ShipmentStatementGroups({categories,groups,disabled,onChange}){
 const [selected,setSelected]=useState([]),[target,setTarget]=useState(''),[name,setName]=useState('');
 const chosen=selected.filter(k=>categories.some(c=>c.key===k));
 function apply(remove=false){
  const label=remove?'':target||name.trim()||grouping.suggestedName(categories,chosen,groups);
  onChange(grouping.assignGroup(groups,chosen,label));setSelected([]);setTarget('');setName('');
 }
 return <details className={styles.panel}><summary>품목 묶음 설정 · 품목군을 선택해서 함께 출력</summary>
  <p>함께 출력할 품목군을 체크한 뒤 묶으세요. 묶음 이름은 자동으로 만들어집니다. 같은 묶음은 한 표에, 다른 묶음은 옆 표에 출력됩니다.</p>
  <fieldset className={styles.selectorField} disabled={disabled}><legend>묶을 품목군 선택</legend><div className={styles.groups}>
   {categories.map(c=><label key={c.key} className={styles.groupChoice}><input type="checkbox" aria-label={`${c.label} 묶음 선택`} checked={chosen.includes(c.key)} onChange={e=>setSelected(e.target.checked?[...chosen,c.key]:chosen.filter(k=>k!==c.key))}/><span>{c.label}<small>{groups.find(g=>g.categories.includes(c.key))?.name??'개별 품목군'}</small></span></label>)}
  </div></fieldset>
  <div className={styles.controls}><span role="status">{chosen.length}개 품목군 선택</span><label>묶음 선택<select aria-label="출력 묶음 선택" value={groups.some(g=>g.name===target)?target:''} disabled={disabled} onChange={e=>setTarget(e.target.value)}><option value="">새 묶음 만들기</option>{groups.map(g=><option key={g.name}>{g.name}</option>)}</select></label>
   {!target&&<label>묶음 이름 (선택)<input aria-label="새 묶음 이름" maxLength={60} placeholder="비워두면 자동 이름" value={name} disabled={disabled} onChange={e=>setName(e.target.value)}/></label>}
   <button disabled={disabled||!chosen.length} onClick={()=>apply()}>선택한 품목군 묶기</button><button disabled={disabled||!chosen.length} onClick={()=>apply(true)}>선택한 품목군 묶음 해제</button>
  </div>
  {!!groups.length&&<ul>{groups.map(g=><li key={g.name}><strong>{g.name}</strong> — {g.categories.map(k=>categories.find(c=>c.key===k)?.label??'다른 차수 품목군').join(', ')}</li>)}</ul>}
  <p className={styles.hint}>기존 묶음에 추가하면 선택한 품목군만 옮깁니다. 작성내용 저장을 눌러야 보관됩니다.</p>
 </details>;
}
