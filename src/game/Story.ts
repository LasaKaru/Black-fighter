import type { GameEvent } from '../core/GameContext';
import type { Player } from '../player/Player';
import type { Profile } from './Profile';
import { STORY as INK_RUN } from './Objectives';

/** One spoken line in a chapter's cutscene. */
export interface Line {
  who: string;
  text: string;
  /** Speech pitch for this speaker. */
  pitch?: number;
}

export type StepKind =
  | { kind: 'legacy'; index: number }
  | { kind: 'travel'; island: string }
  | { kind: 'mission'; id: string }
  | { kind: 'event'; event: GameEvent; count: number }
  | { kind: 'talk'; npc: string };

export interface StoryStep {
  text: string;
  hint?: string;
  step: StepKind;
}

export interface Chapter {
  title: string;
  intro: Line[];
  steps: StoryStep[];
  outro?: Line[];
  reward: number;
}

const WARDEN = 0.45;
const YOU = 1.1;
const KEEPER = 0.8;

/**
 * "Drawn Out": seven chapters across the ring. Chapter 1 is the Ink Run through
 * the hub; the rest chain island travel, missions, quest-giver talks and the
 * island bosses, with spoken, subtitled dialogue between them.
 */
export const CHAPTERS: Chapter[] = [
  {
    title: 'Chapter 1 · Blank Page',
    intro: [
      { who: 'Narrator', text: 'In Ink City, faces are printed. Yours, you drew yourself.', pitch: 0.9 },
      { who: 'The Warden', text: 'A Blank. Draw them out. Erase them.', pitch: WARDEN },
    ],
    steps: INK_RUN.map((s, i) => ({ text: s.text, hint: s.hint, step: { kind: 'legacy', index: i } })),
    outro: [{ who: 'You', text: 'Every Eye in this city can see me now. Good. Let them watch.', pitch: YOU }],
    reward: 300,
  },
  {
    title: 'Chapter 2 · Lotus Signal',
    intro: [
      { who: 'Radio', text: 'Blank, the Lotus Tower is broadcasting the Warden’s signal. Climb it and scramble the feed.', pitch: 1 },
    ],
    steps: [
      { text: 'Cross the bridge to Colombo', hint: 'East bridge from the plaza · M for the map', step: { kind: 'travel', island: 'colombo' } },
      { text: 'Complete Lotus Leap', hint: 'Mission beacon at the Lotus Tower', step: { kind: 'mission', id: 'lotus_leap' } },
      { text: 'Find the Lighthouse Keeper at Galle Fort', hint: 'Over the long bridge behind Colombo', step: { kind: 'talk', npc: 'keeper' } },
      { text: 'Run the ramparts: complete Rampart Run', step: { kind: 'mission', id: 'rampart_run' } },
    ],
    outro: [{ who: 'Lighthouse Keeper', text: 'The signal is cut. They’ll come looking for you in the hills.', pitch: KEEPER }],
    reward: 400,
  },
  {
    title: 'Chapter 3 · Tea and Thunder',
    intro: [{ who: 'Lighthouse Keeper', text: 'The tea pickers of Ella hide a Tide Eye. Ride the Nine Arch line and climb the pilgrim stair.', pitch: KEEPER }],
    steps: [
      { text: 'Travel to Ella', step: { kind: 'travel', island: 'ella' } },
      { text: 'Complete Nine Arch Express', step: { kind: 'mission', id: 'nine_arch' } },
      { text: 'Catch a Tide Eye', hint: 'Eye nests glow by every island’s arrival plaza', step: { kind: 'event', event: 'catch', count: 1 } },
      { text: 'Reach the summit: complete Pilgrim’s Dawn', hint: 'Adam’s Peak, behind Ella', step: { kind: 'mission', id: 'pilgrim_dawn' } },
    ],
    reward: 450,
  },
  {
    title: 'Chapter 4 · The Lion’s Gate',
    intro: [
      { who: 'The Warden', text: 'Sigiriya’s guardian has never let a Blank through its paws.', pitch: WARDEN },
      { who: 'You', text: 'Then it’s about time.', pitch: YOU },
    ],
    steps: [
      { text: 'Travel to Sigiriya', step: { kind: 'travel', island: 'sigiriya' } },
      { text: 'Climb Lion’s Rock', step: { kind: 'mission', id: 'lion_rock' } },
      { text: 'Defeat the Lion Guardian', hint: 'Dodge the pounce, punish the landing', step: { kind: 'mission', id: 'lion_guardian' } },
    ],
    reward: 600,
  },
  {
    title: 'Chapter 5 · Wonders Watching',
    intro: [{ who: 'Radio', text: 'The wonders are relays for the Warden’s Eyes. Take them back, one by one.', pitch: 1 }],
    steps: [
      { text: 'Defeat Kukulkan at Chichén Itzá', step: { kind: 'mission', id: 'kukulkan' } },
      { text: 'Touch the Five Lotus Buds at Angkor Wat', step: { kind: 'mission', id: 'lotus_buds' } },
      { text: 'Complete Pharaoh’s Climb at Giza', step: { kind: 'mission', id: 'pharaoh_climb' } },
    ],
    reward: 700,
  },
  {
    title: 'Chapter 6 · Downtown Rising',
    intro: [
      { who: 'Radio', text: 'The Warden is broadcasting from the top of the Ink Spire in the Metropolis. Cross the long bridge from the Ink Docks.', pitch: 1 },
      { who: 'You', text: 'A whole city of rooftops. Finally, some room to run.', pitch: YOU },
    ],
    steps: [
      { text: 'Cross the long bridge to the Ink Metropolis', hint: 'From the Ink Docks · M for the map', step: { kind: 'travel', island: 'metro' } },
      { text: 'Climb the Ink Spire', hint: 'Spiral ramp, wall-runs or the grapple', step: { kind: 'mission', id: 'spire_climb' } },
      { text: 'Keep the Flow over the rooftop row', step: { kind: 'mission', id: 'metro_flow' } },
      { text: 'Dive from the Spire to the park', step: { kind: 'mission', id: 'spire_dive' } },
    ],
    outro: [{ who: 'Radio', text: 'Signal down. Only HQ is left. This is it, Blank.', pitch: 1 }],
    reward: 1000,
  },
  {
    title: 'Chapter 7 · Faceless',
    intro: [
      { who: 'The Warden', text: 'You drew a face. I will wipe it clean.', pitch: WARDEN },
      { who: 'You', text: 'Ink doesn’t wash out.', pitch: YOU },
    ],
    steps: [
      { text: 'Defeat the Gladiator King', step: { kind: 'mission', id: 'gladiator_king' } },
      { text: 'Storm Agent HQ: defeat the Warden', step: { kind: 'mission', id: 'warden' } },
    ],
    outro: [
      { who: 'Narrator', text: 'The Eyes close, one by one. Somewhere, a thousand Blanks pick up a pen.', pitch: 0.9 },
      { who: 'You', text: 'Free run. The city is ours now.', pitch: YOU },
    ],
    reward: 1500,
  },
];

export interface StoryHost {
  profile: Profile;
  player: Player;
  islandAt(p: { x: number; z: number }): string | null;
  /** Play a cutscene: lines are subtitled and spoken one after another. */
  say(lines: Line[]): void;
  toast(text: string, kind?: 'info' | 'power' | 'warn'): void;
  /** Point the waypoint at an island / mission. */
  guide(step: StepKind): void;
  onChapter(n: number): void;
  /** A step was cleared: record a checkpoint (cleared text, next goal). */
  onCheckpoint(cleared: string): void;
  /** The legacy Ink Run objective checker (chapter 1). */
  legacy: { index: number; done: boolean; reset(): void };
}

/** Story progress, saved in the profile. */
export class Story {
  private eventCount = 0;

  constructor(private h: StoryHost) {}

  get chapter(): number {
    return this.h.profile.data.story.chapter;
  }

  get stepIndex(): number {
    return this.h.profile.data.story.step;
  }

  get finished(): boolean {
    return this.chapter >= CHAPTERS.length;
  }

  get current(): StoryStep | null {
    const c = CHAPTERS[this.chapter];
    return c ? (c.steps[this.stepIndex] ?? null) : null;
  }

  /** HUD line. */
  hud(): { text: string; hint?: string; progress: string } | null {
    const c = CHAPTERS[this.chapter];
    const s = this.current;
    if (!c || !s) return null;
    return { text: s.text, hint: s.hint, progress: `${c.title.toUpperCase()} · ${this.stepIndex + 1}/${c.steps.length}` };
  }

  /** Begin (or resume) the story: play the chapter intro when at its first step. */
  begin() {
    if (this.finished) {
      this.h.toast('Story complete — replay missions or free run.', 'info');
      return;
    }
    const c = CHAPTERS[this.chapter];
    if (this.stepIndex === 0) {
      this.h.toast(c.title, 'power');
      this.h.say(c.intro);
    }
    if (this.chapter === 0) {
      this.h.legacy.reset();
      for (let i = 0; i < this.stepIndex; i++) this.h.legacy.index = i + 1;
    }
    const s = this.current;
    if (s) this.h.guide(s.step);
  }

  /** Called every frame while the story runs. */
  update() {
    const s = this.current;
    if (!s) return;
    const st = s.step;
    if (st.kind === 'legacy') {
      if (this.h.legacy.done || this.h.legacy.index > st.index) this.advance();
    } else if (st.kind === 'travel') {
      if (this.h.islandAt(this.h.player.feet) === st.island) this.advance();
    } else if (st.kind === 'mission') {
      if (this.h.profile.data.done.includes(st.id)) this.advance();
    }
  }

  event(e: GameEvent) {
    const s = this.current;
    if (s?.step.kind === 'event' && s.step.event === e) {
      this.eventCount++;
      if (this.eventCount >= s.step.count) this.advance();
    }
  }

  /** A quest-giver was spoken to. Returns true if the story wanted it. */
  talked(npc: string): boolean {
    const s = this.current;
    if (s?.step.kind === 'talk' && s.step.npc === npc) {
      this.advance();
      return true;
    }
    return false;
  }

  private advance() {
    const d = this.h.profile.data.story;
    const c = CHAPTERS[d.chapter];
    const cleared = c.steps[d.step]?.text ?? c.title;
    d.step++;
    this.eventCount = 0;
    if (d.step >= c.steps.length) {
      // chapter complete
      if (c.outro) this.h.say(c.outro);
      this.h.profile.addInk(c.reward);
      this.h.toast(`${c.title} complete · +${c.reward} Ink`, 'power');
      d.chapter++;
      d.step = 0;
      this.h.profile.save();
      this.h.onChapter(d.chapter);
      this.h.onCheckpoint(`${c.title} complete`);
      const next = CHAPTERS[d.chapter];
      if (next) {
        setTimeout(() => {
          this.h.toast(next.title, 'power');
          this.h.say(next.intro);
          const s = this.current;
          if (s) this.h.guide(s.step);
        }, 6000);
      }
      return;
    }
    this.h.profile.save();
    const s = this.current!;
    this.h.onCheckpoint(cleared);
    this.h.toast('Next: ' + s.text, 'info');
    this.h.guide(s.step);
  }
}
