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

const PORTAL_MORPH_DURATION_MS = 520;
const PORTAL_EXIT_DURATION_MS = 420;
const PORTAL_NAVIGATE_DELAY_MS = 1450;
const DOMAIN_CORRECTION_DURATION_MS = 900;

type PortalPhase = 'idle' | 'typing' | 'correcting' | 'transit' | 'exiting';

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
  const [domainEditStep, setDomainEditStep] = useState(0);
  const animationCleanupRef = useRef<(() => void) | null>(null);
  const isPortalOpening = portalPhase !== 'idle';
  const isPortalLoading = portalPhase === 'transit' || portalPhase === 'exiting';
  const isDomainVisible = portalPhase === 'correcting' || isPortalLoading;
  const loadingUrl = isDomainVisible ? githubUrlToGitShamanUrl(githubUrl.trim()) : null;
  const animatedDomainChange =
    domainEditStep <= 3
      ? 'hub'.slice(0, 3 - domainEditStep)
      : 'shaman'.slice(0, domainEditStep - 3);

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
      setPortalPhase('correcting');
      setDomainEditStep(0);
      setLoadingProgress(0);

      const correctionStartedAt = performance.now();
      let progressStartedAt: number | null = null;
      let progressFrame = 0;
      let exitTimer = 0;
      let navigationTimer = 0;

      const animateProgress = (now: number) => {
        if (progressStartedAt === null) {
          const correctionProgress = Math.min(
            1,
            (now - correctionStartedAt) / DOMAIN_CORRECTION_DURATION_MS
          );
          setDomainEditStep(Math.min(9, Math.floor(correctionProgress * 10)));
          if (correctionProgress < 1) {
            progressFrame = requestAnimationFrame(animateProgress);
            return;
          }

          progressStartedAt = now;
          setPortalPhase('transit');
          exitTimer = window.setTimeout(() => {
            setPortalPhase('exiting');
            setLoadingProgress(100);
          }, PORTAL_NAVIGATE_DELAY_MS - PORTAL_EXIT_DURATION_MS);
          navigationTimer = window.setTimeout(() => {
            router.push(destination);
          }, PORTAL_NAVIGATE_DELAY_MS);
        }
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
      const detail = (event as CustomEvent<CuratedRepositoryPortalEventDetail | undefined>).detail;
      if (!detail || typeof detail.githubUrl !== 'string') {
        return;
      }
      const { githubUrl: targetUrl } = detail;
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
    <div className="shaman-hero-windows">
      <div className={`shaman-url-morph ${isPortalLoading ? 'shaman-url-morph--portal' : ''}`}>
        <form onSubmit={handleSubmit} className="shaman-url-form">
          <div className="shaman-browser-window">
            <div className="shaman-browser-window-bar">
              <div className="shaman-browser-window-controls" aria-hidden="true">
                <span className="shaman-cli-window-dot shaman-cli-window-dot--red" />
                <span className="shaman-cli-window-dot shaman-cli-window-dot--yellow" />
                <span className="shaman-cli-window-dot shaman-cli-window-dot--green" />
              </div>
              <span className="shaman-browser-window-title">Web Browser</span>
            </div>
            <div
              className={`shaman-url-input-shell relative min-w-0 ${
                isPortalOpening ? 'shaman-url-input-shell--opening' : ''
              } ${isPortalLoading ? 'shaman-url-input-shell--loading' : ''} ${
                isDomainVisible ? 'shaman-url-input-shell--domain' : ''
              }`}
              style={{ '--shaman-url-load-progress': `${loadingProgress}%` } as CSSProperties}
            >
              <span className="shaman-url-lock" aria-hidden="true">
                <svg viewBox="0 0 16 16" fill="none">
                  <rect x="3" y="7" width="10" height="7" rx="2" />
                  <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
                  <path d="m6.5 10.5 1 1 2-2" />
                </svg>
              </span>
              <label htmlFor="github-url" className="sr-only">
                GitHub repository URL
              </label>
              {!githubUrl && (
                <div className="shaman-url-placeholder" aria-hidden="true">
                  https://github.com/owner/repo
                </div>
              )}
              <input
                id="github-url"
                value={loadingUrl ?? githubUrl}
                onChange={(event) => setGithubUrl(event.target.value)}
                placeholder=""
                className="shaman-url-input relative z-10 w-full rounded-md px-4 py-4 text-base outline-none"
                type="url"
                inputMode="url"
                autoComplete="url"
                readOnly={isPortalOpening}
                aria-busy={isPortalOpening}
                aria-describedby={isPortalLoading ? 'github-url-loading-status' : undefined}
                suppressHydrationWarning
              />
              {loadingUrl && (
                <div className="shaman-url-loading-text" aria-hidden="true">
                  <span>
                    https://git<strong>{animatedDomainChange}</strong>
                    {loadingUrl.slice('https://gitshaman'.length)}
                  </span>
                </div>
              )}
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
              aria-label={isPortalLoading ? 'Loading repository' : 'Open in GitShaman'}
            >
              {isPortalLoading ? (
                <span className="shaman-url-button-spinner" aria-hidden="true" />
              ) : (
                <span className="shaman-url-button-arrow" aria-hidden="true">
                  ↑
                </span>
              )}
            </button>
          </div>
        </form>
      </div>
      <span className="shaman-hero-window-separator">OR</span>
      <div className="shaman-cli-window overflow-hidden rounded-lg">
        <div className="shaman-cli-window-bar flex items-center gap-3 px-3 py-2">
          <span className="shaman-cli-window-dot shaman-cli-window-dot--red" />
          <span className="shaman-cli-window-dot shaman-cli-window-dot--yellow" />
          <span className="shaman-cli-window-dot shaman-cli-window-dot--green" />
          <span className="shaman-cli-window-title">Terminal</span>
        </div>
        <div className="shaman-cli-window-content px-4 py-3">
          <code>
            <span className="shaman-cli-prompt">$</span> cd foobar
            <br />
            <span className="shaman-cli-prompt">$</span> gitshaman init
          </code>
        </div>
      </div>
      {urlError && (
        <p role="alert" className="mt-2 text-xs text-rose-300">
          {urlError}
        </p>
      )}
    </div>
  );
}
