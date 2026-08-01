import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  GitCompare,
  Code,
  CheckSquare,
  Square,
  RotateCcw,
  Copy,
  Check,
  Search,
  RefreshCw,
  Layers,
} from 'lucide-react';
import { StorageDiffResult, JSONPatchOperation, StorageTarget } from '../src/domain/model/storageDiff';
import { RealtimeDiffEngine } from '../utils/realtimeDiffEngine';

export interface DiffViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  oldState: Record<string, unknown> | string;
  newState: Record<string, unknown> | string;
  storageTarget?: StorageTarget;
  onApplyPatches?: (selectedPatches: JSONPatchOperation[]) => Promise<void> | void;
  onRollback?: () => Promise<void> | void;
}

export type ViewMode = 'visual' | 'raw_patch' | 'interactive_apply';

export default function DiffViewerModal({
  isOpen,
  onClose,
  oldState,
  newState,
  storageTarget = 'localStorage',
  onApplyPatches,
  onRollback,
}: DiffViewerModalProps) {
  const [activeMode, setActiveMode] = useState<ViewMode>('visual');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [opFilter, setOpFilter] = useState<string>('all');
  const [copied, setCopied] = useState<boolean>(false);

  // Parsed JSON objects
  const parsedOld = useMemo(() => {
    if (typeof oldState === 'string') {
      try {
        return JSON.parse(oldState);
      } catch {
        return { raw: oldState };
      }
    }
    return oldState;
  }, [oldState]);

  const parsedNew = useMemo(() => {
    if (typeof newState === 'string') {
      try {
        return JSON.parse(newState);
      } catch {
        return { raw: newState };
      }
    }
    return newState;
  }, [newState]);

  // Compute diff
  const diffResult = useMemo<StorageDiffResult | null>(() => {
    const res = RealtimeDiffEngine.createDiff(parsedOld, parsedNew);
    return res.ok ? res.value : null;
  }, [parsedOld, parsedNew]);

  // Interactive selected patch indices
  const [selectedIndices, setSelectedIndices] = useState<Record<number, boolean>>({});

  const allPatches = useMemo(() => diffResult?.globalPatches || [], [diffResult]);

  // Initialize all selected
  useEffect(() => {
    if (allPatches.length > 0) {
      const initial: Record<number, boolean> = {};
      allPatches.forEach((_, idx) => (initial[idx] = true));
      setSelectedIndices(initial);
    }
  }, [allPatches]);

  const filteredPatches = useMemo(() => {
    return allPatches.filter((p) => {
      const matchesOp = opFilter === 'all' || p.op === opFilter;
      const matchesSearch =
        searchQuery === '' || p.path.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesOp && matchesSearch;
    });
  }, [allPatches, opFilter, searchQuery]);

  const selectedPatchesList = useMemo(() => {
    return allPatches.filter((_, idx) => selectedIndices[idx]);
  }, [allPatches, selectedIndices]);

  // Preview target state after applying selected patches
  const previewState = useMemo(() => {
    if (!parsedOld) return {};
    const res = RealtimeDiffEngine.applyPatch(parsedOld, selectedPatchesList);
    return res.ok ? res.value : { error: res.error.message };
  }, [parsedOld, selectedPatchesList]);

  if (!isOpen) return null;

  const handleCopyPatches = () => {
    navigator.clipboard.writeText(JSON.stringify(allPatches, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleSelectAll = () => {
    const allSelected = allPatches.every((_, idx) => selectedIndices[idx]);
    const updated: Record<number, boolean> = {};
    allPatches.forEach((_, idx) => (updated[idx] = !allSelected));
    setSelectedIndices(updated);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(3, 7, 18, 0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '1200px',
          height: '85vh',
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: 12,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: '#f8fafc',
        }}
      >
        {/* Header Bar */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #1e293b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#090d16',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ padding: 8, background: 'rgba(56, 189, 248, 0.1)', borderRadius: 8, color: '#38bdf8' }}>
              <GitCompare size={20} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#f8fafc' }}>
                  Real-Time Storage Diff Engine
                </h3>
                <span
                  style={{
                    fontSize: 11,
                    background: '#1e293b',
                    color: '#a855f7',
                    padding: '2px 8px',
                    borderRadius: 12,
                    fontWeight: 600,
                  }}
                >
                  {storageTarget}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                RFC 6902 JSON Patch & Delta Inspection
              </p>
            </div>
          </div>

          {/* Stats Badges */}
          {diffResult && (
            <div style={{ display: 'flex', gap: 10, fontSize: 11, fontWeight: 600 }}>
              <span style={{ color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', padding: '4px 8px', borderRadius: 6 }}>
                +{diffResult.summary.keysAdded} Added
              </span>
              <span style={{ color: '#38bdf8', background: 'rgba(56, 189, 248, 0.1)', padding: '4px 8px', borderRadius: 6 }}>
                ~{diffResult.summary.keysModified} Modified
              </span>
              <span style={{ color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)', padding: '4px 8px', borderRadius: 6 }}>
                -{diffResult.summary.keysDeleted} Deleted
              </span>
              <span style={{ color: '#a855f7', background: 'rgba(168, 85, 247, 0.1)', padding: '4px 8px', borderRadius: 6 }}>
                {diffResult.summary.patchCount} Patches
              </span>
            </div>
          )}

          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4 }}
          >
            <X size={20} />
          </button>
        </div>

        {/* View Mode Navigation Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #1e293b', background: '#0b1120', padding: '0 20px' }}>
          <button
            onClick={() => setActiveMode('visual')}
            style={{
              padding: '12px 16px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeMode === 'visual' ? '2px solid #38bdf8' : '2px solid transparent',
              color: activeMode === 'visual' ? '#38bdf8' : '#94a3b8',
              fontWeight: 600,
              fontSize: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Layers size={14} /> Side-by-Side Visual Diff
          </button>
          <button
            onClick={() => setActiveMode('raw_patch')}
            style={{
              padding: '12px 16px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeMode === 'raw_patch' ? '2px solid #38bdf8' : '2px solid transparent',
              color: activeMode === 'raw_patch' ? '#38bdf8' : '#94a3b8',
              fontWeight: 600,
              fontSize: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Code size={14} /> RFC 6902 Raw Patches ({allPatches.length})
          </button>
          <button
            onClick={() => setActiveMode('interactive_apply')}
            style={{
              padding: '12px 16px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeMode === 'interactive_apply' ? '2px solid #38bdf8' : '2px solid transparent',
              color: activeMode === 'interactive_apply' ? '#38bdf8' : '#94a3b8',
              fontWeight: 600,
              fontSize: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <CheckSquare size={14} /> Interactive Patch Toggle & Apply
          </button>
        </div>

        {/* Content Body */}
        <div style={{ flex: 1, overflow: 'hidden', padding: 20, display: 'flex', flexDirection: 'column' }}>
          {/* Mode 1: Side-by-Side Visual Diff */}
          {activeMode === 'visual' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, height: '100%' }}>
              {/* Previous State Pane */}
              <div style={{ display: 'flex', flexDirection: 'column', background: '#090d16', borderRadius: 8, border: '1px solid #1e293b' }}>
                <div style={{ padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', borderBottom: '1px solid #1e293b', color: '#ef4444', fontSize: 11, fontWeight: 700 }}>
                  PREVIOUS STORAGE STATE (OLD)
                </div>
                <pre style={{ margin: 0, padding: 12, overflowY: 'auto', flex: 1, fontFamily: 'monospace', fontSize: 11, color: '#fca5a5' }}>
                  {JSON.stringify(parsedOld, null, 2)}
                </pre>
              </div>

              {/* Current State Pane */}
              <div style={{ display: 'flex', flexDirection: 'column', background: '#090d16', borderRadius: 8, border: '1px solid #1e293b' }}>
                <div style={{ padding: '8px 12px', background: 'rgba(16, 185, 129, 0.1)', borderBottom: '1px solid #1e293b', color: '#10b981', fontSize: 11, fontWeight: 700 }}>
                  TARGET STORAGE STATE (NEW)
                </div>
                <pre style={{ margin: 0, padding: 12, overflowY: 'auto', flex: 1, fontFamily: 'monospace', fontSize: 11, color: '#86efac' }}>
                  {JSON.stringify(parsedNew, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {/* Mode 2: RFC 6902 Raw Patch Viewer */}
          {activeMode === 'raw_patch' && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
              {/* Controls */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ position: 'relative' }}>
                    <Search size={14} style={{ position: 'absolute', left: 8, top: 8, color: '#64748b' }} />
                    <input
                      type="text"
                      placeholder="Search patch path..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      style={{
                        background: '#090d16',
                        border: '1px solid #334155',
                        borderRadius: 6,
                        padding: '6px 8px 6px 28px',
                        color: '#f8fafc',
                        fontSize: 11,
                        width: 200,
                      }}
                    />
                  </div>
                  <select
                    value={opFilter}
                    onChange={(e) => setOpFilter(e.target.value)}
                    style={{ background: '#090d16', border: '1px solid #334155', borderRadius: 6, padding: '6px 8px', color: '#f8fafc', fontSize: 11 }}
                  >
                    <option value="all">All Operations</option>
                    <option value="add">add</option>
                    <option value="remove">remove</option>
                    <option value="replace">replace</option>
                    <option value="move">move</option>
                    <option value="copy">copy</option>
                    <option value="test">test</option>
                  </select>
                </div>

                <button
                  onClick={handleCopyPatches}
                  style={{
                    background: '#1e293b',
                    border: '1px solid #334155',
                    color: copied ? '#10b981' : '#38bdf8',
                    padding: '6px 12px',
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? 'Copied JSON!' : 'Copy RFC 6902 JSON'}
                </button>
              </div>

              {/* JSON Editor Output */}
              <div style={{ flex: 1, background: '#090d16', border: '1px solid #1e293b', borderRadius: 8, padding: 12, overflowY: 'auto' }}>
                <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: 11, color: '#38bdf8' }}>
                  {JSON.stringify(filteredPatches, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {/* Mode 3: Interactive Patch Toggle & Selective Application */}
          {activeMode === 'interactive_apply' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, height: '100%' }}>
              {/* Patch Checklist */}
              <div style={{ display: 'flex', flexDirection: 'column', background: '#090d16', borderRadius: 8, border: '1px solid #1e293b' }}>
                <div style={{ padding: '8px 12px', background: '#0b1120', borderBottom: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#38bdf8' }}>
                    Selective Patch Operations ({selectedPatchesList.length}/{allPatches.length} selected)
                  </span>
                  <button
                    onClick={toggleSelectAll}
                    style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: 10, cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    Toggle All
                  </button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {allPatches.map((patch, idx) => {
                    const isSelected = !!selectedIndices[idx];
                    return (
                      <div
                        key={idx}
                        onClick={() => setSelectedIndices((prev) => ({ ...prev, [idx]: !prev[idx] }))}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '8px 10px',
                          background: isSelected ? 'rgba(56, 189, 248, 0.08)' : 'transparent',
                          border: isSelected ? '1px solid #38bdf8' : '1px solid #1e293b',
                          borderRadius: 6,
                          cursor: 'pointer',
                          fontFamily: 'monospace',
                          fontSize: 11,
                        }}
                      >
                        {isSelected ? <CheckSquare size={14} color="#38bdf8" /> : <Square size={14} color="#64748b" />}
                        <span style={{ fontWeight: 700, color: patch.op === 'add' ? '#10b981' : patch.op === 'remove' ? '#ef4444' : '#38bdf8' }}>
                          {patch.op.toUpperCase()}
                        </span>
                        <span style={{ color: '#f8fafc', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {patch.path}
                        </span>
                        {patch.value !== undefined && (
                          <span style={{ color: '#94a3b8', fontSize: 10 }}>
                            val: {JSON.stringify(patch.value)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Live Partial Apply Preview Pane */}
              <div style={{ display: 'flex', flexDirection: 'column', background: '#090d16', borderRadius: 8, border: '1px solid #1e293b' }}>
                <div style={{ padding: '8px 12px', background: '#0b1120', borderBottom: '1px solid #1e293b', color: '#10b981', fontSize: 11, fontWeight: 700 }}>
                  PREVIEW RESULT OF SELECTED PATCHES
                </div>
                <pre style={{ margin: 0, padding: 12, overflowY: 'auto', flex: 1, fontFamily: 'monospace', fontSize: 11, color: '#e2e8f0' }}>
                  {JSON.stringify(previewState, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid #1e293b',
            background: '#090d16',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <button
            onClick={onRollback}
            style={{
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid #ef4444',
              color: '#ef4444',
              padding: '8px 16px',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <RotateCcw size={14} /> Rollback All (Apply Inverse Patches)
          </button>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onClose}
              style={{ background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', padding: '8px 16px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              onClick={() => onApplyPatches?.(selectedPatchesList)}
              style={{
                background: '#10b981',
                border: 'none',
                color: '#030712',
                padding: '8px 18px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <RefreshCw size={14} /> Apply Selected Patches ({selectedPatchesList.length})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
