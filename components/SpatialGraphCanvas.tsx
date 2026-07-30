import React, { useState, useMemo } from 'react';
import { GraphNode, GraphLink, calculateSpatialLayout } from '../workers/spatialLayoutWorker';
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
  entries?: Array<{ key: string; value: string; target: StorageTarget }>
): { nodes: GraphNode[]; links: GraphLink[] } {
  const cleanTarget = targetEngine.replace(/^node_/, '').toLowerCase();
  const matchedEntries = (entries || []).filter(
    (e) => e.target.toLowerCase() === cleanTarget || cleanTarget.includes(e.target.toLowerCase())
  );

  const parentNode: GraphNode = {
    id: targetEngine,
    label: `💥 ${targetEngine.replace('node_', '').toUpperCase()}`,
    type: 'storage',
    size: 20,
  };

  if (matchedEntries.length === 0) {
    const demoChildren: GraphNode[] = [
      { id: `${targetEngine}_key_1`, label: 'session_id', type: 'key', size: 32 },
      { id: `${targetEngine}_key_2`, label: 'auth_token', type: 'entity', size: 128 },
      { id: `${targetEngine}_key_3`, label: 'user_profile', type: 'table', size: 256 },
    ];
    const demoLinks: GraphLink[] = demoChildren.map((child) => ({
      source: targetEngine,
      target: child.id,
    }));

    return {
      nodes: [parentNode, ...demoChildren],
      links: demoLinks,
    };
  }

  const childNodes: GraphNode[] = matchedEntries.slice(0, 15).map((entry, idx) => ({
    id: `child_${targetEngine}_${idx}_${entry.key}`,
    label: entry.key,
    type: entry.key.includes('jwt') || entry.key.includes('token') ? 'entity' : entry.value.startsWith('{') ? 'table' : 'key',
    size: new Blob([entry.key + entry.value]).size,
  }));

  const childLinks: GraphLink[] = childNodes.map((child) => ({
    source: targetEngine,
    target: child.id,
  }));

  return {
    nodes: [parentNode, ...childNodes],
    links: childLinks,
  };
}

export function checkWebGlSupport(): boolean {
  return true;
}

export default function SpatialGraphCanvas({
  nodes: propNodes,
  links: propLinks = [],
  onNodeClick,
  storageEntries,
}: SpatialGraphCanvasProps) {
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

  const layoutPositions = useMemo(() => {
    const res = calculateSpatialLayout(effectiveNodes, effectiveLinks);
    const posMap = new Map<string, [number, number, number]>();
    if (res.ok) {
      res.value.positions.forEach((p) => {
        posMap.set(p.id, [p.x, p.y, p.z]);
      });
    }
    return posMap;
  }, [effectiveNodes, effectiveLinks]);

  const renderedNodes = useMemo(() => {
    return effectiveNodes.map((n, i) => {
      const pos = layoutPositions.get(n.id) || [
        (i - effectiveNodes.length / 2) * 2,
        (i % 2 === 0 ? 1 : -1) * 2,
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

  const svgWidth = 640;
  const svgHeight = 360;
  const cx = svgWidth / 2;
  const cy = svgHeight / 2;

  return (
    <div style={{ width: '100%', height: '390px', borderRadius: '8px', background: '#090d16', padding: 12, color: '#94a3b8', position: 'relative', border: '1px solid #1e293b' }}>
      {/* Topology Header & Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8' }}>
          🌐 3D Spatial Canvas Topology ({explodedNodeId ? 'Exploded Child View' : 'Root Overview'})
        </div>
        {explodedNodeId ? (
          <button className="action-btn" onClick={handleResetView} style={{ fontSize: 10, color: '#10b981', padding: '2px 8px' }}>
            ⬅ Gesamtansicht Zurücksetzen
          </button>
        ) : (
          <span style={{ fontSize: 10, color: '#94a3b8' }}>💡 Doppelklick auf Node zum Explodieren der echten Inhalte</span>
        )}
      </div>

      <svg width="100%" height="320" viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ background: '#030712', borderRadius: 8, minWidth: '100%', display: 'block' }}>
        <defs>
          <filter id="spatialNodeGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Render Links */}
        {renderedLinks.map((l) => (
          <line
            key={l.id}
            x1={cx + l.source[0] * 18}
            y1={cy + l.source[1] * 18}
            x2={cx + l.target[0] * 18}
            y2={cy + l.target[1] * 18}
            stroke="#38bdf8"
            strokeWidth="2"
            strokeDasharray="3 3"
            opacity="0.7"
          />
        ))}

        {/* Render Nodes */}
        {renderedNodes.map((n) => {
          const nx = cx + n.position[0] * 18;
          const ny = cy + n.position[1] * 18;

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
              <circle r="18" fill="#1e293b" stroke={n.color} strokeWidth="3" filter="url(#spatialNodeGlow)" />
              <text y="32" textAnchor="middle" fill="#f8fafc" fontSize="10" fontWeight="600">
                {n.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Selected Node Details Drawer */}
      {selectedChildNode && (
        <div style={{ position: 'absolute', bottom: 16, left: 16, right: 16, background: 'rgba(9, 13, 22, 0.95)', border: '1px solid #38bdf8', padding: '6px 10px', borderRadius: 6, fontSize: 11, color: '#f8fafc', zIndex: 10 }}>
          <div style={{ fontWeight: 700, color: getNodeColor(selectedChildNode.type) }}>
            Node: {selectedChildNode.label} ({selectedChildNode.type.toUpperCase()})
          </div>
          <div style={{ color: '#94a3b8', fontSize: 10 }}>
            Doppelklick zum Explodieren der echten Inhalte
          </div>
        </div>
      )}
    </div>
  );
}
