// pages/pm3d-preview.js — /pm 3D 장면 미리보기(로그인 불필요, 가짜 데이터만).
// 용도: 소프트 클레이 에셋·셰이딩 교체를 실화면과 같은 Scene3D 로 확인(배포 전후 비교·자동 점검).
// 실제 직원·DB 데이터는 쓰지 않는다 — 이름은 '샘플N', 상태·종족·체형은 고정 배열. 검색 노출 차단(noindex).
import Head from 'next/head';
import dynamic from 'next/dynamic';
import { PmThemeCtx } from '../components/pm/PmTheme';

const Scene3D = dynamic(() => import('../components/pm3d/Scene3D'), { ssr: false, loading: () => <p>3D 장면 불러오는 중…</p> });

const STATUS = ['working', 'idle', 'working', 'off', 'working', 'idle'];
const CHARS = ['human', 'cat', 'bear', 'bunny', 'robot', 'fox', 'penguin', 'dog', 'cactus', 'fairy'];
const BODIES = ['balance', 'cute', 'slim'];
const DEPTS = ['경영지원', '영업지원', '영업부', '수입부'];

const rooms = DEPTS.map((dept, di) => ({
  dept,
  seats: Array.from({ length: 4 }, (_, i) => ({ name: `샘플${di * 4 + i + 1}`, status: STATUS[(di + i) % STATUS.length] })),
}));
const avatars = Object.fromEntries(rooms.flatMap((r) => r.seats).map((p, i) => [p.name, { char: CHARS[i % CHARS.length], bodyType: BODIES[i % BODIES.length], items: {} }]));
const ctx = { manifest: null, theme: null, avatars, save: null, shop: null, reloadShop: null };

export default function Pm3dPreview() {
  return (
    <PmThemeCtx.Provider value={ctx}>
      <Head><title>PM 3D 미리보기</title><meta name="robots" content="noindex" /></Head>
      <div style={{ width: '100vw', height: '100vh' }}>
        <Scene3D themeId="I" rooms={rooms} agents={[]} links={[]} reduced />
      </div>
    </PmThemeCtx.Provider>
  );
}
