'use client';

import { useEffect, useRef, useSyncExternalStore, type CSSProperties } from 'react';
import { useSearchParams } from 'next/navigation';
import { getCuratedRepoAccent } from '@/lib/curated-repos';
import {
  REPOSITORY_HISTORY_KEY,
  createRepositoryVisit,
  readRepositoryHistory,
  recordRepositoryVisit,
  type RepositoryVisit,
} from '@/lib/repository-history';
import './repository-history.css';

let visits: RepositoryVisit[] = [];
let activeVisit: { repository: string; id: string } | null = null;
const emptyVisits: RepositoryVisit[] = [];
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getSnapshot = () => visits;
const getServerSnapshot = () => emptyVisits;

function publishHistory(next: RepositoryVisit[]) {
  visits = next;
  try {
    localStorage.setItem(REPOSITORY_HISTORY_KEY, JSON.stringify(visits));
  } catch {
    // Navigation and removal still work when browser storage is unavailable.
  }
  listeners.forEach((listener) => listener());
}

export function useRepositoryHistory() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export default function RepositoryHistory({
  owner,
  repo,
  file,
  branch,
  targetFile,
  expanded,
}: {
  owner: string;
  repo: string;
  file: string;
  branch: string;
  targetFile?: string;
  expanded: boolean;
}) {
  const history = useRepositoryHistory();
  const search = useSearchParams().toString();
  const timelineRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (expanded && timelineRef.current) {
      timelineRef.current.scrollLeft = timelineRef.current.scrollWidth;
    }
  }, [history, expanded]);

  useEffect(() => {
    const repository = `${owner}/${repo}`;
    const currentVisit = activeVisit;
    if (
      currentVisit?.repository === repository &&
      !visits.some((visit) => visit.id === currentVisit.id)
    )
      return; // Do not recreate a dismissed visit as the current workspace updates.
    if (!visits.length) {
      try {
        visits = readRepositoryHistory(localStorage.getItem(REPOSITORY_HISTORY_KEY));
      } catch {
        // The trail still works in memory when browser storage is unavailable.
      }
    }
    const params = new URLSearchParams(search);
    if (targetFile && !params.has('file') && !params.has('dir')) params.set('file', targetFile);
    const visit = createRepositoryVisit(
      owner,
      repo,
      file || params.get('file') || '',
      branch,
      params.toString()
    );
    const next = recordRepositoryVisit(visits, visit);
    activeVisit = { repository, id: next.at(-1)!.id };
    publishHistory(next);
  }, [owner, repo, file, branch, search, targetFile]);

  if (history.length < 2) return null;

  return (
    <nav
      id="repository-history-panel"
      className="repository-history"
      aria-label="Navigation History"
      hidden={!expanded}
    >
      <ol
        ref={timelineRef}
        role="list"
        id="repository-history-previews"
        className="repository-history-previews"
        hidden={!expanded}
      >
        {history.map((visit, index) => (
          <li key={visit.id} className="repository-history-step">
            <div
              className="repository-history-preview"
              data-current={visit.id === activeVisit?.id || undefined}
              style={
                {
                  '--history-accent': getCuratedRepoAccent(visit.owner, visit.repo),
                } as CSSProperties
              }
            >
              <a
                href={visit.href}
                className="repository-history-link"
                aria-current={visit.id === activeVisit?.id ? 'location' : undefined}
                aria-label={`Visit ${index + 1}: ${visit.owner}/${visit.repo}${visit.file ? ` · ${visit.file}` : ''}`}
                title={`${visit.owner}/${visit.repo}\n${visit.file || 'Repository overview'}${visit.branch ? `\n${visit.branch}` : ''}`}
              >
                <span className="repository-history-preview-top">
                  <span>{visit.owner}</span>
                  <span>
                    {visit.id === activeVisit?.id ? 'Current' : String(index + 1).padStart(2, '0')}
                  </span>
                </span>
                <strong>{visit.repo}</strong>
                <span className="repository-history-file">
                  {visit.file || 'Repository overview'}
                </span>
              </a>
              <button
                type="button"
                className="repository-history-remove"
                aria-label={`Remove visit ${index + 1}: ${visit.owner}/${visit.repo} from history`}
                title="Remove from history"
                onClick={() => publishHistory(visits.filter((entry) => entry.id !== visit.id))}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            {index < history.length - 1 && (
              <span className="repository-history-arrow" aria-hidden="true">
                →
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
