'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import RepositoryChatPanel from './RepositoryChatPanel';
import './repository-right-panel.css';

export default function RepositoryRightPanel({
  children,
  owner,
  repo,
  theme = 'dark',
  onClose,
}: {
  children: ReactNode;
  owner: string;
  repo: string;
  theme?: 'light' | 'dark';
  onClose?: () => void;
}) {
  const id = useId();
  const [active, setActive] = useState<'guide' | 'chat'>('guide');
  const [chatMounted, setChatMounted] = useState(false);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const select = (tab: 'guide' | 'chat') => {
    setActive(tab);
    if (tab === 'chat') setChatMounted(true);
  };
  return (
    <div className="repository-right-panel">
      <div className="repository-panel-header">
        <div role="tablist" aria-label="Repository resources">
          {(['guide', 'chat'] as const).map((tab, index) => (
            <button
              key={tab}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`${id}-${tab}-tab`}
              aria-controls={`${id}-${tab}`}
              aria-selected={active === tab}
              tabIndex={active === tab ? 0 : -1}
              onClick={() => select(tab)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
                select(next === 0 ? 'guide' : 'chat');
                buttons.current[next]?.focus();
              }}
            >
              {tab === 'guide' ? 'Guide' : 'Chat'}
            </button>
          ))}
        </div>
        {onClose && (
          <button
            type="button"
            aria-label="Hide guide sidebar"
            title="Hide sidebar"
            onClick={onClose}
          >
            ›
          </button>
        )}
      </div>
      <div
        role="tabpanel"
        id={`${id}-guide`}
        aria-labelledby={`${id}-guide-tab`}
        hidden={active !== 'guide'}
        className="repository-panel-body"
        tabIndex={0}
      >
        {children}
      </div>
      <div
        role="tabpanel"
        id={`${id}-chat`}
        aria-labelledby={`${id}-chat-tab`}
        hidden={active !== 'chat'}
        className="repository-panel-body repository-panel-chat"
        tabIndex={0}
      >
        {chatMounted && (
          <RepositoryChatPanel key={`${owner}/${repo}`} owner={owner} repo={repo} theme={theme} />
        )}
      </div>
    </div>
  );
}
