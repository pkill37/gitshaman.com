'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import BugReportWidget from '@/components/BugReportWidget';
import { getCuratedRepoAccent, getCuratedRepoPath } from '@/lib/curated-repos';
import type { CuratedRepoSourceMode } from '@/lib/repo-static';

type WorkspaceTheme = 'dark' | 'light';

interface StatusBarProps {
  repoLabel?: string;
  branch?: string;
  sourceMode?: CuratedRepoSourceMode;
  canUseR2Source?: boolean;
  onSourceModeChange?: (sourceMode: CuratedRepoSourceMode) => void;
  workspaceTheme?: WorkspaceTheme;
  onWorkspaceThemeChange?: (theme: WorkspaceTheme) => void;
}

const AOSP_REPO_LINKS = [
  { owner: 'LineageOS', repo: 'android', label: 'LineageOS', avatarFile: 'lineageos.svg' },
  {
    owner: 'GrapheneOS',
    repo: 'platform_manifest',
    label: 'GrapheneOS',
    avatarFile: 'grapheneos.svg',
  },
  { owner: 'ofdryads', repo: 'miniageos', label: 'miniageOS', avatarFile: 'miniageos.svg' },
] as const;

function formatDisplayBranch(branch: string): string {
  if (!/^[0-9a-f]{7,40}$/i.test(branch)) {
    return branch;
  }

  return branch.length > 12 ? `${branch.slice(0, 12)}…` : branch;
}

function buildGitHubTreeUrl(repoLabel: string, branch: string): string {
  return `https://github.com/${repoLabel}/tree/${branch
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;
}

const StatusBar: React.FC<StatusBarProps> = ({
  repoLabel,
  branch,
  sourceMode,
  canUseR2Source = false,
  onSourceModeChange,
  workspaceTheme,
  onWorkspaceThemeChange,
}) => {
  const [repoSwitchFlash, setRepoSwitchFlash] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const branchLabel = branch ? formatDisplayBranch(branch) : null;
  const githubRepoUrl = repoLabel ? `https://github.com/${repoLabel}` : null;
  const githubTreeUrl = repoLabel && branch ? buildGitHubTreeUrl(repoLabel, branch) : null;
  const [repoOwner, repoName] = repoLabel?.split('/') ?? [];
  const repoAccent = repoOwner && repoName ? getCuratedRepoAccent(repoOwner, repoName) : undefined;
  const isAospRepo = AOSP_REPO_LINKS.some(
    (entry) => entry.owner === repoOwner && entry.repo === repoName
  );
  const sourceLabel =
    sourceMode === 'local-filesystem'
      ? 'Local staged corpus'
      : sourceMode === 'r2-bucket'
        ? 'R2'
        : null;

  useEffect(() => {
    if (!repoLabel || typeof window === 'undefined') {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      try {
        const stored = sessionStorage.getItem('explorar:repo-switch-flash');
        if (!stored) {
          setRepoSwitchFlash(false);
          return;
        }

        const parsed = JSON.parse(stored) as { to?: string; ts?: number };
        setRepoSwitchFlash(parsed.to === repoLabel);
      } catch {
        setRepoSwitchFlash(false);
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [repoLabel]);

  useEffect(() => {
    if (!repoLabel || typeof window === 'undefined' || !repoSwitchFlash) {
      return;
    }

    try {
      sessionStorage.removeItem('explorar:repo-switch-flash');
    } catch {
      // Ignore storage failures; the visual cue is still time-boxed below.
    }

    const timeoutId = window.setTimeout(() => setRepoSwitchFlash(false), 1200);
    return () => window.clearTimeout(timeoutId);
  }, [repoLabel, repoSwitchFlash]);

  const handleShare = useCallback((platform: string) => {
    const shareText = 'Explore source code with interactive learning on GitShaman.';
    const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
    const encodedText = encodeURIComponent(shareText);
    const encodedUrl = encodeURIComponent(shareUrl);
    const encodedTextWithUrl = encodeURIComponent(`${shareText} ${shareUrl}`);

    let shareLink = '';
    switch (platform) {
      case 'twitter':
        shareLink = `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`;
        break;
      case 'linkedin':
        shareLink = `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`;
        break;
      case 'reddit':
        shareLink = `https://reddit.com/submit?title=${encodedText}&url=${encodedUrl}`;
        break;
      case 'whatsapp':
        shareLink = `https://wa.me/?text=${encodedTextWithUrl}`;
        break;
      case 'hackernews':
        shareLink = `https://news.ycombinator.com/submitlink?u=${encodedUrl}&t=${encodedText}`;
        break;
    }

    if (shareLink) {
      window.open(shareLink, '_blank', 'width=550,height=420');
      setShowShareMenu(false);
    }
  }, []);

  return (
    <div
      className="cursor-statusbar"
      style={repoAccent ? ({ '--repo-accent': repoAccent } as React.CSSProperties) : undefined}
    >
      <div className="cursor-statusbar-left">
        <Link
          className="cursor-statusbar-item cursor-statusbar-link cursor-statusbar-brand"
          href="/"
          title="gitshaman.com home"
          aria-label="gitshaman.com home"
        >
          <span className="cursor-statusbar-brand-git">git</span>
          <span className="cursor-statusbar-brand-sha">sha</span>
          <span className="cursor-statusbar-brand-man">man</span>
          <span className="cursor-statusbar-brand-domain">.com</span>
        </Link>
        <div className="cursor-statusbar-divider" />
        {repoLabel && (
          <>
            <a
              className={`cursor-statusbar-item cursor-statusbar-link${
                repoSwitchFlash ? ' cursor-statusbar-link--repo-flash' : ''
              } cursor-statusbar-repo`}
              href={githubRepoUrl ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open repository: ${repoLabel}`}
              aria-label={`Open repository ${repoLabel}`}
            >
              <span className="cursor-statusbar-icon">🔗</span>
              <span className="cursor-statusbar-text">{repoLabel}</span>
            </a>
            <div className="cursor-statusbar-divider" />
          </>
        )}
        {branch && branchLabel && (
          <>
            <a
              className="cursor-statusbar-item cursor-statusbar-link"
              href={githubTreeUrl ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open branch/revision: ${branch}`}
              aria-label={`Open branch or revision ${branch}`}
            >
              <span className="cursor-statusbar-icon">🌿</span>
              <span className="cursor-statusbar-text">{branchLabel}</span>
            </a>
            <div className="cursor-statusbar-divider" />
          </>
        )}
      </div>
      <div className="cursor-statusbar-right">
        {isAospRepo && (
          <nav className="cursor-statusbar-aosp-nav" aria-label="AOSP repository family">
            <span className="cursor-statusbar-aosp-label">AOSP</span>
            {AOSP_REPO_LINKS.map((entry) => {
              const active = entry.owner === repoOwner && entry.repo === repoName;
              return (
                <Link
                  key={`${entry.owner}/${entry.repo}`}
                  href={getCuratedRepoPath(entry.owner, entry.repo)}
                  className={`cursor-statusbar-aosp-link${active ? ' is-active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  title={`Open ${entry.label}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className="cursor-statusbar-aosp-avatar"
                    src={`/avatars/${entry.avatarFile}`}
                    alt=""
                    width={14}
                    height={14}
                    loading="lazy"
                    decoding="async"
                  />
                  {entry.label}
                </Link>
              );
            })}
          </nav>
        )}
        <div className="shaman-share-menu-wrap shaman-share-menu-wrap--statusbar">
          <button
            type="button"
            className="cursor-statusbar-item cursor-statusbar-button"
            aria-haspopup="menu"
            aria-expanded={showShareMenu}
            onClick={() => setShowShareMenu((open) => !open)}
          >
            <svg
              className="cursor-statusbar-icon cursor-statusbar-share-icon"
              viewBox="0 0 16 16"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M11.75 10.15a2.3 2.3 0 0 0-1.69.74L6.21 8.81a2.36 2.36 0 0 0 0-1.62l3.85-2.08a2.33 2.33 0 1 0-.67-1.24L5.53 5.95a2.35 2.35 0 1 0 0 4.1l3.86 2.08a2.35 2.35 0 1 0 2.36-1.98Zm0-8.65a.85.85 0 1 1 0 1.7.85.85 0 0 1 0-1.7ZM4.25 8.85a.85.85 0 1 1 0-1.7.85.85 0 0 1 0 1.7Zm7.5 5.65a.85.85 0 1 1 0-1.7.85.85 0 0 1 0 1.7Z" />
            </svg>
            <span className="cursor-statusbar-text">Share</span>
          </button>
          {showShareMenu && (
            <div
              className="shaman-share-menu shaman-share-menu--statusbar"
              role="menu"
              onMouseLeave={() => setShowShareMenu(false)}
            >
              {(['hackernews', 'twitter', 'reddit', 'linkedin', 'whatsapp'] as const).map(
                (platform) => (
                  <button
                    key={platform}
                    type="button"
                    role="menuitem"
                    onClick={() => handleShare(platform)}
                  >
                    {platform === 'hackernews' && 'Hacker News'}
                    {platform === 'twitter' && 'Twitter'}
                    {platform === 'reddit' && 'Reddit'}
                    {platform === 'linkedin' && 'LinkedIn'}
                    {platform === 'whatsapp' && 'WhatsApp'}
                  </button>
                )
              )}
            </div>
          )}
        </div>
        {sourceMode && sourceLabel && onSourceModeChange && (
          <label
            className="cursor-statusbar-item cursor-statusbar-source"
            title={`Storage source: ${sourceLabel}`}
          >
            <span className="cursor-statusbar-icon">🌐</span>
            <span className="cursor-statusbar-text">storage</span>
            <select
              value={sourceMode}
              onChange={(event) => onSourceModeChange(event.target.value as CuratedRepoSourceMode)}
              aria-label="Storage source"
            >
              <option value="local-filesystem">local</option>
              <option value="r2-bucket" disabled={!canUseR2Source}>
                R2
              </option>
            </select>
          </label>
        )}
        {workspaceTheme && onWorkspaceThemeChange && (
          <button
            type="button"
            className="cursor-statusbar-item cursor-statusbar-button"
            onClick={() => onWorkspaceThemeChange(workspaceTheme === 'light' ? 'dark' : 'light')}
            title={workspaceTheme === 'light' ? 'Use dark theme' : 'Use light theme'}
            aria-label={workspaceTheme === 'light' ? 'Use dark theme' : 'Use light theme'}
            aria-pressed={workspaceTheme === 'light'}
          >
            <span className="cursor-statusbar-icon" aria-hidden="true">
              {workspaceTheme === 'light' ? '🌙' : '☀️'}
            </span>
            <span className="cursor-statusbar-text">
              {workspaceTheme === 'light' ? 'dark' : 'light'}
            </span>
          </button>
        )}
        <BugReportWidget variant="statusbar" />
      </div>
    </div>
  );
};

export default StatusBar;
