import { describe, expect, it } from 'vitest';
import {
  catalogCoverBox,
  catalogImagePanRange,
  catalogImageStyle,
  lineHasStoredImageTransform,
  mergeLineImageFields,
} from '../lib/catalogImagePosition.js';

describe('catalogCoverBox', () => {
  it('square at 100% has no pan overflow', () => {
    const box = catalogCoverBox(1, 100, 50, 50);
    expect(box.overflowX).toBe(0);
    expect(box.overflowY).toBe(0);
    expect(box.left).toBe(0);
    expect(box.top).toBe(0);
  });

  it('landscape at 100% pans horizontally', () => {
    const box = catalogCoverBox(2, 100, 100, 50);
    expect(box.overflowX).toBeGreaterThan(0);
    expect(box.overflowY).toBe(0);
    expect(box.left).toBeLessThan(0);
  });

  it('portrait at 100% pans horizontally', () => {
    const box = catalogCoverBox(0.5, 100, 100, 100);
    expect(box.overflowX).toBe(0);
    expect(box.overflowY).toBeGreaterThan(0);
    expect(box.top).toBeLessThan(0);
  });

  it('zoom increases pan range for square', () => {
    const at100 = catalogImagePanRange(1, 100);
    const at150 = catalogImagePanRange(1, 150);
    expect(at100.needsZoomForPan).toBe(true);
    expect(at150.needsZoomForPan).toBe(false);
    expect(at150.canPanX).toBe(true);
  });
});

describe('mergeLineImageFields', () => {
  it('keeps line transform when custom values without manual flag', () => {
    const line = { imagePosX: 8, imagePosY: 53, imageScale: 138, imageRotate: 0 };
    const img = { id: 'a', url: '/x.jpg', posX: 50, posY: 50, scale: 100, rotate: 0 };
    const merged = mergeLineImageFields(line, img);
    expect(merged.imagePosX).toBe(8);
    expect(merged.imageScale).toBe(138);
    expect(merged.imageManualAdjusted).toBe(true);
  });

  it('detects stored transform', () => {
    expect(lineHasStoredImageTransform({ imagePosX: 50, imageScale: 100 })).toBe(false);
    expect(lineHasStoredImageTransform({ imagePosX: 10, imageScale: 100 })).toBe(true);
  });
});

describe('catalogImageStyle', () => {
  it('uses absolute layout when aspect known', () => {
    const style = catalogImageStyle({ imagePosX: 100, imageScale: 100 }, 2);
    expect(style.position).toBe('absolute');
    expect(style.left).toMatch(/^-/);
  });

  it('falls back to object-position without aspect', () => {
    const style = catalogImageStyle({ imagePosX: 30, imageScale: 100 }, null);
    expect(style.objectPosition).toBe('30% 50%');
  });
});
