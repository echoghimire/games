import * as THREE from 'three';
import type { AssetManager } from '../assets/AssetManager';
import type { TextureKey } from '../assets/AssetManifest';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../game/GameEvents';
import { HitEffect } from './HitEffect';
import { ParticleSystem } from './ParticleSystem';

const rand = (min: number, max: number): number => min + Math.random() * (max - min);

type SystemName = 'spark' | 'star' | 'glow' | 'blood' | 'dust' | 'debris' | 'smoke' | 'flame' | 'ember';

interface SystemSpec {
  readonly texture: TextureKey;
  readonly capacity: number;
  readonly blending: THREE.Blending;
  /** Color multiplier (>1 makes additive sprites bloom brighter). */
  readonly intensity: number;
}

const SYSTEMS: Readonly<Record<SystemName, SystemSpec>> = {
  spark: { texture: 'dot', capacity: 400, blending: THREE.AdditiveBlending, intensity: 2.2 },
  star: { texture: 'star', capacity: 48, blending: THREE.AdditiveBlending, intensity: 2 },
  glow: { texture: 'dot', capacity: 64, blending: THREE.AdditiveBlending, intensity: 1.4 },
  blood: { texture: 'dot', capacity: 360, blending: THREE.NormalBlending, intensity: 1 },
  dust: { texture: 'smoke', capacity: 200, blending: THREE.NormalBlending, intensity: 1 },
  debris: { texture: 'debris', capacity: 80, blending: THREE.NormalBlending, intensity: 1 },
  smoke: { texture: 'smoke', capacity: 200, blending: THREE.NormalBlending, intensity: 1 },
  flame: { texture: 'flame', capacity: 420, blending: THREE.AdditiveBlending, intensity: 1.8 },
  ember: { texture: 'dot', capacity: 240, blending: THREE.AdditiveBlending, intensity: 2.5 },
};

/**
 * All gameplay VFX. Subscribes to game events and turns them into particles,
 * slashes and light pulses; gameplay code never calls it directly.
 */
export class EffectManager {
  readonly root = new THREE.Group();
  private readonly systems: Record<SystemName, ParticleSystem>;
  private readonly systemList: readonly ParticleSystem[];
  private readonly hits: HitEffect;
  private readonly fireEmitters: THREE.Vector3[] = [];
  private fireAccum = 0;
  private emberAccum = 0;
  private time = 0;
  private readonly unsubscribe: Array<() => void> = [];
  /** Global gore switch (blood-like particles). */
  blood = true;

  constructor(
    assets: AssetManager,
    private readonly events: EventBus<GameEvents>,
    private readonly stageHalfWidth: number,
  ) {
    const make = (spec: SystemSpec): ParticleSystem => {
      const tex = assets.getTexture(spec.texture);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sys = new ParticleSystem(spec.capacity, tex, spec.blending, spec.intensity);
      this.root.add(sys.points);
      return sys;
    };
    this.systems = {
      spark: make(SYSTEMS.spark),
      star: make(SYSTEMS.star),
      glow: make(SYSTEMS.glow),
      blood: make(SYSTEMS.blood),
      dust: make(SYSTEMS.dust),
      debris: make(SYSTEMS.debris),
      smoke: make(SYSTEMS.smoke),
      flame: make(SYSTEMS.flame),
      ember: make(SYSTEMS.ember),
    };
    this.systemList = Object.values(this.systems);
    const slashTex = assets.getTexture('slash');
    slashTex.colorSpace = THREE.SRGBColorSpace;
    this.hits = new HitEffect(slashTex);
    this.root.add(this.hits.root);
    this.bind();
  }

  setFireEmitters(points: readonly THREE.Vector3[]): void {
    this.fireEmitters.length = 0;
    for (const p of points) this.fireEmitters.push(p.clone());
  }

  setViewport(heightPx: number, camera: THREE.PerspectiveCamera): void {
    for (const s of this.systemList) s.setViewport(heightPx, camera);
  }

  private bind(): void {
    const ev = this.events;
    this.unsubscribe.push(
      ev.on('hit', (e) => this.impact(e.point.x, e.point.y, e.direction, e.heavy, e.counter)),
      ev.on('block', (e) => this.blockSparks(e.point.x, e.point.y)),
      ev.on('throw', (e) => {
        this.impact(e.point.x, e.point.y, e.direction, true, false);
        this.dustBurst(e.point.x, 18, 1.4);
      }),
      ev.on('grabConnect', (e) => this.blockSparks(e.point.x, e.point.y)),
      ev.on('grabTech', (e) => this.blockSparks(e.point.x, e.point.y)),
      ev.on('land', (e) => this.dustBurst(e.x, e.hard ? 22 : 10, e.hard ? 1.3 : 0.8)),
      ev.on('jump', (e) => this.dustBurst(e.x, 8, 0.6)),
      ev.on('dash', (e) => this.dustBurst(e.x, 6, 0.5)),
      ev.on('ko', (e) => {
        this.impact(e.point.x, e.point.y, 1, true, true);
        this.impact(e.point.x, e.point.y + 0.3, -1, true, true);
      }),
    );
  }

  /** Sparks + glow + blood + slash + light pulse at an impact point. */
  impact(x: number, y: number, facing: number, heavy: boolean, counter: boolean): void {
    const s = this.systems;
    const sparks = heavy ? 34 : 16;
    const speed = heavy ? 9 : 6;
    for (let i = 0; i < sparks; i++) {
      const a = rand(-1.2, 1.2) + (facing > 0 ? 0 : Math.PI);
      const v = rand(speed * 0.4, speed);
      s.spark.emit(x, y, rand(-0.1, 0.3), Math.cos(a) * v, Math.sin(a) * v + 1.5, rand(-2, 2), rand(0.18, 0.4), rand(0.12, 0.24), 0.03, counter ? 0xff5a30 : 0xffd27a, 1, 12, 2.5, rand(-8, 8));
    }
    s.glow.emit(x, y, 0.3, 0, 0, 0, heavy ? 0.22 : 0.14, heavy ? 2.4 : 1.4, heavy ? 3.4 : 2, counter ? 0xff4020 : 0xffc070, 1);
    s.glow.emit(x, y, 0.3, 0, 0, 0, 0.08, heavy ? 1.2 : 0.7, 0.2, 0xffffff, 1);
    s.star.emit(x, y, 0.35, 0, 0, 0, heavy ? 0.16 : 0.11, heavy ? 1.6 : 0.9, heavy ? 2.6 : 1.4, counter ? 0xff6a40 : 0xfff0c0, 1, 0, 0, 3);
    if (this.blood) {
      const drops = heavy ? 22 : 9;
      for (let i = 0; i < drops; i++) {
        const v = rand(1.5, heavy ? 6 : 4);
        s.blood.emit(x, y, rand(-0.2, 0.3), facing * v * rand(0.5, 1.1), rand(0.5, 4), rand(-1.5, 1.5), rand(0.45, 0.9), rand(0.1, 0.2), rand(0.05, 0.1), i % 3 === 0 ? 0x7a0404 : 0xc0140c, 1, 14, 0.6);
      }
    }
    if (heavy) {
      this.hits.slash(x, y, facing, counter ? 2.2 : 1.8, counter ? 0xff5030 : 0xffb060, rand(-0.6, 0.3));
      for (let i = 0; i < 6; i++) {
        s.smoke.emit(x, y, 0.1, facing * rand(0.5, 2), rand(0.2, 1.2), rand(-0.5, 0.5), rand(0.4, 0.7), 0.4, 1.3, 0x3a2a24, 0.35, -0.5, 1.5, rand(-1, 1));
      }
    } else {
      this.hits.slash(x, y, facing, 1.1, 0xffe0a0, rand(-0.3, 0.3));
    }
    this.hits.flashLight(x, y, heavy ? 22 : 10, counter ? 0xff4a20 : 0xffb070);
  }

  blockSparks(x: number, y: number): void {
    const s = this.systems;
    for (let i = 0; i < 14; i++) {
      const a = rand(0, Math.PI * 2);
      const v = rand(2, 6);
      s.spark.emit(x, y, 0.2, Math.cos(a) * v, Math.sin(a) * v + 1, rand(-1, 1), rand(0.12, 0.25), rand(0.08, 0.16), 0.02, 0x9fd4ff, 1, 8, 3);
    }
    s.glow.emit(x, y, 0.3, 0, 0, 0, 0.12, 1.2, 1.8, 0x6ab8ff, 0.9);
    this.hits.flashLight(x, y, 14, 0x7ab8ff);
  }

  dustBurst(x: number, count: number, scale: number): void {
    if (scale > 1) {
      for (let i = 0; i < 5; i++) {
        this.systems.debris.emit(x + rand(-0.3, 0.3), 0.1, rand(-0.2, 0.3), rand(-2.5, 2.5), rand(2, 4.5), rand(-0.5, 0.5), rand(0.5, 0.8), rand(0.25, 0.4), 0.2, 0x6a5a50, 1, 14, 0.5, rand(-6, 6));
      }
    }
    const d = this.systems.dust;
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      d.emit(x + rand(-0.2, 0.2), 0.08, rand(-0.3, 0.3), side * rand(0.6, 2.4) * scale, rand(0.2, 0.9), rand(-0.6, 0.6), rand(0.4, 0.8), 0.35 * scale, 1.1 * scale, 0xb8a490, 0.45, -0.3, 2.2, rand(-1, 1));
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.emitFire(dt);
    this.emitEmbers(dt);
    for (const s of this.systemList) s.update(dt);
    this.hits.update(dt);
  }

  private emitFire(dt: number): void {
    if (this.fireEmitters.length === 0) return;
    this.fireAccum += dt * 34;
    while (this.fireAccum >= 1) {
      this.fireAccum -= 1;
      for (const p of this.fireEmitters) {
        this.systems.flame.emit(p.x + rand(-0.06, 0.06), p.y - 0.1, p.z + rand(-0.06, 0.06), rand(-0.15, 0.15), rand(0.8, 1.6), rand(-0.1, 0.1), rand(0.35, 0.6), rand(0.32, 0.45), 0.08, Math.random() < 0.3 ? 0xffd070 : 0xff6a1a, 0.9, -0.6, 0.6, rand(-2, 2));
        if (Math.random() < 0.08) {
          this.systems.ember.emit(p.x, p.y, p.z, rand(-0.4, 0.4), rand(1, 2.2), rand(-0.2, 0.2), rand(1.2, 2.2), 0.06, 0.02, 0xffa040, 1, -0.2, 0.4);
        }
      }
    }
  }

  /** Ambient embers drifting across the arena. */
  private emitEmbers(dt: number): void {
    this.emberAccum += dt * 10;
    while (this.emberAccum >= 1) {
      this.emberAccum -= 1;
      const x = rand(-this.stageHalfWidth - 4, this.stageHalfWidth + 4);
      this.systems.ember.emit(x, rand(0, 1), rand(-4, 2), rand(-0.3, 0.6), rand(0.4, 1.2), rand(-0.2, 0.2), rand(3, 6), rand(0.04, 0.08), 0.01, 0xff7a2a, 0.9, -0.05, 0.1);
    }
  }

  clearTransient(): void {
    this.systems.spark.clear();
    this.systems.blood.clear();
    this.systems.dust.clear();
    this.systems.debris.clear();
    this.systems.smoke.clear();
    this.systems.glow.clear();
    this.hits.clear();
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
    for (const s of this.systemList) s.dispose();
    this.hits.dispose();
    this.root.removeFromParent();
  }
}
