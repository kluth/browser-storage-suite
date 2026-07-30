import React, { useEffect, useRef, useState, useId, useMemo } from 'react';
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
  const sanitize = (text: string) => text.replace(/["'`\\]/g, '').replace(/[\r\n]/g, ' ');
  const cleanDomain = sanitize(domainName.replace(/^https?:\/\//, ''));

  // Group entries by storage target
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

export default function MermaidTopologyDiagram({ entries, currentUrl = 'https://example.com' }: MermaidTopologyDiagramProps) {
  const uniqueId = useId().replace(/:/g, '');
  const containerRef = useRef<HTMLDivElement>(null);

  const [layoutType, setLayoutType] = useState<DiagramLayoutType>('star');
  const [svgContent, setSvgContent] = useState<string>('');
  const [renderError, setRenderError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const mermaidCode = useMemo(() => {
    return generateMermaidCode(entries, layoutType, currentUrl);
  }, [entries, layoutType, currentUrl]);

  useEffect(() => {
    let isMounted = true;
    const elementId = `mermaid_diagram_${uniqueId}`;

    import('mermaid')
      .then((m) => {
        const mermaidInstance = m.default || m;
        mermaidInstance.initialize({
          startOnLoad: false,
          theme: 'dark',
          securityLevel: 'loose',
          fontFamily: 'monospace',
        });
        return mermaidInstance.render(elementId, mermaidCode);
      })
      .then(({ svg }) => {
        if (isMounted) {
          setSvgContent(svg);
          setRenderError(null);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error('Mermaid render error:', err);
          setRenderError(String(err?.message || err));
        }
      });

    return () => {
      isMounted = false;
    };
  }, [mermaidCode, uniqueId]);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(mermaidCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadSvg = () => {
    if (!svgContent) return;
    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
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

      {/* Main View Area: Rendered SVG vs Code View */}
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
          ref={containerRef}
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
          {renderError ? (
            <div style={{ color: '#ef4444', fontSize: 11, textAlign: 'center', padding: 20 }}>
              ⚠️ Fehler beim Rendern des Mermaid-Diagramms: {renderError}
            </div>
          ) : (
            <div
              dangerouslySetInnerHTML={{ __html: svgContent }}
              style={{ width: '100%', display: 'flex', justifyContent: 'center' }}
            />
          )}
        </div>
      )}
    </div>
  );
}
