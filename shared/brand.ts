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
  updatedAt?: number;
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
};
