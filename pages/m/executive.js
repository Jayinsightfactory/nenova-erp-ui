import Head from 'next/head';
import ExecutiveReports from '../../components/executive/ExecutiveReports';
import {verifyReqUser} from '../../lib/auth';
import {canPreview} from '../../lib/mobileExecutiveReportPreview';

export async function getServerSideProps({req,res,query}) {
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Robots-Tag','noindex, nofollow');
  return {props:{preview:canPreview(query,verifyReqUser(req))}};
}
export default function ExecutivePage({preview}) {
  return <><Head><title>NENOVA | 경영 보고서</title><meta name="robots" content="noindex,nofollow"/><meta name="viewport" content="width=device-width, initial-scale=1"/></Head><ExecutiveReports preview={preview}/></>;
}
