'use client';

import { type ReactNode } from 'react';
import RepositoryUrlForm from './RepositoryUrlForm';

export default function HeroInputSection({ children }: { children: ReactNode }) {
  return (
    <>
      <h1 className="shaman-wordmark shaman-hero-heading">
        Understand <span className="shaman-wordmark-sha">unfamiliar code</span> faster
      </h1>

      <RepositoryUrlForm />
      <p className="mt-3 text-sm leading-6 text-gray-300">
        Paste a public GitHub repository, file, or branch URL to trace symbols, references, and
        architecture. Or replace <code>github.com</code> with <code>gitshaman.com</code>.
      </p>

      {children}
    </>
  );
}
