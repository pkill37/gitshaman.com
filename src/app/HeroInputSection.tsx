'use client';

import { type ReactNode } from 'react';
import RepositoryUrlForm from './RepositoryUrlForm';

export default function HeroInputSection({ children }: { children: ReactNode }) {
  return (
    <>
      <h1 className="shaman-wordmark shaman-hero-heading">
        Understand <span className="shaman-wordmark-sha">code</span> faster
      </h1>

      <RepositoryUrlForm />

      {children}
    </>
  );
}
