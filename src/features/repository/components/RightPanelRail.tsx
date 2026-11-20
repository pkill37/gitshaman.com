'use client';

import type { ReactNode } from 'react';

export interface RightPanelTab {
  id: string;
  label: string;
  controls: string;
  icon: ReactNode;
}

export default function RightPanelRail({
  tabs,
  activePanel,
  onSelect,
}: {
  tabs: RightPanelTab[];
  activePanel: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="workspace-right-activity-bar" aria-label="Right sidebar panels">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className="workspace-activity-button"
          aria-label={tab.label}
          title={tab.label}
          aria-controls={tab.controls}
          aria-pressed={activePanel === tab.id}
          aria-expanded={activePanel === tab.id}
          onClick={() => onSelect(tab.id)}
        >
          {tab.icon}
        </button>
      ))}
    </nav>
  );
}
