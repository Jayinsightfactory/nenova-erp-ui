import Head from 'next/head';
import { verifyReqUser } from '../../lib/auth';
import ImportOneStopPipeline from '../../components/import-tools/ImportOneStopPipeline';

export default function ImportOneStopPipelinePage({ userId = '', userName = '' }) {
  return (
    <>
      <Head>
        <title>수입 원스톱 파이프라인 | Nenova</title>
      </Head>
      <ImportOneStopPipeline userId={userId} userName={userName} />
    </>
  );
}

export async function getServerSideProps({ req, res }) {
  const user = await verifyReqUser(req, res);
  if (!user) {
    return { redirect: { destination: '/login', permanent: false } };
  }
  return {
    props: {
      userId: String(user.userId || ''),
      userName: String(user.userName || user.userId || ''),
    },
  };
}
