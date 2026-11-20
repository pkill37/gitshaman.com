import { debugLog } from './browser-debug';

export type FileFetchSource =
  'r2-bucket' | 'static-path' | 'github-api' | 'local-filesystem' | 'unknown';

export interface FileFetchDebugInfo {
  enabled: boolean;
  source: FileFetchSource;
  requestUrl: string;
  responseUrl?: string;
  responseStatus?: number;
  cacheStatus?: string | null;
  r2Key?: string | null;
  contentLength?: string | null;
}

export interface FileFetchResult {
  content: string;
  blob?: Blob;
  debugInfo?: FileFetchDebugInfo;
}

export const isPdfFile = (path: string): boolean => /\.pdf$/i.test(path);

export async function readRepositoryFileResponse(
  response: Response,
  path: string
): Promise<FileFetchResult> {
  if (isPdfFile(path)) {
    const bytes = await response.arrayBuffer();
    return { content: '', blob: new Blob([bytes], { type: 'application/pdf' }) };
  }
  return { content: await response.text() };
}

export function logFileFetchDebugInfo(debugInfo: FileFetchDebugInfo | undefined): void {
  if (!debugInfo?.enabled) {
    return;
  }

  debugLog('[explorar:file-fetch]', debugInfo);
}
