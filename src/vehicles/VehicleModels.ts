import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type VehicleType = 'tuktuk' | 'inkbox' | 'blotter' | 'buggy' | 'bus' | 'moto' | 'board' | 'skiff' | 'glider';

export interface WheelDef {
  /** model space (forward = +Z, right = -X) */
  x: number;
  z: number;
  steer: boolean;
  drive: boolean;
}

export interface VehicleSpec {
  name: string;
  /** chassis half extents in model space (x = half width, y = half height, z = half length) */
  half: [number, number, number];
  mass: number;
  wheels: WheelDef[];
  wheelY: number;
  wheelR: number;
  rest: number;
  stiffness: number;
  friction: number;
  engine: number;
  brake: number;
  maxSteer: number;
  topSpeed: number;
  /** driver seat (model space, relative to chassis centre) */
  seat: [number, number, number];
  camDist: number;
  paint: string[];
  price: number;
  /** wheels: raycast car · hover: rides a cushion above the ground · fly: free flight */
  mode?: 'wheels' | 'hover' | 'fly';
  /** Ride standing up (boards) instead of seated. */
  stance?: 'sit' | 'stand';
  /** Hover height above the ground. */
  hoverH?: number;
  /** Hover craft that holds altitude over gaps (sinks slowly instead of falling). */
  holdAlt?: boolean;
  /** Two-wheeler: actively balanced, leans into turns. */
  lean?: boolean;
  blurb?: string;
}

export const VEHICLES: Record<VehicleType, VehicleSpec> = {
  tuktuk: {
    name: 'Tuk-Tuk', half: [0.75, 0.55, 1.35], mass: 180,
    wheels: [{ x: 0, z: 1.1, steer: true, drive: false }, { x: 0.7, z: -0.95, steer: false, drive: true }, { x: -0.7, z: -0.95, steer: false, drive: true }],
    wheelY: -0.35, wheelR: 0.3, rest: 0.35, stiffness: 28, friction: 2.4, engine: 520, brake: 6, maxSteer: 0.55, topSpeed: 17,
    seat: [0, 0.05, 0.35], camDist: 6, paint: ['#111114', '#eceae6', '#17a9a3', '#6b2bff', '#ff7a1a'], price: 0,
  },
  inkbox: {
    name: 'Inkbox', half: [0.95, 0.55, 1.9], mass: 260,
    wheels: [{ x: 0.85, z: 1.25, steer: true, drive: true }, { x: -0.85, z: 1.25, steer: true, drive: true }, { x: 0.85, z: -1.25, steer: false, drive: false }, { x: -0.85, z: -1.25, steer: false, drive: false }],
    wheelY: -0.35, wheelR: 0.38, rest: 0.35, stiffness: 32, friction: 2.6, engine: 900, brake: 9, maxSteer: 0.5, topSpeed: 30,
    seat: [0.4, 0.15, 0.15], camDist: 7, paint: ['#eceae6', '#111114', '#17a9a3'], price: 0,
  },
  blotter: {
    name: 'Blotter', half: [1.0, 0.45, 2.3], mass: 320,
    wheels: [{ x: 0.92, z: 1.55, steer: true, drive: false }, { x: -0.92, z: 1.55, steer: true, drive: false }, { x: 0.95, z: -1.5, steer: false, drive: true }, { x: -0.95, z: -1.5, steer: false, drive: true }],
    wheelY: -0.28, wheelR: 0.42, rest: 0.3, stiffness: 40, friction: 2.2, engine: 1500, brake: 12, maxSteer: 0.42, topSpeed: 42,
    seat: [0.42, 0.05, -0.1], camDist: 8, paint: ['#111114', '#6b2bff', '#ff7a1a'], price: 600,
  },
  buggy: {
    name: 'Goo Buggy', half: [0.95, 0.5, 1.6], mass: 220,
    wheels: [{ x: 1.0, z: 1.2, steer: true, drive: true }, { x: -1.0, z: 1.2, steer: true, drive: true }, { x: 1.0, z: -1.15, steer: false, drive: true }, { x: -1.0, z: -1.15, steer: false, drive: true }],
    wheelY: -0.25, wheelR: 0.5, rest: 0.55, stiffness: 22, friction: 3.0, engine: 1100, brake: 9, maxSteer: 0.55, topSpeed: 32,
    seat: [0, 0.25, -0.1], camDist: 7, paint: ['#6b2bff', '#eceae6', '#17a9a3'], price: 400,
  },
  moto: {
    name: 'Ink Moto', half: [0.32, 0.45, 1.05], mass: 140, lean: true,
    // four narrow wheels in two pairs read as two (the twins are hidden)
    wheels: [{ x: 0.12, z: 0.85, steer: true, drive: false }, { x: -0.12, z: 0.85, steer: true, drive: false }, { x: 0.12, z: -0.82, steer: false, drive: true }, { x: -0.12, z: -0.82, steer: false, drive: true }],
    wheelY: -0.25, wheelR: 0.34, rest: 0.3, stiffness: 30, friction: 2.9, engine: 760, brake: 8, maxSteer: 0.48, topSpeed: 40,
    seat: [0, 0.38, -0.2], camDist: 5.5, paint: ['#111114', '#ff7a1a', '#eceae6'], price: 500, blurb: 'Light, twitchy and very fast. Leans into every corner.',
  },
  board: {
    name: 'Hoverboard', half: [0.32, 0.08, 0.8], mass: 70, mode: 'hover', stance: 'stand', hoverH: 0.5, wheels: [],
    wheelY: 0, wheelR: 0.1, rest: 0.1, stiffness: 0, friction: 0, engine: 0, brake: 0, maxSteer: 2.6, topSpeed: 26,
    seat: [0, 0.1, 0], camDist: 5, paint: ['#17a9a3', '#6b2bff', '#111114'], price: 350, blurb: 'Surf the streets on a cushion of ink. Space to drift.',
  },
  skiff: {
    name: 'Cloud Skiff', half: [0.9, 0.35, 2.0], mass: 240, mode: 'hover', holdAlt: true, hoverH: 0.9, wheels: [],
    wheelY: 0, wheelR: 0.1, rest: 0.1, stiffness: 0, friction: 0, engine: 0, brake: 0, maxSteer: 1.7, topSpeed: 24,
    seat: [0, 0.35, -0.5], camDist: 8, paint: ['#eceae6', '#17a9a3', '#111114'], price: 700, blurb: 'A boat for the cloud sea: holds its height over the gaps between islands.',
  },
  glider: {
    name: 'Goo Glider', half: [0.6, 0.3, 1.4], mass: 160, mode: 'fly', hoverH: 0.7, wheels: [],
    wheelY: 0, wheelR: 0.1, rest: 0.1, stiffness: 0, friction: 0, engine: 0, brake: 0, maxSteer: 1.5, topSpeed: 34,
    seat: [0, 0.3, -0.2], camDist: 9, paint: ['#6b2bff', '#111114', '#eceae6'], price: 900, blurb: 'Fly! W thrust, Space climb, let go to sink. Shift boosts.',
  },
  bus: {
    name: 'Island Bus', half: [1.3, 1.5, 5.2], mass: 1200,
    wheels: [{ x: 1.2, z: 3.4, steer: true, drive: false }, { x: -1.2, z: 3.4, steer: true, drive: false }, { x: 1.2, z: -3.2, steer: false, drive: true }, { x: -1.2, z: -3.2, steer: false, drive: true }],
    wheelY: -1.2, wheelR: 0.55, rest: 0.4, stiffness: 40, friction: 2, engine: 4000, brake: 40, maxSteer: 0.4, topSpeed: 18,
    seat: [0.7, 0.4, 4.3], camDist: 13, paint: ['#eceae6'], price: 99999,
  },
};

type MatName = 'paint' | 'trim' | 'glass' | 'chrome' | 'canvas' | 'light' | 'tail' | 'stripe' | 'tire' | 'seat';

interface ModelParts {
  root: THREE.Group;
  wheels: THREE.Object3D[];
}

const matCache = new Map<string, THREE.Material>();
function mat(name: MatName, paint: string): THREE.Material {
  const key = name === 'paint' ? 'paint:' + paint : name;
  let m = matCache.get(key);
  if (!m) {
    switch (name) {
      case 'paint':
        m = new THREE.MeshStandardMaterial({ color: paint, roughness: 0.35, metalness: 0.15 });
        break;
      case 'trim':
        m = new THREE.MeshStandardMaterial({ color: '#16161a', roughness: 0.7 });
        break;
      case 'glass':
        m = new THREE.MeshStandardMaterial({ color: '#1d3a40', roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.75 });
        break;
      case 'chrome':
        m = new THREE.MeshStandardMaterial({ color: '#c8cad0', roughness: 0.25, metalness: 0.9 });
        break;
      case 'canvas':
        m = new THREE.MeshStandardMaterial({ color: '#1e1e22', roughness: 0.95 });
        break;
      case 'light':
        m = new THREE.MeshStandardMaterial({ color: '#fff4d8', emissive: '#ffd27a', emissiveIntensity: 2.5 });
        break;
      case 'tail':
        m = new THREE.MeshStandardMaterial({ color: '#ff3a2a', emissive: '#ff1a10', emissiveIntensity: 1.8 });
        break;
      case 'stripe':
        m = new THREE.MeshStandardMaterial({ color: '#efe8d8', roughness: 0.4 });
        break;
      case 'tire':
        m = new THREE.MeshStandardMaterial({ color: '#141416', roughness: 0.9, flatShading: true });
        break;
      case 'seat':
        m = new THREE.MeshStandardMaterial({ color: '#5a2a1e', roughness: 0.8 });
        break;
    }
    matCache.set(key, m!);
  }
  return m!;
}

class MiniBuilder {
  private parts = new Map<MatName, THREE.BufferGeometry[]>();
  add(name: MatName, g: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    g.rotateX(rx);
    g.rotateY(ry);
    g.rotateZ(rz);
    g.translate(x, y, z);
    const ng = g.index ? g.toNonIndexed() : g;
    for (const n of Object.keys(ng.attributes)) if (n !== 'position' && n !== 'normal') ng.deleteAttribute(n);
    if (!this.parts.has(name)) this.parts.set(name, []);
    this.parts.get(name)!.push(ng);
  }
  build(root: THREE.Object3D, paint: string) {
    for (const [name, list] of this.parts) {
      const m = new THREE.Mesh(mergeGeometries(list)!, mat(name, paint));
      m.castShadow = true;
      m.receiveShadow = true;
      root.add(m);
    }
  }
}

function wheel(r: number, w: number, paint: string): THREE.Object3D {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 14), mat('tire', paint));
  tire.rotation.z = Math.PI / 2;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.02, 8), mat('chrome', paint));
  hub.rotation.z = Math.PI / 2;
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, r * 0.15, r * 1.1), mat('trim', paint));
  g.add(tire, hub, spoke);
  g.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : 0));
  return g;
}

/** Build a vehicle model in model space (forward +Z), centred on the chassis. */
export function buildVehicleModel(type: VehicleType, paint: string): ModelParts {
  const spec = VEHICLES[type];
  const root = new THREE.Group();
  const mb = new MiniBuilder();
  const [hw, hh, hl] = spec.half;
  switch (type) {
    case 'tuktuk': {
      // front cowl + cabin floor + rear bench body + canvas roof
      mb.add('paint', new RoundedBoxGeometry(1.0, 0.9, 0.7, 3, 0.18), 0, 0.0, 1.05);
      mb.add('paint', new RoundedBoxGeometry(1.5, 0.75, 1.9, 3, 0.15), 0, -0.05, -0.35);
      mb.add('trim', new THREE.BoxGeometry(1.52, 0.12, 2.6), 0, -0.4, 0);
      mb.add('canvas', new RoundedBoxGeometry(1.56, 0.12, 2.25, 2, 0.05), 0, 1.38, -0.25);
      mb.add('canvas', new THREE.BoxGeometry(1.5, 1.0, 0.08), 0, 0.85, -1.33);
      for (const s of [-1, 1]) {
        mb.add('chrome', new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6), s * 0.72, 0.85, 0.75, 0.12);
        mb.add('chrome', new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6), s * 0.74, 0.85, -1.3);
        mb.add('paint', new THREE.BoxGeometry(0.06, 0.25, 1.6), s * 0.76, 0.35, -0.35);
      }
      mb.add('glass', new THREE.BoxGeometry(1.3, 0.75, 0.05), 0, 0.95, 0.82, -0.3);
      mb.add('seat', new RoundedBoxGeometry(1.3, 0.3, 0.6, 2, 0.08), 0, 0.3, -0.8);
      mb.add('seat', new RoundedBoxGeometry(0.5, 0.2, 0.45, 2, 0.06), 0, 0.3, 0.35);
      mb.add('chrome', new THREE.CylinderGeometry(0.025, 0.025, 0.9, 6), 0, 0.82, 0.62, 0, 0, Math.PI / 2);
      mb.add('light', new THREE.SphereGeometry(0.11, 8, 6), 0, 0.42, 1.42);
      mb.add('trim', new THREE.CylinderGeometry(0.06, 0.06, 0.4, 6), 0.4, -0.25, -1.4, Math.PI / 2);
      break;
    }
    case 'inkbox': {
      mb.add('paint', new RoundedBoxGeometry(1.9, 0.7, 3.9, 3, 0.25), 0, -0.05, 0);
      mb.add('paint', new RoundedBoxGeometry(1.7, 0.7, 2.2, 3, 0.25), 0, 0.6, -0.35);
      mb.add('glass', new THREE.BoxGeometry(1.55, 0.5, 0.05), 0, 0.62, 0.8, -0.45);
      mb.add('glass', new THREE.BoxGeometry(1.55, 0.45, 0.05), 0, 0.62, -1.47, 0.35);
      for (const s of [-1, 1]) mb.add('glass', new THREE.BoxGeometry(0.05, 0.42, 1.8), s * 0.86, 0.66, -0.35);
      mb.add('trim', new THREE.BoxGeometry(1.95, 0.25, 0.2), 0, -0.25, 1.95);
      mb.add('trim', new THREE.BoxGeometry(1.95, 0.25, 0.2), 0, -0.25, -1.95);
      for (const s of [-1, 1]) {
        mb.add('light', new THREE.BoxGeometry(0.4, 0.15, 0.05), s * 0.62, 0.05, 1.96);
        mb.add('trim', new THREE.BoxGeometry(0.06, 0.1, 0.2), s * 0.98, 0.3, 0.7);
      }
      // painted eye on the doors
      for (const s of [-1, 1]) {
        mb.add('stripe', new THREE.CircleGeometry(0.26, 16), s * 0.962, 0.05, 0, 0, (s * Math.PI) / 2);
        mb.add('trim', new THREE.CircleGeometry(0.12, 12), s * 0.97, 0.05, 0, 0, (s * Math.PI) / 2);
      }
      break;
    }
    case 'blotter': {
      mb.add('paint', new RoundedBoxGeometry(2.0, 0.6, 4.6, 3, 0.2), 0, -0.05, 0);
      mb.add('paint', new RoundedBoxGeometry(1.7, 0.55, 2.0, 3, 0.2), 0, 0.45, -0.4);
      mb.add('glass', new THREE.BoxGeometry(1.55, 0.42, 0.05), 0, 0.48, 0.62, -0.7);
      for (const s of [-1, 1]) mb.add('glass', new THREE.BoxGeometry(0.05, 0.36, 1.6), s * 0.86, 0.5, -0.4);
      mb.add('trim', new RoundedBoxGeometry(0.7, 0.2, 1.0, 2, 0.06), 0, 0.3, 1.4);
      mb.add('trim', new THREE.BoxGeometry(2.0, 0.08, 0.5), 0, 0.62, -2.15);
      for (const s of [-1, 1]) mb.add('trim', new THREE.BoxGeometry(0.08, 0.35, 0.08), s * 0.8, 0.42, -2.15);
      mb.add('light', new THREE.BoxGeometry(1.4, 0.1, 0.05), 0, 0.1, 2.31);
      mb.add('chrome', new THREE.BoxGeometry(2.04, 0.12, 0.2), 0, -0.3, 2.3);
      for (const s of [-1, 1]) mb.add('chrome', new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8), s * 0.6, -0.35, -2.35, Math.PI / 2);
      // racing stripes
      for (const s of [-1, 1]) mb.add('stripe', new THREE.BoxGeometry(0.18, 0.02, 4.4), s * 0.22, 0.26, 0);
      break;
    }
    case 'buggy': {
      mb.add('paint', new RoundedBoxGeometry(1.4, 0.35, 3.1, 2, 0.12), 0, -0.2, 0);
      mb.add('seat', new RoundedBoxGeometry(0.6, 0.6, 0.5, 2, 0.1), 0, 0.15, -0.25);
      // roll cage
      const tube = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
        const a = new THREE.Vector3(x0, y0, z0);
        const b = new THREE.Vector3(x1, y1, z1);
        const len = a.distanceTo(b);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        const gg = new THREE.CylinderGeometry(0.045, 0.045, len, 6);
        gg.applyQuaternion(q);
        gg.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
        mb.add('chrome', gg);
      };
      for (const s of [-1, 1]) {
        tube(s * 0.6, -0.05, 0.6, s * 0.55, 1.15, -0.1);
        tube(s * 0.55, 1.15, -0.1, s * 0.6, -0.05, -1.1);
        tube(s * 0.6, -0.05, 1.4, s * 0.6, -0.05, -1.4);
      }
      tube(-0.55, 1.15, -0.1, 0.55, 1.15, -0.1);
      mb.add('light', new THREE.BoxGeometry(0.9, 0.12, 0.08), 0, 1.2, 0.0);
      mb.add('trim', new THREE.BoxGeometry(1.2, 0.3, 0.2), 0, -0.1, 1.6);
      mb.add('paint', new RoundedBoxGeometry(0.9, 0.25, 0.6, 2, 0.08), 0, 0.0, -1.35);
      break;
    }
    case 'moto': {
      mb.add('paint', new RoundedBoxGeometry(0.42, 0.42, 1.2, 2, 0.12), 0, 0.12, 0.05);
      mb.add('paint', new RoundedBoxGeometry(0.36, 0.28, 0.5, 2, 0.1), 0, 0.42, 0.35);
      mb.add('seat', new RoundedBoxGeometry(0.32, 0.12, 0.6, 2, 0.05), 0, 0.38, -0.25);
      mb.add('trim', new THREE.BoxGeometry(0.3, 0.3, 0.5), 0, -0.12, -0.1);
      mb.add('chrome', new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6), 0, 0.4, 0.78, 0.45);
      mb.add('chrome', new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6), 0, 0.62, 0.62, 0, 0, Math.PI / 2);
      mb.add('chrome', new THREE.CylinderGeometry(0.05, 0.06, 0.6, 8), 0.18, -0.15, -0.65, Math.PI / 2 - 0.2);
      mb.add('light', new THREE.SphereGeometry(0.1, 8, 6), 0, 0.5, 0.75);
      mb.add('stripe', new THREE.BoxGeometry(0.44, 0.04, 0.9), 0, 0.34, 0.05);
      break;
    }
    case 'board': {
      mb.add('paint', new RoundedBoxGeometry(0.6, 0.08, 1.6, 2, 0.04), 0, 0, 0);
      mb.add('trim', new RoundedBoxGeometry(0.62, 0.03, 1.62, 2, 0.015), 0, -0.05, 0);
      mb.add('light', new THREE.BoxGeometry(0.5, 0.02, 1.3), 0, -0.075, 0);
      mb.add('stripe', new THREE.BoxGeometry(0.08, 0.01, 1.4), 0, 0.045, 0);
      break;
    }
    case 'skiff': {
      // a little ink boat with an outrigger and a sail fin
      const hull = new THREE.CylinderGeometry(0.9, 0.55, 3.8, 10, 1, false, 0, Math.PI);
      hull.rotateX(Math.PI / 2);
      hull.rotateZ(Math.PI);
      mb.add('paint', hull, 0, 0.1, 0);
      mb.add('trim', new THREE.BoxGeometry(1.7, 0.08, 3.6), 0, 0.12, 0);
      mb.add('seat', new RoundedBoxGeometry(0.8, 0.25, 0.6, 2, 0.06), 0, 0.3, -0.5);
      mb.add('chrome', new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), 0, 1.25, 0.4);
      const sail = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.4, 0.45), new THREE.Vector3(0, 2.3, 0.45), new THREE.Vector3(0, 0.5, -1.0)]);
      sail.computeVertexNormals();
      mb.add('canvas', sail);
      mb.add('stripe', new THREE.CircleGeometry(0.3, 14), 0.86, 0.12, 0.9, 0, Math.PI / 2);
      mb.add('light', new THREE.BoxGeometry(1.2, 0.04, 2.8), 0, -0.36, 0);
      break;
    }
    case 'glider': {
      mb.add('paint', new RoundedBoxGeometry(0.8, 0.5, 2.6, 3, 0.2), 0, 0, 0);
      mb.add('glass', new RoundedBoxGeometry(0.6, 0.35, 0.9, 2, 0.15), 0, 0.35, 0.3);
      // swept wings and tail fins
      for (const s of [-1, 1]) {
        const wing = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0.6), new THREE.Vector3(s * 2.6, 0.1, -0.6), new THREE.Vector3(0, 0, -0.7)]);
        wing.computeVertexNormals();
        mb.add('paint', wing);
        const wing2 = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -0.7), new THREE.Vector3(s * 2.6, 0.1, -0.6), new THREE.Vector3(0, 0, 0.6)]);
        wing2.computeVertexNormals();
        mb.add('trim', wing2);
        mb.add('stripe', new THREE.BoxGeometry(0.5, 0.03, 0.12), s * 2.2, 0.1, -0.5);
      }
      mb.add('trim', new THREE.BoxGeometry(0.06, 0.55, 0.5), 0, 0.4, -1.15);
      mb.add('light', new THREE.CylinderGeometry(0.16, 0.22, 0.25, 10), 0, 0, -1.4, Math.PI / 2);
      break;
    }
    case 'bus': {
      mb.add('paint', new RoundedBoxGeometry(2.6, 2.6, 10.4, 3, 0.3), 0, 0.2, 0);
      mb.add('stripe', new THREE.BoxGeometry(2.62, 0.3, 10.2), 0, -0.4, 0);
      for (let k = 0; k < 8; k++) for (const s of [-1, 1]) mb.add('glass', new THREE.BoxGeometry(0.05, 0.9, 1.0), s * 1.31, 0.75, -4 + k * 1.15);
      mb.add('glass', new THREE.BoxGeometry(2.3, 1.1, 0.05), 0, 0.8, 5.21);
      mb.add('trim', new THREE.BoxGeometry(2.62, 0.4, 0.2), 0, -0.9, 5.2);
      mb.add('canvas', new THREE.BoxGeometry(2.0, 0.4, 3.0), 0, 1.7, 0.5);
      break;
    }
  }
  // red tail lights on the rear face (x offset, height, rear z)
  const tail: Record<VehicleType, [number, number, number]> = { tuktuk: [0.55, -0.05, -1.31], inkbox: [0.7, 0.05, -1.96], blotter: [0.72, 0.05, -2.31], buggy: [0.3, 0.0, -1.66], bus: [1.05, -0.6, -5.21], moto: [0.08, 0.3, -0.56], board: [0.2, 0.0, -0.81], skiff: [0.4, 0.2, -1.9], glider: [0.25, 0.05, -1.31] };
  const [tx, ty, tz] = tail[type];
  for (const s of [-1, 1]) mb.add('tail', new THREE.BoxGeometry(0.32, 0.12, 0.04), s * tx, ty, tz);
  mb.build(root, paint);
  const wheels: THREE.Object3D[] = [];
  spec.wheels.forEach((w, i) => {
    // the moto's twin wheels: one visible per axle, centred
    const hidden = type === 'moto' && i % 2 === 1;
    const wh = hidden ? new THREE.Group() : wheel(spec.wheelR, type === 'buggy' ? 0.42 : type === 'moto' ? 0.16 : 0.26, paint);
    wh.position.set(type === 'moto' ? 0 : w.x, spec.wheelY - spec.rest * 0.5, w.z);
    root.add(wh);
    wheels.push(wh);
  });
  void hw;
  void hh;
  void hl;
  return { root, wheels };
}
