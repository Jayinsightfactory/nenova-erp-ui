'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const VISUALS_PATH = path.join(ROOT, 'config/development-story-visuals.json');
const COMPONENT_PATH = path.join(ROOT, 'components/dev/DevelopmentPurposeStories.js');
const STORY_ID = 'mindmap-orbit-visual-map-expanded';
const SOURCE_COMMIT = 'aa78dbdf13aa71d433b2f9c5e9e6bd5b288fd737';
const SOURCE_PATH = 'test-screenshots/03-personal.png';

test('MindMap story visual is an allowlisted local attempt with complete source evidence', () => {
  const visuals = JSON.parse(fs.readFileSync(VISUALS_PATH, 'utf8'));
  const story = visuals.stories?.[STORY_ID];
  assert.ok(story, `${STORY_ID} visual evidence must exist`);
  assert.ok(Array.isArray(story.images) && story.images.length > 0, 'story needs at least one evidence image');

  for (const image of story.images) {
    assert.match(image.id, /^[a-z0-9][a-z0-9-]*$/);
    assert.match(image.src, /^\/development-evidence\/[a-z0-9][a-z0-9-]*\.png$/, 'only the local public evidence directory is allowed');
    assert.equal(image.stage, 'attempt', 'this capture is an attempted UI, not a verified result');
    assert.equal(typeof image.alt, 'string');
    assert.ok(image.alt.trim().length >= 10);
    assert.equal(typeof image.caption, 'string');
    assert.ok(image.caption.includes('시도'), 'the visible caption must identify the image as an attempt');
    assert.equal(typeof image.limitation, 'string');
    assert.ok(image.limitation.trim().length >= 20, 'the image limitation must be explicit');
    assert.equal(image.source?.repository, 'mindmap-viewer');
    assert.match(image.source?.commit || '', /^[0-9a-f]{40}$/, 'source commit must be a full Git hash');
    assert.equal(image.source.commit, SOURCE_COMMIT);
    assert.equal(image.source?.path, SOURCE_PATH);

    const relativePath = image.src.slice(1).split('/');
    const imagePath = path.join(ROOT, 'public', ...relativePath);
    assert.equal(fs.existsSync(imagePath), true, `missing visual file: ${image.src}`);
    assert.deepEqual(
      [...fs.readFileSync(imagePath).subarray(0, 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      `${image.src} must have a real PNG signature`,
    );
  }

  assert.equal(typeof story.resultNote, 'string');
  assert.ok(story.resultNote.trim().length >= 20);
  assert.match(story.resultNote, /결과.*(확인 중|확인되지|없)/, 'missing result evidence must be stated, not inferred');
});

test('development story UI statically imports visuals and keeps failures and native images reachable', () => {
  const source = fs.readFileSync(COMPONENT_PATH, 'utf8');
  assert.match(source, /import\s+\w+\s+from\s+['"]\.\.\/\.\.\/config\/development-story-visuals\.json['"]/, 'visual config must be a static import');
  assert.match(source, /<figure\b/, 'story visuals must use figure semantics');
  assert.match(source, /<img\b[\s\S]*?onError=/, 'image load failures must be handled');
  assert.match(source, /failedImages/, 'image failures must be retained in visible component state');
  assert.match(source, /role=['"](?:status|alert)['"]|aria-live=['"](?:polite|assertive)['"]/, 'image errors must be visibly announced');
  assert.match(source, /href=\{(?:image|item)\.src\}/, 'the native image URL must remain directly reachable');
  assert.match(source, /캡처 크게 보기/, 'the native-size link needs a clear accessible label');
  assert.match(source, /target=['"]_blank['"]/);
  assert.match(source, /rel=['"][^'"]*noreferrer[^'"]*['"]/);

  const figcaptionStart = source.indexOf('<figcaption>');
  const figcaptionEnd = source.indexOf('</figcaption>', figcaptionStart);
  assert.ok(figcaptionStart >= 0 && figcaptionEnd > figcaptionStart, 'visual evidence needs a figcaption');
  const figcaption = source.slice(figcaptionStart, figcaptionEnd);
  assert.match(figcaption, /href=\{item\.src\}/, 'the native image link must remain outside the failed-image branch');
  assert.match(figcaption, /캡처 원본 열기/);
  assert.doesNotMatch(figcaption, /failedImages/, 'the native image link must render even after the preview fails');
});
