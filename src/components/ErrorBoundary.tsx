/* ============================================================================
   LiteDAW · FAULT ISOLATION
   A module that throws must not take the whole instrument down: the rail keeps
   working and the panel is replaced by a recoverable annunciator.
   ========================================================================= */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from '../design/Icon';

interface Props {
  children: ReactNode;
  /** Changing this value clears the fault (e.g. the active route). */
  resetKey?: string;
  label?: string;
}

interface State {
  error: Error | null;
  info: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info: info.componentStack ?? '' });
    console.error('[LiteDAW] module fault', error, info);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null, info: '' });
    }
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="pagegrid">
        <div className="pagegrid__main">
          <section className="panel">
            <header className="panel__head panel__head--alu">
              <h2 className="panel__title">
                <Icon name="alert" size={13} />
                {this.props.label ?? 'Module'} fault
              </h2>
              <span className="panel__spacer" />
              <span className="panel__tag">CAUTION</span>
            </header>
            <div className="panel__body">
              <div className="callout callout--warn" style={{ borderLeftColor: 'var(--red)', background: 'rgba(199,15,40,.1)' }}>
                <Icon name="alert" size={16} />
                <span>
                  <strong>{error.name}:</strong> {error.message}
                </span>
              </div>
              {info && (
                <pre
                  className="t-readout"
                  style={{
                    margin: 0,
                    padding: 12,
                    fontSize: 10,
                    lineHeight: 1.5,
                    maxHeight: 240,
                    overflow: 'auto',
                    background: 'var(--carbon-950)',
                    border: '1px solid var(--hair)',
                    borderRadius: 'var(--r-md)',
                    color: 'var(--ink-dim)',
                  }}
                >
                  {info.trim()}
                </pre>
              )}
              <div className="row">
                <button type="button" className="btn btn--primary" onClick={() => this.setState({ error: null, info: '' })}>
                  <span className="btn__cap">
                    <Icon name="refresh" size={15} />
                    Recover
                  </span>
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => window.location.reload()}>
                  <span className="btn__cap">
                    <Icon name="power" size={15} />
                    Restart
                  </span>
                </button>
              </div>
            </div>
          </section>
        </div>
        <div className="pagegrid__side" />
      </div>
    );
  }
}
