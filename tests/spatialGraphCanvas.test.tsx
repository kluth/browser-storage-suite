import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SpatialGraphCanvas, {
  getNodeColor,
  getDefaultGraphNodes,
  deriveGraphNodesFromEntries,
  checkWebGlSupport,
} from '../components/SpatialGraphCanvas';
import { GraphNode } from '../workers/spatialLayoutWorker';

// Mock Three.js / React Three Fiber Canvas in JSDOM environment
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-three-canvas">{children}</div>
  ),
  useFrame: () => {},
}));

vi.mock('@react-three/drei', () => ({
  OrbitControls: () => <div data-testid="mock-orbit-controls" />,
  Sphere: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <div data-testid="mock-sphere" onClick={onClick}>
      {children}
    </div>
  ),
}));

describe('SpatialGraphCanvas Component & Web Worker Integration (M2)', () => {
  it('should compute correct node colors based on storage node type', () => {
    expect(getNodeColor('storage')).toBe('#38bdf8');
    expect(getNodeColor('table')).toBe('#10b981');
    expect(getNodeColor('entity')).toBe('#a855f7');
    expect(getNodeColor('key')).toBe('#f59e0b');
    expect(getNodeColor('unknown')).toBe('#ec4899');
  });

  it('should generate dynamic default storage engine graph nodes without static coordinate hardcoding', () => {
    const defaultNodes = getDefaultGraphNodes();
    expect(defaultNodes).toHaveLength(5);
    expect(defaultNodes[0].label).toBe('localStorage Engine');
    expect(defaultNodes[0].type).toBe('storage');

    // Ensure nodes carry no static position properties
    defaultNodes.forEach((node) => {
      // @ts-expect-error position should not exist on GraphNode
      expect(node.position).toBeUndefined();
    });
  });

  it('should derive graph nodes dynamically from inspected browser storage entries', () => {
    const entries = [
      { key: 'user_jwt', value: 'secret_token_val', target: 'localStorage' as const },
      { key: 'cart_data', value: '{"items":[1,2]}', target: 'indexedDB' as const },
    ];

    const nodes = deriveGraphNodesFromEntries(entries);
    expect(nodes).toHaveLength(2);
    expect(nodes[0].label).toBe('user_jwt');
    expect(nodes[0].type).toBe('entity');
    expect(nodes[1].label).toBe('cart_data');
    expect(nodes[1].type).toBe('table');
  });

  it('should evaluate WebGL context availability safely', () => {
    const isSupported = checkWebGlSupport();
    expect(typeof isSupported).toBe('boolean');
  });

  it('should render 2D view fallback when WebGL context is absent in JSDOM environment', () => {
    const customNodes: GraphNode[] = [
      { id: 'n1', label: 'Auth Token', type: 'entity', size: 10 },
      { id: 'n2', label: 'Cart Store', type: 'table', size: 20 },
    ];

    render(<SpatialGraphCanvas nodes={customNodes} />);

    // In JSDOM without HTMLCanvasElement.getContext('webgl'), 2D fallback view renders
    const fallbackTitle = screen.getByText(/3D Graph Topology \(2D View/i);
    expect(fallbackTitle).toBeInTheDocument();

    expect(screen.getByText(/● Auth Token/i)).toBeInTheDocument();
    expect(screen.getByText(/● Cart Store/i)).toBeInTheDocument();
  });

  it('should handle onNodeClick callbacks when clicking nodes in fallback mode', () => {
    const handleClick = vi.fn();
    const customNodes: GraphNode[] = [
      { id: 'node_click_1', label: 'Clickable Node', type: 'key', size: 5 },
    ];

    render(<SpatialGraphCanvas nodes={customNodes} onNodeClick={handleClick} />);

    const item = screen.getByText(/● Clickable Node/i);
    fireEvent.click(item);

    expect(handleClick).toHaveBeenCalledWith('node_click_1');
  });
});
