'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  CURATED_REPOSITORY_PORTAL_EVENT,
  type CuratedRepositoryPortalEventDetail,
} from './CuratedRepositoryPortalLink';
import { getCuratedRepoPath, isCuratedRepo } from '@/lib/curated-repos';
import { githubUrlToGitShamanUrl, parseGitHubUrl } from '@/lib/github-url';

const URL_HACK_HOSTS = ['github.com'] as const;

export default function RepositoryUrlForm() {
  const router = useRouter();
  const [githubUrl, setGithubUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const [isPortalOpening, setIsPortalOpening] = useState(false);
  const animationCleanupRef = useRef<(() => void) | null>(null);

  const resolveDestination = useCallback((url: string) => {
    const translatedUrl = githubUrlToGitShamanUrl(url.trim());
    if (!translatedUrl) {
      return null;
    }

    const target = new URL(translatedUrl);
    const parsedTarget = parseGitHubUrl(url.trim());
    return parsedTarget && isCuratedRepo(parsedTarget.owner, parsedTarget.repo)
      ? `${getCuratedRepoPath(parsedTarget.owner, parsedTarget.repo)}${target.search}`
      : `${target.pathname}${target.search}`;
  }, []);

  useEffect(() => {
    return () => animationCleanupRef.current?.();
  }, []);

  useEffect(() => {
    const handleCuratedPortal = (event: Event) => {
      const { githubUrl: targetUrl } = (event as CustomEvent<CuratedRepositoryPortalEventDetail>)
        .detail;
      const destination = resolveDestination(targetUrl);
      if (!destination) {
        return;
      }

      animationCleanupRef.current?.();
      setUrlError('');
      setGithubUrl('');
      setIsPortalOpening(true);

      const typeDurationMs = 680;
      const navigateDelayMs = 950;
      const startedAt = performance.now();
      let frame = 0;
      let navigationTimer = 0;

      const tick = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / typeDurationMs);
        const nextLength = Math.ceil(targetUrl.length * progress);
        setGithubUrl(targetUrl.slice(0, nextLength));

        if (progress < 1) {
          frame = requestAnimationFrame(tick);
          return;
        }

        navigationTimer = window.setTimeout(() => {
          router.push(destination);
        }, navigateDelayMs);
      };

      frame = requestAnimationFrame(tick);
      animationCleanupRef.current = () => {
        cancelAnimationFrame(frame);
        window.clearTimeout(navigationTimer);
        animationCleanupRef.current = null;
      };
    };

    window.addEventListener(CURATED_REPOSITORY_PORTAL_EVENT, handleCuratedPortal);
    return () => window.removeEventListener(CURATED_REPOSITORY_PORTAL_EVENT, handleCuratedPortal);
  }, [resolveDestination, router]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const destination = resolveDestination(githubUrl);
    if (!destination) {
      setUrlError('Paste a public github.com repository, tree, or file URL.');
      return;
    }

    setUrlError('');
    router.push(destination);
  };

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
        <div
          className={`shaman-url-input-shell relative min-w-0 flex-1 ${
            isPortalOpening ? 'shaman-url-input-shell--opening' : ''
          }`}
        >
          <label htmlFor="github-url" className="sr-only">
            GitHub repository URL
          </label>
          {!githubUrl && (
            <div className="shaman-url-placeholder" aria-hidden="true">
              <span className="shaman-logo-hack">
                <span className="shaman-logo-hack-protocol">https://</span>
                <span className="shaman-logo-hack-hosts">
                  {URL_HACK_HOSTS.map((host) => (
                    <span key={host} className="shaman-logo-hack-old-host">
                      {host}
                    </span>
                  ))}
                  <span className="shaman-logo-hack-new-host">
                    git<span className="shaman-wordmark-sha">sha</span>man
                    <span className="shaman-wordmark-domain">.com</span>
                  </span>
                </span>
                <span className="shaman-logo-hack-path">/owner/repo</span>
              </span>
            </div>
          )}
          <input
            id="github-url"
            value={githubUrl}
            onChange={(event) => setGithubUrl(event.target.value)}
            placeholder=""
            className="shaman-url-input relative z-10 w-full rounded-md px-4 py-4 text-base outline-none"
            type="url"
            inputMode="url"
            autoComplete="url"
            readOnly={isPortalOpening}
            aria-busy={isPortalOpening}
          />
        </div>
        <button
          type="submit"
          className="shaman-url-button shaman-url-button--icon rounded-md px-6 py-4 text-base font-semibold transition-colors"
          disabled={isPortalOpening}
          aria-label={isPortalOpening ? 'Loading repository' : 'Open in GitShaman'}
        >
          {isPortalOpening ? (
            <span className="shaman-url-button-spinner" aria-hidden="true" />
          ) : (
            <span className="shaman-url-button-arrow" aria-hidden="true">
              ↑
            </span>
          )}
        </button>
      </form>
      {urlError && (
        <p role="alert" className="mt-2 text-xs text-rose-300">
          {urlError}
        </p>
      )}
    </>
  );
}
