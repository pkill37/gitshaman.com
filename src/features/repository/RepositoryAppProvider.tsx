'use client';

import type { ReactNode } from 'react';
import { RepositoryProvider } from '@/contexts/RepositoryContext';
import RepositoryNotifications from './components/RepositoryNotifications';

export default function RepositoryAppProvider({ children }: { children: ReactNode }) {
  return (
    <RepositoryProvider>
      <RepositoryNotifications>{children}</RepositoryNotifications>
    </RepositoryProvider>
  );
}
