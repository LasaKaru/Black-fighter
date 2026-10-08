import { describe, expect, it } from 'vitest';
import { DEFAULT_BRAND, featureOn } from '../shared/brand';
import { LEGAL_MENU, resolvePages } from '../src/ui/Pages';

describe('brand pages and feature switches', () => {
  it('fills placeholders and lists every legal page', () => {
    const pages = resolvePages(DEFAULT_BRAND, '0.5.0');
    for (const id of LEGAL_MENU) expect(pages[id]?.title).toBeTruthy();
    expect(pages.privacy.body).toContain('support@helao2.com');
    expect(pages.about.body).toContain('Version 0.5.0');
    expect(JSON.stringify(pages)).not.toMatch(/\{(company|email|website|version)\}/);
  });

  it('uses the owner text and hides disabled pages', () => {
    const cfg = { ...DEFAULT_BRAND, company: 'Acme', pages: { terms: { title: 'EULA', body: 'By {company}', enabled: true }, health: { title: 'x', body: 'y', enabled: false } } };
    const pages = resolvePages(cfg, '1');
    expect(pages.terms).toEqual({ title: 'EULA', body: 'By Acme' });
    expect(pages.health).toBeUndefined();
  });

  it('feature switches fall back to their defaults', () => {
    expect(featureOn({ features: {} }, 'multiplayer')).toBe(true);
    expect(featureOn({ features: { multiplayer: false } }, 'multiplayer')).toBe(false);
    expect(featureOn({ features: {} }, 'unknown')).toBe(true);
  });
});

import { cleanGpu } from '../src/core/gpu';
describe('GPU names for reports', () => {
  it('reads the device out of ANGLE strings', () => {
    expect(cleanGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('NVIDIA GeForce RTX 3060');
    expect(cleanGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')).toBe('Software rendering (no GPU)');
    expect(cleanGpu('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('Intel Iris Xe Graphics');
    expect(cleanGpu('Apple M2')).toBe('Apple M2');
  });
});
