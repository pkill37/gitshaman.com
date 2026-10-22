import { useMemo, useSyncExternalStore } from 'react';

const event = 'gitshaman:navigation';
const subscribe = (callback: () => void) => {
  window.addEventListener('popstate', callback);
  window.addEventListener(event, callback);
  return () => {
    window.removeEventListener('popstate', callback);
    window.removeEventListener(event, callback);
  };
};
function navigate(href: string, replace = false) {
  const url = new URL(href, location.href);
  if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) return;
  // This host has one repository; navigation changes file focus through query parameters.
  history[replace ? 'replaceState' : 'pushState'](null, '', '/' + url.search + url.hash);
  window.dispatchEvent(new Event(event));
}
const router = {
  push: (href: string) => navigate(href),
  replace: (href: string) => navigate(href, true),
  back: () => history.back(),
  forward: () => history.forward(),
  refresh: () => location.reload(),
  prefetch: () => {},
};
export const useRouter = () => router;
export function useSearchParams() {
  const search = useSyncExternalStore(subscribe, () => location.search);
  return useMemo(() => new URLSearchParams(search), [search]);
}
