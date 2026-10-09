'use client';

import dynamic from 'next/dynamic';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { resolveRepositoryNavigation } from '@/lib/github-url';

function RepositoryAppLoadingShell() {
  return <div className="shaman-workspace-enter shaman-workspace-boot vscode-theme-dark" />;
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
