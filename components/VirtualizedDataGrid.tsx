import React, { useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MoreVertical, Copy, Eye, EyeOff, Calendar, Code, Check, ChevronRight, ChevronDown } from 'lucide-react';

export interface GridRow {
  id: number;
  key: string;
  value: string;
  type: string;
  sizeBytes: number;
}

interface VirtualizedDataGridProps {
  rows: GridRow[];
}

type DisplayFormat = 'raw' | 'pretty_json' | 'masked' | 'epoch_date';

export default function VirtualizedDataGrid({ rows }: VirtualizedDataGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [activeMenuRowId, setActiveMenuRowId] = useState<number | null>(null);
  const [rowFormats, setRowFormats] = useState<Record<number, DisplayFormat>>({});
  const [expandedRowIds, setExpandedRowIds] = useState<Record<number, boolean>>({});
  const [copiedRowId, setCopiedRowId] = useState<number | null>(null);
  const [copiedCodeRowId, setCopiedCodeRowId] = useState<number | null>(null);

  const toggleRowExpand = (rowId: number) => {
    setExpandedRowIds((prev) => {
      const next = { ...prev, [rowId]: !prev[rowId] };
      rowVirtualizer.measure();
      return next;
    });
  };

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const rowId = rows[index]?.id;
      return expandedRowIds[rowId] ? 160 : 40;
    },
    overscan: 10,
  });

  const toggleMenu = (rowId: number) => {
    setActiveMenuRowId((prev) => (prev === rowId ? null : rowId));
  };

  const setFormat = (rowId: number, format: DisplayFormat) => {
    setRowFormats((prev) => ({ ...prev, [rowId]: format }));
    setActiveMenuRowId(null);
  };

  const handleCopy = (rowId: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedRowId(rowId);
    setTimeout(() => setCopiedRowId(null), 1500);
    setActiveMenuRowId(null);
  };

  const handleCodeCopy = (rowId: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCodeRowId(rowId);
    setTimeout(() => setCopiedCodeRowId(null), 1500);
  };

  const renderFormattedValue = (row: GridRow, format: DisplayFormat) => {
    if (format === 'masked') {
      return <span style={{ color: '#64748b' }}>••••••••••••••••</span>;
    }

    if (format === 'pretty_json') {
      try {
        const parsed = JSON.parse(row.value);
        return <span style={{ color: '#a855f7', fontFamily: 'monospace' }}>{JSON.stringify(parsed, null, 2)}</span>;
      } catch {
        return <span style={{ color: '#f43f5e' }}>[Invalid JSON] {row.value}</span>;
      }
    }

    if (format === 'epoch_date') {
      const num = Number(row.value);
      if (!isNaN(num)) {
        return <span style={{ color: '#10b981' }}>{new Date(num > 1e11 ? num : num * 1000).toLocaleString()}</span>;
      }
    }

    return <span>{row.value}</span>;
  };

  return (
    <div
      ref={parentRef}
      style={{
        flex: 1,
        width: '100%',
        minHeight: '400px',
        overflowY: 'auto',
        overflowX: 'visible',
        background: '#0f172a',
        borderRadius: '8px',
        border: '1px solid #334155',
        position: 'relative',
      }}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          const currentFormat = rowFormats[row.id] || 'raw';
          const isMenuOpen = activeMenuRowId === row.id;
          const isExpanded = !!expandedRowIds[row.id];

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={rowVirtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
                display: 'flex',
                flexDirection: 'column',
                borderBottom: '1px solid #1e293b',
                fontFamily: 'monospace',
                fontSize: '11px',
                color: '#e2e8f0',
                background: isMenuOpen || isExpanded ? '#1e293b' : 'transparent',
                zIndex: isMenuOpen ? 9999 : 1,
              }}
            >
              {/* Row Header Bar */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '30px 50px 180px 1fr 80px 40px',
                  alignItems: 'center',
                  padding: '0 12px',
                  height: '40px',
                }}
              >
                <button
                  className="action-btn"
                  title="Expand row for multi-line detail view"
                  onClick={() => toggleRowExpand(row.id)}
                  style={{ color: isExpanded ? '#38bdf8' : '#94a3b8', padding: 2 }}
                >
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                <span style={{ color: '#64748b' }}>#{row.id}</span>
                <span style={{ color: '#38bdf8', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {row.key}
                </span>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>
                  {renderFormattedValue(row, currentFormat)}
                </span>
                <span style={{ color: '#10b981', textAlign: 'right' }}>{row.sizeBytes} B</span>

                {/* 3-Dots Context Menu Trigger Button */}
                <div style={{ position: 'relative', justifySelf: 'end', zIndex: isMenuOpen ? 10000 : 2 }}>
                  <button
                    className="action-btn"
                    title="Value Display & Formatting Options"
                    onClick={() => toggleMenu(row.id)}
                    style={{ padding: 4, color: isMenuOpen ? '#38bdf8' : '#94a3b8' }}
                  >
                    <MoreVertical size={14} />
                  </button>

                  {/* Dropdown Options Menu */}
                  {isMenuOpen && (
                    <div
                      style={{
                        position: 'absolute',
                        right: 0,
                        top: 28,
                        zIndex: 10001,
                        background: '#090d16',
                        border: '1px solid #38bdf8',
                        borderRadius: 6,
                        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.9)',
                        padding: 4,
                        minWidth: 170,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                      }}
                    >
                      <button
                        className="tab-btn"
                        style={{ fontSize: 11, padding: '6px 10px', justifyContent: 'flex-start', gap: 6, color: '#f8fafc' }}
                        onClick={() => setFormat(row.id, 'raw')}
                      >
                        <Eye size={12} /> Raw String
                      </button>
                      <button
                        className="tab-btn"
                        style={{ fontSize: 11, padding: '6px 10px', justifyContent: 'flex-start', gap: 6, color: '#f8fafc' }}
                        onClick={() => setFormat(row.id, 'pretty_json')}
                      >
                        <Code size={12} /> Formatted JSON
                      </button>
                      <button
                        className="tab-btn"
                        style={{ fontSize: 11, padding: '6px 10px', justifyContent: 'flex-start', gap: 6, color: '#f8fafc' }}
                        onClick={() => setFormat(row.id, 'masked')}
                      >
                        <EyeOff size={12} /> Mask / Obfuscate
                      </button>
                      <button
                        className="tab-btn"
                        style={{ fontSize: 11, padding: '6px 10px', justifyContent: 'flex-start', gap: 6, color: '#f8fafc' }}
                        onClick={() => setFormat(row.id, 'epoch_date')}
                      >
                        <Calendar size={12} /> Epoch Date Format
                      </button>
                      <div style={{ height: 1, background: '#334155', margin: '2px 0' }} />
                      <button
                        className="tab-btn"
                        style={{ fontSize: 11, padding: '6px 10px', justifyContent: 'flex-start', gap: 6, color: '#10b981' }}
                        onClick={() => handleCopy(row.id, row.value)}
                      >
                        {copiedRowId === row.id ? <Check size={12} /> : <Copy size={12} />}
                        {copiedRowId === row.id ? 'Copied!' : 'Copy Value'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Expandable Multi-Line Detail Drawer with Copy Button */}
              {isExpanded && (
                <div
                  style={{
                    padding: '8px 12px 12px 42px',
                    background: '#090d16',
                    borderTop: '1px solid #334155',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    position: 'relative',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: 10 }}>
                    <span>Type: <strong style={{ color: '#38bdf8' }}>{row.type || 'String'}</strong></span>
                    <span>Size: <strong style={{ color: '#10b981' }}>{row.sizeBytes} bytes</strong></span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: '#cbd5e1', fontWeight: 600 }}>Un-truncated Payload Value:</span>
                    <button
                      className="action-btn"
                      title="Copy payload to clipboard"
                      onClick={() => handleCodeCopy(row.id, row.value)}
                      style={{ color: copiedCodeRowId === row.id ? '#10b981' : '#38bdf8', padding: '2px 6px', fontSize: 10, background: '#030712', borderRadius: 4, border: '1px solid #1e293b' }}
                    >
                      {copiedCodeRowId === row.id ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                  <pre
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 11,
                      background: '#030712',
                      padding: 10,
                      borderRadius: 6,
                      border: '1px solid #1e293b',
                      color: '#38bdf8',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      maxHeight: '200px',
                      overflowY: 'auto',
                    }}
                  >
                    {renderFormattedValue(row, currentFormat)}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
