'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function NotFound() {
  const router = useRouter();

  useEffect(() => {
    const path = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (window.location.pathname !== '/') {
      router.replace(`/?github_path=${encodeURIComponent(path)}`);
    }
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-950 px-6 text-gray-100">
      <section className="max-w-md text-center">
        <div className="mb-4 text-4xl" aria-hidden="true">
          🔍
        </div>
        <h1 className="mb-3 text-2xl font-semibold">Page not found</h1>
        <p className="mb-6 text-sm leading-6 text-gray-400">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <button
          type="button"
          onClick={() => router.push('/')}
          className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-950 transition hover:bg-white"
        >
          Go home
        </button>
      </section>
    </main>
  );
}
