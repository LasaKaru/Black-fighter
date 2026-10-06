import { describe, expect, it } from 'vitest';
import { SnapshotBuffer, lerpAngle } from '../src/net/Interpolation';
import { makeRng, wrapAngle, clamp, moveTowards } from '../src/core/math';
import { sanitizeName, sanitizeRoom, isVec3 } from '../shared/protocol';
import { TUNING, jumpVelocity } from '../shared/tuning';
import { packAttack, unpackAttack, AttackId } from '../src/character/Animator';
import { fromNet, toNet, DEFAULT_APPEARANCE } from '../src/character/Appearance';

describe('SnapshotBuffer', () => {
  it('interpolates between bracketing snapshots', () => {
    const b = new SnapshotBuffer<number>();
    b.push(100, 0);
    b.push(200, 10);
    const s = b.sample(150)!;
    expect(s.a + (s.b - s.a) * s.k).toBeCloseTo(5);
  });

  it('ignores out-of-order snapshots and clamps old render times', () => {
    const b = new SnapshotBuffer<number>();
    b.push(100, 1);
    b.push(90, 99);
    expect(b.size).toBe(1);
    const s = b.sample(10)!;
    expect(s.a).toBe(1);
    expect(s.k).toBe(0);
  });

  it('extrapolates a bounded amount past the newest snapshot', () => {
    const b = new SnapshotBuffer<number>();
    b.push(0, 0);
    b.push(100, 10);
    const s = b.sample(1000)!;
    expect(s.k).toBeLessThanOrEqual(1.5);
  });

  it('lerps angles the short way round', () => {
    expect(lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5)).toBeCloseTo(Math.PI, 5);
  });
});

describe('math', () => {
  it('rng is deterministic per seed (every client builds the same city)', () => {
    const a = makeRng(1337);
    const b = makeRng(1337);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
    const r = makeRng(5);
    for (let i = 0; i < 100; i++) {
      const v = r.int(2, 4);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(4);
    }
  });

  it('wraps angles into [-π, π]', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(-Math.PI);
  });

  it('clamps and moves towards targets', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(moveTowards(0, 10, 3)).toBe(3);
    expect(moveTowards(9, 10, 3)).toBe(10);
  });
});

describe('protocol', () => {
  it('sanitises names and rooms', () => {
    expect(sanitizeName('  <script>Bob</script> ')).toBe('scriptBobscript');
    expect(sanitizeName('')).toBe('Blank');
    expect(sanitizeName(42)).toBe('Blank');
    expect(sanitizeRoom('My Room!!')).toBe('myroom');
    expect(sanitizeRoom(undefined)).toBe('plaza');
  });

  it('validates vectors', () => {
    expect(isVec3([1, 2, 3])).toBe(true);
    expect(isVec3([1, 2])).toBe(false);
    expect(isVec3([1, NaN, 3])).toBe(false);
    expect(isVec3('1,2,3')).toBe(false);
  });

  it('round-trips appearance through the network format', () => {
    const a = structuredClone(DEFAULT_APPEARANCE);
    a.print = 'HELLO';
    a.acc = ['backpack', 'glasses'];
    a.top = 'hoodie';
    a.hat = 'bucket';
    const back = fromNet(toNet(a));
    expect(back.colors).toEqual(a.colors);
    expect(back.print).toBe('HELLO');
    expect(back.acc).toEqual(['backpack', 'glasses']);
    expect(back.top).toBe('hoodie');
    expect(back.hat).toBe('bucket');
    expect(back.patches).toBe(true);
  });

  it('rejects malformed appearance colours', () => {
    const n = toNet(DEFAULT_APPEARANCE);
    n.c.skin = 'red; background:url(x)';
    expect(fromNet(n).colors.skin).toBe(DEFAULT_APPEARANCE.colors.skin);
  });
});

describe('tuning (level-design metrics contract, README §14)', () => {
  it('jump velocity reaches the designed apex', () => {
    const v = jumpVelocity(TUNING.jumpApex);
    const apex = (v * v) / (2 * TUNING.gravityUp);
    expect(apex).toBeCloseTo(TUNING.jumpApex);
  });

  it('a running jump clears the 4 m metric gap', () => {
    const v = jumpVelocity(TUNING.jumpApex);
    const tUp = v / TUNING.gravityUp;
    // fall back to take-off height
    const tDown = Math.sqrt((2 * TUNING.jumpApex) / TUNING.gravityDown);
    expect(TUNING.runSpeed * (tUp + tDown)).toBeGreaterThan(3.5);
    expect(TUNING.sprintSpeed * (tUp + tDown)).toBeGreaterThan(5.0);
  });

  it('super-jump can reach the 10 m high tower', () => {
    expect(TUNING.superJumpMaxHeight).toBeGreaterThanOrEqual(10.5);
  });
});

describe('animation params', () => {
  it('packs attack id with progress', () => {
    const p = packAttack(AttackId.Kick, 0.5);
    expect(unpackAttack(p).id).toBe(AttackId.Kick);
    expect(unpackAttack(p).t).toBeCloseTo(0.5);
    expect(unpackAttack(packAttack(AttackId.Jab, 1.2)).id).toBe(AttackId.Jab);
  });
});
