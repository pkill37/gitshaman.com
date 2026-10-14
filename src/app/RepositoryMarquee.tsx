'use client';

import { useState, type ReactNode } from 'react';

export default function RepositoryMarquee({ children }: { children: ReactNode }) {
  const [paused, setPaused] = useState(false);

  return (
    <div
      className="shaman-repo-marquee"
      aria-label="Curated repositories"
      data-paused={paused || undefined}
      onPointerDownCapture={(event) => {
        if ((event.target as HTMLElement).closest('a')) setPaused(true);
      }}
      onClickCapture={(event) => {
        if ((event.target as HTMLElement).closest('a')) setPaused(true);
      }}
    >
      {children}
    </div>
  );
}
