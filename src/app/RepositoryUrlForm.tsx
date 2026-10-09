'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  CURATED_REPOSITORY_PORTAL_EVENT,
  type CuratedRepositoryPortalEventDetail,
} from './CuratedRepositoryPortalLink';
import { getCuratedRepoPath, isCuratedRepo } from '@/lib/curated-repos';
import { githubUrlToGitShamanUrl, parseGitHubUrl } from '@/lib/github-url';

const URL_HACK_HOSTS = ['github.com'] as const;
const PORTAL_MORPH_DURATION_MS = 520;
const PORTAL_EXIT_DURATION_MS = 420;
const PORTAL_NAVIGATE_DELAY_MS = 1450;

type PortalPhase = 'idle' | 'typing' | 'transit' | 'exiting';

export default function RepositoryUrlForm({
  onPortalLoadingChange,
}: {
  onPortalLoadingChange?: (isLoading: boolean) => void;
}) {
  const router = useRouter();
  const [githubUrl, setGithubUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const [portalPhase, setPortalPhase] = useState<PortalPhase>('idle');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const animationCleanupRef = useRef<(() => void) | null>(null);
  const isPortalOpening = portalPhase !== 'idle';
  const isPortalLoading = portalPhase === 'transit' || portalPhase === 'exiting';

  useEffect(() => {
    onPortalLoadingChange?.(isPortalLoading);
  }, [isPortalLoading, onPortalLoadingChange]);

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

  const openPortal = useCallback(
    (destination: string) => {
      animationCleanupRef.current?.();
      setPortalPhase('transit');
      setLoadingProgress(0);

      const progressStartedAt = performance.now();
      let progressFrame = 0;

      const animateProgress = (now: number) => {
        const progress = Math.min(
          100,
          Math.round(((now - progressStartedAt) / PORTAL_NAVIGATE_DELAY_MS) * 100)
        );
        setLoadingProgress(progress);

        if (progress < 100) {
          progressFrame = requestAnimationFrame(animateProgress);
        }
      };

      progressFrame = requestAnimationFrame(animateProgress);

      const exitTimer = window.setTimeout(() => {
        setPortalPhase('exiting');
        setLoadingProgress(100);
      }, PORTAL_NAVIGATE_DELAY_MS - PORTAL_EXIT_DURATION_MS);
      const navigationTimer = window.setTimeout(() => {
        router.push(destination);
      }, PORTAL_NAVIGATE_DELAY_MS);

      animationCleanupRef.current = () => {
        cancelAnimationFrame(progressFrame);
        window.clearTimeout(exitTimer);
        window.clearTimeout(navigationTimer);
        animationCleanupRef.current = null;
      };
    },
    [router]
  );

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
      setLoadingProgress(0);
      setPortalPhase('typing');

      const typeDurationMs = 680;
      const startedAt = performance.now();
      let frame = 0;
      let morphTimer = 0;

      const tick = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / typeDurationMs);
        const nextLength = Math.ceil(targetUrl.length * progress);
        setGithubUrl(targetUrl.slice(0, nextLength));

        if (progress < 1) {
          frame = requestAnimationFrame(tick);
          return;
        }

        morphTimer = window.setTimeout(() => {
          openPortal(destination);
        }, PORTAL_MORPH_DURATION_MS);
      };

      frame = requestAnimationFrame(tick);
      animationCleanupRef.current = () => {
        cancelAnimationFrame(frame);
        window.clearTimeout(morphTimer);
        animationCleanupRef.current = null;
      };
    };

    window.addEventListener(CURATED_REPOSITORY_PORTAL_EVENT, handleCuratedPortal);
    return () => window.removeEventListener(CURATED_REPOSITORY_PORTAL_EVENT, handleCuratedPortal);
  }, [openPortal, resolveDestination]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const destination = resolveDestination(githubUrl);
    if (!destination) {
      setUrlError('Paste a public github.com repository, tree, or file URL.');
      return;
    }

    setUrlError('');
    setLoadingProgress(0);
    openPortal(destination);
  };

  return (
    <>
      <div className={`shaman-url-morph ${isPortalLoading ? 'shaman-url-morph--portal' : ''}`}>
        <form onSubmit={handleSubmit} className="shaman-url-form flex flex-col gap-3 sm:flex-row">
          <div
            className={`shaman-url-input-shell relative min-w-0 flex-1 ${
              isPortalOpening ? 'shaman-url-input-shell--opening' : ''
            } ${isPortalLoading ? 'shaman-url-input-shell--loading' : ''}`}
            style={
              {
                '--shaman-url-load-progress': `${loadingProgress}%`,
              } as CSSProperties
            }
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
              aria-describedby={isPortalLoading ? 'github-url-loading-status' : undefined}
            />
            {isPortalLoading && (
              <span id="github-url-loading-status" className="sr-only">
                Loading repository {loadingProgress}%
              </span>
            )}
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
      </div>
      {urlError && (
        <p role="alert" className="mt-2 text-xs text-rose-300">
          {urlError}
        </p>
      )}
    </>
  );
}
