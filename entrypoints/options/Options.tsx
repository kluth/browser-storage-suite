import React, { useState } from 'react';
import { Settings, Shield, Download, Upload, Monitor } from 'lucide-react';

export default function Options() {
  const [autoSync, setAutoSync] = useState(true);
  const [formatJson, setFormatJson] = useState(true);

  return (
    <div className="options-container">
      <header className="options-header">
        <Settings size={32} color="#38bdf8" />
        <div>
          <h1 className="options-title">Browser Storage Suite Settings</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Configure cross-browser storage behavior, export snapshots, and system rules.
          </p>
        </div>
      </header>

      <section className="section-card">
        <h2 className="section-title">
          <Monitor size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />
          Cross-Browser Settings
        </h2>
        <div className="setting-row">
          <div>
            <strong>Automatic Storage Refresh</strong>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Automatically update storage view when active tab changes.
            </p>
          </div>
          <input
            type="checkbox"
            checked={autoSync}
            onChange={(e) => setAutoSync(e.target.checked)}
          />
        </div>
        <div className="setting-row">
          <div>
            <strong>Prettify JSON Values</strong>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Automatically parse and format JSON values in the inspector.
            </p>
          </div>
          <input
            type="checkbox"
            checked={formatJson}
            onChange={(e) => setFormatJson(e.target.checked)}
          />
        </div>
      </section>

      <section className="section-card">
        <h2 className="section-title">
          <Download size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />
          Data Export & Import
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
          Export your site storage data to a JSON snapshot or restore previous configurations across browsers.
        </p>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            style={{
              padding: '10px 16px',
              borderRadius: 6,
              background: '#38bdf8',
              color: '#0f172a',
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Download size={16} /> Export Storage JSON
          </button>
          <button
            style={{
              padding: '10px 16px',
              borderRadius: 6,
              background: '#334155',
              color: '#fff',
              fontWeight: 500,
              border: '1px solid #475569',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Upload size={16} /> Import Snapshot
          </button>
        </div>
      </section>
    </div>
  );
}
