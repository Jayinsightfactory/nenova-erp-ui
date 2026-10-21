import ShillaAnalysis from '../shilla-analysis';
export async function getServerSideProps({query}) {
  return {redirect:{destination:`/raum/shilla-analysis?workspace=check${query.popup==='1'?'&popup=1':''}`,permanent:false}};
}
export default function ShillaCheck() { return <ShillaAnalysis workspace/>; }
