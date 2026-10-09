'use client';

// Repository Context for managing repository state across components
// Handles GitHub-downloaded repositories

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import {
  getAvailableBranches,
  getStorageUsage,
  parseGitHubRepoIdentifier,
} from '@/lib/repo-storage';
import { DownloadProgress, BranchDownloadStatus } from '@/lib/github-archive';
import { getGitHubDefaultBranch, getTrustedVersion } from '@/lib/github-api';
import { getRepositoryMode as getRepoMode } from '@/lib/repo-static';

export interface RepositoryState {
  // Current repository
  source: 'github' | 'uploaded' | null;
  identifier: string | null; // owner~repo for GitHub, repoId for uploaded
  displayName: string | null;

  // Branch management
  currentBranch: string | null;
  availableBranches: string[];
  trustedBranches: string[]; // Only for GitHub repos

  // Status
  isLoading: boolean;
  isSetup: boolean; // Whether any repository is configured
  error: string | null;

  // Download status (for GitHub repos)
  downloadStatus: Record<string, BranchDownloadStatus>;
  downloadProgress: DownloadProgress | null;
}

export interface RepositoryActions {
  // Repository management
  setRepository: (
    source: 'github' | 'uploaded',
    identifier: string,
    displayName: string,
    preferredBranch?: string
  ) => Promise<void>;
  clearRepository: () => void;
  checkSetupStatus: () => Promise<boolean>;

  // Branch management
  switchBranch: (branch: string) => Promise<void>;
  refreshBranches: () => Promise<void>;

  // GitHub-specific actions
  getRepoInfo: () => { owner?: string; repo?: string; repoId?: string } | null;
  getRepositoryMode: () => 'curated' | 'workspace' | null;
}

interface RepositoryContextValue extends RepositoryState, RepositoryActions {}

const RepositoryContext = createContext<RepositoryContextValue | null>(null);

interface RepositoryProviderProps {
  children: ReactNode;
}

export function RepositoryProvider({ children }: RepositoryProviderProps) {
  const [state, setState] = useState<RepositoryState>({
    source: null,
    identifier: null,
    displayName: null,
    currentBranch: null,
    availableBranches: [],
    trustedBranches: [],
    isLoading: false,
    isSetup: false,
    error: null,
    downloadStatus: {},
    downloadProgress: null,
  });

  // Check if any repository is set up
  const checkSetupStatus = useCallback(async (): Promise<boolean> => {
    try {
      const usage = await getStorageUsage();
      const hasRepos = usage.repositories.length > 0;

      setState((prev) => ({ ...prev, isSetup: hasRepos }));
      return hasRepos;
    } catch (error) {
      console.error('Failed to check setup status:', error);
      return false;
    }
  }, []);

  // Set current repository
  const setRepository = useCallback(
    async (
      source: 'github' | 'uploaded',
      identifier: string,
      displayName: string,
      preferredBranch?: string
    ): Promise<void> => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        // Get available branches
        let branches: string[] = [];
        if (source === 'github') {
          const { owner, repo } = parseGitHubRepoIdentifier(identifier);
          const trustedVersion = getTrustedVersion(owner, repo);
          branches =
            trustedVersion && !preferredBranch
              ? [trustedVersion]
              : [preferredBranch || (await getGitHubDefaultBranch(owner, repo))];
        }

        if (branches.length === 0) {
          throw new Error(`No stable branches found for repository ${displayName}`);
        }

        const trustedBranches =
          source === 'github'
            ? (() => {
                const { owner, repo } = parseGitHubRepoIdentifier(identifier);
                const trustedVersion = getTrustedVersion(owner, repo);
                return trustedVersion ? [trustedVersion] : [];
              })()
            : [];

        // Set default branch (first trusted branch if available, otherwise first available stable branch)
        const defaultBranch =
          source === 'github' && trustedBranches.length > 0 && !preferredBranch
            ? trustedBranches.find((branch) => branches.includes(branch)) || branches[0]
            : branches[0];

        const downloadStatus: Record<string, BranchDownloadStatus> = {};
        if (defaultBranch) {
          downloadStatus[defaultBranch] = {
            isDownloading: false,
            isAvailable: true,
          };
        }

        setState((prev) => ({
          ...prev,
          source,
          identifier,
          displayName,
          currentBranch: defaultBranch,
          availableBranches: branches,
          trustedBranches,
          downloadStatus,
          isLoading: false,
          isSetup: true,
          error: null,
        }));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to set repository';
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: errorMessage,
        }));
        throw error;
      }
    },
    []
  );

  // Clear current repository
  const clearRepository = useCallback(() => {
    setState({
      source: null,
      identifier: null,
      displayName: null,
      currentBranch: null,
      availableBranches: [],
      trustedBranches: [],
      isLoading: false,
      isSetup: false,
      error: null,
      downloadStatus: {},
      downloadProgress: null,
    });
  }, []);

  // Switch to different branch
  const switchBranch = useCallback(
    async (branch: string): Promise<void> => {
      if (!state.source || !state.identifier) {
        throw new Error('No repository selected');
      }

      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        // Refresh available branches (in case new branch was downloaded)
        const branches = await getAvailableBranches(state.source, state.identifier);

        if (!branches.includes(branch)) {
          throw new Error(`Branch ${branch} not available`);
        }

        setState((prev) => ({
          ...prev,
          currentBranch: branch,
          availableBranches: branches,
          isLoading: false,
        }));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to switch branch';
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: errorMessage,
        }));
        throw error;
      }
    },
    [state.source, state.identifier]
  );

  // Refresh available branches
  const refreshBranches = useCallback(async (): Promise<void> => {
    if (!state.source || !state.identifier) {
      return;
    }

    try {
      const branches = await getAvailableBranches(state.source, state.identifier);
      setState((prev) => ({ ...prev, availableBranches: branches }));
    } catch (error) {
      console.error('Failed to refresh branches:', error);
    }
  }, [state.source, state.identifier]);

  // Get repository info
  const getRepoInfo = useCallback(() => {
    if (!state.source || !state.identifier) {
      return null;
    }

    if (state.source === 'github') {
      const { owner, repo } = parseGitHubRepoIdentifier(state.identifier);
      return { owner, repo };
    } else {
      return { repoId: state.identifier };
    }
  }, [state.source, state.identifier]);

  // Get repository mode
  const getRepositoryMode = useCallback((): 'curated' | 'workspace' | null => {
    if (!state.source || !state.identifier) {
      return null;
    }

    if (state.source === 'github') {
      const { owner, repo } = parseGitHubRepoIdentifier(state.identifier);
      return getRepoMode(owner, repo);
    }

    return 'workspace';
  }, [state.source, state.identifier]);

  // Initialize setup status on mount
  useEffect(() => {
    queueMicrotask(() => {
      void checkSetupStatus();
    });
  }, [checkSetupStatus]);

  const contextValue: RepositoryContextValue = {
    ...state,
    setRepository,
    clearRepository,
    checkSetupStatus,
    switchBranch,
    refreshBranches,
    getRepoInfo,
    getRepositoryMode,
  };

  return <RepositoryContext.Provider value={contextValue}>{children}</RepositoryContext.Provider>;
}

// Hook to use repository context
export function useRepository(): RepositoryContextValue {
  const context = useContext(RepositoryContext);

  if (!context) {
    throw new Error('useRepository must be used within a RepositoryProvider');
  }

  return context;
}

// Hook to check if repository is set up (for redirects)
export function useRepositorySetup(): {
  isSetup: boolean;
  isLoading: boolean;
  checkSetup: () => Promise<boolean>;
} {
  const { isSetup, isLoading, checkSetupStatus } = useRepository();

  return {
    isSetup,
    isLoading,
    checkSetup: checkSetupStatus,
  };
}
