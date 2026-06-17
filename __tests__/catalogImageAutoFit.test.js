import { describe, expect, it } from 'vitest';
import {
  buildCatalogAutoFitTransform,
  computeCatalogAutoFitScale,
  needsCatalogImageAutoFit,
} from '../lib/catalogImageAutoFit.js';
import { catalogImageRotatePad } from '../lib/catalogImagePosition.js';

describe('catalogImageAutoFit', () => {
  it('cover default scale is 100%', () => {
    expect(computeCatalogAutoFitScale()).toBe(100);
  });

  it('buildAutoFit sets cover fill and auto flag', () => {
    const t = buildCatalogAutoFitTransform();
    expect(t).toMatchObject({
      posX: 50, posY: 50, scale: 100, rotate: 0,
      autoAdjusted: true, manualAdjusted: false,
    });
  });

  it('needs auto-fit for default or legacy contain scale', () => {
    expect(needsCatalogImageAutoFit({ scale: 100, posX: 50, posY: 50 })).toBe(true);
    expect(needsCatalogImageAutoFit({ autoAdjusted: true, scale: 200 })).toBe(true);
    expect(needsCatalogImageAutoFit({ autoAdjusted: true, scale: 100 })).toBe(false);
    expect(needsCatalogImageAutoFit({ manualAdjusted: true, scale: 100 })).toBe(false);
  });
});

describe('catalogImageRotatePad', () => {
  it('pads 90deg rotation', () => {
    expect(catalogImageRotatePad(90)).toBeGreaterThan(1);
    expect(catalogImageRotatePad(0)).toBe(1);
  });
});
