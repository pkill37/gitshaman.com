'use client';

import Link from 'next/link';
import type { MouseEvent, ReactNode } from 'react';

export const CURATED_REPOSITORY_PORTAL_EVENT = 'gitshaman:open-curated-portal';

export type CuratedRepositoryPortalEventDetail = {
  githubUrl: string;
};

export default function CuratedRepositoryPortalLink({
  href,
  githubUrl,
  className,
  children,
}: {
  href: string;
  githubUrl: string;
  className: string;
  children: ReactNode;
}) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();
    window.dispatchEvent(
      new CustomEvent<CuratedRepositoryPortalEventDetail>(CURATED_REPOSITORY_PORTAL_EVENT, {
        detail: { githubUrl },
      })
    );
  };

  return (
    <Link href={href} prefetch={false} className={className} onClick={handleClick}>
      {children}
    </Link>
  );
}
