import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Database, Cookie, HardDrive, Trash2, RefreshCw, Box, Table, Search, Terminal, Settings as SettingsIcon, Zap, AlertTriangle, CheckCircle, Info, Code, FileText, ChevronDown, ChevronRight, UserCheck, Clock, GitCommit, Bookmark, Play, ExternalLink, Loader2, Sparkles, Server, PlusCircle, Copy, Check, Bot, Globe } from 'lucide-react';
import { getCookiesForTab, deleteCookie } from '@/utils/browserApi';
import VirtualizedDataGrid, { GridRow } from '@/components/VirtualizedDataGrid';
import { generateSelectiveSeedData, SeedTemplate } from '@/utils/dataSeeder';
import { translateSqlToIDBCursor, ExecutionPlan } from '@/utils/sqlToIdb';
import { analyzeStoragePerformance, PerformanceQuotaMetrics } from '@/utils/performanceAdvisor';
import { getStorageDataBlame, DataBlameInfo } from '@/utils/dataBlamer';
import { predictPagePresets, PredictedPreset } from '@/utils/presetPredictor';
import { probeBackendEndpoint, DiscoveredBackend } from '@/utils/backendDiscoverer';

// Lazy-load 3D WebGL Canvas for instant Popup startup (<50ms)
const SpatialGraphCanvas = lazy(() => import('@/components/SpatialGraphCanvas'));

type ViewTab = 'storage' | 'presets' | 'spatial' | 'virtual' | 'sql' | 'performance';
type StorageType = 'local' | 'session' | 'cookies';

export default function App() {
  const [activeTab, setActiveTab] = useState<ViewTab>('storage');
  const [storageType, setStorageType] = useState<StorageType>('local');
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [currentTitle, setCurrentTitle] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [items, setItems] = useState<{ key: string; value: string }[]>([]);
  const [cookies, setCookies] = useState<{ name: string; value: string }[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingStep, setLoadingStep] = useState<string>('Verbindung zu aktivem Tab wird hergestellt...');

  // Active guide subtab for OpenAPI vs MCP
  const [guideSubTab, setGuideSubTab] = useState<'openapi' | 'mcp'>('openapi');
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);

  // Expandable Data Blame state per key
  const [expandedBlameKeys, setExpandedBlameKeys] = useState<Record<string, boolean>>({});

  // Smart Predicted Presets
  const [predictedPresets, setPredictedPresets] = useState<PredictedPreset[]>([]);

  // Discovered Backends & Swagger Specs
  const [discoveredBackend, setDiscoveredBackend] = useState<DiscoveredBackend | null>(null);

  // Selective Seeder State
  const [selectedTemplate, setSelectedTemplate] = useState<SeedTemplate>('user_profiles');
  const [seedCount, setSeedCount] = useState<number>(100);

  // SQL Query Playground State & Execution Results
  const [sqlQuery, setSqlQuery] = useState<string>("SELECT * FROM storage WHERE key LIKE '%token%'");
  const [queryPlan, setQueryPlan] = useState<ExecutionPlan | null>(null);
  const [queryResults, setQueryResults] = useState<{ key: string; value: string }[]>([]);
  const [executionTimeMs, setExecutionTimeMs] = useState<number | null>(null);

  // Performance & Anti-pattern Advisor State
  const [perfMetrics, setPerfMetrics] = useState<PerformanceQuotaMetrics | null>(null);

  const toggleBlameExpand = (key: string) => {
    setExpandedBlameKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleDetachWindow = () => {
    if (typeof chrome !== 'undefined' && chrome.windows) {
      chrome.windows.create({
        url: chrome.runtime.getURL('popup.html'),
        type: 'popup',
        width: 1200,
        height: 800,
      });
    } else {
      window.open(window.location.href, '_blank', 'width=1200,height=800');
    }
  };

  const copyCodeSnippet = (snippetId: string, code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedSnippet(snippetId);
    setTimeout(() => setCopiedSnippet(null), 1500);
  };

  const fetchStorageData = () => {
    setLoading(true);
    setLoadingStep('Verbindung zu aktivem Browser-Tab wird hergestellt...');

    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const active = tabs[0];
        if (active?.url) {
          setCurrentUrl(active.url);
          setCurrentTitle(active.title || 'Page');

          const predictionsRes = predictPagePresets({
            url: active.url,
            title: active.title || '',
            hasPasswordField: false,
            hasFormCart: false,
            metaTags: [],
          });
          if (predictionsRes.ok) {
            setPredictedPresets(predictionsRes.value);
          }

          probeBackendEndpoint(new URL(active.url).origin).then((backend) => {
            if (backend) setDiscoveredBackend(backend);
          });

          getCookiesForTab(active.url).then((cList) => {
            const fetchedCookies = cList.map((c) => ({ name: c.name, value: c.value }));
            setCookies(fetchedCookies);
          });

          if (active.id) {
            chrome.tabs.sendMessage(active.id, { type: 'GET_STORAGE_DATA' }, (response) => {
              if (!chrome.runtime.lastError && response) {
                const data = storageType === 'local' ? response.localStorage : response.sessionStorage;
                if (data) {
                  const list = Object.entries(data).map(([key, value]) => ({ key, value: String(value) }));
                  setItems(list);
                  runPerfAnalysis(list, []);
                } else {
                  setItems([]);
                }
              } else {
                setItems([]);
              }
              setTimeout(() => setLoading(false), 300);
            });
          } else {
            setItems([]);
            setTimeout(() => setLoading(false), 300);
          }
        } else {
          setCurrentUrl('https://example.com');
          setItems([]);
          setTimeout(() => setLoading(false), 300);
        }
      });
    } else {
      setCurrentUrl('https://localhost:3000');
      const fallbackList = [
        { key: 'session_token', value: 'bearer_xyz_9981' },
        { key: 'ui_theme', value: 'dark' },
      ];
      setItems(fallbackList);
      runPerfAnalysis(fallbackList, []);
      setTimeout(() => setLoading(false), 300);
    }
  };

  const handleApplyPreset = (preset: PredictedPreset) => {
    const newItems = Object.entries(preset.entries).map(([key, value]) => ({ key, value }));

    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeId = tabs[0]?.id;
        if (activeId) {
          newItems.forEach((item) => {
            chrome.tabs.sendMessage(activeId, { type: 'SET_LOCAL_STORAGE', key: item.key, value: item.value });
          });
          fetchStorageData();
        }
      });
    } else {
      setItems(newItems);
    }
  };

  const handleGenerateSelectiveSeed = () => {
    const seedRecords = generateSelectiveSeedData(selectedTemplate, seedCount);
    const newItems = seedRecords.map((r) => ({ key: r.key, value: r.value }));

    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeId = tabs[0]?.id;
        if (activeId) {
          newItems.forEach((item) => {
            chrome.tabs.sendMessage(activeId, { type: 'SET_LOCAL_STORAGE', key: item.key, value: item.value });
          });
          fetchStorageData();
        }
      });
    } else {
      setItems(newItems);
    }
  };

  const runPerfAnalysis = (itemList: { key: string; value: string }[], cookieList: { name: string; value: string }[]) => {
    const rawRecord: Record<string, string> = {};
    itemList.forEach((item) => (rawRecord[item.key] = item.value));
    const metrics = analyzeStoragePerformance(rawRecord, cookieList);
    setPerfMetrics(metrics);
  };

  const handleUpdateStorageEntry = async (key: string, newValue: string) => {
    if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        if (storageType === 'cookie') {
          if (chrome.cookies) {
            await chrome.cookies.set({
              url: tab.url || currentUrl,
              name: key,
              value: newValue,
            });
          }
        } else {
          const targetStore = storageType === 'session' ? 'sessionStorage' : 'localStorage';
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (storeName: string, k: string, v: string) => {
              const store = storeName === 'sessionStorage' ? window.sessionStorage : window.localStorage;
              store.setItem(k, v);
              window.dispatchEvent(new StorageEvent('storage', { key: k, newValue: v }));
            },
            args: [targetStore, key, newValue],
          });
        }
      }
    } else {
      if (storageType === 'local') localStorage.setItem(key, newValue);
      else if (storageType === 'session') sessionStorage.setItem(key, newValue);
    }
    await fetchStorageData();
  };

  const handleDeleteStorageEntry = async (key: string) => {
    if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        if (storageType === 'cookie') {
          if (chrome.cookies) {
            await chrome.cookies.remove({
              url: tab.url || currentUrl,
              name: key,
            });
          }
        } else {
          const targetStore = storageType === 'session' ? 'sessionStorage' : 'localStorage';
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (storeName: string, k: string) => {
              const store = storeName === 'sessionStorage' ? window.sessionStorage : window.localStorage;
              store.removeItem(k);
              window.dispatchEvent(new StorageEvent('storage', { key: k, newValue: null }));
            },
            args: [targetStore, key],
          });
        }
      }
    } else {
      if (storageType === 'local') localStorage.removeItem(key);
      else if (storageType === 'session') sessionStorage.removeItem(key);
    }
    await fetchStorageData();
  };

  const [observedKeys, setObservedKeys] = useState<Record<string, boolean>>({});

  const handleToggleObserve = (key: string) => {
    setObservedKeys((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  // High-Frequency Observer Polling (1000ms) to detect live page mutations
  useEffect(() => {
    const hasObserved = Object.values(observedKeys).some(Boolean);
    if (!hasObserved) return;

    const interval = setInterval(() => {
      fetchStorageData();
    }, 1000);

    return () => clearInterval(interval);
  }, [observedKeys, storageType]);

  useEffect(() => {
    fetchStorageData();
  }, [storageType]);

  const handleExecuteSql = () => {
    const startTime = performance.now();
    const plan = translateSqlToIDBCursor(sqlQuery);
    setQueryPlan(plan);

    const pattern = plan.filterKeyPattern ? plan.filterKeyPattern.replace(/%/g, '').toLowerCase() : '';
    const filtered = items.filter((item) => item.key.toLowerCase().includes(pattern) || item.value.toLowerCase().includes(pattern));

    setQueryResults(filtered);
    const endTime = performance.now();
    setExecutionTimeMs(Number((endTime - startTime).toFixed(2)));
  };

  const currentBrowser = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.BROWSER || 'chrome' : 'chrome';

  const gridRows: GridRow[] = items.map((item, index) => ({
    id: index + 1,
    key: item.key,
    value: item.value,
    type: 'String',
    sizeBytes: new Blob([item.key + item.value]).size,
  }));

  const mcpConfigCode = JSON.stringify(
    {
      mcpServers: {
        'browser-storage-suite': {
          command: 'node',
          args: ['C:/Users/kluth/Projects/browser-storage-suite/dist/mcpServerAdapter.js'],
        },
      },
    },
    null,
    2
  );

  const curlCode = `curl -X GET "http://localhost:3000/api/v1/storage/localStorage" \\
  -H "Accept: application/json"`;

  const fetchCode = `// Fetch all localStorage items from Extension REST API
const res = await fetch('http://localhost:3000/api/v1/storage/localStorage');
const data = await res.json();
console.log('LocalStorage State:', data);`;

  return (
    <>
      <header className="header">
        <div className="brand">
          <div className="brand-icon">S</div>
          <div>
            <div className="brand-title">Storage Suite</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            className="action-btn"
            title="Detach Window (Open as Standalone Desktop Window)"
            onClick={handleDetachWindow}
            style={{ color: '#38bdf8' }}
          >
            <ExternalLink size={14} />
          </button>
          <button
            className="action-btn"
            title="Open Options Settings"
            onClick={() => {
              if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
                chrome.runtime.openOptionsPage();
              } else {
                window.open('/options.html', '_blank');
              }
            }}
          >
            <SettingsIcon size={14} />
          </button>
          <span className="target-badge">{currentBrowser}</span>
        </div>
      </header>

      {/* Primary Navigation Tabs */}
      <nav className="tabs">
        <button
          className={`tab-btn ${activeTab === 'storage' ? 'active' : ''}`}
          onClick={() => setActiveTab('storage')}
        >
          <HardDrive size={13} /> Storage
        </button>
        <button
          className={`tab-btn ${activeTab === 'presets' ? 'active' : ''}`}
          onClick={() => setActiveTab('presets')}
        >
          <Sparkles size={13} /> Presets & Seed
        </button>
        <button
          className={`tab-btn ${activeTab === 'spatial' ? 'active' : ''}`}
          onClick={() => setActiveTab('spatial')}
        >
          <Box size={13} /> 3D View
        </button>
        <button
          className={`tab-btn ${activeTab === 'virtual' ? 'active' : ''}`}
          onClick={() => setActiveTab('virtual')}
        >
          <Table size={13} /> Real Grid
        </button>
        <button
          className={`tab-btn ${activeTab === 'sql' ? 'active' : ''}`}
          onClick={() => setActiveTab('sql')}
        >
          <Terminal size={13} /> SQL Query
        </button>
        <button
          className={`tab-btn ${activeTab === 'performance' ? 'active' : ''}`}
          onClick={() => setActiveTab('performance')}
        >
          <Zap size={13} /> Tips & API
        </button>
      </nav>

      {/* Module 1: Live Storage Inspector with Expandable Data Blame Drawer */}
      {activeTab === 'storage' && (
        <>
          <div className="toolbar">
            <div className="domain-pill">
              <span>Active Page:</span>
              <span className="domain-url">{currentUrl || 'https://example.com'}</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className={`tab-btn ${storageType === 'local' ? 'active' : ''}`}
                style={{ flex: 1, padding: '4px 8px', fontSize: 11 }}
                onClick={() => setStorageType('local')}
              >
                Local ({items.length})
              </button>
              <button
                className={`tab-btn ${storageType === 'session' ? 'active' : ''}`}
                style={{ flex: 1, padding: '4px 8px', fontSize: 11 }}
                onClick={() => setStorageType('session')}
              >
                Session
              </button>
              <button
                className={`tab-btn ${storageType === 'cookies' ? 'active' : ''}`}
                style={{ flex: 1, padding: '4px 8px', fontSize: 11 }}
                onClick={() => setStorageType('cookies')}
              >
                Cookies ({cookies.length})
              </button>
            </div>
            <input
              type="text"
              className="search-input"
              placeholder="Search keys or values..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <main className="content-area">
            {loading ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '40px 20px',
                  background: '#090d16',
                  borderRadius: 12,
                  border: '1px solid #1e293b',
                  margin: 'auto',
                  textAlign: 'center',
                  gap: 12,
                  width: '90%',
                  maxWidth: '380px',
                }}
              >
                <div style={{ position: 'relative', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ position: 'absolute', width: '100%', height: '100%', borderRadius: '50%', border: '2px solid #38bdf8', opacity: 0.2 }} />
                  <Loader2 className="animate-spin" size={28} color="#38bdf8" />
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>Analysiere Seitenspeicher...</div>
                <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>{loadingStep}</div>
              </div>
            ) : storageType === 'cookies' ? (
              cookies.length > 0 ? (
                cookies.map((c) => (
                  <div className="storage-card" key={c.name}>
                    <div className="card-header">
                      <span className="item-key">{c.name}</span>
                    </div>
                    <div className="item-value">{c.value}</div>
                  </div>
                ))
              ) : (
                <div className="empty-state">
                  <Cookie size={32} opacity={0.4} />
                  <p>Keine Cookies auf dieser Seite aktiv.</p>
                </div>
              )
            ) : items.length > 0 ? (
              items
                .filter(
                  (item) =>
                    item.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    item.value.toLowerCase().includes(searchQuery.toLowerCase())
                )
                .map((item) => {
                  const isExpanded = !!expandedBlameKeys[item.key];
                  const blame = getStorageDataBlame(item.key, item.value);

                  return (
                    <div className="storage-card" key={item.key}>
                      <div className="card-header">
                        <span className="item-key">{item.key}</span>
                        <button
                          className="action-btn"
                          title="Toggle Data Blame & Provenance"
                          onClick={() => toggleBlameExpand(item.key)}
                          style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, color: isExpanded ? '#38bdf8' : '#94a3b8' }}
                        >
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Data Blame
                        </button>
                      </div>
                      <div className="item-value">{item.value}</div>

                      {/* Expandable Data Blaming Drawer */}
                      {isExpanded && (
                        <div
                          style={{
                            marginTop: 6,
                            padding: '8px 10px',
                            background: '#090d16',
                            borderRadius: 6,
                            border: '1px solid #334155',
                            fontSize: 11,
                            color: '#cbd5e1',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                          }}
                        >
                          <div style={{ fontWeight: 700, color: '#38bdf8', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <UserCheck size={13} /> Data Blaming & Provenance Attribution
                          </div>
                          <div>
                            <strong>Actor / Source:</strong>{' '}
                            <span style={{ color: '#a855f7' }}>{blame.actor.name}</span> ({blame.actor.type})
                          </div>
                          {blame.actor.scriptUrl && (
                            <div style={{ fontFamily: 'monospace', color: '#38bdf8', fontSize: 10 }}>
                              <strong>Script Origin:</strong> {blame.actor.scriptUrl}
                            </div>
                          )}
                          {blame.actor.stackTraceSnippet && (
                            <div style={{ fontFamily: 'monospace', background: '#030712', padding: 6, borderRadius: 4, color: '#94a3b8', fontSize: 10, whiteSpace: 'pre-wrap' }}>
                              {blame.actor.stackTraceSnippet}
                            </div>
                          )}
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, color: '#94a3b8', fontSize: 10 }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <Clock size={11} /> Modified: {new Date(blame.lastModifiedAt).toLocaleTimeString()}
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <GitCommit size={11} /> Revisions: {blame.revisionCount}
                            </span>
                          </div>
                          {blame.previousValue && (
                            <div style={{ marginTop: 4, fontSize: 10, fontFamily: 'monospace' }}>
                              <span style={{ color: '#f43f5e' }}>- Prev: {blame.previousValue}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
            ) : (
              <div className="empty-state">
                <HardDrive size={32} opacity={0.4} />
                <p>Keine Einträge im LocalStorage für diese Domain gefunden.</p>
              </div>
            )}
          </main>
        </>
      )}

      {/* Module 2: Smart Predicted Presets & Selective Storage Seeder */}
      {activeTab === 'presets' && (
        <main className="content-area" style={{ padding: 12, gap: 12 }}>
          {/* Smart Predicted Presets */}
          <div style={{ fontWeight: 700, fontSize: 13, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Sparkles size={16} /> Auf Basis der Seitenstruktur prognostizierte Presets:
          </div>

          {predictedPresets.map((p) => (
            <div key={p.id} className="storage-card" style={{ borderColor: '#38bdf8' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: '#f8fafc' }}>{p.name}</div>
                <button
                  className="btn-primary"
                  style={{ padding: '4px 10px', fontSize: 10 }}
                  onClick={() => handleApplyPreset(p)}
                >
                  <Play size={11} /> Anwenden
                </button>
              </div>
              <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{p.description}</p>
            </div>
          ))}

          {/* Selective Storage Seeder */}
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #1e293b' }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#10b981', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <PlusCircle size={16} /> Selektiver Storage-Seeder (Faker.js Testdaten):
            </div>

            <div className="storage-card" style={{ gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, color: '#cbd5e1' }}>Testdaten-Schema auswählen:</label>
                <select
                  className="search-input"
                  value={selectedTemplate}
                  onChange={(e) => setSelectedTemplate(e.target.value as SeedTemplate)}
                >
                  <option value="user_profiles">👤 User Profiles (UUID, Name, Email, Role)</option>
                  <option value="cart_items">🛒 E-Commerce Cart (ProductID, Price, Quantity)</option>
                  <option value="auth_tokens">🔐 Auth Session Tokens (Bearer Alpha-Numeric)</option>
                  <option value="app_settings">⚙️ App Settings & Feature Flags (Booleans)</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, color: '#cbd5e1' }}>Anzahl der Datensätze:</label>
                <select
                  className="search-input"
                  value={seedCount}
                  onChange={(e) => setSeedCount(Number(e.target.value))}
                >
                  <option value={10}>10 Datensätze</option>
                  <option value={100}>100 Datensätze</option>
                  <option value={1000}>1.000 Datensätze</option>
                  <option value={10000}>10.000 Datensätze</option>
                </select>
              </div>

              <button
                className="btn-primary"
                onClick={handleGenerateSelectiveSeed}
                style={{ background: '#10b981', color: '#030712', alignSelf: 'flex-start', marginTop: 4 }}
              >
                <PlusCircle size={13} /> {seedCount} Datensätze generieren & in Storage schreiben
              </button>
            </div>
          </div>
        </main>
      )}

      {/* Module 3: Lazy-Loaded 3D Spatial Canvas */}
      {activeTab === 'spatial' && (
        <main className="content-area" style={{ padding: 8 }}>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>
            WebGL 3D Graph Canvas (Drag to rotate, scroll to zoom):
          </div>
          <Suspense
            fallback={
              <div className="empty-state">
                <RefreshCw className="animate-spin" size={24} />
                <p>Initializing WebGL 3D Canvas...</p>
              </div>
            }
          >
            <SpatialGraphCanvas
              storageEntries={items.map((i) => ({ key: i.key, value: i.value, target: storageType === 'local' ? 'localStorage' : storageType === 'session' ? 'sessionStorage' : 'cookie' }))}
            />
          </Suspense>
        </main>
      )}

      {/* Module 4: Real Virtualized Data Grid */}
      {activeTab === 'virtual' && (
        <main className="content-area" style={{ padding: 8 }}>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>
            Echte Daten der Seite ({gridRows.length.toLocaleString()} Einträge):
          </div>
          <VirtualizedDataGrid
            rows={gridRows}
            onUpdateEntry={handleUpdateStorageEntry}
            onDeleteEntry={handleDeleteStorageEntry}
            observedKeys={observedKeys}
            onToggleObserve={handleToggleObserve}
          />
        </main>
      )}

      {/* Module 5: SQL Query Playground */}
      {activeTab === 'sql' && (
        <main className="content-area" style={{ padding: 12, gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>SQL Query Input:</label>
            <input
              type="text"
              className="search-input"
              style={{ fontFamily: 'monospace' }}
              value={sqlQuery}
              onChange={(e) => setSqlQuery(e.target.value)}
            />
            <button className="btn-primary" onClick={handleExecuteSql} style={{ alignSelf: 'flex-start' }}>
              Translate to IDBCursor Plan
            </button>
          </div>

          {queryPlan && (
            <div className="storage-card" style={{ background: '#090d16' }}>
              <div style={{ color: '#38bdf8', fontWeight: 700, marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                <span>Execution Plan Profiler Output</span>
                {executionTimeMs !== null && <span style={{ color: '#10b981', fontSize: 11 }}>Executed in {executionTimeMs} ms</span>}
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#cbd5e1', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div><strong>Scan Strategy:</strong> <span style={{ color: '#10b981' }}>{queryPlan.scanStrategy}</span></div>
                <div><strong>Pattern Match:</strong> {queryPlan.filterKeyPattern || 'ALL'}</div>
                <div><strong>Est. IDBCursor Cost:</strong> {queryPlan.estimatedCostMs} ms</div>
                <div><strong>Target Fields:</strong> {queryPlan.parsedFields.join(', ')}</div>
              </div>

              {queryResults.length > 0 && (
                <div style={{ marginTop: 10, borderTop: '1px solid #1e293b', paddingTop: 8 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Query Matching Results ({queryResults.length} items):</div>
                  {queryResults.map((r) => (
                    <div key={r.key} style={{ fontSize: 11, fontFamily: 'monospace', padding: '4px 0', borderBottom: '1px dashed #1e293b' }}>
                      <span style={{ color: '#38bdf8' }}>{r.key}:</span> <span style={{ color: '#e2e8f0' }}>{r.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      )}

      {/* Module 6: Performance, Interactive OpenAPI & MCP Guide Advisor */}
      {activeTab === 'performance' && (
        <main className="content-area" style={{ padding: 12, gap: 12 }}>
          {/* Interactive OpenAPI vs MCP Usage Guide */}
          <div className="storage-card" style={{ background: '#090d16', border: '1px solid #a855f7' }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#a855f7', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Code size={16} /> Entwickler-Handbuch: OpenAPI REST API & MCP Server Nutzen
            </div>

            {/* Guide Subtabs */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 10, borderBottom: '1px solid #1e293b', paddingBottom: 6 }}>
              <button
                className={`tab-btn ${guideSubTab === 'openapi' ? 'active' : ''}`}
                style={{ padding: '4px 10px', fontSize: 11, gap: 4 }}
                onClick={() => setGuideSubTab('openapi')}
              >
                <Globe size={13} /> OpenAPI 3.0 REST API
              </button>
              <button
                className={`tab-btn ${guideSubTab === 'mcp' ? 'active' : ''}`}
                style={{ padding: '4px 10px', fontSize: 11, gap: 4 }}
                onClick={() => setGuideSubTab('mcp')}
              >
                <Bot size={13} /> MCP Server (für KI-Agenten)
              </button>
            </div>

            {/* OpenAPI REST Guide Subtab */}
            {guideSubTab === 'openapi' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11, color: '#cbd5e1' }}>
                <p>
                  Die Extension stellt einen lokalen <strong>REST-Server (Port 3000)</strong> für Skripte, CI/CD und Web-Clients bereit:
                </p>
                <div style={{ background: '#030712', padding: 8, borderRadius: 6, border: '1px solid #1e293b', fontFamily: 'monospace', fontSize: 10 }}>
                  <div><span style={{ color: '#10b981', fontWeight: 700 }}>GET</span> /api/v1/storage/{'{target}'} - Speicher auslesen</div>
                  <div><span style={{ color: '#38bdf8', fontWeight: 700 }}>POST</span> /api/v1/storage/{'{target}'} - Key/Value setzen</div>
                  <div><span style={{ color: '#f43f5e', fontWeight: 700 }}>DELETE</span> /api/v1/storage/{'{target}'}/{'{key}'} - Key löschen</div>
                </div>

                <div style={{ fontWeight: 600, color: '#38bdf8', marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Beispiel: cURL Request</span>
                  <button
                    className="action-btn"
                    onClick={() => copyCodeSnippet('curl', curlCode)}
                    style={{ fontSize: 10, color: copiedSnippet === 'curl' ? '#10b981' : '#38bdf8' }}
                  >
                    {copiedSnippet === 'curl' ? <Check size={12} /> : <Copy size={12} />} Copy cURL
                  </button>
                </div>
                <pre style={{ background: '#030712', padding: 8, borderRadius: 4, color: '#cbd5e1', fontSize: 10, fontFamily: 'monospace', overflowX: 'auto' }}>
                  {curlCode}
                </pre>

                <div style={{ marginTop: 4 }}>
                  <a
                    href="/docs/openapi.yaml"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: '#a855f7', textDecoration: 'underline', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    <FileText size={12} /> Vollständige OpenAPI 3.0 Spezifikation öffnen (/docs/openapi.yaml)
                  </a>
                </div>
              </div>
            )}

            {/* MCP Server Subtab */}
            {guideSubTab === 'mcp' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11, color: '#cbd5e1' }}>
                <p>
                  Das <strong>Model Context Protocol (MCP)</strong> erlaubt es KI-Agenten (Claude, Gemini, Cursor), Seitenspeicher per Prompt abzufragen & zu bearbeiten:
                </p>
                <div style={{ background: '#030712', padding: 8, borderRadius: 6, border: '1px solid #1e293b', fontFamily: 'monospace', fontSize: 10 }}>
                  <div><strong>Verfügbare MCP Tools:</strong></div>
                  <div>• <span style={{ color: '#38bdf8' }}>query_storage_sql</span>: SQL Abfragen gegen Browser-Storage</div>
                  <div>• <span style={{ color: '#a855f7' }}>get_storage_snapshot</span>: Time-Travel Snapshots per Zeitstempel</div>
                  <div>• <span style={{ color: '#10b981' }}>seed_mock_data</span>: Schema-konforme Testdaten injizieren</div>
                </div>

                <div style={{ fontWeight: 600, color: '#a855f7', marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>MCP Server Konfiguration (für claude_desktop_config.json / gemini.json):</span>
                  <button
                    className="action-btn"
                    onClick={() => copyCodeSnippet('mcp', mcpConfigCode)}
                    style={{ fontSize: 10, color: copiedSnippet === 'mcp' ? '#10b981' : '#a855f7' }}
                  >
                    {copiedSnippet === 'mcp' ? <Check size={12} /> : <Copy size={12} />} Copy JSON
                  </button>
                </div>
                <pre style={{ background: '#030712', padding: 8, borderRadius: 4, color: '#a855f7', fontSize: 10, fontFamily: 'monospace', overflowX: 'auto' }}>
                  {mcpConfigCode}
                </pre>
              </div>
            )}
          </div>

          {discoveredBackend && (
            <div className="storage-card" style={{ borderColor: '#a855f7', background: 'rgba(168, 85, 247, 0.05)' }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: '#a855f7', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Server size={16} /> Backend API & Swagger/OpenAPI Endpunkt erkannt!
              </div>
              <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 4 }}>
                Base URL: <strong style={{ color: '#38bdf8' }}>{discoveredBackend.baseUrl}</strong>
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>
                Spec: {discoveredBackend.type.toUpperCase()} ({discoveredBackend.schemasCount} Datenschemata & {discoveredBackend.endpointsFound.length} Routen gefunden)
              </div>
            </div>
          )}

          {perfMetrics && (
            <div className="storage-card">
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Zap size={16} /> Storage Quota & Allocation
              </div>
              <div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 6 }}>
                LocalStorage Allocated: <strong>{Math.round(perfMetrics.localStorageBytes / 1024)} KB</strong> / 5.0 MB
              </div>
              <div style={{ width: '100%', height: 8, background: '#0f172a', borderRadius: 4, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(100, (perfMetrics.localStorageBytes / perfMetrics.localStorageLimitBytes) * 100)}%`,
                    background: 'linear-gradient(90deg, #38bdf8, #10b981)',
                  }}
                />
              </div>
            </div>
          )}

          <div style={{ fontSize: 12, fontWeight: 700, color: '#f8fafc', marginTop: 4 }}>
            Storage Optimization & Best Practice Tips:
          </div>

          {perfMetrics?.insights.map((insight) => (
            <div
              key={insight.id}
              className="storage-card"
              style={{
                borderColor: insight.type === 'warning' ? '#f43f5e' : insight.type === 'tip' ? '#38bdf8' : '#10b981',
                background: insight.type === 'warning' ? 'rgba(244, 63, 94, 0.05)' : '#1e293b',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 12, color: insight.type === 'warning' ? '#f43f5e' : insight.type === 'tip' ? '#38bdf8' : '#10b981' }}>
                {insight.type === 'warning' ? <AlertTriangle size={16} /> : insight.type === 'tip' ? <Info size={16} /> : <CheckCircle size={16} />}
                {insight.title}
              </div>
              <p style={{ fontSize: 11, color: '#cbd5e1', marginTop: 4 }}>{insight.description}</p>
              <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic', marginTop: 4 }}>
                <strong>Empfehlung:</strong> {insight.recommendation}
              </div>
            </div>
          ))}
        </main>
      )}

      <footer className="footer">
        <button className="action-btn" title="Refresh" onClick={fetchStorageData}>
          <RefreshCw size={14} /> Refresh
        </button>
        <span style={{ fontSize: 11, color: '#64748b' }}>Browser Storage Suite v1.1.0</span>
      </footer>
    </>
  );
}
