'use client';

import type { ReactNode } from 'react';
import './repository-right-panel.css';

export default function RepositoryRightPanel({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className="repository-right-panel">
      {onClose && (
        <div className="repository-panel-header">
          <button
            type="button"
            aria-label="Hide guide sidebar"
            title="Hide sidebar"
            onClick={onClose}
          >
            ›
          </button>
        </div>
      )}
      <div className="repository-panel-body">{children}</div>
    </div>
  );
}
