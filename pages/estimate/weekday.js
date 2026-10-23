import dynamic from 'next/dynamic';
import WeekdayEstimateEntry from '../../components/WeekdayEstimateEntry';
const WeekdayEstimateWorkspace=dynamic(()=>import('../../components/WeekdayEstimateWorkspace'),{
  ssr:false,loading:()=> <p role="status" style={{padding:20}}>선택한 차수의 작업 화면을 불러오는 중…</p>
});

export default function WeekdayEstimatePage() {
  return <WeekdayEstimateEntry renderWorkspace={scope=><WeekdayEstimateWorkspace initialScope={scope}/>}/>;
}
