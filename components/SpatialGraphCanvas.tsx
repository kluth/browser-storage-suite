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

export function generateExplodingChildNodes(targetEngine: string): { nodes: GraphNode[]; links: GraphLink[] } {
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

  let sampleKeys: { key: string; type: 'table' | 'entity' | 'key' }[] = [];

  if (engineKey.includes('indexedDB')) {
    sampleKeys = [
      { key: 'user_credentials_store', type: 'table' },
      { key: 'cache_blob_store', type: 'table' },
      { key: 'telemetry_queue_store', type: 'table' },
      { key: 'auth_token_entity', type: 'entity' },
      { key: 'app_state_blob', type: 'key' },
    ];
  } else if (engineKey.includes('local')) {
    sampleKeys = [
      { key: 'user_session_jwt', type: 'entity' },
      { key: 'ui_theme_mode', type: 'key' },
      { key: 'cart_items_json', type: 'table' },
      { key: 'feature_flags', type: 'key' },
    ];
  } else if (engineKey.includes('session')) {
    sampleKeys = [
      { key: 'temp_auth_challenge', type: 'entity' },
      { key: 'draft_form_state', type: 'key' },
    ];
  } else if (engineKey.includes('cookie')) {
    sampleKeys = [
      { key: '__Secure-next-auth.session-token', type: 'entity' },
      { key: '_ga_analytics_id', type: 'key' },
    ];
  } else {
    sampleKeys = [
      { key: 'cached_api_responses', type: 'table' },
      { key: 'asset_bundle_v1', type: 'key' },
    ];
  }

  sampleKeys.forEach((item, idx) => {
    const childId = `child_${engineKey}_${idx}_${item.key}`;
    childNodes.push({
      id: childId,
      label: item.key,
      type: item.type,
      size: 8,
    });
    childLinks.push({
      source: parentNodeId,
      target: childId,
      strength: 1.0,
    });
  });

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
    const exploded = generateExplodingChildNodes(explodedNodeId);
    return { effectiveNodes: exploded.nodes, effectiveLinks: exploded.links };
  }, [baseNodes, propLinks, explodedNodeId]);

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
      // Toggle back to root topology
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
      <div style={{ width: '100%', height: '400px', borderRadius: '8px', background: '#090d16', padding: 16, color: '#94a3b8' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#38bdf8' }}>
            3D Graph Topology (2D View{workerError ? ' - Fallback' : ''}):
          </div>
          {explodedNodeId && (
            <button className="action-btn" onClick={handleResetView} style={{ fontSize: 10, color: '#38bdf8' }}>
              ⬅ Zurück zur Übersicht
            </button>
          )}
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
            onDoubleClick={() => handleNodeDoubleClick(n.id)}
            style={{ fontSize: 11, color: n.color, marginBottom: 4, fontFamily: 'monospace', cursor: 'pointer' }}
            title="Doppelklick zum Explodieren der Inhalte"
          >
            ● {n.label} (x: {n.position[0].toFixed(1)}, y: {n.position[1].toFixed(1)}, z: {n.position[2].toFixed(1)})
          </div>
        ))}
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
          <span style={{ fontSize: 10, color: '#94a3b8' }}>💡 Doppelklick auf Node zum Explodieren der Inhalte</span>
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
            title="Doppelklick zum Explodieren"
          >
            ● {n.label}
          </span>
        ))}
      </div>
    </div>
  );
}
