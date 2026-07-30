import { Result } from '../utils/result';

export interface GraphNode {
  id: string;
  label: string;
  type: 'storage' | 'table' | 'entity' | 'key';
  size: number;
}

export interface GraphLink {
  source: string;
  target: string;
  strength: number;
}

export interface Node3DPosition {
  id: string;
  x: number;
  y: number;
  z: number;
}

export type WorkerLayoutResponse = Result<{ positions: Node3DPosition[]; type: 'LAYOUT_COMPLETE' }, string>;

interface Vector3D {
  x: number;
  y: number;
  z: number;
}

function initSphericalPositions(nodes: GraphNode[]): Node3DPosition[] {
  const len = nodes.length;
  return nodes.map((node, idx) => {
    const phi = Math.acos(-1 + (2 * (idx + 0.5)) / len);
    const theta = Math.sqrt(len * Math.PI) * phi;
    const radius = 12 + (idx % 3) * 4;

    return {
      id: node.id,
      x: radius * Math.cos(theta) * Math.sin(phi),
      y: radius * Math.sin(theta) * Math.sin(phi),
      z: radius * Math.cos(phi),
    };
  });
}

function computeRepulsion(positions: Node3DPosition[], velocities: Vector3D[], kRep: number): void {
  const n = positions.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = positions[i].x - positions[j].x;
      const dy = positions[i].y - positions[j].y;
      const dz = positions[i].z - positions[j].z;
      const distSq = dx * dx + dy * dy + dz * dz || 0.01;
      const dist = Math.sqrt(distSq);
      const force = kRep / distSq;

      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      const fz = (dz / dist) * force;

      velocities[i].x += fx;
      velocities[i].y += fy;
      velocities[i].z += fz;
      velocities[j].x -= fx;
      velocities[j].y -= fy;
      velocities[j].z -= fz;
    }
  }
}

function computeAttraction(positions: Node3DPosition[], velocities: Vector3D[], links: GraphLink[], kAtt: number): void {
  const idMap = new Map<string, number>();
  positions.forEach((p, idx) => idMap.set(p.id, idx));

  for (const link of links) {
    const i = idMap.get(link.source);
    const j = idMap.get(link.target);
    if (i === undefined || j === undefined) continue;

    const dx = positions[j].x - positions[i].x;
    const dy = positions[j].y - positions[i].y;
    const dz = positions[j].z - positions[i].z;
    const dist = Math.hypot(dx, dy, dz) || 0.01;
    const force = kAtt * dist * (link.strength || 1.0);

    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    const fz = (dz / dist) * force;

    velocities[i].x += fx;
    velocities[i].y += fy;
    velocities[i].z += fz;
    velocities[j].x -= fx;
    velocities[j].y -= fy;
    velocities[j].z -= fz;
  }
}

function applyPhysicsStep(positions: Node3DPosition[], velocities: Vector3D[], damping: number): void {
  for (let i = 0; i < positions.length; i++) {
    positions[i].x += velocities[i].x * damping;
    positions[i].y += velocities[i].y * damping;
    positions[i].z += velocities[i].z * damping;
    velocities[i].x *= 0.5;
    velocities[i].y *= 0.5;
    velocities[i].z *= 0.5;
  }
}

export function calculateSpatialLayout(
  nodes: GraphNode[],
  links: GraphLink[] = []
): WorkerLayoutResponse {
  try {
    if (!Array.isArray(nodes)) {
      return Result.err('Invalid payload: nodes must be an array');
    }

    if (nodes.length === 0) {
      return Result.ok({ positions: [], type: 'LAYOUT_COMPLETE' });
    }

    const positions = initSphericalPositions(nodes);
    const velocities: Vector3D[] = positions.map(() => ({ x: 0, y: 0, z: 0 }));

    for (let iter = 0; iter < 30; iter++) {
      computeRepulsion(positions, velocities, 25.0);
      computeAttraction(positions, velocities, links, 0.15);
      applyPhysicsStep(positions, velocities, 0.2);
    }

    return Result.ok({ positions, type: 'LAYOUT_COMPLETE' });
  } catch (err: any) {
    return Result.err(err?.message || String(err));
  }
}

export function handleWorkerMessage(data: any): WorkerLayoutResponse {
  if (!data || typeof data !== 'object') {
    return Result.err('Invalid worker message data payload');
  }
  const nodes = data.nodes;
  const links = data.links || [];
  return calculateSpatialLayout(nodes, links);
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = (e: MessageEvent<{ nodes: GraphNode[]; links: GraphLink[] }>) => {
    const response = handleWorkerMessage(e.data);
    self.postMessage(response);
  };
}
