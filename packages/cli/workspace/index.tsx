import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import RepositoryApp from '../../../src/features/repository/RepositoryApp';
import { registerRepositoryDataSource } from '../../../src/lib/repository-data-source';
import { LocalRepositorySource, type LocalStatus } from './source';
import 'monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css';
import '../../../src/app/globals.css';
import './workspace.css';

const source = new LocalRepositorySource();

function LocalWorkspace() {
  const [status, setStatus] = useState<LocalStatus | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void source
        .status()
        .then((next) => {
          if (!active) return;
          source.configure(next);
          registerRepositoryDataSource(source);
          setStatus(next);
          setError('');
        })
        .catch((reason: Error) => {
          if (active) setError(reason.message);
        });
    };
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {error && <div role="alert">{error}</div>}
      {status?.stale && (
        <div role="status">
          Source changed since analysis ({status.changed.length} files). Run gitshaman analyze, then
          restart gitshaman viz.
        </div>
      )}
      {status ? (
        <div
          className="cli-repository"
          style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}
        >
          <RepositoryApp owner={source.owner} repo={source.repo} />
        </div>
      ) : (
        !error && <p role="status">Loading local repository…</p>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<LocalWorkspace />);
