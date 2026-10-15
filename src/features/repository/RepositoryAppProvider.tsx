'use client';

import type { ReactNode } from 'react';
import { RepositoryProvider } from '@/contexts/RepositoryContext';

export default function RepositoryAppProvider({ children }: { children: ReactNode }) {
  return <RepositoryProvider>{children}</RepositoryProvider>;
}
