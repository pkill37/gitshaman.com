'use client';

import { type ReactNode } from 'react';
import RepositoryUrlForm from './RepositoryUrlForm';

export default function HeroInputSection({ children }: { children: ReactNode }) {
  return (
    <>
      <h1 className="shaman-wordmark shaman-hero-heading">
        Semantic <span className="shaman-wordmark-sha">Code</span> Intelligence
      </h1>

      <RepositoryUrlForm />

      {children}
    </>
  );
}
