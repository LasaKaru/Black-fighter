import * as THREE from 'three';
import type { Physics } from '../physics/Physics';
import type { WorldMaterials } from './Materials';
import { Builder } from './Builder';
import { jitter } from './islands/base';

/** The loft floats high above the hub plaza. */
export const HIDEOUT_POS = new THREE.Vector3(0, 95, -15);
/** Teleport pad on the hub plaza. */
export const LOFT_PAD = new THREE.Vector3(-10, 0.1, 30);

const PHOTO_KEY = 'blackeye.photos';

/** Keep a small thumbnail of every photo for the loft's photo wall (last 6). */
export function savePhotoThumb(src: HTMLCanvasElement) {
  try {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 144;
    c.getContext('2d')!.drawImage(src, 0, 0, 256, 144);
    const list = JSON.parse(localStorage.getItem(PHOTO_KEY) ?? '[]') as string[];
    list.unshift(c.toDataURL('image/jpeg', 0.7));
    localStorage.setItem(PHOTO_KEY, JSON.stringify(list.slice(0, 6)));
  } catch {
    /* storage full: skip */
  }
}

export type HideoutAction = 'wardrobe' | 'rest' | 'exit' | 'enter' | 'trophies';

interface Spot {
  pos: THREE.Vector3;
  action: HideoutAction;
  label: string;
}

/**
 * Blank's Loft: a floating home base above the hub. Trophy shelf (bosses
 * beaten, achievements), a mirror that opens the wardrobe, a bed that skips
 * to morning or night, a photo wall of your last six photo-mode shots, and a
 * pad back down to the plaza (and one on the plaza up here).
 */
export class Hideout {
  readonly group = new THREE.Group();
  private spots: Spot[] = [];
  private frames: THREE.Mesh[] = [];
  private trophies: THREE.Mesh[] = [];
  private plaque: THREE.Mesh;
  private plaqueCanvas = document.createElement('canvas');

  constructor(scene: THREE.Scene, physics: Physics, mats: WorldMaterials) {
    const b = new Builder(physics, mats);
    const c = HIDEOUT_POS;
    const y = c.y;
    // floating slab with a faceted rock underside
    b.box(c.x - 13, c.x + 13, y - 1, y, c.z - 13, c.z + 13, 'white');
    const under = jitter(new THREE.ConeGeometry(16, 22, 9, 3, true), 2.2, 7);
    under.rotateX(Math.PI);
    under.translate(c.x, y - 12, c.z);
    b.add('rock', under);
    // walls on three sides, a glass wall facing the city
    b.box(c.x - 13, c.x + 13, y, y + 6, c.z - 13, c.z - 12.4, 'black');
    b.box(c.x - 13, c.x - 12.4, y, y + 6, c.z - 13, c.z + 13, 'black');
    b.box(c.x + 12.4, c.x + 13, y, y + 6, c.z - 13, c.z + 13, 'black');
    b.box(c.x - 13, c.x + 13, y + 6, y + 6.4, c.z - 13, c.z + 2, 'black', null);
    b.box(c.x - 13, c.x + 13, y, y + 1, c.z + 12.6, c.z + 13, 'black');
    b.box(c.x - 13, c.x + 13, y + 1, y + 4, c.z + 12.7, c.z + 12.9, 'glass', null);
    // rug, bed, sofa, desk, neon sign
    b.box(c.x - 5, c.x + 5, y, y + 0.03, c.z - 4, c.z + 4, 'purple', null);
    b.box(c.x + 7, c.x + 12, y, y + 0.7, c.z - 12, c.z - 7, 'dark');
    b.box(c.x + 7.2, c.x + 11.8, y + 0.7, y + 0.9, c.z - 11.8, c.z - 7.2, 'white', null);
    b.box(c.x + 7.5, c.x + 9, y + 0.9, y + 1.2, c.z - 11.5, c.z - 10, 'teal', null);
    b.box(c.x - 11, c.x - 5, y, y + 0.8, c.z - 11.5, c.z - 9.5, 'dark');
    b.box(c.x - 11, c.x - 5, y + 0.8, y + 1.8, c.z - 12, c.z - 11.4, 'dark', null);
    b.box(c.x + 4, c.x + 8, y, y + 1, c.z + 8, c.z + 10, 'wood');
    b.box(c.x - 3, c.x + 3, y + 4.4, y + 5.4, c.z - 12.3, c.z - 12.2, 'neonTeal', null);
    // trophy shelf along the left wall
    b.box(c.x - 12.3, c.x - 11.3, y, y + 1.2, c.z - 6, c.z + 6, 'black');
    // exit pad
    b.cyl(c.x, y, c.z + 9, 1.4, 1.4, 0.15, 24, 'neonPurple', 'concrete');
    const g = new THREE.Group();
    b.finalize(g);
    this.group.add(g);
    // the pad on the hub plaza up to the loft
    const pb = new Builder(physics, mats);
    pb.cyl(LOFT_PAD.x, 0, LOFT_PAD.z, 1.4, 1.5, 0.18, 24, 'neonPurple', 'concrete');
    const pg = new THREE.Group();
    pb.finalize(pg);
    this.group.add(pg);
    // trophy pedestal tops (lit up as bosses fall)
    const goldOff = new THREE.MeshStandardMaterial({ color: '#2a2a30', roughness: 0.6 });
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), goldOff);
      m.position.set(c.x - 11.8, y + 1.75, c.z - 4.5 + i * 3);
      this.trophies.push(m);
      this.group.add(m);
    }
    // photo wall
    for (let i = 0; i < 6; i++) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.7), new THREE.MeshBasicMaterial({ color: '#2a2a30' }));
      f.position.set(c.x + 12.35, y + 2.2 + (i % 2) * 1.9, c.z - 4 + Math.floor(i / 2) * 3.4);
      f.rotation.y = -Math.PI / 2;
      this.frames.push(f);
      this.group.add(f);
    }
    // achievements plaque
    this.plaqueCanvas.width = 512;
    this.plaqueCanvas.height = 256;
    this.plaque = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(this.plaqueCanvas) }));
    this.plaque.position.set(c.x - 12.35, y + 3.4, c.z);
    this.plaque.rotation.y = Math.PI / 2;
    this.group.add(this.plaque);
    // mirror
    const mirror = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 3), new THREE.MeshStandardMaterial({ color: '#c8d4dc', metalness: 0.95, roughness: 0.05 }));
    mirror.position.set(c.x - 2, y + 1.7, c.z - 12.35);
    this.group.add(mirror);
    this.group.traverse((o) => (o.userData.noMap = true));
    scene.add(this.group);
    this.spots = [
      { pos: new THREE.Vector3(c.x - 2, y, c.z - 11), action: 'wardrobe', label: 'F · Wardrobe mirror' },
      { pos: new THREE.Vector3(c.x + 9.5, y, c.z - 6), action: 'rest', label: 'F · Sleep (skip to morning / night)' },
      { pos: new THREE.Vector3(c.x, y, c.z + 9), action: 'exit', label: 'F · Pad down to the plaza' },
      { pos: new THREE.Vector3(c.x - 10.5, y, c.z), action: 'trophies', label: 'F · Trophy shelf' },
      { pos: LOFT_PAD.clone(), action: 'enter', label: 'F · Pad up to Blank’s Loft' },
    ];
  }

  /** Where you arrive in the loft. */
  get arrival(): THREE.Vector3 {
    return HIDEOUT_POS.clone().add(new THREE.Vector3(0, 0.3, 6));
  }

  spotAt(p: THREE.Vector3): Spot | null {
    for (const s of this.spots) if (s.pos.distanceTo(p) < 2.4) return s;
    return null;
  }

  /** Refresh trophies, plaque and photos (called when you arrive). */
  refresh(bossesBeaten: boolean[], achievements: number, totalAchievements: number, level: number) {
    const gold = new THREE.MeshStandardMaterial({ color: '#ffd27a', emissive: '#ff9a2a', emissiveIntensity: 0.8, metalness: 0.6, roughness: 0.3 });
    this.trophies.forEach((t, i) => {
      if (bossesBeaten[i]) t.material = gold;
    });
    const g = this.plaqueCanvas.getContext('2d')!;
    g.fillStyle = '#111114';
    g.fillRect(0, 0, 512, 256);
    g.strokeStyle = '#ffd27a';
    g.lineWidth = 8;
    g.strokeRect(8, 8, 496, 240);
    g.fillStyle = '#f6f5f2';
    g.font = '700 44px sans-serif';
    g.textAlign = 'center';
    g.fillText("BLANK'S LOFT", 256, 70);
    g.font = '600 32px sans-serif';
    g.fillText(`Level ${level}`, 256, 130);
    g.fillText(`${achievements} / ${totalAchievements} achievements`, 256, 185);
    ((this.plaque.material as THREE.MeshBasicMaterial).map as THREE.CanvasTexture).needsUpdate = true;
    let photos: string[] = [];
    try {
      photos = JSON.parse(localStorage.getItem(PHOTO_KEY) ?? '[]') as string[];
    } catch {
      photos = [];
    }
    photos.forEach((url, i) => {
      const f = this.frames[i];
      if (!f) return;
      new THREE.TextureLoader().load(url, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        f.material = new THREE.MeshBasicMaterial({ map: tex });
      });
    });
  }

  update(time: number) {
    this.trophies.forEach((t, i) => (t.rotation.y = time * 0.8 + i));
  }
}
