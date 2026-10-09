'use client';

import dynamic from 'next/dynamic';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { resolveRepositoryNavigation } from '@/lib/github-url';

function RepositoryAppLoadingShell() {
  return (
    <div className="shaman-workspace-enter shaman-workspace-boot vscode-theme-dark" role="status">
      <div className="shaman-workspace-boot-panel">
        <p className="shaman-workspace-boot-kicker">Loading source workspace</p>
        <h1>Repository source explorer</h1>
        <p>Preparing the file tree, guide context, and editor workspace.</p>
        <div className="shaman-workspace-boot-steps" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}

const RepositoryApp = dynamic(() => import('@/features/repository/RepositoryApp'), {
  loading: () => <RepositoryAppLoadingShell />,
});

export default function HomeRoute({ landing }: { landing: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const target = resolveRepositoryNavigation(
    pathname,
    searchParams.toString(),
    typeof window === 'undefined' ? '' : window.location.hash
  );

  if (!target) return landing;

  return (
    <RepositoryApp
      key={`${target.owner}/${target.repo}`}
      owner={target.owner}
      repo={target.repo}
      directTarget={target}
    />
  );
}
