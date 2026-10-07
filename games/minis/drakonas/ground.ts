/**
 * Endless ground far below the planes: rows of five 200×200 Drakonas tiles
 * that scroll toward the camera and are recycled at the top. Sea and land
 * come in stretches of a few rows, with a sandy strip where they meet.
 */
import * as THREE from 'three';
import type { Assets, Tile } from './assets';

export const TILE = 200;
const COLS = 5;

interface Row {
  z: number;
  tiles: THREE.Mesh[];
  beach: THREE.Mesh;
  land: boolean;
}

export class Ground {
  readonly group = new THREE.Group();
  private rows: Row[] = [];
  private land = false;
  private stretch = 3;
  private riverIn = 2;
  private bottom = 0;
  private readonly beachMat = new THREE.MeshLambertMaterial({ color: 0xd9c38f });
  private readonly beachGeo = new THREE.PlaneGeometry(TILE * COLS, 7).rotateX(-Math.PI / 2);

  constructor(
    scene: THREE.Scene,
    private readonly tiles: Assets['tiles'],
    readonly y: number,
    private readonly scale: number,
  ) {
    this.group.position.y = y;
    this.group.scale.setScalar(scale);
    // Dark underlay so cracks between tiles of different heights never show the sky.
    const under = new THREE.Mesh(new THREE.PlaneGeometry(TILE * (COLS + 2), TILE * 12).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x24452a }));
    under.position.y = -2.5;
    this.group.add(under);
    scene.add(this.group);
  }

  /** Make sure rows cover world z ∈ [top, bottom] on the ground plane. */
  cover(top: number, bottom: number): void {
    top /= this.scale;
    bottom /= this.scale;
    const need = Math.ceil((bottom - top) / TILE) + 2;
    while (this.rows.length < need) {
      const tiles = Array.from({ length: COLS }, (_, c) => {
        const m = new THREE.Mesh(this.tiles.water.geo, this.tiles.water.mat);
        m.position.x = (c - (COLS - 1) / 2) * TILE;
        this.group.add(m);
        return m;
      });
      const beach = new THREE.Mesh(this.beachGeo, this.beachMat);
      beach.position.y = 0.6;
      this.group.add(beach);
      const topRow = this.rows.reduce((a, r) => Math.min(a, r.z), bottom + TILE / 2);
      const row: Row = { z: topRow - TILE, tiles, beach, land: false };
      this.fill(row, this.rows.length ? this.topmost().land : false);
      this.rows.push(row);
    }
    this.bottom = bottom;
    this.place();
  }

  private topmost(): Row {
    return this.rows.reduce((a, r) => (r.z < a.z ? r : a));
  }

  /** Scroll by `dz` world units. */
  update(dz: number): void {
    dz /= this.scale;
    for (const r of this.rows) r.z += dz;
    for (const r of this.rows) {
      if (r.z - TILE / 2 > this.bottom) {
        const top = this.topmost();
        r.z = top.z - TILE;
        this.fill(r, top.land);
      }
    }
    this.place();
  }

  private place(): void {
    for (const r of this.rows) {
      for (const t of r.tiles) t.position.z = r.z;
      r.beach.position.z = r.z + TILE / 2;
    }
  }

  /** Choose new tiles for a row placed above a row whose biome was `belowLand`. */
  private fill(row: Row, belowLand: boolean): void {
    if (--this.stretch <= 0) {
      this.land = !this.land;
      this.stretch = 2 + Math.floor(Math.random() * 4);
    }
    row.land = this.land;
    row.beach.visible = row.land !== belowLand;
    const T = this.tiles;
    const river = row.land && --this.riverIn <= 0;
    if (river) this.riverIn = 2 + Math.floor(Math.random() * 3);
    row.tiles.forEach((m, col) => {
      let t: Tile;
      let turn = Math.floor(Math.random() * 4);
      if (river) {
        t = T.river;
        turn = 0; // keep the river flowing across the whole row
      } else if (row.land) t = Math.random() < 0.6 ? T.hills : T.swamp;
      else t = Math.random() < 0.45 ? T.island : T.water;
      m.geometry = t.geo;
      m.material = t.mat;
      m.rotation.y = (turn * Math.PI) / 2;
      // The river's two ends sit at different depths: mirror every other tile so they meet.
      m.scale.x = river ? (col % 2 ? -1 : 1) : Math.random() < 0.5 ? -1 : 1;
    });
  }
}
