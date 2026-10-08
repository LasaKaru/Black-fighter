/** "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)" → "NVIDIA GeForce RTX 3060". */
export function cleanGpu(raw: string): string {
  if (/swiftshader|llvmpipe|software/i.test(raw)) return 'Software rendering (no GPU)';
  let s = raw.trim();
  const angle = /^ANGLE \((.*)\)$/.exec(s);
  if (angle) s = angle[1].split(', ')[1] ?? angle[1];
  // drop nested (…) groups and API suffixes
  for (let i = 0; i < 4; i++) s = s.replace(/\s*\([^()]*\)/g, '');
  return s.replace(/\s+(Direct3D|OpenGL|Vulkan|Metal|vs_|ps_).*$/i, '').trim().slice(0, 60);
}
