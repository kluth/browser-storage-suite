import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an unhandled error:', error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: 16,
            background: '#090d16',
            border: '1px solid #ef4444',
            borderRadius: 8,
            color: '#f8fafc',
            margin: 8,
            fontSize: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ef4444', fontWeight: 700 }}>
            <AlertTriangle size={18} />
            <span>{this.props.fallbackTitle || 'Render-Fehler abgefangen'}</span>
          </div>
          <div style={{ color: '#cbd5e1', fontSize: 11, fontFamily: 'monospace', background: '#030712', padding: 8, borderRadius: 4, overflowX: 'auto' }}>
            {this.state.error?.message || 'Unbekannter Ausführungsfehler'}
          </div>
          <button
            onClick={this.handleRetry}
            style={{
              padding: '6px 12px',
              background: '#38bdf8',
              color: '#030712',
              border: 'none',
              borderRadius: 6,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              alignSelf: 'flex-start',
            }}
          >
            <RefreshCw size={14} /> Erneut versuchen
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
