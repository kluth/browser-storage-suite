import React, { useState, useMemo } from 'react';
import { StorageTarget } from '../src/domain/model/valueObjects';
import { Copy, Check, Download, Code, Network, GitBranch, Layers, Activity, ChevronRight, Home, CornerUpLeft } from 'lucide-react';

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
  domainName: string = 'Active Page',
  focusedPath: string[] = []
): string {
  const sanitize = (text: string) =>
    String(text || '')
      .replace(/["'`\\()[\]{}#&]/g, '')
      .replace(/[\r\n]/g, ' ')
      .trim();

  const cleanDomain = sanitize(domainName.replace(/^https?:\/\//, '')) || 'Active Page';

  // 1. Level 2 Drilldown: Focused Key Sub-Diagram (Key -> Value, Type, Size, Provenance)
  if (focusedPath.length === 2) {
    const [targetEng, keyName] = focusedPath;
    const item = entries.find((e) => e.target.toLowerCase().includes(targetEng.toLowerCase()) && e.key === keyName);
    const valText = item ? sanitize(item.value) : 'undefined';
    const valSize = item ? new Blob([item.key + item.value]).size : 0;

    let code = `flowchart TD\n`;
    code += `  style KEY_ROOT fill:#0284c7,stroke:#38bdf8,stroke-width:3px,color:#ffffff;\n`;
    code += `  KEY_ROOT["🔑 ${sanitize(keyName)}"]\n`;
    code += `  KEY_ROOT --> VAL_NODE["📄 Value: ${valText.slice(0, 30)}..."]\n`;
    code += `  KEY_ROOT --> SIZE_NODE["📊 Size: ${valSize} Bytes"]\n`;
    code += `  KEY_ROOT --> ENGINE_NODE["📦 Engine: ${targetEng}"]\n`;
    code += `  KEY_ROOT --> PROV_NODE["📍 Tracing: User Action / Interceptor"]\n`;

    code += `  style VAL_NODE fill:#0f172a,stroke:#38bdf8,color:#cbd5e1;\n`;
    code += `  style SIZE_NODE fill:#0f172a,stroke:#a855f7,color:#cbd5e1;\n`;
    code += `  style ENGINE_NODE fill:#0f172a,stroke:#10b981,color:#cbd5e1;\n`;
    code += `  style PROV_NODE fill:#0f172a,stroke:#f59e0b,color:#cbd5e1;\n`;
    return code;
  }

  // 2. Level 1 Drilldown: Focused Engine Sub-Diagram (Engine -> All Child Keys)
  if (focusedPath.length === 1) {
    const targetEng = focusedPath[0];
    const engItems = entries.filter((e) => e.target.toLowerCase().includes(targetEng.toLowerCase()));

    if (layoutType === 'star') {
      let code = `graph LR\n`;
      code += `  style ENG_ROOT fill:#a855f7,stroke:#c084fc,stroke-width:3px,color:#ffffff;\n`;
      code += `  ENG_ROOT["📦 ${targetEng.toUpperCase()} (${engItems.length} Einträge)"]\n`;

      engItems.forEach((item, idx) => {
        const itemId = `ITEM_${idx}`;
        const keyLabel = sanitize(item.key);
        code += `  ENG_ROOT --- ${itemId}["🔑 ${keyLabel}"]\n`;
        code += `  style ${itemId} fill:#0f172a,stroke:#38bdf8,color:#38bdf8;\n`;
      });
      return code;
    }

    if (layoutType === 'hierarchical_td' || layoutType === 'hierarchical_lr') {
      const dir = layoutType === 'hierarchical_td' ? 'TD' : 'LR';
      let code = `flowchart ${dir}\n`;
      code += `  EngNode["📦 ${targetEng.toUpperCase()} Engine Root"]\n`;
      engItems.forEach((item, idx) => {
        const leafId = `Leaf_${idx}`;
        const cleanKey = sanitize(item.key);
        const cleanVal = sanitize(item.value.slice(0, 16));
        code += `  EngNode --> ${leafId}["🔑 ${cleanKey} : ${cleanVal}"]\n`;
      });
      return code;
    }

    if (layoutType === 'subgraph_cluster') {
      let code = `flowchart TB\n`;
      code += `  subgraph ${targetEng.toUpperCase()} ["📦 ${targetEng.toUpperCase()} Sub-Diagram Cluster"]\n`;
      engItems.forEach((item, idx) => {
        const itemId = `Sub_${idx}`;
        code += `    ${itemId}["🔑 ${sanitize(item.key)} : ${sanitize(item.value.slice(0, 20))}"]\n`;
      });
      code += `  end\n`;
      return code;
    }

    // Sequence for single engine
    let code = `sequenceDiagram\n`;
    code += `  autonumber\n`;
    code += `  actor User as 👤 User\n`;
    code += `  participant Engine as 📦 ${targetEng}\n`;
    code += `  participant Suite as 🛠️ Storage Suite\n`;
    engItems.slice(0, 5).forEach((item) => {
      code += `  User->>Engine: Mutate Key "${sanitize(item.key)}"\n`;
      code += `  Engine-->>Suite: Intercept Mutation (${new Blob([item.value]).size} B)\n`;
    });
    return code;
  }

  // 3. Level 0: Main Global Diagram
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
  const [focusedPath, setFocusedPath] = useState<string[]>([]);
  const [expandedClusters, setExpandedClusters] = useState<Record<string, boolean>>({
    localStorage: true,
    sessionStorage: true,
    cookie: true,
    indexedDB: true,
  });

  const cleanDomain = currentUrl.replace(/^https?:\/\//, '') || 'Active Page';

  const mermaidCode = useMemo(() => {
    return generateMermaidCode(entries, layoutType, currentUrl, focusedPath);
  }, [entries, layoutType, currentUrl, focusedPath]);

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

  const renderSvgDiagram = () => {
    const width = 640;
    const height = 420;
    const cx = width / 2;
    const cy = height / 2;

    // A. LEVEL 2 SUB-MERMAID DIAGRAM (Key Detail Sub-Diagram)
    if (focusedPath.length === 2) {
      const [engName, keyName] = focusedPath;
      const eng = engines.find((e) => e.name === engName) || engines[0];
      const item = entries.find((e) => e.target.toLowerCase().includes(engName.toLowerCase()) && e.key === keyName);
      const valStr = item ? item.value : 'undefined';
      const sizeBytes = item ? new Blob([item.key + item.value]).size : 0;

      return (
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ background: '#030712', borderRadius: 8, minWidth: '100%', display: 'block' }}>
          {/* Connecting Lines */}
          <line x1={cx} y1={cy} x2={cx - 160} y2={cy - 100} stroke="#38bdf8" strokeWidth="2" strokeDasharray="3 3" />
          <line x1={cx} y1={cy} x2={cx + 160} y2={cy - 100} stroke="#a855f7" strokeWidth="2" strokeDasharray="3 3" />
          <line x1={cx} y1={cy} x2={cx - 160} y2={cy + 100} stroke="#10b981" strokeWidth="2" strokeDasharray="3 3" />
          <line x1={cx} y1={cy} x2={cx + 160} y2={cy + 100} stroke="#f59e0b" strokeWidth="2" strokeDasharray="3 3" />

          {/* Root Sub-Node (Key) */}
          <g transform={`translate(${cx}, ${cy})`}>
            <rect x="-90" y="-24" width="180" height="48" rx="8" fill="#0284c7" stroke="#38bdf8" strokeWidth="3" />
            <text y="-4" textAnchor="middle" fill="#ffffff" fontSize="12" fontWeight="bold">🔑 Key: {keyName.slice(0, 14)}</text>
            <text y="12" textAnchor="middle" fill="#94a3b8" fontSize="9">Sub-Diagram Level 2</text>
          </g>

          {/* Sub-Attribute Nodes */}
          <g transform={`translate(${cx - 160}, ${cy - 100})`}>
            <rect x="-70" y="-20" width="140" height="40" rx="6" fill="#1e293b" stroke="#38bdf8" strokeWidth="1.5" />
            <text y="-2" textAnchor="middle" fill="#38bdf8" fontSize="10" fontWeight="bold">📄 Value Payload</text>
            <text y="10" textAnchor="middle" fill="#cbd5e1" fontSize="9">{valStr.slice(0, 16)}...</text>
          </g>

          <g transform={`translate(${cx + 160}, ${cy - 100})`}>
            <rect x="-70" y="-20" width="140" height="40" rx="6" fill="#1e293b" stroke="#a855f7" strokeWidth="1.5" />
            <text y="-2" textAnchor="middle" fill="#a855f7" fontSize="10" fontWeight="bold">📊 Byte Size</text>
            <text y="10" textAnchor="middle" fill="#cbd5e1" fontSize="9">{sizeBytes} Bytes</text>
          </g>

          <g transform={`translate(${cx - 160}, ${cy + 100})`}>
            <rect x="-70" y="-20" width="140" height="40" rx="6" fill="#1e293b" stroke="#10b981" strokeWidth="1.5" />
            <text y="-2" textAnchor="middle" fill="#10b981" fontSize="10" fontWeight="bold">📦 Parent Engine</text>
            <text y="10" textAnchor="middle" fill="#cbd5e1" fontSize="9">{engName}</text>
          </g>

          <g transform={`translate(${cx + 160}, ${cy + 100})`}>
            <rect x="-70" y="-20" width="140" height="40" rx="6" fill="#1e293b" stroke="#f59e0b" strokeWidth="1.5" />
            <text y="-2" textAnchor="middle" fill="#f59e0b" fontSize="10" fontWeight="bold">📍 Provenance Trace</text>
            <text y="10" textAnchor="middle" fill="#cbd5e1" fontSize="9">User Interception</text>
          </g>
        </svg>
      );
    }

    // B. LEVEL 1 SUB-MERMAID DIAGRAM (Engine Sub-Diagram)
    if (focusedPath.length === 1) {
      const engName = focusedPath[0];
      const eng = engines.find((e) => e.name === engName) || engines[0];
      const matched = entries.filter((e) => e.target.toLowerCase().includes(engName.toLowerCase()));

      if (layoutType === 'star') {
        const leafAngles = matched.map((_, i) => (i / Math.max(matched.length, 1)) * 2 * Math.PI);

        return (
          <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ background: '#030712', borderRadius: 8, minWidth: '100%', display: 'block' }}>
            {/* Connecting Star Rays */}
            {matched.map((item, idx) => {
              const angle = leafAngles[idx];
              const r = 140;
              const lx = cx + Math.cos(angle) * r;
              const ly = cy + Math.sin(angle) * r;

              return (
                <g key={idx}>
                  <line x1={cx} y1={cy} x2={lx} y2={ly} stroke={eng.color} strokeWidth="1.5" strokeDasharray="3 3" opacity="0.8" />
                  <g transform={`translate(${lx}, ${ly})`} onDoubleClick={() => setFocusedPath([engName, item.key])} style={{ cursor: 'pointer' }} title="Doppelklick für Key-Detail-Diagramm">
                    <rect x="-55" y="-14" width="110" height="28" rx="6" fill="#090d16" stroke={eng.color} strokeWidth="1.5" />
                    <text y="-1" textAnchor="middle" fill="#f8fafc" fontSize="10" fontWeight="bold">🔑 {item.key.slice(0, 10)}</text>
                    <text y="9" textAnchor="middle" fill="#94a3b8" fontSize="8">{item.value.slice(0, 10)}</text>
                  </g>
                </g>
              );
            })}

            {/* Central Engine Sub-Root Node */}
            <g transform={`translate(${cx}, ${cy})`}>
              <rect x="-80" y="-24" width="160" height="48" rx="8" fill="#1e293b" stroke={eng.color} strokeWidth="3" />
              <text y="-4" textAnchor="middle" fill="#ffffff" fontSize="12" fontWeight="bold">{eng.icon} {engName.toUpperCase()}</text>
              <text y="12" textAnchor="middle" fill={eng.color} fontSize="10">{matched.length} Einträge Sub-Diagramm</text>
            </g>
          </svg>
        );
      }

      if (layoutType === 'hierarchical_td' || layoutType === 'hierarchical_lr') {
        const isTD = layoutType === 'hierarchical_td';
        return (
          <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ background: '#030712', borderRadius: 8, minWidth: '100%', display: 'block' }}>
            {/* Top/Left Engine Root */}
            <g transform={`translate(${isTD ? cx : 70}, ${isTD ? 45 : cy})`}>
              <rect x="-70" y="-20" width="140" height="40" rx="8" fill="#1e293b" stroke={eng.color} strokeWidth="2" />
              <text y="-2" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="bold">{eng.icon} {engName.toUpperCase()}</text>
              <text y="10" textAnchor="middle" fill={eng.color} fontSize="9">Engine Sub-Root</text>
            </g>

            {/* Sub-Children Nodes */}
            {matched.map((item, idx) => {
              const lx = isTD ? (idx * 140) + 70 : 280;
              const ly = isTD ? 220 : (idx * 65) + 50;
              const startX = isTD ? cx : 140;
              const startY = isTD ? 65 : cy;

              return (
                <g key={idx}>
                  <line x1={startX} y1={startY} x2={lx} y2={ly} stroke={eng.color} strokeWidth="1.5" strokeDasharray="3 3" />
                  <g transform={`translate(${lx}, ${ly})`} onDoubleClick={() => setFocusedPath([engName, item.key])} style={{ cursor: 'pointer' }} title="Doppelklick für Key-Detail-Diagramm">
                    <rect x="-60" y="-16" width="120" height="32" rx="6" fill="#090d16" stroke="#334155" strokeWidth="1.5" />
                    <text y="-1" textAnchor="middle" fill={eng.color} fontSize="10" fontWeight="bold">🔑 {item.key.slice(0, 12)}</text>
                    <text y="10" textAnchor="middle" fill="#94a3b8" fontSize="8">{item.value.slice(0, 14)}</text>
                  </g>
                </g>
              );
            })}
          </svg>
        );
      }
    }

    // C. LEVEL 0: MAIN GLOBAL DIAGRAM VIEWS
    if (layoutType === 'subgraph_cluster') {
      return (
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>
            📦 Storage Cluster Übersicht (Doppelklick auf Engine-Header für Sub-Diagramm):
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxHeight: 390, overflowY: 'auto' }}>
            {engines.map((eng) => {
              const matched = entries.filter((e) => e.target.toLowerCase().includes(eng.name.toLowerCase()));

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
                  {/* Cluster Header with Double-Click Sub-Diagram Exploration */}
                  <div
                    onDoubleClick={() => setFocusedPath([eng.name])}
                    style={{
                      background: '#1e293b',
                      padding: '8px 10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                    title="Doppelklick: Sub-Diagramm für diese Engine öffnen!"
                  >
                    <span style={{ fontSize: 11, fontWeight: 700, color: eng.color }}>
                      {eng.icon} {eng.name.toUpperCase()} ({matched.length})
                    </span>
                    <span style={{ fontSize: 9, color: '#38bdf8', fontWeight: 600 }}>🔍 Doppelklick für Sub-Diagramm</span>
                  </div>

                  {/* Cluster Items */}
                  <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
                    {matched.length === 0 ? (
                      <div style={{ fontSize: 10, color: '#64748b', fontStyle: 'italic', padding: 4 }}>
                        (Keine Einträge)
                      </div>
                    ) : (
                      matched.map((item, idx) => (
                        <div
                          key={idx}
                          onDoubleClick={() => setFocusedPath([eng.name, item.key])}
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
                            cursor: 'pointer',
                          }}
                          title="Doppelklick für Key Sub-Diagramm"
                        >
                          <span style={{ color: eng.color, fontWeight: 600 }}>🔑 {item.key.slice(0, 16)}</span>
                          <span style={{ color: '#94a3b8', fontSize: 9 }}>{item.value.slice(0, 12)}...</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

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
            const matched = entries.filter((e) => e.target.toLowerCase().includes(eng.name.toLowerCase()));

            return (
              <g key={eng.name}>
                <path d={`M ${cx} ${topY + 18} L ${engX} ${midY - 18}`} stroke={eng.color} strokeWidth="1.5" strokeDasharray="3 3" />

                <g transform={`translate(${engX}, ${midY})`} onDoubleClick={() => setFocusedPath([eng.name])} style={{ cursor: 'pointer' }} title="Doppelklick: Sub-Diagramm öffnen!">
                  <rect x="-60" y="-18" width="120" height="36" rx="6" fill="#1e293b" stroke={eng.color} strokeWidth="2" />
                  <text y="-2" textAnchor="middle" fill="#f8fafc" fontSize="10" fontWeight="bold">{eng.icon} {eng.name}</text>
                  <text y="10" textAnchor="middle" fill={eng.color} fontSize="9">{matched.length} Einträge</text>
                </g>

                {matched.slice(0, 2).map((item, i) => {
                  const leafX = engX + (i === 0 ? -28 : 28);
                  return (
                    <g key={i}>
                      <line x1={engX} y1={midY + 18} x2={leafX} y2={leafY - 14} stroke={eng.color} strokeWidth="1" opacity="0.6" />
                      <g transform={`translate(${leafX}, ${leafY})`} onDoubleClick={() => setFocusedPath([eng.name, item.key])} style={{ cursor: 'pointer' }}>
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

    if (layoutType === 'hierarchical_lr') {
      const leftX = 65;
      const midX = 250;
      const rightX = 460;

      return (
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ background: '#030712', borderRadius: 8, minWidth: '100%', display: 'block' }}>
          <g transform={`translate(${leftX}, ${cy})`}>
            <rect x="-50" y="-24" width="100" height="48" rx="8" fill="#0284c7" stroke="#38bdf8" strokeWidth="2" />
            <text y="-2" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="bold">🌐 Root</text>
            <text y="12" textAnchor="middle" fill="#94a3b8" fontSize="9">{cleanDomain.slice(0, 14)}</text>
          </g>

          {engines.map((eng, idx) => {
            const engY = idx * 90 + 55;
            const matched = entries.filter((e) => e.target.toLowerCase().includes(eng.name.toLowerCase()));

            return (
              <g key={eng.name}>
                <path d={`M ${leftX + 50} ${cy} C ${leftX + 140} ${cy}, ${midX - 140} ${engY}, ${midX - 60} ${engY}`} stroke={eng.color} strokeWidth="1.5" fill="none" strokeDasharray="3 3" />

                <g transform={`translate(${midX}, ${engY})`} onDoubleClick={() => setFocusedPath([eng.name])} style={{ cursor: 'pointer' }} title="Doppelklick: Sub-Diagramm öffnen!">
                  <rect x="-60" y="-18" width="120" height="36" rx="6" fill="#1e293b" stroke={eng.color} strokeWidth="2" />
                  <text y="-2" textAnchor="middle" fill="#f8fafc" fontSize="10" fontWeight="bold">{eng.icon} {eng.name}</text>
                  <text y="10" textAnchor="middle" fill={eng.color} fontSize="9">{matched.length} Einträge</text>
                </g>

                {matched.slice(0, 2).map((item, i) => {
                  const leafY = engY + (i === 0 ? -14 : 14);
                  return (
                    <g key={i}>
                      <line x1={midX + 60} y1={engY} x2={rightX - 55} y2={leafY} stroke={eng.color} strokeWidth="1" opacity="0.6" />
                      <g transform={`translate(${rightX}, ${leafY})`} onDoubleClick={() => setFocusedPath([eng.name, item.key])} style={{ cursor: 'pointer' }}>
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

    // Default Star View
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

        <g transform={`translate(${cx}, ${cy})`}>
          <circle r="36" fill="#0284c7" stroke="#38bdf8" strokeWidth="3" filter="url(#glow)" />
          <text y="-4" textAnchor="middle" fill="#ffffff" fontSize="12" fontWeight="bold">🌐 Active Hub</text>
          <text y="14" textAnchor="middle" fill="#94a3b8" fontSize="10">{cleanDomain.slice(0, 20)}</text>
        </g>

        {engines.map((eng, idx) => {
          const pos = enginePositions[idx];
          const count = entries.filter((e) => e.target.toLowerCase().includes(eng.name.toLowerCase())).length;

          return (
            <g
              key={eng.name}
              transform={`translate(${pos.x}, ${pos.y})`}
              onDoubleClick={() => setFocusedPath([eng.name])}
              style={{ cursor: 'pointer' }}
              title="Doppelklick: Unter-Mermaid-Diagramm für diese Engine öffnen!"
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
      {/* Sub-Diagram Breadcrumb Navigation Bar */}
      {focusedPath.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#1e293b', padding: '6px 12px', borderRadius: 6, border: '1px solid #38bdf8' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700 }}>
            <span onClick={() => setFocusedPath([])} style={{ color: '#38bdf8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Home size={13} /> {cleanDomain}
            </span>
            {focusedPath.map((step, idx) => (
              <React.Fragment key={idx}>
                <ChevronRight size={12} style={{ color: '#64748b' }} />
                <span
                  onClick={() => setFocusedPath(focusedPath.slice(0, idx + 1))}
                  style={{ color: idx === focusedPath.length - 1 ? '#a855f7' : '#cbd5e1', cursor: 'pointer' }}
                >
                  {idx === 0 ? `📦 ${step}` : `🔑 ${step}`}
                </span>
              </React.Fragment>
            ))}
          </div>

          <button
            onClick={() => setFocusedPath(focusedPath.slice(0, -1))}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: 10, background: '#0284c7', color: '#ffffff', border: 'none', borderRadius: 4, fontWeight: 700, cursor: 'pointer' }}
          >
            <CornerUpLeft size={12} /> Ebenen Zurück
          </button>
        </div>
      )}

      {/* Diagram Controls Toolbar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#38bdf8' }}>
          <Network size={16} />
          <span>{focusedPath.length === 0 ? 'Mermaid Storage Topology' : `Sub-Mermaid: ${focusedPath.join(' / ')}`}</span>
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
            title="Kopiere Sub-Mermaid Markdown Code"
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
