'use client';

import type { GitHubUrlTarget } from '@/lib/github-url';
import RepositoryAppProvider from './RepositoryAppProvider';
import RepositoryExplorerClient from './RepositoryExplorerClient';

interface RepositoryAppProps {
  owner: string;
  repo: string;
  directTarget?: GitHubUrlTarget;
}

export default function RepositoryApp({ owner, repo, directTarget }: RepositoryAppProps) {
  return (
    <RepositoryAppProvider>
      <RepositoryExplorerClient owner={owner} repo={repo} directTarget={directTarget} />
    </RepositoryAppProvider>
  );
}
