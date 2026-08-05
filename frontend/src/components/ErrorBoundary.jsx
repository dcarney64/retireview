import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('Page crashed:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 text-center">
          <div className="text-red-400 text-lg mb-2">
            Something went wrong on this page.
          </div>
          <div className="text-slate-400 text-sm mb-4">
            {this.state.error?.message}
          </div>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            className="rounded bg-sky-500 px-4 py-2 text-white hover:bg-sky-600"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export function withErrorBoundary(Component) {
  function Wrapped(props) {
    return (
      <ErrorBoundary>
        <Component {...props} />
      </ErrorBoundary>
    );
  }

  Wrapped.displayName = `WithErrorBoundary(${Component.displayName || Component.name || 'Component'})`;
  return Wrapped;
}
