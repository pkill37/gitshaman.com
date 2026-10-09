'use client';

import dynamic from 'next/dynamic';
import { getGiscusConfig, getRepositoryDiscussionTerm } from '@/lib/giscus-config';

const GiscusDiscussion = dynamic(() => import('./GiscusDiscussion'), {
  ssr: false,
  loading: () => <p role="status">Loading discussion widget…</p>,
});
const config = getGiscusConfig();

export default function RepositoryChatPanel({
  owner,
  repo,
  theme,
}: {
  owner: string;
  repo: string;
  theme: 'light' | 'dark';
}) {
  return (
    <section className="repository-chat" aria-label="Repository discussion">
      {config ? (
        <GiscusDiscussion
          key={getRepositoryDiscussionTerm(owner, repo)}
          config={config}
          term={getRepositoryDiscussionTerm(owner, repo)}
          theme={theme}
        />
      ) : (
        <div className="repository-chat-setup">
          <h3>Chat is not configured yet</h3>
          <p>
            Enable Discussions and install giscus on pkill37/gitshaman.com, then configure the
            public repository and category IDs.
          </p>
          <a href="https://giscus.app" target="_blank" rel="noreferrer">
            Configure giscus ↗
          </a>
          <p>
            Setup instructions: <code>docs/giscus-chat-integration.md</code>
          </p>
        </div>
      )}
    </section>
  );
}
