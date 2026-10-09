'use client';

import Giscus from '@giscus/react';
import { useEffect, useRef, useState } from 'react';
import type { GiscusConfig } from '@/lib/giscus-config';

export default function GiscusDiscussion({
  config,
  term,
  theme,
}: {
  config: GiscusConfig;
  term: string;
  theme: 'light' | 'dark';
}) {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [discussionUrl, setDiscussionUrl] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setStatus('error'), 20000);
    const onMessage = (event: MessageEvent) => {
      const widget = container.current?.querySelector('giscus-widget');
      const iframe = widget?.shadowRoot?.querySelector('iframe');
      if (event.origin !== 'https://giscus.app' || !iframe || event.source !== iframe.contentWindow)
        return;
      const data = event.data?.giscus;
      if (!data || typeof data !== 'object') return;
      if (typeof data.resizeHeight === 'number' || data.discussion) {
        window.clearTimeout(timeout);
        setStatus('ready');
      }
      if (typeof data.error === 'string') {
        window.clearTimeout(timeout);
        // An empty repository thread is created by giscus on the first comment.
        setStatus(data.error.includes('Discussion not found') ? 'ready' : 'error');
      }
      const url = data.discussion?.url;
      if (typeof url === 'string') {
        try {
          const parsed = new URL(url);
          const prefix = `/${config.repo}/discussions/`;
          if (
            parsed.origin === 'https://github.com' &&
            parsed.pathname.startsWith(prefix) &&
            /^\d+$/.test(parsed.pathname.slice(prefix.length))
          ) {
            setDiscussionUrl(parsed.href);
          }
        } catch {
          // Ignore malformed widget metadata.
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
    };
  }, [attempt, config.repo]);

  return (
    <div ref={container}>
      {status === 'loading' && <p role="status">Loading GitHub discussion…</p>}
      {status === 'error' && (
        <div role="status">
          <p>Discussion could not be loaded.</p>
          <a
            href={discussionUrl || `https://github.com/${config.repo}/discussions`}
            target="_blank"
            rel="noreferrer"
          >
            Open GitHub ↗
          </a>
          <button
            type="button"
            onClick={() => {
              setStatus('loading');
              setAttempt((value) => value + 1);
            }}
          >
            Retry discussion
          </button>
        </div>
      )}
      <Giscus
        key={attempt}
        {...config}
        mapping="specific"
        term={term}
        strict="1"
        reactionsEnabled="1"
        emitMetadata="1"
        inputPosition="bottom"
        theme={theme === 'light' ? 'light' : 'dark_dimmed'}
        lang="en"
        loading="eager"
      />
    </div>
  );
}
