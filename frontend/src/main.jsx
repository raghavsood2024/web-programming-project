import React, { Component, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'Unknown render error' };
  }

  componentDidCatch(error) {
    // Keep logging for browser devtools diagnostics.
    console.error('React render error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="container">
          <h1>Habit Tracker</h1>
          <p className="error">Frontend crashed: {this.state.message}</p>
        </main>
      );
    }
    return this.props.children;
  }
}

const rootEl = document.getElementById('root');

function renderFatal(message) {
  if (rootEl) {
    rootEl.innerHTML = `<main class="container"><h1>Habit Tracker</h1><p class="error">${message}</p></main>`;
  } else {
    document.body.textContent = message;
  }
}

window.addEventListener('error', (event) => {
  renderFatal(`Startup error: ${event.message}`);
});

try {
  if (!rootEl) {
    throw new Error('Missing root element');
  }

  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  );
} catch (err) {
  renderFatal(`Failed to mount app: ${err?.message || 'Unknown error'}`);
}
