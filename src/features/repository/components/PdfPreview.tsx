'use client';

import { useEffect, useState } from 'react';
import type { FileFetchResult } from '@/lib/file-fetch-debug';

interface PdfPreviewProps {
  filePath: string;
  fetchFile: (path: string) => Promise<FileFetchResult>;
}

export default function PdfPreview({ filePath, fetchFile }: PdfPreviewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let objectUrl: string | undefined;
    void (async () => {
      try {
        const result = await fetchFile(filePath);
        if (disposed) return;
        if (!result.blob) throw new Error('PDF data is unavailable from this repository source.');
        const header = await result.blob.slice(0, 1024).text();
        if (disposed) return;
        if (!header.includes('%PDF-')) throw new Error('This file is not a valid PDF.');
        objectUrl = URL.createObjectURL(result.blob);
        setUrl(objectUrl);
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : 'Failed to load PDF.');
      }
    })();
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [filePath, fetchFile]);

  return (
    <div className="vscode-editor vscode-pdf-preview">
      {error ? (
        <div className="vscode-loading" role="alert">
          <div>Failed to load PDF</div>
          <div>{error}</div>
        </div>
      ) : url ? (
        <>
          <nav className="vscode-pdf-toolbar" aria-label="PDF actions">
            <span>{filePath.split('/').pop()}</span>
            <a href={url} target="_blank" rel="noopener noreferrer">
              Open PDF
            </a>
            <a href={url} download={filePath.split('/').pop()}>
              Download
            </a>
          </nav>
          <iframe title={`PDF preview: ${filePath}`} src={url} />
        </>
      ) : (
        <div className="vscode-loading" role="status">
          Loading PDF…
        </div>
      )}
    </div>
  );
}
