import React, { useState, useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  MoreVertical,
  Eye,
  EyeOff,
  Code,
  Calendar,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Edit3,
  Save,
  X,
  Trash2,
  Activity,
  Pin,
} from 'lucide-react';
import { HighlightedCodeSpan } from './MermaidTopologyDiagram';

export interface GridRow {
  id: number;
  key: string;
  value: string;
  type?: string;
  sizeBytes: number;
}

export type DisplayFormat = 'raw' | 'pretty_json' | 'masked' | 'epoch_date';

export interface VirtualizedDataGridProps {
  rows: GridRow[];
  onUpdateEntry?: (key: string, newValue: string) => Promise<void> | void;
  onDeleteEntry?: (key: string) => Promise<void> | void;
  observedKeys?: Record<string, boolean>;
  onToggleObserve?: (key: string) => void;
}

export default function VirtualizedDataGrid({
  rows,
  onUpdateEntry,
  onDeleteEntry,
  observedKeys = {},
  onToggleObserve,
}: VirtualizedDataGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [rowFormats, setRowFormats] = useState<Record<number, DisplayFormat>>({});
  const [activeMenuRowId, setActiveMenuRowId] = useState<number | null>(null);
  const [copiedRowId, setCopiedRowId] = useState<number | null>(null);
  const [copiedCodeRowId, setCopiedCodeRowId] = useState<number | null>(null);
  const [expandedRowIds, setExpandedRowIds] = useState<Record<number, boolean>>({});

  // On-The-Fly Inline Edit State
  const [editingRowId, setEditingRowId] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Value mutation track & pulse glow animation map
  const previousValuesRef = useRef<Record<string, string>>({});
  const [glowingKeys, setGlowingKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const newGlows: Record<string, boolean> = {};
    let hasChanges = false;

    rows.forEach((r) => {
      const prev = previousValuesRef.current[r.key];
      if (prev !== undefined && prev !== r.value) {
        newGlows[r.key] = true;
        hasChanges = true;
      }
      previousValuesRef.current[r.key] = r.value;
    });

    if (hasChanges) {
      setGlowingKeys((prev) => ({ ...prev, ...newGlows }));
      const timer = setTimeout(() => {
        setGlowingKeys((prev) => {
          const updated = { ...prev };
          Object.keys(newGlows).forEach((k) => delete updated[k]);
          return updated;
        });
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [rows]);

  // Sort rows so observed fields are pinned at the top
  const sortedRows = [...rows].sort((a, b) => {
    const aObs = observedKeys[a.key] ? 1 : 0;
    const bObs = observedKeys[b.key] ? 1 : 0;
    return bObs - aObs;
  });

  const rowVirtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const id = sortedRows[index]?.id;
      const isExpanded = expandedRowIds[id];
      const isEditing = editingRowId === id;
      if (isEditing) return 160;
      return isExpanded ? 190 : 40;
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

  const toggleRowExpand = (rowId: number) => {
    setExpandedRowIds((prev) => ({ ...prev, [rowId]: !prev[rowId] }));
  };

  const startEditing = (row: GridRow) => {
    setEditingRowId(row.id);
    setEditingValue(row.value);
    setActiveMenuRowId(null);
    setExpandedRowIds((prev) => ({ ...prev, [row.id]: true }));
  };

  const cancelEditing = () => {
    setEditingRowId(null);
    setEditingValue('');
  };

  const handleSaveEdit = async (row: GridRow) => {
    if (!onUpdateEntry) return;
    setIsSaving(true);
    try {
      await onUpdateEntry(row.key, editingValue);
      setEditingRowId(null);
    } catch (err) {
      console.error('Error saving storage entry:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (row: GridRow) => {
    if (!onDeleteEntry) return;
    if (confirm(`Möchtest du den Eintrag "${row.key}" wirklich löschen?`)) {
      await onDeleteEntry(row.key);
      setActiveMenuRowId(null);
    }
  };

  const renderFormattedValue = (row: GridRow, format: DisplayFormat) => {
    if (format === 'masked') {
      return <span style={{ color: '#64748b' }}>••••••••••••••••</span>;
    }

    if (format === 'pretty_json') {
      try {
        const parsed = JSON.parse(row.value);
        return <HighlightedCodeSpan text={JSON.stringify(parsed, null, 2)} showLineNumbers={true} />;
      } catch {
        return <HighlightedCodeSpan text={row.value} showLineNumbers={true} />;
      }
    }

    if (format === 'epoch_date') {
      const num = Number(row.value);
      if (!isNaN(num)) {
        return <span style={{ color: '#10b981' }}>📅 {new Date(num > 1e11 ? num : num * 1000).toLocaleString()}</span>;
      }
    }

    return <HighlightedCodeSpan text={row.value} />;
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
          const row = sortedRows[virtualRow.index];
          if (!row) return null;
          const currentFormat = rowFormats[row.id] || 'raw';
          const isMenuOpen = activeMenuRowId === row.id;
          const isExpanded = !!expandedRowIds[row.id];
          const isEditing = editingRowId === row.id;
          const isObserved = !!observedKeys[row.key];
          const isGlowing = !!glowingKeys[row.key];

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
                background: isGlowing
                  ? 'rgba(56, 189, 248, 0.25)'
                  : isEditing
                  ? '#0f2744'
                  : isObserved
                  ? 'rgba(168, 85, 247, 0.12)'
                  : isMenuOpen || isExpanded
                  ? '#1e293b'
                  : 'transparent',
                boxShadow: isGlowing
                  ? '0 0 20px rgba(56, 189, 248, 0.9), inset 0 0 10px rgba(16, 185, 129, 0.4)'
                  : isObserved
                  ? 'inset 3px 0 0 #a855f7'
                  : 'none',
                transition: 'all 0.3s ease-in-out',
                zIndex: isGlowing ? 100 : isMenuOpen ? 9999 : 1,
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

                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ color: '#64748b' }}>#{row.id}</span>
                  {isObserved && (
                    <span title="Feld wird aktiv beobachtet (Observed)" style={{ color: '#a855f7', display: 'flex', alignItems: 'center' }}>
                      <Activity size={12} className="pulse-glow" />
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                  <span style={{ color: isObserved ? '#a855f7' : '#38bdf8', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {row.key}
                  </span>
                  {isObserved && (
                    <span style={{ fontSize: 9, background: '#a855f7', color: '#ffffff', padding: '1px 4px', borderRadius: 3, fontWeight: 700 }}>
                      OBSERVED
                    </span>
                  )}
                </div>

                {/* Value display with Double-Click to Edit */}
                <span
                  onDoubleClick={() => startEditing(row)}
                  title="💡 Doppelklick zum Bearbeiten des Werts"
                  style={{
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    paddingRight: 8,
                    cursor: 'pointer',
                    color: isGlowing ? '#38bdf8' : 'inherit',
                    fontWeight: isGlowing ? 700 : 'normal',
                  }}
                >
                  {renderFormattedValue(row, currentFormat)}
                </span>

                <span style={{ color: '#10b981', textAlign: 'right' }}>{row.sizeBytes} B</span>

                {/* 3-Dots Context Menu Trigger Button */}
                <div style={{ position: 'relative', justifySelf: 'end', zIndex: isMenuOpen ? 10000 : 2 }}>
                  <button
                    className="action-btn"
                    title="Value Display & Formatting Options"
                    onClick={() => toggleMenu(row.id)}
                    style={{ padding: 4, color: isMenuOpen ? '#38bdf8' : isObserved ? '#a855f7' : '#94a3b8' }}
                  >
                    <MoreVertical size={14} />
                  </button>

                  {/* Dropdown Options Menu */}
                  {isMenuOpen && (
                    <div
                      style={{
                        position: 'absolute',
                        right: 0,
                        top: 24,
                        zIndex: 10001,
                        background: '#090d16',
                        border: '1px solid #38bdf8',
                        borderRadius: 6,
                        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.9)',
                        padding: 4,
                        minWidth: 190,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                      }}
                    >
                      <button
                        className="tab-btn"
                        style={{ fontSize: 11, padding: '6px 10px', justifyContent: 'flex-start', gap: 6, color: '#38bdf8' }}
                        onClick={() => startEditing(row)}
                      >
                        <Edit3 size={12} /> Live Edit Value (Doppelklick)
                      </button>
                      {onToggleObserve && (
                        <button
                          className="tab-btn"
                          style={{ fontSize: 11, padding: '6px 10px', justifyContent: 'flex-start', gap: 6, color: isObserved ? '#f43f5e' : '#a855f7' }}
                          onClick={() => {
                            onToggleObserve(row.key);
                            setActiveMenuRowId(null);
                          }}
                        >
                          <Activity size={12} /> {isObserved ? 'Unobserve Field' : '👁️ Observe / Watch Field'}
                        </button>
                      )}
                      <div style={{ height: 1, background: '#334155', margin: '2px 0' }} />
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
                      <button
                        className="tab-btn"
                        style={{ fontSize: 11, padding: '6px 10px', justifyContent: 'flex-start', gap: 6, color: '#ef4444' }}
                        onClick={() => handleDelete(row)}
                      >
                        <Trash2 size={12} /> Delete Entry
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* On-The-Fly Live Edit Form Drawer */}
              {isEditing ? (
                <div
                  style={{
                    padding: '8px 12px 12px 42px',
                    background: '#091526',
                    borderTop: '1px solid #38bdf8',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: '#38bdf8', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Edit3 size={13} /> On-The-Fly Edit: {row.key}
                    </span>
                    <span style={{ fontSize: 10, color: '#94a3b8' }}>↵ Enter = Speichern | ⇧+↵ = Neue Zeile</span>
                  </div>
                  <textarea
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSaveEdit(row);
                      } else if (e.key === 'Escape') {
                        cancelEditing();
                      }
                    }}
                    placeholder="Wert eingeben... [Enter zum Speichern, Shift+Enter für neue Zeile]"
                    style={{
                      width: '100%',
                      minHeight: 70,
                      background: '#030712',
                      border: '1px solid #334155',
                      borderRadius: 6,
                      padding: 8,
                      color: '#f8fafc',
                      fontFamily: 'monospace',
                      fontSize: 11,
                      resize: 'vertical',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button
                      className="action-btn"
                      onClick={cancelEditing}
                      disabled={isSaving}
                      style={{ padding: '4px 10px', fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <X size={12} /> Abbrechen
                    </button>
                    <button
                      className="btn-primary"
                      onClick={() => handleSaveEdit(row)}
                      disabled={isSaving}
                      style={{ padding: '4px 12px', fontSize: 11, background: '#10b981', color: '#030712', display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      {isSaving ? <span className="spinner" /> : <Save size={12} />}
                      {isSaving ? 'Speichert...' : '💾 Speichern & Anwenden'}
                    </button>
                  </div>
                </div>
              ) : isExpanded ? (
                /* Expandable Multi-Line Detail Drawer with Copy & Observe Buttons */
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
                    <div style={{ display: 'flex', gap: 6 }}>
                      {onToggleObserve && (
                        <button
                          className="action-btn"
                          title="Feld beobachten"
                          onClick={() => onToggleObserve(row.key)}
                          style={{ color: isObserved ? '#f43f5e' : '#a855f7', padding: '2px 6px', fontSize: 10, background: '#030712', borderRadius: 4, border: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: 4 }}
                        >
                          <Activity size={11} /> {isObserved ? 'Unobserve' : 'Observe'}
                        </button>
                      )}
                      <button
                        className="action-btn"
                        title="Edit value"
                        onClick={() => startEditing(row)}
                        style={{ color: '#38bdf8', padding: '2px 6px', fontSize: 10, background: '#030712', borderRadius: 4, border: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: 4 }}
                      >
                        <Edit3 size={11} /> Edit (Doppelklick)
                      </button>
                      <button
                        className="action-btn"
                        title="Copy payload to clipboard"
                        onClick={() => handleCodeCopy(row.id, row.value)}
                        style={{ color: copiedCodeRowId === row.id ? '#10b981' : '#38bdf8', padding: '2px 6px', fontSize: 10, background: '#030712', borderRadius: 4, border: '1px solid #1e293b' }}
                      >
                        {copiedCodeRowId === row.id ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    </div>
                  </div>
                  <div
                    onDoubleClick={() => startEditing(row)}
                    title="💡 Doppelklick zum Bearbeiten des Werts"
                    style={{
                      background: '#030712',
                      padding: 10,
                      borderRadius: 6,
                      border: '1px solid #1e293b',
                      maxHeight: '200px',
                      overflowY: 'auto',
                      cursor: 'pointer',
                    }}
                  >
                    <HighlightedCodeSpan text={row.value} showLineNumbers={true} />
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
