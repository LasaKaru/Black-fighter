/**
 * Colour-blind correction filters (Daltonization-style colour matrices) as
 * SVG filters applied to the game canvas with CSS. The ink palette's key
 * accents (teal routes, purple goo, orange fire) are shifted apart for each
 * type of colour vision deficiency.
 */
const MATRICES: Record<string, string> = {
  protanopia: '0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0',
  deuteranopia: '0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0',
  tritanopia: '0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0',
};

let injected = false;

function inject() {
  if (injected) return;
  injected = true;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  for (const [name, m] of Object.entries(MATRICES)) {
    const f = document.createElementNS(ns, 'filter');
    f.id = 'cb-' + name;
    // correction = boost the contrast the deficiency loses: shift towards the simulated loss's complement
    const cm = document.createElementNS(ns, 'feColorMatrix');
    cm.setAttribute('type', 'matrix');
    cm.setAttribute('values', correction(m));
    f.append(cm);
    svg.append(f);
  }
  document.body.append(svg);
}

/** Daltonize: original + (original − simulated) redistributed to channels the viewer can see. */
function correction(sim: string): string {
  const s = sim.trim().split(/\s+/).map(Number);
  // error matrix E = I − S on RGB; redistribute red/green error into blue and vice versa
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const S = [s[0], s[1], s[2], s[5], s[6], s[7], s[10], s[11], s[12]];
  const E = I.map((v, i) => v - S[i]);
  const shift = [0, 0, 0, 0.7, 1, 0, 0.7, 0, 1];
  const M = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) M[r * 3 + c] += shift[r * 3 + k] * E[k * 3 + c];
  const out = I.map((v, i) => v + M[i]);
  return `${out[0]} ${out[1]} ${out[2]} 0 0  ${out[3]} ${out[4]} ${out[5]} 0 0  ${out[6]} ${out[7]} ${out[8]} 0 0  0 0 0 1 0`;
}

export function colorblindFilter(mode: string): string {
  return MATRICES[mode] ? `url(#cb-${mode})` : '';
}

export function applyColorblind(canvas: HTMLCanvasElement, mode: string) {
  if (MATRICES[mode]) inject();
  canvas.style.filter = colorblindFilter(mode);
}
