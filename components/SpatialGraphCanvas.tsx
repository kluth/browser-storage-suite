import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Sphere } from '@react-three/drei';
import * as THREE from 'three';
import { GraphNode, GraphLink, calculateSpatialLayout, WorkerLayoutResponse } from '../workers/spatialLayoutWorker';
import { StorageTarget } from '../src/domain/model/valueObjects';

export interface SpatialGraphCanvasProps {
  nodes?: GraphNode[];
  links?: GraphLink[];
  onNodeClick?: (nodeId: string) => void;
  storageEntries?: Array<{ key: string; value: string; target: StorageTarget }>;
}

export function getNodeColor(type?: string): string {
  switch (type) {
    case 'storage': return '#38bdf8';
    case 'table': return '#10b981';
    case 'entity': return '#a855f7';
    case 'key': return '#f59e0b';
    default: return '#ec4899';
  }
}

export function getDefaultGraphNodes(): GraphNode[] {
  const targets: StorageTarget[] = ['localStorage', 'sessionStorage', 'indexedDB', 'cookie', 'cacheAPI'];
  return targets.map((target) => ({
    id: `node_${target}`,
    label: `${target} Engine`,
    type: 'storage',
    size: 10,
  }));
}

export function deriveGraphNodesFromEntries(
  entries: Array<{ key: string; value: string; target: StorageTarget }>
): GraphNode[] {
  if (!entries || entries.length === 0) {
    return getDefaultGraphNodes();
  }
  return entries.map((entry, idx) => ({
    id: `node_${idx + 1}_${entry.key}`,
    label: entry.key,
    type: entry.key.includes('jwt') || entry.key.includes('token') ? 'entity' : entry.value.startsWith('{') ? 'table' : 'key',
    size: new Blob([entry.key + entry.value]).size,
  }));
}

interface Node3DProps {
  position: [number, number, number];
  label: string;
  color?: string;
  onClick?: () => void;
}

function Node3D({ position, color = '#38bdf8', onClick }: Node3DProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.5;
    }
  });

  return (
    <group position={position} onClick={onClick}>
      <Sphere ref={meshRef} args={[0.8, 24, 24]}>
        <meshStandardMaterial
          color={color}
          roughness={0.2}
          metalness={0.8}
          emissive={color}
          emissiveIntensity={0.3}
        />
      </Sphere>
    </group>
  );
}

export function checkWebGlSupport(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return !!gl;
  } catch {
    return false;
  }
}

export default function SpatialGraphCanvas({
  nodes: propNodes,
  links: propLinks = [],
  onNodeClick,
  storageEntries,
}: SpatialGraphCanvasProps) {
  const [webglSupported, setWebglSupported] = useState<boolean>(true);
  const [layoutPositions, setLayoutPositions] = useState<Map<string, [number, number, number]>>(new Map());
  const [workerError, setWorkerError] = useState<string | null>(null);

  const effectiveNodes = useMemo<GraphNode[]>(() => {
    if (propNodes && propNodes.length > 0) return propNodes;
    if (storageEntries && storageEntries.length > 0) return deriveGraphNodesFromEntries(storageEntries);
    return getDefaultGraphNodes();
  }, [propNodes, storageEntries]);

  useEffect(() => {
    setWebglSupported(checkWebGlSupport());
  }, []);

  useEffect(() => {
    let isSubscribed = true;

    const applyLayoutResult = (res: WorkerLayoutResponse) => {
      if (!isSubscribed) return;
      if (res.ok) {
        const posMap = new Map<string, [number, number, number]>();
        res.value.positions.forEach((p) => {
          posMap.set(p.id, [p.x, p.y, p.z]);
        });
        setLayoutPositions(posMap);
        setWorkerError(null);
      } else {
        setWorkerError(res.error);
      }
    };

    // Calculate spatial layout synchronously to guarantee 100% reliability across extension environments
    try {
      const res = calculateSpatialLayout(effectiveNodes, propLinks);
      applyLayoutResult(res);
    } catch (err: any) {
      if (isSubscribed) {
        setWorkerError(err?.message || 'Error calculating 3D spatial layout');
      }
    }

    return () => {
      isSubscribed = false;
    };
  }, [effectiveNodes, propLinks]);

  const renderedNodes = useMemo(() => {
    return effectiveNodes.map((n, i) => {
      const pos = layoutPositions.get(n.id) || [
        (i - effectiveNodes.length / 2) * 2,
        0,
        0,
      ];
      return {
        id: n.id,
        label: n.label,
        color: getNodeColor(n.type),
        position: pos as [number, number, number],
      };
    });
  }, [effectiveNodes, layoutPositions]);

  if (!webglSupported || workerError !== null) {
    return (
      <div style={{ width: '100%', height: '400px', borderRadius: '8px', background: '#090d16', padding: 16, color: '#94a3b8' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#38bdf8', marginBottom: 8 }}>
          3D Graph Topology (2D View{workerError ? ' - Fallback' : ''}):
        </div>
        {workerError && (
          <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 8 }}>
            Error: {workerError}
          </div>
        )}
        {renderedNodes.map((n) => (
          <div
            key={n.id}
            onClick={() => onNodeClick?.(n.id)}
            style={{ fontSize: 11, color: n.color, marginBottom: 4, fontFamily: 'monospace', cursor: onNodeClick ? 'pointer' : 'default' }}
          >
            ● {n.label} (x: {n.position[0].toFixed(1)}, y: {n.position[1].toFixed(1)}, z: {n.position[2].toFixed(1)})
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '400px', borderRadius: '8px', overflow: 'hidden', background: '#090d16', position: 'relative' }}>
      <Canvas camera={{ position: [0, 0, 12], fov: 50 }}>
        <ambientLight intensity={0.8} />
        <pointLight position={[10, 10, 10]} intensity={1.5} />
        <pointLight position={[-10, -10, -10]} intensity={0.6} color="#38bdf8" />

        {renderedNodes.map((n) => (
          <Node3D
            key={n.id}
            position={n.position}
            label={n.label}
            color={n.color}
            onClick={() => onNodeClick?.(n.id)}
          />
        ))}

        <OrbitControls enablePan enableZoom enableRotate />
      </Canvas>

      <div style={{ position: 'absolute', bottom: 8, left: 8, right: 8, background: 'rgba(3, 7, 18, 0.85)', backdropFilter: 'blur(4px)', padding: '6px 10px', borderRadius: 6, display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 10, fontFamily: 'monospace' }}>
        {renderedNodes.map((n) => (
          <span
            key={n.id}
            onClick={() => onNodeClick?.(n.id)}
            style={{ color: n.color, display: 'flex', alignItems: 'center', gap: 4, cursor: onNodeClick ? 'pointer' : 'default' }}
          >
            ● {n.label}
          </span>
        ))}
      </div>
    </div>
  );
}
