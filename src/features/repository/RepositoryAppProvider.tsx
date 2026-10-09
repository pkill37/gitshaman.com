'use client';

import { useEffect, type ReactNode } from 'react';
import { RepositoryProvider } from '@/contexts/RepositoryContext';
import { initializeWebPlatform } from '@/shared/platform/web';
import { config } from '@/shared/config';

export default function RepositoryAppProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    initializeWebPlatform({
      guidesApiUrl: config.getGuidesApiUrl(),
      guidesApiKey: config.getGuidesApiKey(),
    });
  }, []);

  return <RepositoryProvider>{children}</RepositoryProvider>;
}
