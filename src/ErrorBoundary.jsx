import React from 'react';

/** Per-tool crash shield: one tool ke render crash hone par poora app nahi gira.
 *  Label + retry ke saath tool-specific panel dikhata hai. */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
    this.retry = this.retry.bind(this);
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }
  retry() {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onRetry) this.props.onRetry();
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ margin: 20, padding: 18, background: '#1A1216', border: '1px solid rgba(255,93,115,.45)', borderRadius: 16, color: 'var(--fg)' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 800, color: '#FF5D73', fontSize: 15 }}>
            <span aria-hidden="true">⚠️</span> {this.props.label || 'Is tool'} mein kuch error aa gaya
          </div>
          <p style={{ margin: '8px 0', color: 'var(--fg2)', fontSize: 13, lineHeight: 1.5 }}>
            Abhi kuch gadbad hui — data ke saath issue ho sakta hai. Tool dobara try karo, ya app reload karo.
            (Technical detail console mein hai.)
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={this.retry} style={{ padding: '8px 14px', borderRadius: 99, border: 0, background: '#2FE39B', color: '#06130D', fontWeight: 800, cursor: 'pointer' }}>↻ Retry tool</button>
            <button onClick={() => location.reload()} style={{ padding: '8px 14px', borderRadius: 99, border: '1px solid var(--line2)', background: 'none', color: 'var(--fg)', cursor: 'pointer' }}>Reload app</button>
          </div>
          <details style={{ marginTop: 10, color: '#8A94A8', fontSize: 11 }}>
            <summary style={{ cursor: 'pointer' }}>Details</summary>
            <pre style={{ background: '#000', padding: 10, borderRadius: 8, overflow: 'auto', fontSize: 10, color: '#ff9d9d', whiteSpace: 'pre-wrap' }}>
              {String((this.state.error && (this.state.error.stack || this.state.error.message)) || this.state.error || '')}
              {'\n\n'}
              {this.state.errorInfo && this.state.errorInfo.componentStack}
            </pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}
