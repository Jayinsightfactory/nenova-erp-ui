import { describe, expect, it } from 'vitest';
import {
  buildCatalogAutoFitTransform,
  computeCatalogAutoFitScale,
  needsCatalogImageAutoFit,
} from '../lib/catalogImageAutoFit.js';

describe('catalogImageAutoFit', () => {
  it('square image stays at 100%', () => {
    expect(computeCatalogAutoFitScale(800, 800)).toBe(100);
  });

  it('landscape image scales to fill square', () => {
    expect(computeCatalogAutoFitScale(1600, 800)).toBe(200);
  });

  it('portrait image scales to fill square', () => {
    expect(computeCatalogAutoFitScale(600, 1200)).toBe(200);
  });

  it('buildAutoFit sets center and auto flag', () => {
    const t = buildCatalogAutoFitTransform(1200, 600);
    expect(t).toMatchObject({
      posX: 50, posY: 50, scale: 200, rotate: 0,
      autoAdjusted: true, manualAdjusted: false,
    });
  });

  it('needs auto-fit for default transform only', () => {
    expect(needsCatalogImageAutoFit({ scale: 100, posX: 50, posY: 50 })).toBe(true);
    expect(needsCatalogImageAutoFit({ autoAdjusted: true, scale: 200 })).toBe(false);
    expect(needsCatalogImageAutoFit({ manualAdjusted: true, scale: 100 })).toBe(false);
  });
});
