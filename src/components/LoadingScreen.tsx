'use client';

import React from 'react';

interface LoadingScreenProps {
  title?: string;
  description?: string;
}

export default function LoadingScreen({
  title = 'Loading Repository',
  description = 'Opening a portal into the source tree...',
}: LoadingScreenProps) {
  return (
    <div className="shaman-loading-screen flex min-h-screen flex-col text-foreground">
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-8">
        <div className="shaman-loading-panel w-full max-w-md rounded-[1.75rem] p-[1px]">
          <div className="shaman-loading-panel-inner rounded-[calc(1.75rem-1px)] px-6 py-8 sm:px-8">
            <div className="flex flex-col items-center gap-7 text-center">
              <div className="shaman-portal-loader" aria-hidden="true">
                <div className="shaman-portal-loader-core" />
              </div>

              <div>
                <h1 className="shaman-landing-title mb-3 text-3xl sm:text-4xl">{title}</h1>
                <p className="text-sm leading-6 text-[#aaa4b3]">{description}</p>
              </div>

              <div className="shaman-loading-lanes" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
