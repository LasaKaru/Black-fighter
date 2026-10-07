/**
 * Prints every in-game achievement as a Steamworks table (API name, display
 * name, description) and writes build/steam-achievements.csv, so the Steam
 * achievements can be created with matching API names. The desktop build
 * unlocks Steam achievements with the in-game id upper-cased.
 *   npm run steam:achievements
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { ACHIEVEMENTS } from '../src/game/Progression';

const rows = ACHIEVEMENTS.map((a) => [a.id.toUpperCase(), a.name, a.desc]);
const csv = ['api_name,display_name,description', ...rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(','))].join('\n');
mkdirSync('build', { recursive: true });
writeFileSync('build/steam-achievements.csv', csv + '\n');
console.table(rows.map(([api, name, desc]) => ({ api, name, desc })));
console.log(`${rows.length} achievements → build/steam-achievements.csv`);
