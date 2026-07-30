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

export function generateExplodingChildNodes(
  targetEngine: string,
  storageEntries?: Array<{ key: string; value: string; target: StorageTarget }>
): { nodes: GraphNode[]; links: GraphLink[] } {
  const engineKey = targetEngine.replace('node_', '');
  const childNodes: GraphNode[] = [];
  const childLinks: GraphLink[] = [];

  const parentNodeId = `node_${engineKey}`;
  childNodes.push({
    id: parentNodeId,
    label: `${engineKey.toUpperCase()} Core`,
    type: 'storage',
    size: 15,
  });

  // Filter actual factual page storage entries for this engine target
  const realEngineEntries = (storageEntries || []).filter(
    (entry) => entry.target.toLowerCase() === engineKey || engineKey.includes(entry.target.toLowerCase())
  );

  if (realEngineEntries.length > 0) {
    realEngineEntries.forEach((entry, idx) => {
      const childId = `child_${engineKey}_${idx}_${entry.key}`;
      const nodeType = entry.key.includes('jwt') || entry.key.includes('token')
        ? 'entity'
        : entry.value.startsWith('{') || entry.value.startsWith('[')
        ? 'table'
        : 'key';

      childNodes.push({
        id: childId,
        label: entry.key,
        type: nodeType,
        size: new Blob([entry.key + entry.value]).size || 8,
      });
      childLinks.push({
        source: parentNodeId,
        target: childId,
        strength: 1.0,
      });
    });
  } else {
    // If engine has no stored items, create a factual status node stating empty engine
    const emptyChildId = `child_${engineKey}_empty`;
    childNodes.push({
      id: emptyChildId,
      label: `Empty ${engineKey.toUpperCase()} Engine`,
      type: 'key',
      size: 5,
    });
    childLinks.push({
      source: parentNodeId,
      target: emptyChildId,
      strength: 0.5,
    });
  }

  return { nodes: childNodes, links: childLinks };
}

interface Node3DProps {
  position: [number, number, number];
  label: string;
  color?: string;
  onClick?: () => void;
  onDoubleClick?: () => void;
}

function Node3D({ position, color = '#38bdf8', onClick, onDoubleClick }: Node3DProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.5;
    }
  });

  return (
    <group position={position} onClick={onClick} onDoubleClick={onDoubleClick}>
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

interface LinkLine3DProps {
  start: [number, number, number];
  end: [number, number, number];
  color?: string;
}

function LinkLine3D({ start, end, color = '#38bdf8' }: LinkLine3DProps) {
  const points = useMemo(() => [new THREE.Vector3(...start), new THREE.Vector3(...end)], [start, end]);
  const geometry = useMemo(() => new THREE.BufferGeometry().setFromPoints(points), [points]);
  const material = useMemo(() => new THREE.LineBasicMaterial({ color, opacity: 0.6, transparent: true, linewidth: 2 }), [color]);

  return <primitive object={new THREE.Line(geometry, material)} />;
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

  // Exploding View State
  const [explodedNodeId, setExplodedNodeId] = useState<string | null>(null);
  const [selectedChildNode, setSelectedChildNode] = useState<GraphNode | null>(null);

  const baseNodes = useMemo<GraphNode[]>(() => {
    if (propNodes && propNodes.length > 0) return propNodes;
    if (storageEntries && storageEntries.length > 0) return deriveGraphNodesFromEntries(storageEntries);
    return getDefaultGraphNodes();
  }, [propNodes, storageEntries]);

  const { effectiveNodes, effectiveLinks } = useMemo(() => {
    if (!explodedNodeId) {
      return { effectiveNodes: baseNodes, effectiveLinks: propLinks };
    }
    const exploded = generateExplodingChildNodes(explodedNodeId, storageEntries);
    return { effectiveNodes: exploded.nodes, effectiveLinks: exploded.links };
  }, [baseNodes, propLinks, explodedNodeId, storageEntries]);

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

    try {
      const res = calculateSpatialLayout(effectiveNodes, effectiveLinks);
      applyLayoutResult(res);
    } catch (err: any) {
      if (isSubscribed) {
        setWorkerError(err?.message || 'Error calculating 3D spatial layout');
      }
    }

    return () => {
      isSubscribed = false;
    };
  }, [effectiveNodes, effectiveLinks]);

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
        type: n.type,
        color: getNodeColor(n.type),
        position: pos as [number, number, number],
      };
    });
  }, [effectiveNodes, layoutPositions]);

  const renderedLinks = useMemo(() => {
    const posMap = new Map<string, [number, number, number]>();
    renderedNodes.forEach((n) => posMap.set(n.id, n.position));

    return effectiveLinks
      .map((l) => {
        const start = posMap.get(l.source);
        const end = posMap.get(l.target);
        if (!start || !end) return null;
        return { source: start, target: end, id: `${l.source}-${l.target}` };
      })
      .filter((l): l is { source: [number, number, number]; target: [number, number, number]; id: string } => l !== null);
  }, [renderedNodes, effectiveLinks]);

  const handleNodeDoubleClick = (nodeId: string) => {
    if (explodedNodeId === nodeId) {
      setExplodedNodeId(null);
      setSelectedChildNode(null);
    } else {
      setExplodedNodeId(nodeId);
      const clicked = effectiveNodes.find((n) => n.id === nodeId);
      setSelectedChildNode(clicked || null);
    }
  };

  const handleResetView = () => {
    setExplodedNodeId(null);
    setSelectedChildNode(null);
  };

  if (!webglSupported || workerError !== null) {
    return (
      <div style={{ width: '100%', height: '400px', borderRadius: '8px', background: '#090d16', padding: 12, color: '#94a3b8', position: 'relative', border: '1px solid #1e293b' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8' }}>
            🌐 2D Spatial Canvas Topology ({explodedNodeId ? 'Exploded View' : 'Root Overview'})
          </div>
          {explodedNodeId && (
            <button className="action-btn" onClick={handleResetView} style={{ fontSize: 10, color: '#10b981', padding: '2px 8px' }}>
              ⬅ Gesamtansicht Zurücksetzen
            </button>
          )}
        </div>

        <svg width="100%" height="340" viewBox="0 0 600 340" style={{ background: '#030712', borderRadius: 8 }}>
          <defs>
            <filter id="nodeGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Render 2D Link Lines */}
          {renderedLinks.map((l) => (
            <line
              key={l.id}
              x1={300 + l.source[0] * 18}
              y1={170 + l.source[1] * 18}
              x2={300 + l.target[0] * 18}
              y2={170 + l.target[1] * 18}
              stroke="#38bdf8"
              strokeWidth="2"
              strokeDasharray="3 3"
              opacity="0.6"
            />
          ))}

          {/* Render 2D Nodes */}
          {renderedNodes.map((n, i) => {
            const nx = 300 + n.position[0] * 18;
            const ny = 170 + n.position[1] * 18;
            return (
              <g
                key={n.id}
                transform={`translate(${nx}, ${ny})`}
                onClick={() => {
                  onNodeClick?.(n.id);
                  setSelectedChildNode(effectiveNodes.find((node) => node.id === n.id) || null);
                }}
                onDoubleClick={() => handleNodeDoubleClick(n.id)}
                style={{ cursor: 'pointer' }}
              >
                <circle r="18" fill="#1e293b" stroke={n.color} strokeWidth="3" filter="url(#nodeGlow)" />
                <text y="32" textAnchor="middle" fill="#f8fafc" fontSize="10" fontWeight="600">
                  {n.label}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Selected Node Drawer */}
        {selectedChildNode && (
          <div style={{ position: 'absolute', bottom: 16, left: 16, right: 16, background: 'rgba(9, 13, 22, 0.95)', border: '1px solid #38bdf8', padding: '6px 10px', borderRadius: 6, fontSize: 11, color: '#f8fafc' }}>
            <div style={{ fontWeight: 700, color: getNodeColor(selectedChildNode.type) }}>
              {selectedChildNode.label} ({selectedChildNode.type.toUpperCase()})
            </div>
            <div style={{ color: '#94a3b8', fontSize: 10 }}>
              Doppelklick zum Explodieren der echten Inhalte
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '400px', borderRadius: '8px', overflow: 'hidden', background: '#090d16', position: 'relative' }}>
      {/* Topology Header & Breadcrumb */}
      <div style={{ position: 'absolute', top: 8, left: 8, right: 8, zIndex: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(3, 7, 18, 0.85)', backdropFilter: 'blur(4px)', padding: '6px 12px', borderRadius: 6, fontSize: 11, color: '#cbd5e1' }}>
        <div>
          <span>Root Topology</span>
          {explodedNodeId && (
            <span style={{ color: '#38bdf8', fontWeight: 700 }}>
              {' > '}💥 Exploded View: {explodedNodeId.replace('node_', '').toUpperCase()}
            </span>
          )}
        </div>
        {explodedNodeId ? (
          <button className="action-btn" onClick={handleResetView} style={{ fontSize: 10, color: '#10b981', padding: '2px 8px' }}>
            ⬅ Gesamtansicht Zurücksetzen
          </button>
        ) : (
          <span style={{ fontSize: 10, color: '#94a3b8' }}>💡 Doppelklick auf Node zum Explodieren der echten Inhalte</span>
        )}
      </div>

      <Canvas camera={{ position: [0, 0, 16], fov: 50 }}>
        <ambientLight intensity={0.8} />
        <pointLight position={[10, 10, 10]} intensity={1.5} />
        <pointLight position={[-10, -10, -10]} intensity={0.6} color="#38bdf8" />

        {/* Render 3D Connection Link Lines */}
        {renderedLinks.map((l) => (
          <LinkLine3D key={l.id} start={l.source} end={l.target} color="#38bdf8" />
        ))}

        {/* Render 3D Spheres */}
        {renderedNodes.map((n) => (
          <Node3D
            key={n.id}
            position={n.position}
            label={n.label}
            color={n.color}
            onClick={() => {
              onNodeClick?.(n.id);
              setSelectedChildNode(effectiveNodes.find((node) => node.id === n.id) || null);
            }}
            onDoubleClick={() => handleNodeDoubleClick(n.id)}
          />
        ))}

        <OrbitControls enablePan enableZoom enableRotate />
      </Canvas>

      {/* Selected Node Details Drawer */}
      {selectedChildNode && (
        <div style={{ position: 'absolute', bottom: 36, left: 8, right: 8, background: 'rgba(9, 13, 22, 0.95)', border: '1px solid #38bdf8', backdropFilter: 'blur(6px)', padding: '8px 12px', borderRadius: 6, fontSize: 11, color: '#f8fafc', zIndex: 10 }}>
          <div style={{ fontWeight: 700, color: getNodeColor(selectedChildNode.type), marginBottom: 2 }}>
            Node: {selectedChildNode.label} ({selectedChildNode.type.toUpperCase()})
          </div>
          <div style={{ color: '#94a3b8', fontSize: 10 }}>
            Payload Size: {selectedChildNode.size} Bytes | Connections: {effectiveLinks.filter((l) => l.source === selectedChildNode.id || l.target === selectedChildNode.id).length}
          </div>
        </div>
      )}

      {/* Bottom Legend */}
      <div style={{ position: 'absolute', bottom: 8, left: 8, right: 8, background: 'rgba(3, 7, 18, 0.85)', backdropFilter: 'blur(4px)', padding: '4px 10px', borderRadius: 6, display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 10, fontFamily: 'monospace' }}>
        {renderedNodes.map((n) => (
          <span
            key={n.id}
            onClick={() => onNodeClick?.(n.id)}
            onDoubleClick={() => handleNodeDoubleClick(n.id)}
            style={{ color: n.color, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
            title="Doppelklick zum Explodieren der echten Inhalte"
          >
            ● {n.label}
          </span>
        ))}
      </div>
    </div>
  );
}
