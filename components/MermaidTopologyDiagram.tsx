import React, { useState, useMemo } from 'react';
import { StorageTarget } from '../src/domain/model/valueObjects';
import { Copy, Check, Download, Code, Network, GitBranch, Layers, Activity } from 'lucide-react';

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

      items.slice(0, 8).forEach((item, idx) => {
        const itemId = `ITEM_${target}_${idx}`;
        const keyLabel = sanitize(item.key);
        code += `  ${targetId} --> ${itemId}["🔑 ${keyLabel}"]\n`;
        code += `  style ${itemId} fill:#0f172a,stroke:#334155,color:#38bdf8;\n`;
      });
      if (items.length > 8) {
        const moreId = `MORE_${target}`;
        code += `  ${targetId} --> ${moreId}["... +${items.length - 8} weitere"]\n`;
      }
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
        items.slice(0, 10).forEach((item, idx) => {
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
        items.slice(0, 10).forEach((item, idx) => {
          const itemId = `Sub_${target}_${idx}`;
          const cleanKey = sanitize(item.key);
          const cleanVal = sanitize(item.value.slice(0, 20));
          code += `    ${itemId}["🔑 ${cleanKey} : ${cleanVal}..."]\n`;
        });
        if (items.length > 10) {
          code += `    Sub_${target}_more["... +${items.length - 10} weitere"]\n`;
        }
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

export function renderNativeTopologySvg(
  entries: StorageEntryItem[],
  layoutType: DiagramLayoutType,
  domainName: string = 'Active Page'
): React.ReactNode {
  const cleanDomain = domainName.replace(/^https?:\/\//, '') || 'Active Page';
  
  const engines = [
    { name: 'localStorage', color: '#38bdf8', icon: '💾' },
    { name: 'sessionStorage', color: '#a855f7', icon: '⏱️' },
    { name: 'cookie', color: '#10b981', icon: '🍪' },
    { name: 'indexedDB', color: '#f59e0b', icon: '🗄️' },
  ];

  const width = 640;
  const height = 380;
  const cx = width / 2;
  const cy = height / 2;

  if (layoutType === 'subgraph_cluster') {
    return (
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ background: '#030712', borderRadius: 8 }}>
        {engines.map((eng, idx) => {
          const col = idx % 2;
          const row = Math.floor(idx / 2);
          const x = col * 300 + 20;
          const y = row * 175 + 15;
          const targetItems = entries.filter((e) => e.target.toLowerCase().includes(eng.name.toLowerCase()));

          return (
            <g key={eng.name} transform={`translate(${x}, ${y})`}>
              <rect width="290" height="160" rx="8" fill="#090d16" stroke={eng.color} strokeWidth="1.5" />
              <rect width="290" height="30" rx="8" fill="#1e293b" />
              <text x="12" y="20" fill="#f8fafc" fontSize="11" fontWeight="bold">
                {eng.icon} {eng.name.toUpperCase()} CLUSTER ({targetItems.length})
              </text>

              {targetItems.slice(0, 4).map((item, i) => (
                <g key={i} transform={`translate(12, ${44 + i * 26})`}>
                  <rect width="266" height="22" rx="4" fill="#030712" stroke="#334155" strokeWidth="1" />
                  <text x="8" y="15" fill={eng.color} fontSize="10" fontFamily="monospace" fontWeight="600">
                    🔑 {item.key.slice(0, 18)} : <tspan fill="#cbd5e1">{item.value.slice(0, 16)}</tspan>
                  </text>
                </g>
              ))}

              {targetItems.length > 4 && (
                <text x="12" y="150" fill="#94a3b8" fontSize="10" italic="true">
                  + {targetItems.length - 4} weitere Einträge...
                </text>
              )}
            </g>
          );
        })}
      </svg>
    );
  }

  if (layoutType === 'sequence_flow') {
    const steps = [
      { from: '👤 User', to: '🌐 Web App', msg: 'User Click / Form Event', y: 70 },
      { from: '🌐 Web App', to: '💾 Engines', msg: 'setItem() / setCookie()', y: 140 },
      { from: '💾 Engines', to: '🛠️ Storage Suite', msg: 'Mutation Event / Intercept', y: 210 },
      { from: '🛠️ Storage Suite', to: '👤 User', msg: 'Realtime Glow & Data Blame', y: 280 },
    ];

    return (
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ background: '#030712', borderRadius: 8 }}>
        <line x1="80" y1="40" x2="80" y2="330" stroke="#334155" strokeDasharray="4 4" />
        <line x1="240" y1="40" x2="240" y2="330" stroke="#334155" strokeDasharray="4 4" />
        <line x1="400" y1="40" x2="400" y2="330" stroke="#334155" strokeDasharray="4 4" />
        <line x1="560" y1="40" x2="560" y2="330" stroke="#334155" strokeDasharray="4 4" />

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
            <line x1="80" y1={s.y} x2="560" y2={s.y} stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="2 2" />
            <polygon points="556,276 564,280 556,284" fill="#38bdf8" />
            <rect x="180" y={s.y - 12} width="280" height="20" rx="4" fill="#090d16" stroke="#334155" />
            <text x="320" y={s.y + 2} textAnchor="middle" fill="#38bdf8" fontSize="10" fontWeight="600">{s.msg}</text>
          </g>
        ))}
      </svg>
    );
  }

  // Default Star & Hierarchy SVG View
  const enginePositions = [
    { x: cx - 180, y: cy - 90 },
    { x: cx + 180, y: cy - 90 },
    { x: cx - 180, y: cy + 90 },
    { x: cx + 180, y: cy + 90 },
  ];

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ background: '#030712', borderRadius: 8 }}>
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
          <g key={eng.name} transform={`translate(${pos.x}, ${pos.y})`}>
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
}

export default function MermaidTopologyDiagram({ entries, currentUrl = 'https://example.com' }: MermaidTopologyDiagramProps) {
  const [layoutType, setLayoutType] = useState<DiagramLayoutType>('star');
  const [showCode, setShowCode] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

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
            onClick={() => setLayoutType('star')}
            style={{ fontSize: 11, padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <Network size={12} /> ⭐ Sternform
          </button>
          <button
            className={`tab-btn ${layoutType === 'hierarchical_td' ? 'active' : ''}`}
            onClick={() => setLayoutType('hierarchical_td')}
            style={{ fontSize: 11, padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <GitBranch size={12} /> ⬇️ Hierarchisch (TD)
          </button>
          <button
            className={`tab-btn ${layoutType === 'hierarchical_lr' ? 'active' : ''}`}
            onClick={() => setLayoutType('hierarchical_lr')}
            style={{ fontSize: 11, padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <GitBranch size={12} /> ➡️ Hierarchisch (LR)
          </button>
          <button
            className={`tab-btn ${layoutType === 'subgraph_cluster' ? 'active' : ''}`}
            onClick={() => setLayoutType('subgraph_cluster')}
            style={{ fontSize: 11, padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <Layers size={12} /> 📦 Cluster
          </button>
          <button
            className={`tab-btn ${layoutType === 'sequence_flow' ? 'active' : ''}`}
            onClick={() => setLayoutType('sequence_flow')}
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
          {renderNativeTopologySvg(entries, layoutType, currentUrl)}
        </div>
      )}
    </div>
  );
}
