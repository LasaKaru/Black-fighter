import { describe, expect, it } from 'vitest';
import { Moderation } from '../server/moderation';

describe('chat moderation', () => {
  const m = new Moderation('/tmp/blackeye-mod-test');
  it('stars blocked words with endings and letter swaps', () => {
    expect(m.filter('you are such a fuck1ng noob').text).toBe('you are such a ★★★★★★★ noob');
    expect(m.filter('SH1T happens').text).toBe('★★★★ happens');
    expect(m.filter('b1tches').hit).toBe(true);
  });
  it('leaves innocent words alone', () => {
    for (const ok of ['Scunthorpe', 'shitake mushrooms', 'class assignment', 'gg see you at the Spire']) expect(m.filter(ok).hit).toBe(false);
  });
  it('limits spam and mutes', () => {
    const c = { id: 1, name: 'Rex', ip: '1.2.3.4', room: 'plaza' };
    for (let i = 0; i < 5; i++) expect('text' in m.chat(c, 'hi ' + i, 1000 + i)).toBe(true);
    expect(m.chat(c, 'one more', 1010)).toEqual({ drop: 'Slow down: too many messages.' });
    m.mute('1.2.3.4', 'Rex', 10);
    expect('drop' in m.chat(c, 'hello', Date.now())).toBe(true);
  });
});
