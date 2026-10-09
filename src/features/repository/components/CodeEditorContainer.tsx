'use client';

import React, { useState, useEffect, useRef } from 'react';
import MonacoCodeEditor from './MonacoCodeEditor';
import MarkdownPreview from './MarkdownPreview';
import { fetchFileContent as fetchFromGitHub } from '@/lib/github-api';
import type { FileFetchResult } from '@/lib/file-fetch-debug';
import type { LoadedCodeIndex } from '@/lib/code-index';
import { debugLog } from '@/lib/browser-debug';

interface CodeEditorContainerProps {
  filePath: string;
  onContentLoad?: (content: string) => void;
  onOpenFile?: (
    path: string,
    searchPattern?: string,
    scrollToLine?: number,
    searchScope?: string[],
    repoTarget?: { owner: string; repo: string }
  ) => void;
  fetchFile?: (path: string) => Promise<FileFetchResult>;
  markdownViewMode?: 'source' | 'preview';
  onToggleMarkdownPreview?: () => void;
  scrollToLine?: number;
  searchPattern?: string;
  navigationNonce?: number;
  onCursorChange?: (line: number, column: number) => void;
  workspaceFilePaths?: string[];
  workspaceId?: string;
  codeIndex?: LoadedCodeIndex | null;
  editorTheme?: 'vs-dark' | 'vs';
}

const isPreviewableMarkupFile = (path: string) => /\.(md|rst)$/i.test(path);

const CodeEditorContainer: React.FC<CodeEditorContainerProps> = ({
  filePath,
  onContentLoad,
  onOpenFile,
  fetchFile,
  markdownViewMode = 'source',
  onToggleMarkdownPreview,
  scrollToLine,
  searchPattern,
  navigationNonce,
  onCursorChange,
  workspaceFilePaths,
  workspaceId,
  codeIndex,
  editorTheme = 'vs-dark',
}) => {
  const [content, setContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentFilePath, setCurrentFilePath] = useState<string>('');
  // Use ref to cache loaded files without causing re-renders
  const loadedFilesCache = useRef<Map<string, FileFetchResult>>(new Map());
  const activeRequestId = useRef(0);
  const onContentLoadRef = useRef(onContentLoad);
  const fetchFileRef = useRef(fetchFile);
  const currentFilePathRef = useRef(currentFilePath);
  const isPreviewableMarkupFileSelected = isPreviewableMarkupFile(filePath);

  useEffect(() => {
    onContentLoadRef.current = onContentLoad;
  }, [onContentLoad]);

  useEffect(() => {
    fetchFileRef.current = fetchFile;
  }, [fetchFile]);

  useEffect(() => {
    currentFilePathRef.current = currentFilePath;
  }, [currentFilePath]);

  useEffect(() => {
    if (!isPreviewableMarkupFileSelected || !onToggleMarkdownPreview) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        onToggleMarkdownPreview();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPreviewableMarkupFileSelected, onToggleMarkdownPreview]);

  useEffect(() => {
    const requestId = ++activeRequestId.current;
    const isStaleRequest = () => activeRequestId.current !== requestId;

    const loadFileContent = async () => {
      if (!filePath) {
        setContent('');
        setError(null);
        setCurrentFilePath('');
        setIsLoading(false);
        return;
      }

      debugLog('[explorar:file-load] start', {
        requestId,
        filePath,
        currentFilePath: currentFilePathRef.current,
        cached: loadedFilesCache.current.has(filePath),
      });

      if (loadedFilesCache.current.has(filePath)) {
        const cachedResult = loadedFilesCache.current.get(filePath);
        const cachedContent = cachedResult?.content || '';
        if (isStaleRequest()) {
          debugLog('[explorar:file-load] stale-cache-hit', { requestId, filePath });
          return;
        }
        debugLog('[explorar:file-load] cache-hit', {
          requestId,
          filePath,
          contentLength: cachedContent.length,
        });
        setContent(cachedContent);
        setCurrentFilePath(filePath);
        setError(null);
        setIsLoading(false);
        if (onContentLoadRef.current) {
          onContentLoadRef.current(cachedContent);
        }
        return;
      }

      setError(null);
      setIsLoading(true);

      try {
        const fileResult = await (fetchFileRef.current
          ? fetchFileRef.current(filePath)
          : fetchFromGitHub(filePath));
        if (isStaleRequest()) {
          debugLog('[explorar:file-load] stale-success', {
            requestId,
            filePath,
            contentLength: fileResult.content.length,
          });
          return;
        }
        debugLog('[explorar:file-load] success', {
          requestId,
          filePath,
          contentLength: fileResult.content.length,
          preview: fileResult.content.slice(0, 80),
        });
        setContent(fileResult.content);
        setCurrentFilePath(filePath);
        loadedFilesCache.current.set(filePath, fileResult);

        if (onContentLoadRef.current) {
          onContentLoadRef.current(fileResult.content);
        }
      } catch (err) {
        if (isStaleRequest()) {
          debugLog('[explorar:file-load] stale-error', { requestId, filePath });
          return;
        }
        const errorMessage = err instanceof Error ? err.message : 'Failed to load file';
        debugLog('[explorar:file-load] error', {
          requestId,
          filePath,
          error: errorMessage,
        });
        setError(errorMessage);
        setContent('');
        setCurrentFilePath('');
      } finally {
        if (!isStaleRequest()) {
          debugLog('[explorar:file-load] settled', {
            requestId,
            filePath,
            isLoading: false,
          });
          setIsLoading(false);
        }
      }
    };

    void loadFileContent();
  }, [filePath]);

  if (error) {
    return (
      <div className="vscode-editor">
        <div className="vscode-loading">
          <div>⚠️ Failed to load file</div>
          <div style={{ fontSize: '12px', marginTop: '8px' }}>{error}</div>
          <div style={{ fontSize: '11px', marginTop: '4px', opacity: 0.7 }}>File: {filePath}</div>
        </div>
      </div>
    );
  }

  if (isPreviewableMarkupFileSelected && markdownViewMode === 'preview') {
    return (
      <MarkdownPreview
        filePath={filePath}
        content={content}
        isLoading={isLoading}
        onOpenFile={onOpenFile}
      />
    );
  }

  return (
    <MonacoCodeEditor
      filePath={filePath}
      content={content}
      contentFilePath={currentFilePath}
      isLoading={isLoading}
      scrollToLine={scrollToLine}
      searchPattern={searchPattern}
      navigationNonce={navigationNonce}
      onCursorChange={onCursorChange}
      onOpenFile={onOpenFile}
      fetchFile={fetchFile}
      workspaceFilePaths={workspaceFilePaths}
      workspaceId={workspaceId}
      codeIndex={codeIndex}
      editorTheme={editorTheme}
    />
  );
};

export default CodeEditorContainer;
