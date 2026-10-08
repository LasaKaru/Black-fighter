/**
 * Built-in text pages (About & legal menu, Settings → Privacy, credits roll).
 * The owner panel can rewrite or hide any of them (brand config `pages`).
 * Format: "# Heading", "- bullet", blank line = new paragraph.
 *
 * These are sensible starting texts, not legal advice: have the privacy
 * policy and terms checked for the countries you sell in before release.
 */
import type { BrandConfig, BrandPage } from '../../shared/brand';

export const DEFAULT_PAGES: Record<string, BrandPage> = {
  health: {
    title: 'Health & safety warning',
    body: `# Photosensitive seizure warning
A very small percentage of people may experience a seizure when exposed to certain visual images, including flashing lights or patterns that may appear in video games. Even people with no history of seizures or epilepsy may have an undiagnosed condition that can cause these "photosensitive epileptic seizures" while playing.

Immediately stop playing and consult a doctor if you experience any symptoms such as lightheadedness, altered vision, eye or face twitching, jerking or shaking of arms or legs, disorientation, confusion, or momentary loss of awareness.

# Lower the risk
- Play in a well-lit room and sit farther from the screen.
- Take a 10 to 15 minute break every hour.
- Do not play when you are tired or need sleep.
- Settings → Access → "Reduce flashes" softens flashes and screen effects.
- Settings → Graphics / Picture: turn off motion blur and film grain.`,
  },
  privacy: {
    title: 'Privacy policy',
    body: `# Who we are
BLACKEYE: Ink City is made by {company}. Contact: {email}.

# What the game collects
If "Anonymous statistics" is on (Settings → Privacy, on by default), the game sends anonymous gameplay events to our server:
- a random install id made on your device (not linked to your name, Steam account or email);
- the game version, platform (web / desktop / mobile), operating system, screen size, graphics card model and language;
- play events: sessions and play time, frame rate, game modes, missions started and finished, islands found, achievements, story chapters, secrets found, menu link clicks;
- error messages if the game crashes.

# Crash reports
If "Send crash reports" is on (Settings → Privacy), a crash, graphics reset or freeze sends a report with the error, the game version, platform, graphics card, what you were doing (mode, island, mission, frame rate) and your last 30 in-game actions (screens, missions, islands). It carries the same random install id and nothing that identifies you. Reports are grouped by problem; only the latest 5 reports per problem are kept, for at most 500 problems, and they can be deleted once the problem is fixed.

We do not collect your name, email, IP address (it is used only to deliver the request and is not stored), contacts, location or payment details.

# Multiplayer
When you join a multiplayer room, the server receives your chosen player name, your character's look, your position and your chat messages so other players in the room can see them. Chat messages are relayed to the room; the last 300 messages are kept in the server's memory (not on disk) so moderators can act on abuse, and are gone when the server restarts. Blocked words are replaced automatically, and players who break the rules can be muted or banned. Server logs record when a player name joins a room and moderation actions (kicks and bans); the network address of a banned player is kept on the ban list until they are unbanned.

# Leaderboards
If you set a top time-trial time, your player name and time are kept on the world leaderboard (top 20 per mission).

# Saves
Your progress is saved on your device. On Steam, Steam Cloud may copy those save files to your Steam account. If you use a cloud save code (Settings → Gameplay → Save slots), that save is stored on our server under a random code until you overwrite it; ask us to delete it any time.

# Why
We use statistics only to fix bugs, balance missions and decide what to make next. We do not sell data and do not use it for advertising profiles. Sponsor logos in the game are plain images: sponsors receive no data about you.

# Your choices
- Turn statistics off any time in Settings → Privacy: nothing more is sent.
- To have the statistics tied to your install id deleted, email {email} with the id shown in Settings → Privacy.

# Keeping data
Statistics are kept as daily totals; raw events are deleted after 120 days.

# Children
The game is not directed at children under 13 and does not knowingly collect personal information from them.

# Changes
We will post changes on this page and in the game's news line.`,
  },
  terms: {
    title: 'Terms of use',
    body: `# Licence
{company} gives you a personal, non-exclusive, non-transferable licence to play BLACKEYE: Ink City. The game, its art, music and code remain the property of {company} and its licensors.

# You may
- play the game and share screenshots, clips and streams, including monetised videos;
- make fan art and fan content that is clearly not official.

# You may not
- copy, resell or redistribute the game, or remove its notices;
- cheat in multiplayer, attack or overload the servers, or reverse engineer the game to do so;
- use the game to harass other players (see the Code of Conduct).

# Online services
Multiplayer, leaderboards and news are provided "as is" and may change, pause for maintenance or end. We may remove players who break these terms or the Code of Conduct.

# Purchases and support
Purchases through Steam follow Steam's refund policy. Donations and sponsorships are voluntary and are not purchases of in-game items.

# Liability
The game is provided "as is" without warranties to the extent the law allows. Nothing here limits rights you have under consumer law in your country.

Contact: {email}`,
  },
  conduct: {
    title: 'Online code of conduct',
    body: `Multiplayer works because everyone plays fair. By joining a room you agree to:

- Be respectful. No harassment, hate speech, threats, or sexual content, in names or in chat.
- Play fair. No cheats, hacks, exploits or modified clients.
- Keep personal information private: yours and other people's.
- No spam, scams or advertising.
- Follow the room host's reasonable rules.

Breaking these rules can get you kicked or banned from our servers. Report a problem to {email} with the room name and time.`,
  },
  credits: {
    title: 'Credits',
    body: `# {company} presents
BLACKEYE: Ink City

# Game design, art & code
{company}

# Built with
three.js
Rapier physics (Dimforge)
Electron
Vite and TypeScript

# Music & sound
Original adaptive score and synthesised sound design
Recorded tracks: see music/manifest.json credits

# Special thanks
Our players, testers and supporters
Everyone who sponsored, donated or shared the game`,
  },
  licenses: {
    title: 'Third-party licences',
    body: `BLACKEYE: Ink City uses these open-source projects. Thank you to their authors.

# three.js — MIT licence
Copyright © 2010-2026 three.js authors

# Rapier (@dimforge/rapier3d-compat) — Apache License 2.0
Copyright © 2020 Sébastien Crozet / Dimforge EURL

# ws — MIT licence
Copyright © 2011 Einar Otto Stangvik and contributors

# Electron — MIT licence (desktop build)
Copyright © Electron contributors, GitHub Inc. Electron includes Chromium (BSD-style licence) and Node.js (MIT licence); their full notices ship in the LICENSES.chromium.html file next to the game.

# MIT licence text
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: the above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

# Apache License 2.0
Licensed under the Apache License, Version 2.0. You may obtain a copy at apache.org/licenses/LICENSE-2.0. Distributed on an "AS IS" basis, without warranties or conditions of any kind.`,
  },
  support: {
    title: 'Support & contact',
    body: `# Need help?
Email {email}. Please include:
- your platform (Steam / web) and game version (shown below the title-screen menu);
- what happened and what you expected;
- a screenshot if you can.

# Common fixes
- Low frame rate: Settings → Graphics, pick a lower preset or turn on Dynamic resolution.
- No sound: check Settings → Audio volumes, then click the game window once.
- Controller not working: press any button on it with the game window focused.
- Lost progress: Settings → Gameplay → Save slots; desktop saves are also backed up by Steam Cloud.

# Advertise in Ink City
Want your brand's logo on billboards and in the title screen? Contact {email}.

# Website
{website}`,
  },
  about: {
    title: 'About',
    body: `# BLACKEYE: Ink City
An open-world ink-noir parkour brawler: seventeen islands, the Metropolis, a story campaign from Mission 1 to the Final, vehicles, secrets and online play.

Made by {company}. {website}

Version {version}`,
  },
};

/** Pages in the "About & legal" menu, in order. */
export const LEGAL_MENU = ['about', 'privacy', 'terms', 'conduct', 'licenses', 'credits', 'support', 'health'];

/** Built-in pages merged with the owner's custom text, placeholders filled; hidden pages dropped. */
export function resolvePages(cfg: BrandConfig, version: string): Record<string, { title: string; body: string }> {
  const out: Record<string, { title: string; body: string }> = {};
  const fill = (s: string) =>
    s
      .replaceAll('{company}', cfg.company)
      .replaceAll('{email}', cfg.supportEmail || 'support@helao2.com')
      .replaceAll('{website}', cfg.website || '')
      .replaceAll('{version}', version);
  for (const id of new Set([...Object.keys(DEFAULT_PAGES), ...Object.keys(cfg.pages ?? {})])) {
    const p = cfg.pages?.[id] ?? DEFAULT_PAGES[id];
    if (!p || p.enabled === false) continue;
    out[id] = { title: fill(p.title), body: fill(p.body) };
  }
  return out;
}
