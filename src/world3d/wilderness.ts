import * as THREE from 'three';
import { GRID_SIZE } from '../game/constants';
import type { Cube } from '../game/types';
import {
  cellToWorldCenter,
  getTerrainHeightAt,
  hash2D,
  PLAYABLE_HALF,
  worldToCell,
} from './worldMath';

interface PropPlacement {
  x: number;
  z: number;
  rotY: number;
  scale: number;
  cellId: number | null; // null = outer wilderness beyond 12x12
  tint: THREE.Color;
}

export class WildernessProps {
  public readonly group = new THREE.Group();

  private readonly rockPlacements: PropPlacement[] = [];
  private readonly bushPlacements: PropPlacement[] = [];
  private readonly palmPlacements: PropPlacement[] = [];

  private readonly rocksMesh: THREE.InstancedMesh;
  private readonly bushesMesh: THREE.InstancedMesh;
  private readonly palmTrunksMesh: THREE.InstancedMesh;
  private readonly palmCrownsMesh: THREE.InstancedMesh;

  private readonly dummy = new THREE.Object3D();

  constructor() {
    this.generateSeededPlacements();

    // Rocks (low-poly sandstone/grey dodecahedrons)
    const rockGeo = new THREE.DodecahedronGeometry(1.15, 0);
    rockGeo.scale(1.25, 0.72, 1.0);
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.94,
      metalness: 0.02,
    });
    this.rocksMesh = new THREE.InstancedMesh(
      rockGeo,
      rockMat,
      Math.max(1, this.rockPlacements.length)
    );
    this.rocksMesh.castShadow = true;
    this.rocksMesh.receiveShadow = true;
    this.rocksMesh.frustumCulled = false;

    this.rockPlacements.forEach((p, idx) => {
      this.rocksMesh.setColorAt(idx, p.tint);
    });
    if (this.rocksMesh.instanceColor) this.rocksMesh.instanceColor.needsUpdate = true;

    // Dry desert bushes (olive-brown scrub spheres/cones)
    const bushGeo = new THREE.DodecahedronGeometry(0.85, 1);
    bushGeo.scale(1.15, 0.65, 1.15);
    const bushMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0.0,
    });
    this.bushesMesh = new THREE.InstancedMesh(
      bushGeo,
      bushMat,
      Math.max(1, this.bushPlacements.length)
    );
    this.bushesMesh.castShadow = true;
    this.bushesMesh.receiveShadow = true;
    this.bushesMesh.frustumCulled = false;

    this.bushPlacements.forEach((p, idx) => {
      this.bushesMesh.setColorAt(idx, p.tint);
    });
    if (this.bushesMesh.instanceColor) this.bushesMesh.instanceColor.needsUpdate = true;

    // Sparse desert palm trees (curved tapered trunks + radiating frond canopies)
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.34, 4.2, 6);
    trunkGeo.translate(0, 2.1, 0);
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x86613e,
      roughness: 0.9,
      metalness: 0.0,
    });
    this.palmTrunksMesh = new THREE.InstancedMesh(
      trunkGeo,
      trunkMat,
      Math.max(1, this.palmPlacements.length)
    );
    this.palmTrunksMesh.castShadow = true;
    this.palmTrunksMesh.receiveShadow = true;
    this.palmTrunksMesh.frustumCulled = false;

    const crownGeo = new THREE.ConeGeometry(2.1, 1.25, 6);
    crownGeo.scale(1, 0.68, 1);
    crownGeo.translate(0, 4.25, 0);
    const crownMat = new THREE.MeshStandardMaterial({
      color: 0x4f7f46,
      roughness: 0.82,
      metalness: 0.0,
    });
    this.palmCrownsMesh = new THREE.InstancedMesh(
      crownGeo,
      crownMat,
      Math.max(1, this.palmPlacements.length)
    );
    this.palmCrownsMesh.castShadow = true;
    this.palmCrownsMesh.receiveShadow = true;
    this.palmCrownsMesh.frustumCulled = false;

    this.group.add(
      this.rocksMesh,
      this.bushesMesh,
      this.palmTrunksMesh,
      this.palmCrownsMesh
    );
  }

  private generateSeededPlacements(): void {
    const rockColors = [
      new THREE.Color(0x9a9182),
      new THREE.Color(0x887f70),
      new THREE.Color(0xa99b83),
    ];
    const bushColors = [
      new THREE.Color(0x7c7444),
      new THREE.Color(0x6b6a3c),
      new THREE.Color(0x8d7b4a),
    ];

    // Seed props sparsely on playable cells (filtered out on owned cells in update)
    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        const cellId = row * GRID_SIZE + col;
        const roll = hash2D(row * 19 + 3, col * 23 + 7);
        const center = cellToWorldCenter(row, col);
        const jx = (hash2D(row * 31, col * 11) - 0.5) * 6.5;
        const jz = (hash2D(row * 17, col * 37) - 0.5) * 6.5;
        const x = center.x + jx;
        const z = center.z + jz;

        if (roll < 0.24 && this.rockPlacements.length < 44) {
          this.rockPlacements.push({
            x,
            z,
            rotY: hash2D(row + 5, col + 9) * Math.PI * 2,
            scale: 0.55 + hash2D(row * 7, col * 13) * 0.85,
            cellId,
            tint: rockColors[Math.floor(hash2D(row, col) * rockColors.length)],
          });
        } else if (roll >= 0.24 && roll < 0.44 && this.bushPlacements.length < 38) {
          this.bushPlacements.push({
            x,
            z,
            rotY: hash2D(row + 15, col + 19) * Math.PI * 2,
            scale: 0.65 + hash2D(row * 11, col * 3) * 0.7,
            cellId,
            tint: bushColors[Math.floor(hash2D(col, row) * bushColors.length)],
          });
        } else if (roll >= 0.94 && this.palmPlacements.length < 10) {
          this.palmPlacements.push({
            x,
            z,
            rotY: hash2D(row + 25, col + 29) * Math.PI * 2,
            scale: 0.85 + hash2D(row * 2, col * 5) * 0.35,
            cellId,
            tint: new THREE.Color(0x4f7f46),
          });
        }
      }
    }

    // Outer wilderness ring beyond playable 12x12 (fading naturally into fog)
    for (let i = 0; i < 28; i++) {
      const angle = (i / 28) * Math.PI * 2 + hash2D(i, 41) * 0.22;
      const radius = PLAYABLE_HALF + 14 + hash2D(i * 3, 71) * 46;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const mapped = worldToCell(x, z);
      if (mapped) continue;

      if (i % 3 === 0) {
        this.bushPlacements.push({
          x,
          z,
          rotY: hash2D(i, 9) * Math.PI * 2,
          scale: 0.85 + hash2D(i, 19) * 0.8,
          cellId: null,
          tint: bushColors[i % bushColors.length],
        });
      } else {
        this.rockPlacements.push({
          x,
          z,
          rotY: hash2D(i, 12) * Math.PI * 2,
          scale: 0.8 + hash2D(i, 24) * 1.25,
          cellId: null,
          tint: rockColors[i % rockColors.length],
        });
      }
    }
  }

  public sync(
    cubes: Cube[],
    seaCoords: Array<{ x: number; z: number }>
  ): void {
    const ownedIds = new Set<number>();
    for (const c of cubes) {
      if (c.owner === 'player') ownedIds.add(c.id);
    }

    const updateList = (
      placements: PropPlacement[],
      mesh: THREE.InstancedMesh,
      yOffset: number,
      tilt = 0
    ) => {
      for (let i = 0; i < placements.length; i++) {
        const p = placements[i];
        const hidden = p.cellId !== null && ownedIds.has(p.cellId);
        if (hidden) {
          this.dummy.position.set(0, -50, 0);
          this.dummy.scale.setScalar(0.0001);
        } else {
          const y = getTerrainHeightAt(p.x, p.z, seaCoords) + yOffset;
          this.dummy.position.set(p.x, y, p.z);
          this.dummy.rotation.set(tilt, p.rotY, tilt * 0.5);
          this.dummy.scale.setScalar(p.scale);
        }
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    };

    updateList(this.rockPlacements, this.rocksMesh, 0.35);
    updateList(this.bushPlacements, this.bushesMesh, 0.28);
    updateList(this.palmPlacements, this.palmTrunksMesh, -0.1, 0.08);
    updateList(this.palmPlacements, this.palmCrownsMesh, -0.1, 0.08);
  }

  public dispose(): void {
    const meshes = [
      this.rocksMesh,
      this.bushesMesh,
      this.palmTrunksMesh,
      this.palmCrownsMesh,
    ];
    for (const m of meshes) {
      m.geometry.dispose();
      if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
      else m.material.dispose();
    }
  }
}
