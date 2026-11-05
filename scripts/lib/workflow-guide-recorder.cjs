const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { sourceHash, sha256 } = require('../check-workflow-guides.cjs');

function vttTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

// Reusable real Chrome capture. The caller serves the tested UI and intercepts every API
// with synthetic fixtures. This module deliberately refuses a production browser URL.
async function createWorkflowGuideRecorder(page, { root = process.cwd(), workflowId, guideId, title, sourceFiles, outputDir, fixtureOnly, ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe' }) {
  if (fixtureOnly !== true || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(page.url()).hostname)) throw Error('Guide recording requires a local synthetic fixture page');
  if (!/^[a-z0-9-]+$/.test(workflowId) || !/^[a-z0-9-]+$/.test(guideId)) throw Error('Invalid guide identity');
  if (!sourceFiles?.length) throw Error('Guide sourceFiles required');
  const sourceHashes = Object.fromEntries(sourceFiles.map(file => [file, sourceHash(path.join(root, file))]));
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  const scale = await page.evaluate(() => ({ scale: window.visualViewport?.scale ?? 1, zoom: getComputedStyle(document.documentElement).zoom }));
  if (scale.scale !== 1 || !['1', 'normal'].includes(scale.zoom)) throw Error('Guide requires 100% browser zoom');
  const destination = outputDir ?? path.join(root, 'public/guides', workflowId);
  fs.mkdirSync(destination, { recursive: true });
  const work = path.join(root, '.verify', 'guide-recordings'); fs.mkdirSync(work, { recursive: true });
  const raw = path.join(work, `${workflowId}-${guideId}.webm`);
  const mp4 = path.join(destination, `${guideId}.mp4`);
  const captions = path.join(destination, `${guideId}.ko.vtt`);
  const proofFile = path.join(destination, `${guideId}.proof.json`);
  const installOverlay = title => {
    document.getElementById('nenova-guide-capture')?.remove();
    const host = document.createElement('div'); host.id = 'nenova-guide-capture';
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;font-family:Arial,"Malgun Gothic",sans-serif';
    const label = document.createElement('div'); label.textContent = `${title} · 연습용 자료`;
    label.style.cssText = 'position:absolute;top:8px;right:18px;background:#122e58;color:white;border-radius:8px;padding:9px 15px;font-size:18px;box-shadow:0 3px 12px #0003';
    const caption = document.createElement('div'); caption.dataset.guideCaption = 'true';
    caption.style.cssText = 'position:absolute;bottom:24px;left:50%;transform:translateX(-50%);max-width:1500px;width:max-content;white-space:pre-line;background:#102847f2;color:#fff;border-radius:12px;padding:17px 26px;font-size:26px;line-height:1.5;text-align:center;box-shadow:0 4px 20px #0004';
    const cursor = document.createElement('div'); cursor.dataset.guideCursor = 'true';
    cursor.style.cssText = 'position:absolute;width:26px;height:26px;border:3px solid #ffb300;border-radius:50%;background:#ffb30033;transform:translate(-50%,-50%);left:-40px;top:-40px;box-shadow:0 0 0 3px #fff9';
    host.append(label, caption, cursor); document.body.append(host);
    document.addEventListener('mousemove', event => { cursor.style.left = `${event.clientX}px`; cursor.style.top = `${event.clientY}px`; });
    document.addEventListener('mousedown', () => { cursor.style.background = '#f27300aa'; });
    document.addEventListener('mouseup', () => { cursor.style.background = '#ffb30033'; });
  };
  await page.evaluate(installOverlay, title);
  const recorder = await page.screencast({ path: raw, format: 'webm', fps: 20, quality: 20, ffmpegPath });
  const started = performance.now(), cues = [], chapters = []; let pending;
  const elapsed = () => (performance.now() - started) / 1000;
  async function caption(text) {
    const now = elapsed(); if (pending) cues.push({ ...pending, end: now });
    pending = { start: now, text: String(text) };
    if (!await page.$('#nenova-guide-capture')) await page.evaluate(installOverlay, title);
    await page.evaluate(text => {
      const host = document.getElementById('nenova-guide-capture');
      const surface = document.querySelector('dialog[open]') ?? document.body;
      if (host.parentElement !== surface) surface.append(host);
      host.querySelector('[data-guide-caption]').textContent = text;
    }, String(text));
  }
  async function stop() {
    if (pending) cues.push({ ...pending, end: elapsed() });
    await recorder.stop();
    execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-i', raw, '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { windowsHide: true, timeout: 300000 });
    const probe = JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,avg_frame_rate:format=duration', '-of', 'json', mp4], { encoding: 'utf8', windowsHide: true }));
    const stream = probe.streams[0], duration = Number(probe.format.duration);
    const fps = stream.avg_frame_rate.split('/').map(Number).reduce((a, b) => a / b);
    if (stream.width !== 1920 || stream.height !== 1080 || !(duration > 0)) throw Error('Recorded guide dimensions/duration invalid');
    fs.writeFileSync(captions, 'WEBVTT\n\n' + cues.filter(cue => cue.start < duration).map(cue => `${vttTime(cue.start)} --> ${vttTime(Math.min(cue.end, duration))}\n${cue.text.replace(/-->/g, '→')}\n`).join('\n'));
    for (const file of sourceFiles) if (sourceHashes[file] !== sourceHash(path.join(root, file))) throw Error(`UI changed while recording: ${file}; record again after the screen is final`);
    const proof = { version: 1, recordedAt: new Date().toISOString(), width: stream.width, height: stream.height, browserZoom: 100, fps, duration, capture: 'actual-browser-ui', dataMode: 'synthetic-fixture', productionWrites: 0, videoSha256: sha256(fs.readFileSync(mp4)), captionsSha256: sha256(fs.readFileSync(captions)), sourceHashes };
    fs.writeFileSync(proofFile, JSON.stringify(proof, null, 2) + '\n');
    return { chapters, duration, mp4, captions, proofFile };
  }
  return { caption, chapter: (scenario, text) => { chapters.push({ scenario, title: text, seconds: Math.round(elapsed() * 1000) / 1000 }); }, pause: ms => new Promise(resolve => setTimeout(resolve, ms)), restoreOverlay: () => page.evaluate(installOverlay, title), stop };
}
module.exports = { createWorkflowGuideRecorder, vttTime };
