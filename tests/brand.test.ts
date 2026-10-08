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
