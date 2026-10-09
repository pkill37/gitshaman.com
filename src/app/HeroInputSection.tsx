'use client';

import { type ReactNode } from 'react';
import RepositoryUrlForm from './RepositoryUrlForm';

export default function HeroInputSection({ children }: { children: ReactNode }) {
  return (
    <>
      <h1 className="shaman-landing-title mb-3 text-[min(2rem,9vw)] font-semibold tracking-tight sm:text-[2.75rem]">
        <>
          <span className="shaman-hero-intro">
            Meet{' '}
            <span className="shaman-wordmark shaman-wordmark--hero">
              git<span className="shaman-wordmark-sha">sha</span>man
              <span className="shaman-wordmark-domain">.com</span>
            </span>
          </span>
          <span className="shaman-landing-title-accent">Understand code faster.</span>
        </>
      </h1>

      <RepositoryUrlForm />

      {children}
    </>
  );
}
