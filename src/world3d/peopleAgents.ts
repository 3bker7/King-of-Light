import * as THREE from 'three';
import { findPalaceCube } from '../game/production';
import type { Cube } from '../game/types';
import { cellToWorldCenter, getTerrainHeightAt } from './worldMath';

const MAX_VISIBLE_AGENTS = 28;
const MIN_VISIBLE_AGENTS = 4;

type AgentRole = 'citizen' | 'guard' | 'child';

interface LivingAgent {
  role: AgentRole;
  group: THREE.Group;
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  speed: number;
  pauseTimer: number;
  walkPhase: number;
  waypointIndex: number;
}

export class PeopleAgentsManager {
  public readonly group = new THREE.Group();

  private readonly agents: LivingAgent[] = [];
  private readonly sharedGeos: THREE.BufferGeometry[] = [];
  private readonly sharedMats: THREE.Material[] = [];

  private readonly robeGeo: THREE.CylinderGeometry;
  private readonly headGeo: THREE.SphereGeometry;
  private readonly turbanGeo: THREE.CylinderGeometry;
  private readonly staffGeo: THREE.CylinderGeometry;
  private readonly lanternGeo: THREE.OctahedronGeometry;
  private readonly shadowGeo: THREE.PlaneGeometry;

  private readonly skinMat: THREE.MeshStandardMaterial;
  private readonly guardTunicMat: THREE.MeshStandardMaterial;
  private readonly guardTrimMat: THREE.MeshStandardMaterial;
  private readonly lanternMat: THREE.MeshStandardMaterial;
  private readonly staffMat: THREE.MeshStandardMaterial;
  private readonly citizenMats: THREE.MeshStandardMaterial[];
  private readonly childMats: THREE.MeshStandardMaterial[];
  private readonly shadowMat: THREE.MeshBasicMaterial;

  // Cached destination points updated on state sync (never allocated per frame)
  private houseSpots: Array<{ x: number; z: number }> = [];
  private workSpots: Array<{ x: number; z: number }> = [];
  private socialSpots: Array<{ x: number; z: number }> = [];
  private schoolGardenSpots: Array<{ x: number; z: number }> = [];
  private palaceCenter = { x: 45, z: 45 };
  private seaCoords: Array<{ x: number; z: number }> = [];
  private ownedMinX = 35;
  private ownedMaxX = 55;
  private ownedMinZ = 35;
  private ownedMaxZ = 55;

  constructor(blobShadowTexture: THREE.CanvasTexture) {
    this.robeGeo = new THREE.CylinderGeometry(0.18, 0.3, 0.95, 7);
    this.robeGeo.translate(0, 0.48, 0);
    this.headGeo = new THREE.SphereGeometry(0.2, 8, 6);
    this.headGeo.translate(0, 1.12, 0);
    this.turbanGeo = new THREE.CylinderGeometry(0.22, 0.21, 0.14, 7);
    this.turbanGeo.translate(0, 1.26, 0);
    this.staffGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.25, 5);
    this.staffGeo.translate(0.32, 0.65, 0.08);
    this.lanternGeo = new THREE.OctahedronGeometry(0.1, 0);
    this.lanternGeo.translate(0.32, 1.32, 0.08);
    this.shadowGeo = new THREE.PlaneGeometry(1.1, 1.1);
    this.shadowGeo.rotateX(-Math.PI / 2);

    this.sharedGeos.push(
      this.robeGeo,
      this.headGeo,
      this.turbanGeo,
      this.staffGeo,
      this.lanternGeo,
      this.shadowGeo
    );

    this.skinMat = new THREE.MeshStandardMaterial({
      color: 0xd2a47c,
      roughness: 0.85,
    });
    this.guardTunicMat = new THREE.MeshStandardMaterial({
      color: 0x195e55,
      roughness: 0.78,
    });
    this.guardTrimMat = new THREE.MeshStandardMaterial({
      color: 0xd4a53d,
      roughness: 0.45,
      metalness: 0.25,
    });
    this.lanternMat = new THREE.MeshStandardMaterial({
      color: 0xffe49c,
      emissive: 0xd99b2e,
      emissiveIntensity: 0.7,
      roughness: 0.3,
    });
    this.staffMat = new THREE.MeshStandardMaterial({
      color: 0x6b4a2d,
      roughness: 0.9,
    });

    // Earthy sun-baked linen/terracotta/olive robes
    this.citizenMats = [
      new THREE.MeshStandardMaterial({ color: 0xe2d5bc, roughness: 0.88 }),
      new THREE.MeshStandardMaterial({ color: 0xb56b49, roughness: 0.86 }),
      new THREE.MeshStandardMaterial({ color: 0x6a8058, roughness: 0.88 }),
      new THREE.MeshStandardMaterial({ color: 0x9b8259, roughness: 0.88 }),
      new THREE.MeshStandardMaterial({ color: 0x4e747a, roughness: 0.86 }),
    ];

    this.childMats = [
      new THREE.MeshStandardMaterial({ color: 0xd8a85c, roughness: 0.86 }),
      new THREE.MeshStandardMaterial({ color: 0x76996a, roughness: 0.86 }),
    ];

    this.shadowMat = new THREE.MeshBasicMaterial({
      map: blobShadowTexture,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    this.sharedMats.push(
      this.skinMat,
      this.guardTunicMat,
      this.guardTrimMat,
      this.lanternMat,
      this.staffMat,
      this.shadowMat,
      ...this.citizenMats,
      ...this.childMats
    );
  }

  private createAgentMesh(role: AgentRole, index: number): THREE.Group {
    const g = new THREE.Group();

    const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
    shadow.position.y = 0.05;
    g.add(shadow);

    const tunicMat =
      role === 'guard'
        ? this.guardTunicMat
        : role === 'child'
          ? this.childMats[index % this.childMats.length]
          : this.citizenMats[index % this.citizenMats.length];

    const body = new THREE.Mesh(this.robeGeo, tunicMat);
    body.castShadow = true;
    g.add(body);

    const head = new THREE.Mesh(this.headGeo, this.skinMat);
    head.castShadow = true;
    g.add(head);

    if (role !== 'child') {
      const turban = new THREE.Mesh(
        this.turbanGeo,
        role === 'guard' ? this.guardTrimMat : this.citizenMats[(index + 1) % this.citizenMats.length]
      );
      turban.castShadow = true;
      g.add(turban);
    }

    // Peaceful civic guard lantern staff (NO weapons)
    if (role === 'guard') {
      const staff = new THREE.Mesh(this.staffGeo, this.staffMat);
      staff.castShadow = true;
      g.add(staff);

      const lantern = new THREE.Mesh(this.lanternGeo, this.lanternMat);
      g.add(lantern);
    }

    if (role === 'child') {
      g.scale.setScalar(0.68);
    }

    return g;
  }

  private pickDestinationForRole(role: AgentRole, waypointIndex: number): { x: number; z: number } {
    const jitter = () => (Math.random() - 0.5) * 4.4;

    if (role === 'guard') {
      // Patrol in a peaceful diamond loop around the Palace courtyard & avenues
      const radius = 7.5 + (waypointIndex % 2) * 3.5;
      const angle = ((waypointIndex % 8) / 8) * Math.PI * 2;
      return {
        x: THREE.MathUtils.clamp(
          this.palaceCenter.x + Math.cos(angle) * radius,
          this.ownedMinX,
          this.ownedMaxX
        ),
        z: THREE.MathUtils.clamp(
          this.palaceCenter.z + Math.sin(angle) * radius,
          this.ownedMinZ,
          this.ownedMaxZ
        ),
      };
    }

    if (role === 'child') {
      const useSchool = waypointIndex % 2 === 0 && this.schoolGardenSpots.length > 0;
      const pool = useSchool ? this.schoolGardenSpots : this.houseSpots;
      const spot =
        pool.length > 0
          ? pool[Math.floor(Math.random() * pool.length)]
          : this.palaceCenter;
      return { x: spot.x + jitter(), z: spot.z + jitter() };
    }

    // Citizen routine: House -> Workplace -> Social (Restaurant/Cafe/Mosque/Garden/Market) -> House
    const step = waypointIndex % 3;
    let pool = this.houseSpots;
    if (step === 1 && this.workSpots.length > 0) pool = this.workSpots;
    else if (step === 2 && this.socialSpots.length > 0) pool = this.socialSpots;

    const chosen =
      pool.length > 0
        ? pool[Math.floor(Math.random() * pool.length)]
        : this.palaceCenter;
    return { x: chosen.x + jitter(), z: chosen.z + jitter() };
  }

  public sync(
    cubes: Cube[],
    population: number,
    seaCoords: Array<{ x: number; z: number }>
  ): void {
    this.seaCoords = seaCoords;
    this.houseSpots = [];
    this.workSpots = [];
    this.socialSpots = [];
    this.schoolGardenSpots = [];

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (const c of cubes) {
      if (c.owner !== 'player') continue;
      const center = cellToWorldCenter(c.row, c.col);
      if (center.x < minX) minX = center.x;
      if (center.x > maxX) maxX = center.x;
      if (center.z < minZ) minZ = center.z;
      if (center.z > maxZ) maxZ = center.z;

      const themes = [c.themeId, c.secondThemeId];
      for (const t of themes) {
        if (!t) continue;
        if (t === 'house') {
          this.houseSpots.push(center);
        } else if (
          t === 'mosque' ||
          t === 'restaurant' ||
          t === 'cafe' ||
          t === 'garden' ||
          t === 'theater' ||
          t === 'shop' ||
          t === 'grand_market'
        ) {
          this.socialSpots.push(center);
          if (t === 'garden') this.schoolGardenSpots.push(center);
        } else if (t === 'school') {
          this.schoolGardenSpots.push(center);
          this.socialSpots.push(center);
        } else if (t !== 'sea' && t !== 'palace') {
          this.workSpots.push(center);
        }
      }
    }

    if (Number.isFinite(minX)) {
      this.ownedMinX = minX - 3.5;
      this.ownedMaxX = maxX + 3.5;
      this.ownedMinZ = minZ - 3.5;
      this.ownedMaxZ = maxZ + 3.5;
    }

    const palace = findPalaceCube(cubes);
    if (palace) {
      this.palaceCenter = cellToWorldCenter(palace.row, palace.col);
    }

    // Target visible agent count strictly capped for 60fps mobile performance
    const targetCount = Math.min(
      MAX_VISIBLE_AGENTS,
      Math.max(MIN_VISIBLE_AGENTS, Math.round(population * 0.7))
    );
    const hasSchoolOrGarden = this.schoolGardenSpots.length > 0;

    while (this.agents.length < targetCount) {
      const idx = this.agents.length;
      const role: AgentRole =
        idx < 2 || (idx === 10 && targetCount > 12)
          ? 'guard'
          : hasSchoolOrGarden && idx % 6 === 3
            ? 'child'
            : 'citizen';

      const group = this.createAgentMesh(role, idx);
      const start = this.pickDestinationForRole(role, idx);
      const next = this.pickDestinationForRole(role, idx + 1);
      const y = getTerrainHeightAt(start.x, start.z, this.seaCoords);
      group.position.set(start.x, y, start.z);
      this.group.add(group);

      this.agents.push({
        role,
        group,
        x: start.x,
        z: start.z,
        targetX: next.x,
        targetZ: next.z,
        speed: role === 'guard' ? 2.5 : role === 'child' ? 3.2 : 2.1 + (idx % 4) * 0.25,
        pauseTimer: (idx % 5) * 0.4,
        walkPhase: idx * 1.1,
        waypointIndex: idx + 1,
      });
    }

    while (this.agents.length > targetCount) {
      const removed = this.agents.pop();
      if (removed) {
        this.group.remove(removed.group);
      }
    }
  }

  private isNearWater(x: number, z: number): boolean {
    for (let i = 0; i < this.seaCoords.length; i++) {
      const sc = this.seaCoords[i];
      if (Math.abs(x - sc.x) < 4.6 && Math.abs(z - sc.z) < 4.6) {
        return true;
      }
    }
    return false;
  }

  public update(dt: number): void {
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (a.pauseTimer > 0) {
        a.pauseTimer -= dt;
        continue;
      }

      const dx = a.targetX - a.x;
      const dz = a.targetZ - a.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 0.45) {
        a.pauseTimer = a.role === 'guard' ? 0.6 : 1.0 + Math.random() * 2.2;
        a.waypointIndex += 1;
        const next = this.pickDestinationForRole(a.role, a.waypointIndex);
        a.targetX = next.x;
        a.targetZ = next.z;
        continue;
      }

      const step = Math.min(dist, a.speed * dt);
      const nextX = a.x + (dx / dist) * step;
      const nextZ = a.z + (dz / dist) * step;

      // Gently skirt around water bodies
      if (this.isNearWater(nextX, nextZ)) {
        a.waypointIndex += 1;
        const alt = this.pickDestinationForRole(a.role, a.waypointIndex);
        a.targetX = alt.x;
        a.targetZ = alt.z;
        continue;
      }

      a.x = nextX;
      a.z = nextZ;
      a.walkPhase += dt * (a.role === 'child' ? 11 : 8.5);
      const groundY = getTerrainHeightAt(a.x, a.z, this.seaCoords);
      const bob = Math.abs(Math.sin(a.walkPhase)) * 0.12;
      a.group.position.set(a.x, groundY + bob, a.z);
      a.group.rotation.y = Math.atan2(dx, dz);
    }
  }

  public dispose(): void {
    for (const a of this.agents) {
      this.group.remove(a.group);
    }
    this.agents.length = 0;
    this.sharedGeos.forEach((g) => g.dispose());
    this.sharedMats.forEach((m) => m.dispose());
  }
}
