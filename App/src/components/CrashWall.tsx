import { Component, type ErrorInfo, type ReactNode } from 'react';

import { clearWorkspace, readStoredWorkspace, type WorkspaceLocation } from '../doc/workspaceStore';
import { download } from '../export/download';

/**
 * The last line of defence: an error during render or an uncaught exception must
 * not leave a blank page with the diagram trapped in storage.
 *
 * The wall never tries to re-render the editor from memory (that state is what just
 * broke). It offers the copy this browser already stored – the same text an
 * autosave wrote, which a design-file reader understands – and then a reload.
 */

/** Browser noise that says nothing about this app's state. */
const IGNORED_ERRORS = /ResizeObserver loop|Script error\.?$/;

const LOCATION_LABEL: Record<WorkspaceLocation | 'none', string> = {
  indexeddb: 'this browser’s database',
  local: 'this browser’s local storage',
  session: 'this tab’s session storage',
  none: 'nowhere yet',
};

type Failure = { name: string; message: string; stack: string | null };

type State = {
  error: Failure | null;
  /** Where a recoverable copy would come from, read when the wall appears. */
  stash: { raw: string; location: WorkspaceLocation } | null;
  stashChecked: boolean;
  note: string | null;
};

const describe = (error: unknown): Failure => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message || 'No message',
      stack: error.stack?.split('\n').slice(0, 6).join('\n') ?? null,
    };
  }
  return { name: 'Error', message: String(error), stack: null };
};

export class CrashWall extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, stash: null, stashChecked: false, note: null };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: describe(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The component stack is the only clue about which panel failed.
    console.error('Render failed', error, info.componentStack);
    void this.loadStash();
  }

  componentDidMount() {
    window.addEventListener('error', this.onWindowError);
  }

  componentWillUnmount() {
    window.removeEventListener('error', this.onWindowError);
  }

  private raise = (error: unknown) => {
    if (this.state.error) return;
    this.setState({ error: describe(error) });
    void this.loadStash();
  };

  private onWindowError = (event: ErrorEvent) => {
    const message = event.message || event.error?.message || '';
    if (IGNORED_ERRORS.test(message)) return;
    this.raise(event.error ?? new Error(message));
  };

  private async loadStash() {
    const stash = await readStoredWorkspace();
    this.setState({ stash, stashChecked: true });
  }

  private downloadCopy = () => {
    const { stash } = this.state;
    if (!stash) {
      this.setState({ note: 'There is no stored copy in this browser to download.' });
      return;
    }
    download('recovered-diagram.nmap2flowchart.json', stash.raw, 'application/json');
    this.setState({ note: `Downloaded the copy stored in ${LOCATION_LABEL[stash.location]}.` });
  };

  private reload = () => {
    window.location.reload();
  };

  private startOver = async () => {
    await clearWorkspace();
    window.location.reload();
  };

  render() {
    const { error, stash, stashChecked, note } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash-wall">
        <section className="crash-wall__panel" role="alert" aria-labelledby="crash-wall-title">
          <span className="eyebrow">Recoverable error</span>
          <h1 id="crash-wall-title">The editor stopped responding</h1>
          <p>
            Something threw while the diagram was on screen. The autosaved copy is still in{' '}
            {LOCATION_LABEL[stash?.location ?? 'none']} – download it first, then reload.
          </p>

          <dl className="crash-wall__facts">
            <div>
              <dt>What failed</dt>
              <dd>
                {error.name}: {error.message}
              </dd>
            </div>
            <div>
              <dt>Stored copy</dt>
              <dd>
                {!stashChecked
                  ? 'checking…'
                  : stash
                    ? `${Math.round(stash.raw.length / 1024)} kB in ${LOCATION_LABEL[stash.location]}`
                    : 'none found – nothing has been saved yet'}
              </dd>
            </div>
          </dl>

          <div className="crash-wall__actions">
            <button type="button" className="btn btn--accent" onClick={this.downloadCopy} disabled={!stash}>
              Download my diagram
            </button>
            <button type="button" className="btn" onClick={this.reload}>
              Reload the editor
            </button>
            <button type="button" className="btn btn--ghost" onClick={this.startOver}>
              Start with an empty canvas
            </button>
          </div>

          {note && <p className="crash-wall__note">{note}</p>}

          <details className="crash-wall__details">
            <summary>Technical detail</summary>
            <pre>{error.stack ?? `${error.name}: ${error.message}`}</pre>
          </details>
        </section>
      </div>
    );
  }
}
