'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useRepository } from '@/contexts/RepositoryContext';

interface Notification {
  key: string;
  scope: string;
  message: string;
  dismissed: boolean;
}

const NotificationContext = createContext<(id: string, message: string) => void>(() => undefined);

export const useRepositoryNotification = () => useContext(NotificationContext);

export default function RepositoryNotifications({ children }: { children: ReactNode }) {
  const { identifier, currentBranch } = useRepository();
  const scope = JSON.stringify([identifier, currentBranch]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const notify = useCallback(
    (id: string, message: string) => {
      const key = `${scope}:${id}`;
      setNotifications((previous) =>
        previous.some((notification) => notification.key === key)
          ? previous
          : [...previous, { key, scope, message, dismissed: false }]
      );
    },
    [scope]
  );

  return (
    <NotificationContext.Provider value={notify}>
      {children}
      <div className="repository-notifications" role="region" aria-label="Repository notifications">
        {notifications
          .filter((notification) => notification.scope === scope && !notification.dismissed)
          .map((notification) => (
            <div className="repository-notification" key={notification.key}>
              <span className="codicon codicon-check" aria-hidden="true" />
              <span role="status">{notification.message}</span>
              <button
                type="button"
                aria-label={`Dismiss ${notification.message}`}
                title="Dismiss notification"
                onClick={() =>
                  setNotifications((previous) =>
                    previous.map((item) =>
                      item.key === notification.key ? { ...item, dismissed: true } : item
                    )
                  )
                }
              >
                <span className="codicon codicon-close" aria-hidden="true" />
              </button>
            </div>
          ))}
      </div>
    </NotificationContext.Provider>
  );
}
