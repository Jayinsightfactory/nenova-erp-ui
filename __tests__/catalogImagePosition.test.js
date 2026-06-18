import { describe, expect, it } from 'vitest';
import {
  catalogCoverBox,
  catalogImagePanRange,
  catalogImageStyle,
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
