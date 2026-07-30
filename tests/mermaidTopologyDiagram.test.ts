import { describe, it, expect, vi } from 'vitest';
import { generateMermaidCode, StorageEntryItem } from '../components/MermaidTopologyDiagram';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg></svg>' }),
  },
}));

describe('Mermaid Topology Diagram Generator', () => {
  const sampleEntries: StorageEntryItem[] = [
    { key: 'theme_preference', value: 'dark', target: 'localStorage' },
    { key: 'session_id', value: 'sess_12345', target: 'sessionStorage' },
    { key: 'PREF', value: 'f6=40000400', target: 'cookie' },
    { key: 'user_db_v1', value: '{"id":1}', target: 'indexedDB' },
  ];

  it('should generate star topology diagram code correctly', () => {
    const code = generateMermaidCode(sampleEntries, 'star', 'https://youtube.com');
    expect(code).toContain('graph LR');
    expect(code).toContain('youtube.com');
    expect(code).toContain('ENGINE_LOCALSTORAGE');
    expect(code).toContain('theme_preference');
  });

  it('should generate top-down hierarchical diagram code correctly', () => {
    const code = generateMermaidCode(sampleEntries, 'hierarchical_td', 'https://example.com');
    expect(code).toContain('flowchart TD');
    expect(code).toContain('DomainNode');
    expect(code).toContain('Node_localStorage');
  });

  it('should generate left-to-right hierarchical diagram code correctly', () => {
    const code = generateMermaidCode(sampleEntries, 'hierarchical_lr', 'https://example.com');
    expect(code).toContain('flowchart LR');
    expect(code).toContain('DomainNode');
    expect(code).toContain('Node_sessionStorage');
  });

  it('should generate subgraph cluster diagram code correctly', () => {
    const code = generateMermaidCode(sampleEntries, 'subgraph_cluster', 'https://example.com');
    expect(code).toContain('flowchart TB');
    expect(code).toContain('subgraph LOCALSTORAGE');
    expect(code).toContain('subgraph COOKIE');
  });

  it('should generate sequence flow diagram code correctly', () => {
    const code = generateMermaidCode(sampleEntries, 'sequence_flow', 'https://example.com');
    expect(code).toContain('sequenceDiagram');
    expect(code).toContain('participant Page');
    expect(code).toContain('participant UI');
  });
});
