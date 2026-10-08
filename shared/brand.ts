/** Company branding, sponsors, support links, pages and feature switches (edited in the owner panel). */

export interface BrandLink {
  id: string;
  label: string;
  url: string;
  kind: 'donate' | 'social' | 'site' | 'store';
}

export interface Sponsor {
  id: string;
  name: string;
  url: string;
  /** Logo image URL (relative to the server, e.g. /brand/files/acme.png). */
  logo: string;
  tier: 'gold' | 'silver' | 'partner';
  /** Show on the title screen footer. */
  menu: boolean;
  /** Show on billboards in the world. */
  world: boolean;
}

export interface BrandPage {
  title: string;
  body: string;
  enabled?: boolean;
}

export interface LiveEvent {
  name: string;
  /** Ink and XP multipliers (1 = normal, up to 5). */
  ink: number;
  xp: number;
  /** 0 = from now / no end. */
  startsAt: number;
  until: number;
}

export interface BrandConfig {
  company: string;
  presents: string;
  website: string;
  supportEmail: string;
  /** Company logo URL ('' = drawn wordmark). */
  logo: string;
  links: BrandLink[];
  sponsors: Sponsor[];
  advertise: { enabled: boolean; text: string };
  /** Show company graffiti in the world. */
  graffiti: boolean;
  /** Show support / donation links in the desktop (Steam) build. Off by default: Steam may object to external payment links. */
  donationsOnDesktop: boolean;
  /** Text pages (privacy, terms, credits, …) overriding the built-in ones. */
  pages: Record<string, BrandPage>;
  /** Feature switches (multiplayer, leaderboards, cloud saves, news, …). */
  features: Record<string, boolean>;
  /** News / message of the day on the title screen ('' = none). */
  news: string;
  /** A bonus event for every player (e.g. "Double Ink Weekend"). */
  event: LiveEvent;
  /** Older game versions are asked to update and kept out of online play ('' = any). */
  minVersion: string;
  updatedAt?: number;
}

/** The built-in company logo (public/logo), used while no logo is uploaded and the company is HelaO2. */
export const BUNDLED_LOGO = { color: 'logo/helao2-logo.png', light: 'logo/helao2-logo-light.png' };

/** Does this config fall back to the bundled HelaO2 logo? */
export function usesBundledLogo(c: Pick<BrandConfig, 'logo' | 'company'>): boolean {
  return !c.logo && /^\s*hela\s*o2/i.test(c.company);
}

export const DEFAULT_BRAND: BrandConfig = {
  company: 'HelaO2',
  presents: 'presents',
  website: 'https://helao2.com',
  supportEmail: 'support@helao2.com',
  logo: '',
  links: [
    { id: 'bmc', label: 'Buy Me a Coffee', url: '', kind: 'donate' },
    { id: 'kofi', label: 'Ko-fi', url: '', kind: 'donate' },
    { id: 'patreon', label: 'Patreon', url: '', kind: 'donate' },
    { id: 'github', label: 'GitHub Sponsors', url: '', kind: 'donate' },
    { id: 'discord', label: 'Discord', url: '', kind: 'social' },
  ],
  sponsors: [],
  advertise: { enabled: true, text: 'Your brand in Ink City? Contact support@helao2.com' },
  graffiti: true,
  donationsOnDesktop: false,
  pages: {},
  features: {},
  news: '',
  event: { name: '', ink: 1, xp: 1, startsAt: 0, until: 0 },
  minVersion: '',
};

/** Is the bonus event running now? */
export function eventActive(c: Pick<BrandConfig, 'event'>, now = Date.now()): boolean {
  const e = c.event;
  return !!e && (e.ink > 1 || e.xp > 1) && (!e.startsAt || e.startsAt <= now) && (!e.until || e.until > now);
}

/** a < b for dotted versions ("0.5.3" < "0.6"). */
export function versionLess(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  }
  return false;
}

/** Feature switches the owner panel can flip for every player (applied at next start). */
export const FEATURES: Record<string, { label: string; hint: string; on: boolean }> = {
  multiplayer: { label: 'Multiplayer', hint: 'The Multiplayer menu (rooms, co-op, PvP). Turn off while the server is down for long work.', on: true },
  leaderboard: { label: 'World leaderboard', hint: 'Top times per mission on the Missions screen.', on: true },
  conduct: { label: 'Ask players to accept the Code of Conduct before multiplayer', hint: 'Recommended for Steam (online chat and names).', on: true },
  healthWarning: { label: 'Photosensitivity warning at start', hint: 'A short warning screen each launch. Recommended.', on: true },
  footer: { label: 'Title-screen footer (sponsors, links, company)', hint: 'Turn off for a clean title screen.', on: true },
  billboards: { label: 'Billboards in the world', hint: 'Sponsor / company / advertise boards at every island.', on: true },
  news: { label: 'Title-screen news line', hint: 'The news text from the Branding tab.', on: true },
  analytics: { label: 'Anonymous statistics', hint: 'Players can still opt out in Settings → Privacy. Off stops collection for everyone.', on: true },
};

/** Is a feature on (owner switch, else its default)? */
export function featureOn(c: Pick<BrandConfig, 'features'>, id: string): boolean {
  return c.features?.[id] ?? FEATURES[id]?.on ?? true;
}
