import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '20px',
          margin: '20px',
          backgroundColor: '#1a1a1a',
          color: '#ff6b6b',
          fontFamily: 'monospace',
          fontSize: '14px',
          borderRadius: '8px',
          border: '2px solid #ff6b6b'
        }}>
          <h2 style={{ color: '#ff6b6b', marginTop: 0 }}>App Error</h2>
          <p style={{ color: '#fff' }}>Something went wrong. Please check the console for details.</p>
          <details style={{ marginTop: '20px' }}>
            <summary style={{ cursor: 'pointer', color: '#4ecdc4' }}>Error Details</summary>
            <pre style={{
              backgroundColor: '#000',
              padding: '15px',
              borderRadius: '4px',
              overflow: 'auto',
              marginTop: '10px',
              color: '#fff'
            }}>
              {this.state.error && this.state.error.toString()}
              {'\n\n'}
              {this.state.errorInfo && this.state.errorInfo.componentStack}
            </pre>
          </details>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '20px',
              padding: '10px 20px',
              backgroundColor: '#4ecdc4',
              color: '#000',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: 'bold'
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
