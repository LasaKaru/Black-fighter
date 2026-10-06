import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Builder } from '../src/world/Builder';
import type { Physics } from '../src/physics/Physics';
import type { WorldMaterials } from '../src/world/Materials';

// The lot finder never touches physics or materials, so stubs are enough.
const builder = () => new Builder({} as Physics, {} as WorldMaterials);

describe('Builder footprints (Ink City district lots)', () => {
  it('records geometry above ground but not ground-flush slabs', () => {
    const b = builder();
    const slab = new THREE.BoxGeometry(50, 1, 50);
    slab.translate(0, -0.5, 0);
    b.add('white', slab);
    expect(b.footprints.length).toBe(0);
    const block = new THREE.BoxGeometry(4, 6, 4);
    block.translate(10, 3, 10);
    b.add('black', block);
    expect(b.footprints.length).toBe(1);
  });

  it('can switch recording off for authored ground', () => {
    const b = builder();
    b.recordFootprints = false;
    const g = new THREE.BoxGeometry(2, 2, 2);
    g.translate(0, 1, 0);
    b.add('white', g);
    expect(b.footprints.length).toBe(0);
  });

  it('finds free lots with a margin', () => {
    const b = builder();
    const block = new THREE.BoxGeometry(4, 6, 4);
    block.translate(0, 3, 0); // occupies x/z in [-2, 2]
    b.add('white', block);
    expect(b.lotFree(-1, 1, -1, 1)).toBe(false);
    expect(b.lotFree(5, 8, 5, 8)).toBe(true);
    // 1 m away: blocked by the default 1.5 m margin, free with a small one
    expect(b.lotFree(3, 6, -1, 1)).toBe(false);
    expect(b.lotFree(3, 6, -1, 1, 0.5)).toBe(true);
  });

  it('ignores things floating above the height of interest', () => {
    const b = builder();
    const ring = new THREE.TorusGeometry(3, 0.2, 6, 12);
    ring.translate(0, 40, 0);
    b.add('teal', ring);
    expect(b.lotFree(-1, 1, -1, 1, 1.5, 20)).toBe(true);
    expect(b.lotFree(-1, 1, -1, 1, 1.5, 50)).toBe(false);
  });
});
