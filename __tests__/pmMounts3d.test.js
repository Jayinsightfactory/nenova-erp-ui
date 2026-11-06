// __tests__/pmMounts3d.test.js — 탈것 15종 적용 경로 고정(사장님 피드백 "탈것 적용 안 됨" 재발 방지)
//   1) lib/pmMounts.MOUNTS 17종 전부가 public/pm3d/mounts.glb 루트 노드(mount_<id>)로 실재
//   2) Scene3D 의 노드명 공식('mount_' + id.replace(/-/g,'_')) == glb 노드명 (노드 매핑 표)
//   3) 각 노드 extras 에 탑승 높이 seatZ · 자세 pose 존재(없으면 캐릭터가 바닥에 묻히거나 서서 탐)
//   4) 구매 저장값('mount.<id>') → mountById → look3d.mount 경유가 끊기지 않음 + 상점 썸네일 webp 실재
// 실행: node __tests__/pmMounts3d.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

function glbJson(file) {
  const d = fs.readFileSync(file);
  assert.strictEqual(d.readUInt32LE(0), 0x46546c67, 'glb magic');
  const len = d.readUInt32LE(12);
  return JSON.parse(d.slice(20, 20 + len).toString('utf8'));
}

(async () => {
  const td = fs.mkdtempSync(path.join(os.tmpdir(), 'pmmounts3d-'));
  for (const n of ['pmThemes', 'pm3dLayout', 'pm3dGrid', 'pmMounts']) {
    fs.writeFileSync(path.join(td, `${n}.mjs`), fs.readFileSync(path.join(process.cwd(), `lib/${n}.js`), 'utf8')
      .replace("'./pmThemes.js'", "'./pmThemes.mjs'").replace("'./pm3dGrid.js'", "'./pm3dGrid.mjs'"));
  }
  const M = await import(pathToFileURL(path.join(td, 'pmMounts.mjs')).href);
  const L = await import(pathToFileURL(path.join(td, 'pm3dLayout.mjs')).href);

  const j = glbJson(path.join(process.cwd(), 'public/pm3d/mounts.glb'));
  const roots = new Map(j.scenes[0].nodes.map((i) => [j.nodes[i].name, j.nodes[i]]));

  assert.strictEqual(M.MOUNTS.length, 17, '탈것 17종(+돛단배·꼬마기차)');
  const table = [];
  for (const m of M.MOUNTS) {
    const node = 'mount_' + m.id.replace(/-/g, '_'); // components/pm3d/Scene3D.js 와 같은 공식
    const n = roots.get(node);
    assert.ok(n, `mounts.glb 에 노드 없음: ${m.id} → ${node} (glb 루트: ${[...roots.keys()].join(', ')})`);
    const ex = n.extras || {};
    assert.ok(typeof ex.seatZ === 'number', `${node} extras.seatZ 누락(탑승 높이)`);
    assert.ok(typeof ex.pose === 'string' && ex.pose, `${node} extras.pose 누락(탑승 자세)`);
    // 구매 저장값 → 장면 적용 경로: items.mount = 'mount.<id>'
    assert.strictEqual(M.mountById(`mount.${m.id}`)?.id, m.id, `mountById('mount.${m.id}') 끊김`);
    const look = L.look3d({ items: { mount: `mount.${m.id}` } }, 'x');
    assert.strictEqual(M.mountById(look.mount)?.id, m.id, `look3d.mount 경유 끊김: ${m.id}`);
    // 상점 카드 썸네일(= mounts.glb 렌더) 실재
    const thumb = path.join(process.cwd(), 'public/pm/mounts/thumb', `${m.id}.webp`);
    assert.ok(fs.existsSync(thumb), `상점 썸네일 없음: ${thumb}`);
    table.push(`${m.id} → ${node} (seatZ ${ex.seatZ}, pose ${ex.pose})`);
  }
  assert.strictEqual(roots.size, 17, 'glb 에 남는/빠진 노드 없음');
  // mountPose: 이동 중=ride, 대기=park, 꺼짐=hidden
  assert.strictEqual(M.mountPose('working', true), 'ride');
  assert.strictEqual(M.mountPose('working', false), 'park');
  assert.strictEqual(M.mountPose('off', true), 'hidden');
  console.log('pmMounts3d OK — 노드 매핑 17/17\n ' + table.join('\n '));
})().catch((e) => { console.error(e); process.exit(1); });
