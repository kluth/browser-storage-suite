import React, { useState, useMemo } from 'react';
import { StorageTarget } from '../src/domain/model/valueObjects';
import { Copy, Check, Download, Code, Network, GitBranch, Layers, Activity, ChevronDown, ChevronUp } from 'lucide-react';

export type DiagramLayoutType = 'star' | 'hierarchical_td' | 'hierarchical_lr' | 'subgraph_cluster' | 'sequence_flow';

export interface StorageEntryItem {
  key: string;
  value: string;
  target: StorageTarget;
}

export interface MermaidTopologyDiagramProps {
  entries: StorageEntryItem[];
  currentUrl?: string;
}

export function generateMermaidCode(
  entries: StorageEntryItem[],
  layoutType: DiagramLayoutType,
  domainName: string = 'Active Page'
): string {
  const sanitize = (text: string) =>
    String(text || '')
      .replace(/["'`\\()[\]{}#&]/g, '')
      .replace(/[\r\n]/g, ' ')
      .trim();

  const cleanDomain = sanitize(domainName.replace(/^https?:\/\//, '')) || 'Active Page';

  const grouped: Record<string, StorageEntryItem[]> = {
    localStorage: [],
    sessionStorage: [],
    cookie: [],
    indexedDB: [],
    cacheAPI: [],
  };

  entries.forEach((entry) => {
    const t = entry.target;
    if (grouped[t]) {
      grouped[t].push(entry);
    } else {
      grouped.localStorage.push(entry);
    }
  });

  if (layoutType === 'star') {
    let code = `graph LR\n`;
    code += `  style ROOT fill:#0284c7,stroke:#38bdf8,stroke-width:2px,color:#ffffff;\n`;
    code += `  ROOT["🌐 ${cleanDomain}"]\n`;

    Object.entries(grouped).forEach(([target, items]) => {
      const targetId = `ENGINE_${target.toUpperCase()}`;
      code += `  ROOT --- ${targetId}["📦 ${target} (${items.length})"]\n`;
      code += `  style ${targetId} fill:#1e293b,stroke:#a855f7,stroke-width:1px,color:#e2e8f0;\n`;

      items.forEach((item, idx) => {
        const itemId = `ITEM_${target}_${idx}`;
        const keyLabel = sanitize(item.key);
        code += `  ${targetId} --> ${itemId}["🔑 ${keyLabel}"]\n`;
        code += `  style ${itemId} fill:#0f172a,stroke:#334155,color:#38bdf8;\n`;
      });
    });

    return code;
  }

  if (layoutType === 'hierarchical_td' || layoutType === 'hierarchical_lr') {
    const dir = layoutType === 'hierarchical_td' ? 'TD' : 'LR';
    let code = `flowchart ${dir}\n`;
    code += `  DomainNode["🌐 ${cleanDomain}"]\n`;

    Object.entries(grouped).forEach(([target, items]) => {
      if (items.length > 0) {
        const targetId = `Node_${target}`;
        code += `  DomainNode --> ${targetId}["${target} Engine"]\n`;
        items.forEach((item, idx) => {
          const leafId = `Leaf_${target}_${idx}`;
          const cleanKey = sanitize(item.key);
          code += `  ${targetId} --> ${leafId}["${cleanKey}"]\n`;
        });
      }
    });

    return code;
  }

  if (layoutType === 'subgraph_cluster') {
    let code = `flowchart TB\n`;

    Object.entries(grouped).forEach(([target, items]) => {
      code += `  subgraph ${target.toUpperCase()} ["📦 ${target} Storage Cluster"]\n`;
      if (items.length === 0) {
        code += `    Empty_${target}["(Keine Einträge)"]\n`;
      } else {
        items.forEach((item, idx) => {
          const itemId = `Sub_${target}_${idx}`;
          const cleanKey = sanitize(item.key);
          const cleanVal = sanitize(item.value.slice(0, 20));
          code += `    ${itemId}["🔑 ${cleanKey} : ${cleanVal}..."]\n`;
        });
      }
      code += `  end\n`;
    });

    return code;
  }

  // Sequence Flow
  let code = `sequenceDiagram\n`;
  code += `  autonumber\n`;
  code += `  actor User as 👤 Web User\n`;
  code += `  participant Page as 🌐 Web App (${cleanDomain})\n`;
  code += `  participant Suite as 🛠️ Storage Suite\n`;
  code += `  participant Engine as 💾 Browser Engines\n`;

  code += `  User->>Page: Interacts with UI\n`;
  code += `  Page->>Engine: setItem() / document.cookie\n`;
  code += `  Engine-->>Suite: StorageEvent / Mutation Event\n`;
  code += `  Suite->>User: Real-time Glow & Data Blame Provenance\n`;

  return code;
}

export default function MermaidTopologyDiagram({ entries, currentUrl = 'https://example.com' }: MermaidTopologyDiagramProps) {
  const [layoutType, setLayoutType] = useState<DiagramLayoutType>('star');
  const [showCode, setShowCode] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [explodedEngine, setExplodedEngine] = useState<string | null>(null);
  const [expandedClusters, setExpandedClusters] = useState<Record<string, boolean>>({
    localStorage: true,
    sessionStorage: true,
    cookie: true,
    indexedDB: true,
  });

  const cleanDomain = currentUrl.replace(/^https?:\/\//, '') || 'Active Page';

  const mermaidCode = useMemo(() => {
    return generateMermaidCode(entries, layoutType, currentUrl);
  }, [entries, layoutType, currentUrl]);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(mermaidCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadSvg = () => {
    const svgElement = document.getElementById('native_topology_svg_container');
    if (!svgElement) return;
    const svgString = new XMLSerializer().serializeToString(svgElement);
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `storage-suite-topology-${layoutType}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const engines = [
    { name: 'localStorage', color: '#38bdf8', icon: '💾' },
    { name: 'sessionStorage', color: '#a855f7', icon: '⏱️' },
    { name: 'cookie', color: '#10b981', icon: '🍪' },
    { name: 'indexedDB', color: '#f59e0b', icon: '🗄️' },
  ];

  const toggleClusterExpand = (engName: string) => {
    setExpandedClusters((prev) => ({
      ...prev,
      [engName]: !prev[engName],
    }));
  };

  const renderSvgDiagram = () => {
    const width = 640;
    const height = 420;
    const cx = width / 2;

    // Exploded View for Engine Detail Exploration
    if (explodedEngine) {
      const eng = engines.find((e) => e.name === explodedEngine) || engines[0];
      const matchedEntries = entries.filter((e) => e.target.toLowerCase().includes(eng.name.toLowerCase()));

      return (
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1e293b', padding: '8px 12px', borderRadius: 8, border: `1px solid ${eng.color}` }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: eng.color }}>
              💥 {eng.icon} Exploded Storage Engine: {eng.name.toUpperCase()} ({matchedEntries.length} Einträge)
            </div>
            <button
              onClick={() => setExplodedEngine(null)}
              style={{ padding: '3px 8px', fontSize: 10, background: '#10b981', color: '#030712', border: 'none', borderRadius: 4, fontWeight: 700, cursor: 'pointer' }}
            >
              ⬅ Zurück zur Gesamtübersicht
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8, maxHeight: 380, overflowY: 'auto' }}>
            {matchedEntries.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 11 }}>
                Keine Einträge in {eng.name} vorhanden.
              </div>
            ) : (
              matchedEntries.map((item, idx) => (
                <div key={idx} style={{ background: '#030712', border: `1px solid ${eng.color}`, padding: 8, borderRadius: 6, fontSize: 11 }}>
                  <div style={{ color: eng.color, fontWeight: 700, fontFamily: 'monospace', marginBottom: 4 }}>
                    🔑 {item.key}
                  </div>
                  <div style={{ background: '#090d16', padding: 6, borderRadius: 4, color: '#cbd5e1', fontSize: 10, fontFamily: 'monospace', wordBreak: 'break-all', maxHeight: 80, overflowY: 'auto' }}>
                    {item.value}
                  </div>
                  <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                    <span>Size: {new Blob([item.key + item.value]).size} B</span>
                    <span style={{ color: '#10b981' }}>Double-click to edit</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      );
    }

    // 1. Cluster View (Full Visibility with Expand/Collapse Controls)
    if (layoutType === 'subgraph_cluster') {
      return (
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>
            📦 Storage Cluster Übersicht (Klicke auf Header zum Ein/Ausklappen oder Doppelklick zum Explodieren):
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxHeight: 390, overflowY: 'auto' }}>
            {engines.map((eng) => {
              const matched = entries.filter((e) => e.target.toLowerCase().includes(eng.name.toLowerCase()));
              const isExpanded = expandedClusters[eng.name] !== false;

              return (
                <div
                  key={eng.name}
                  style={{
                    background: '#090d16',
                    border: `1px solid ${eng.color}`,
                    borderRadius: 8,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  {/* Cluster Header */}
                  <div
                    onClick={() => toggleClusterExpand(eng.name)}
                    onDoubleClick={() => setExplodedEngine(eng.name)}
                    style={{
                      background: '#1e293b',
                      padding: '8px 10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                    title="Klick: Ein/Ausklappen | Doppelklick: Engine Explodieren"
                  >
                    <span style={{ fontSize: 11, fontWeight: 700, color: eng.color }}>
                      {eng.icon} {eng.name.toUpperCase()} ({matched.length})
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#94a3b8' }}>
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </div>
                  </div>

                  {/* Cluster Items List (NO hidden items!) */}
                  {isExpanded && (
                    <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
                      {matched.length === 0 ? (
                        <div style={{ fontSize: 10, color: '#64748b', fontStyle: 'italic', padding: 4 }}>
                          (Keine Einträge)
                        </div>
                      ) : (
                        matched.map((item, idx) => (
                          <div
                            key={idx}
                            style={{
                              background: '#030712',
                              border: '1px solid #1e293b',
                              borderRadius: 4,
                              padding: '4px 8px',
                              fontSize: 10,
                              fontFamily: 'monospace',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                            }}
                          >
                            <span style={{ color: eng.color, fontWeight: 600 }}>🔑 {item.key.slice(0, 16)}</span>
                            <span style={{ color: '#94a3b8', fontSize: 9 }}>{item.value.slice(0, 12)}...</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // 2. Sequence Diagram View
    if (layoutType === 'sequence_flow') {
      const steps = [
        { from: '👤 User', to: '🌐 Web App', msg: 'UI Interaction / Event', y: 70 },
        { from: '🌐 Web App', to: '💾 Storage Engine', msg: 'setItem() / setCookie()', y: 140 },
        { from: '💾 Storage Engine', to: '🛠️ Storage Suite', msg: 'Mutation Event / Interception', y: 210 },
        { from: '🛠️ Storage Suite', to: '👤 User', msg: 'Real-time Glow & Provenance Blame', y: 280 },
      ];

      return (
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ background: '#030712', borderRadius: 8, minWidth: '100%', display: 'block' }}>
          <line x1="80" y1="40" x2="80" y2="340" stroke="#334155" strokeDasharray="4 4" />
          <line x1="240" y1="40" x2="240" y2="340" stroke="#334155" strokeDasharray="4 4" />
          <line x1="400" y1="40" x2="400" y2="340" stroke="#334155" strokeDasharray="4 4" />
          <line x1="560" y1="40" x2="560" y2="340" stroke="#334155" strokeDasharray="4 4" />

          <rect x="30" y="10" width="100" height="28" rx="6" fill="#1e293b" stroke="#38bdf8" />
          <text x="80" y="28" textAnchor="middle" fill="#f8fafc" fontSize="11" fontWeight="bold">👤 User</text>

          <rect x="190" y="10" width="100" height="28" rx="6" fill="#1e293b" stroke="#a855f7" />
          <text x="240" y="28" textAnchor="middle" fill="#f8fafc" fontSize="11" fontWeight="bold">🌐 Web App</text>

          <rect x="350" y="10" width="100" height="28" rx="6" fill="#1e293b" stroke="#10b981" />
          <text x="400" y="28" textAnchor="middle" fill="#f8fafc" fontSize="11" fontWeight="bold">💾 Engines</text>

          <rect x="510" y="10" width="100" height="28" rx="6" fill="#1e293b" stroke="#f59e0b" />
          <text x="560" y="28" textAnchor="middle" fill="#f8fafc" fontSize="11" fontWeight="bold">🛠️ Suite</text>

          {steps.map((s, idx) => (
            <g key={idx}>
              <line x1="80" y1={s.y} x2="560" y2={s.y} stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="3 3" />
              <polygon points="556,276 564,280 556,284" fill="#38bdf8" />
              <rect x="180" y={s.y - 12} width="280" height="22" rx="4" fill="#090d16" stroke="#334155" />
              <text x="320" y={s.y + 3} textAnchor="middle" fill="#38bdf8" fontSize="10" fontWeight="600">{s.msg}</text>
            </g>
          ))}
        </svg>
      );
    }

    // 3. Hierarchical Top-Down (TD) View
    if (layoutType === 'hierarchical_td') {
      const topY = 40;
      const midY = 150;
      const leafY = 280;

      return (
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ background: '#030712', borderRadius: 8, minWidth: '100%', display: 'block' }}>
          {/* Top Domain Node */}
          <g transform={`translate(${cx}, ${topY})`}>
            <rect x="-90" y="-18" width="180" height="36" rx="8" fill="#0284c7" stroke="#38bdf8" strokeWidth="2" />
            <text y="4" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="bold">🌐 {cleanDomain.slice(0, 22)}</text>
          </g>

          {/* Engine Nodes & Branching Lines */}
          {engines.map((eng, idx) => {
            const engX = idx * 150 + 95;

            return (
              <g key={eng.name}>
                {/* Line from Domain to Engine */}
                <path d={`M ${cx} ${topY + 18} L ${engX} ${midY - 18}`} stroke={eng.color} strokeWidth="1.5" strokeDasharray="3 3" />

                {/* Engine Node Box */}
                <g transform={`translate(${engX}, ${midY})`} onDoubleClick={() => setExplodedEngine(eng.name)} style={{ cursor: 'pointer' }}>
                  <rect x="-60" y="-18" width="120" height="36" rx="6" fill="#1e293b" stroke={eng.color} strokeWidth="2" />
                  <text y="-2" textAnchor="middle" fill="#f8fafc" fontSize="10" fontWeight="bold">{eng.icon} {eng.name}</text>
                  <text y="10" textAnchor="middle" fill={eng.color} fontSize="9">{entries.filter((e) => e.target.toLowerCase().includes(eng.name.toLowerCase())).length} Einträge</text>
                </g>

                {/* Leaf Key Branch */}
                {entries.filter((e) => e.target.toLowerCase().includes(eng.name.toLowerCase())).slice(0, 2).map((item, i) => {
                  const leafX = engX + (i === 0 ? -28 : 28);
                  return (
                    <g key={i}>
                      <line x1={engX} y1={midY + 18} x2={leafX} y2={leafY - 14} stroke={eng.color} strokeWidth="1" opacity="0.6" />
                      <g transform={`translate(${leafX}, ${leafY})`}>
                        <rect x="-32" y="-12" width="64" height="24" rx="4" fill="#090d16" stroke="#334155" />
                        <text y="3" textAnchor="middle" fill="#cbd5e1" fontSize="8" fontFamily="monospace">🔑 {item.key.slice(0, 7)}</text>
                      </g>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      );
    }

    // 4. Hierarchical Left-Right (LR) View
    if (layoutType === 'hierarchical_lr') {
      const leftX = 65;
      const midX = 250;
      const rightX = 460;
      const cyLocal = height / 2;

      return (
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ background: '#030712', borderRadius: 8, minWidth: '100%', display: 'block' }}>
          {/* Left Domain Root Node */}
          <g transform={`translate(${leftX}, ${cyLocal})`}>
            <rect x="-50" y="-24" width="100" height="48" rx="8" fill="#0284c7" stroke="#38bdf8" strokeWidth="2" />
            <text y="-2" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="bold">🌐 Root</text>
            <text y="12" textAnchor="middle" fill="#94a3b8" fontSize="9">{cleanDomain.slice(0, 14)}</text>
          </g>

          {/* Engine Nodes in Column 2 */}
          {engines.map((eng, idx) => {
            const engY = idx * 90 + 55;
            const matched = entries.filter((e) => e.target.toLowerCase().includes(eng.name.toLowerCase()));

            return (
              <g key={eng.name}>
                {/* Curved Bezier Path from Root to Engine */}
                <path d={`M ${leftX + 50} ${cyLocal} C ${leftX + 140} ${cyLocal}, ${midX - 140} ${engY}, ${midX - 60} ${engY}`} stroke={eng.color} strokeWidth="1.5" fill="none" strokeDasharray="3 3" />

                {/* Engine Node Box */}
                <g transform={`translate(${midX}, ${engY})`} onDoubleClick={() => setExplodedEngine(eng.name)} style={{ cursor: 'pointer' }}>
                  <rect x="-60" y="-18" width="120" height="36" rx="6" fill="#1e293b" stroke={eng.color} strokeWidth="2" />
                  <text y="-2" textAnchor="middle" fill="#f8fafc" fontSize="10" fontWeight="bold">{eng.icon} {eng.name}</text>
                  <text y="10" textAnchor="middle" fill={eng.color} fontSize="9">{matched.length} Einträge</text>
                </g>

                {/* Leaf Branch Items in Column 3 */}
                {matched.slice(0, 2).map((item, i) => {
                  const leafY = engY + (i === 0 ? -14 : 14);
                  return (
                    <g key={i}>
                      <line x1={midX + 60} y1={engY} x2={rightX - 55} y2={leafY} stroke={eng.color} strokeWidth="1" opacity="0.6" />
                      <g transform={`translate(${rightX}, ${leafY})`}>
                        <rect x="-55" y="-10" width="110" height="20" rx="4" fill="#090d16" stroke="#334155" />
                        <text y="3" textAnchor="middle" fill="#cbd5e1" fontSize="9" fontFamily="monospace">🔑 {item.key.slice(0, 12)}</text>
                      </g>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      );
    }

    // 5. Default Star View
    const enginePositions = [
      { x: cx - 180, y: cy - 90 },
      { x: cx + 180, y: cy - 90 },
      { x: cx - 180, y: cy + 90 },
      { x: cx + 180, y: cy + 90 },
    ];

    return (
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ background: '#030712', borderRadius: 8, minWidth: '100%', display: 'block' }}>
        <defs>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Central Connecting Lines */}
        {enginePositions.map((pos, idx) => (
          <line
            key={`line_${idx}`}
            x1={cx}
            y1={cy}
            x2={pos.x}
            y2={pos.y}
            stroke={engines[idx].color}
            strokeWidth="2"
            strokeDasharray="4 4"
            opacity="0.7"
          />
        ))}

        {/* Center Root Node */}
        <g transform={`translate(${cx}, ${cy})`}>
          <circle r="36" fill="#0284c7" stroke="#38bdf8" strokeWidth="3" filter="url(#glow)" />
          <text y="-4" textAnchor="middle" fill="#ffffff" fontSize="12" fontWeight="bold">🌐 Active Hub</text>
          <text y="14" textAnchor="middle" fill="#94a3b8" fontSize="10">{cleanDomain.slice(0, 20)}</text>
        </g>

        {/* Engine Nodes & Entries */}
        {engines.map((eng, idx) => {
          const pos = enginePositions[idx];
          const count = entries.filter((e) => e.target.toLowerCase().includes(eng.name.toLowerCase())).length;

          return (
            <g
              key={eng.name}
              transform={`translate(${pos.x}, ${pos.y})`}
              onDoubleClick={() => setExplodedEngine(eng.name)}
              style={{ cursor: 'pointer' }}
              title="Doppelklick zum Explodieren der Inhalte"
            >
              <rect x="-70" y="-24" width="140" height="48" rx="8" fill="#1e293b" stroke={eng.color} strokeWidth="2" filter="url(#glow)" />
              <text y="-4" textAnchor="middle" fill="#f8fafc" fontSize="11" fontWeight="bold">
                {eng.icon} {eng.name}
              </text>
              <text y="12" textAnchor="middle" fill={eng.color} fontSize="10" fontWeight="600">
                {count} {count === 1 ? 'Eintrag' : 'Einträge'}
              </text>
            </g>
          );
        })}
      </svg>
    );
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        background: '#090d16',
        borderRadius: 10,
        border: '1px solid #1e293b',
        padding: 14,
        color: '#f8fafc',
      }}
    >
      {/* Diagram Controls Toolbar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#38bdf8' }}>
          <Network size={16} />
          <span>Mermaid Storage Topology</span>
        </div>

        {/* Diagram Type Switcher Selector */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button
            className={`tab-btn ${layoutType === 'star' ? 'active' : ''}`}
            onClick={() => { setLayoutType('star'); setExplodedEngine(null); }}
            style={{ fontSize: 11, padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <Network size={12} /> ⭐ Sternform
          </button>
          <button
            className={`tab-btn ${layoutType === 'hierarchical_td' ? 'active' : ''}`}
            onClick={() => { setLayoutType('hierarchical_td'); setExplodedEngine(null); }}
            style={{ fontSize: 11, padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <GitBranch size={12} /> ⬇️ Hierarchisch (TD)
          </button>
          <button
            className={`tab-btn ${layoutType === 'hierarchical_lr' ? 'active' : ''}`}
            onClick={() => { setLayoutType('hierarchical_lr'); setExplodedEngine(null); }}
            style={{ fontSize: 11, padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <GitBranch size={12} /> ➡️ Hierarchisch (LR)
          </button>
          <button
            className={`tab-btn ${layoutType === 'subgraph_cluster' ? 'active' : ''}`}
            onClick={() => { setLayoutType('subgraph_cluster'); setExplodedEngine(null); }}
            style={{ fontSize: 11, padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <Layers size={12} /> 📦 Cluster
          </button>
          <button
            className={`tab-btn ${layoutType === 'sequence_flow' ? 'active' : ''}`}
            onClick={() => { setLayoutType('sequence_flow'); setExplodedEngine(null); }}
            style={{ fontSize: 11, padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <Activity size={12} /> 🔄 Sequenz
          </button>
        </div>

        {/* Action Buttons: Copy Code & Download SVG */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="action-btn"
            title="Mermaid Code anzeigen/kopieren"
            onClick={() => setShowCode(!showCode)}
            style={{ fontSize: 11, color: showCode ? '#38bdf8' : '#94a3b8' }}
          >
            <Code size={13} /> {showCode ? 'Diagramm' : 'Syntax Code'}
          </button>
          <button
            className="action-btn"
            title="Kopiere Mermaid Markdown Code"
            onClick={handleCopyCode}
            style={{ fontSize: 11, color: copied ? '#10b981' : '#94a3b8' }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Kopiert!' : 'Code'}
          </button>
          <button
            className="action-btn"
            title="Vektorgrafik als SVG herunterladen"
            onClick={handleDownloadSvg}
            style={{ fontSize: 11, color: '#38bdf8' }}
          >
            <Download size={13} /> SVG
          </button>
        </div>
      </div>

      {/* Main View Area */}
      {showCode ? (
        <div style={{ position: 'relative' }}>
          <pre
            style={{
              background: '#030712',
              border: '1px solid #1e293b',
              borderRadius: 8,
              padding: 12,
              color: '#38bdf8',
              fontFamily: 'monospace',
              fontSize: 11,
              overflowX: 'auto',
              maxHeight: 400,
              whiteSpace: 'pre-wrap',
            }}
          >
            {mermaidCode}
          </pre>
        </div>
      ) : (
        <div
          id="native_topology_svg_container"
          style={{
            minHeight: 320,
            maxHeight: 520,
            overflow: 'auto',
            background: '#030712',
            borderRadius: 8,
            border: '1px solid #1e293b',
            padding: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {renderSvgDiagram()}
        </div>
      )}
    </div>
  );
}
