// Repository storage utilities using IndexedDB
// Provides storage for GitHub-downloaded repositories
// Falls back gracefully if IndexedDB is not available

import type { FileNode } from '@/types';

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
}

export interface RepositoryMetadata {
  source: 'github' | 'uploaded'; // 'uploaded' kept for backward compatibility
  identifier: string; // owner~repo for GitHub repositories
  branches: string[];
  totalSize: number;
  lastAccessed: number;
  displayName: string; // Human-readable name
}

export interface StorageUsage {
  totalSize: number;
  repositories: RepositoryMetadata[];
  availableSpace?: number; // If available from browser
}

export interface TreeStructure {
  key: string;
  source: 'github' | 'uploaded';
  identifier: string;
  branch: string;
  tree: FileNode[]; // Complete tree structure
  createdAt: number;
}

const DB_NAME = 'explorar-repo-storage';
const DB_VERSION = 4; // Increment version to ensure tree structure store exists
const FILES_STORE = 'files';
const METADATA_STORE = 'metadata';
const DIRECTORY_STORE = 'directories'; // Store directory listings for lazy loading
const TREE_STRUCTURE_STORE = 'treeStructure'; // Store complete tree structure

let db: IDBDatabase | null = null;
let initPromise: Promise<void> | null = null;

// Debounce metadata updates to avoid transaction conflicts during bulk downloads
const metadataUpdateQueue = new Map<string, ReturnType<typeof setTimeout>>();
const METADATA_UPDATE_DELAY = 1000; // Update metadata at most once per second per repository

function resetDatabaseConnection(database?: IDBDatabase): void {
  if (!database || database === db) {
    db = null;
    initPromise = null;
  }
}

function isClosedDatabaseError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    error.name === 'InvalidStateError' &&
    error.message.includes('closed database')
  );
}

function attachDatabaseLifecycleHandlers(database: IDBDatabase): void {
  database.onversionchange = () => {
    database.close();
    resetDatabaseConnection(database);
  };

  database.addEventListener('close', () => {
    resetDatabaseConnection(database);
  });
}

async function withOpenDatabase<T>(operation: (database: IDBDatabase) => Promise<T>): Promise<T> {
  const database = await ensureDB();

  try {
    return await operation(database);
  } catch (error) {
    if (!isClosedDatabaseError(error)) {
      throw error;
    }

    resetDatabaseConnection(database);
    return operation(await ensureDB());
  }
}

/**
 * Initialize IndexedDB database
 */
export async function initStorage(): Promise<void> {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    if (typeof window === 'undefined') {
      throw new Error('Storage not available in this environment');
    }

    // Check if IndexedDB is available (works in all modern browsers including Firefox)
    if (!('indexedDB' in window)) {
      console.warn('IndexedDB not supported, storage will not persist');
      throw new Error('IndexedDB not supported in this browser');
    }

    try {
      db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
          reject(new Error(`Failed to open database: ${request.error?.message}`));
        };

        request.onsuccess = () => {
          attachDatabaseLifecycleHandlers(request.result);
          resolve(request.result);
        };

        request.onupgradeneeded = (event) => {
          const database = (event.target as IDBOpenDBRequest).result;

          // Create files store if it doesn't exist
          if (!database.objectStoreNames.contains(FILES_STORE)) {
            const filesStore = database.createObjectStore(FILES_STORE, { keyPath: 'key' });
            filesStore.createIndex('source', 'source', { unique: false });
            filesStore.createIndex('identifier', 'identifier', { unique: false });
            filesStore.createIndex('branch', 'branch', { unique: false });
          }

          // Create metadata store if it doesn't exist
          if (!database.objectStoreNames.contains(METADATA_STORE)) {
            const metadataStore = database.createObjectStore(METADATA_STORE, {
              keyPath: 'id',
            });
            metadataStore.createIndex('source', 'source', { unique: false });
            metadataStore.createIndex('lastAccessed', 'lastAccessed', { unique: false });
          }

          // Create directory metadata store for lazy loading
          if (!database.objectStoreNames.contains(DIRECTORY_STORE)) {
            const directoryStore = database.createObjectStore(DIRECTORY_STORE, {
              keyPath: 'key',
            });
            directoryStore.createIndex('source', 'source', { unique: false });
            directoryStore.createIndex('identifier', 'identifier', { unique: false });
            directoryStore.createIndex('branch', 'branch', { unique: false });
            directoryStore.createIndex('path', 'path', { unique: false });
          }

          // Create tree structure store for complete repository tree
          if (!database.objectStoreNames.contains(TREE_STRUCTURE_STORE)) {
            const treeStore = database.createObjectStore(TREE_STRUCTURE_STORE, {
              keyPath: 'key',
            });
            treeStore.createIndex('source', 'source', { unique: false });
            treeStore.createIndex('identifier', 'identifier', { unique: false });
            treeStore.createIndex('branch', 'branch', { unique: false });
          }
        };
      });

      console.log('IndexedDB initialized successfully');
    } catch (error) {
      console.error('Failed to initialize IndexedDB:', error);
      throw new Error('Failed to initialize storage');
    }
  })();

  return initPromise;
}

/**
 * Ensure database is initialized
 */
async function ensureDB(): Promise<IDBDatabase> {
  if (!db) {
    await initStorage();
  }
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

/**
 * Generate storage key for a file
 */
function getFileKey(
  source: 'github' | 'uploaded',
  identifier: string,
  branch: string,
  filePath: string
): string {
  return `repos/${source}/${identifier}/${branch}/${filePath}`;
}

/**
 * Get metadata key for a repository
 */
function getMetadataKey(source: 'github' | 'uploaded', identifier: string): string {
  return `${source}:${identifier}`;
}

/**
 * Get list of available branches for a repository
 * Checks both files store and metadata store for branches
 */
export async function getAvailableBranches(
  source: 'github' | 'uploaded',
  identifier: string
): Promise<string[]> {
  try {
    console.log('[Repo Storage] Getting available branches:', { source, identifier });
    const database = await ensureDB();
    const branches = new Set<string>();

    // Check metadata store first (more reliable)
    const metadataKey = getMetadataKey(source, identifier);
    const metadata = await new Promise<RepositoryMetadata | null>((resolve, reject) => {
      const transaction = database.transaction([METADATA_STORE], 'readonly');
      const metadataStore = transaction.objectStore(METADATA_STORE);
      const request = metadataStore.get(metadataKey);

      request.onsuccess = () => {
        transaction.oncomplete = () => resolve(request.result || null);
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });

    if (metadata && metadata.branches) {
      console.log('[Repo Storage] Found branches in metadata:', {
        source,
        identifier,
        branches: metadata.branches,
      });
      metadata.branches.forEach((b) => branches.add(b));
    }

    // Also check files store for any branches that might have files
    const transaction = database.transaction([FILES_STORE], 'readonly');
    const store = transaction.objectStore(FILES_STORE);
    const index = store.index('identifier');

    await new Promise<void>((resolve, reject) => {
      const request = index.openCursor(IDBKeyRange.only(identifier));

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const record = cursor.value;
          if (record.source === source) {
            branches.add(record.branch);
          }
          cursor.continue();
        } else {
          resolve();
        }
      };

      request.onerror = () => reject(request.error);
    });

    // Also check tree structure store for branches
    if (database.objectStoreNames.contains(TREE_STRUCTURE_STORE)) {
      const treeTransaction = database.transaction([TREE_STRUCTURE_STORE], 'readonly');
      const treeStore = treeTransaction.objectStore(TREE_STRUCTURE_STORE);
      const treeIndex = treeStore.index('identifier');

      await new Promise<void>((resolve, reject) => {
        const request = treeIndex.openCursor(IDBKeyRange.only(identifier));

        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            const record = cursor.value;
            if (record.source === source) {
              branches.add(record.branch);
            }
            cursor.continue();
          } else {
            resolve();
          }
        };

        request.onerror = () => reject(request.error);
      });
    }

    const result = Array.from(branches).sort();
    console.log('[Repo Storage] All available branches:', {
      source,
      identifier,
      branches: result,
      count: result.length,
    });
    return result;
  } catch (error) {
    console.error('[Repo Storage] Error getting available branches:', {
      source,
      identifier,
      error,
    });
    return [];
  }
}

/**
 * Store directory metadata (file listings) for lazy loading
 */
export async function storeDirectoryMetadata(
  source: 'github' | 'uploaded',
  identifier: string,
  branch: string,
  path: string,
  entries: FileEntry[]
): Promise<void> {
  const database = await ensureDB();

  // Check if DIRECTORY_STORE exists (safety check for databases created before this store was added)
  if (!database.objectStoreNames.contains(DIRECTORY_STORE)) {
    throw new Error('DIRECTORY_STORE not found in database - database needs upgrade');
  }

  const key = `repos/${source}/${identifier}/${branch}/dir/${path}`;

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([DIRECTORY_STORE], 'readwrite');
    const directoryStore = transaction.objectStore(DIRECTORY_STORE);

    const request = directoryStore.put({
      key,
      source,
      identifier,
      branch,
      path,
      entries,
      lastModified: Date.now(),
    });

    request.onsuccess = () => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get directory metadata (file listings) from storage
 */
export async function getDirectoryMetadata(
  source: 'github' | 'uploaded',
  identifier: string,
  branch: string,
  path: string
): Promise<FileEntry[] | null> {
  try {
    const database = await ensureDB();

    // Check if DIRECTORY_STORE exists (safety check for databases created before this store was added)
    if (!database.objectStoreNames.contains(DIRECTORY_STORE)) {
      console.warn('DIRECTORY_STORE not found in database - database may need upgrade');
      return null;
    }

    const key = `repos/${source}/${identifier}/${branch}/dir/${path}`;

    return new Promise<FileEntry[] | null>((resolve, reject) => {
      const transaction = database.transaction([DIRECTORY_STORE], 'readonly');
      const directoryStore = transaction.objectStore(DIRECTORY_STORE);
      const request = directoryStore.get(key);

      request.onsuccess = () => {
        transaction.oncomplete = () => {
          const result = request.result;
          resolve(result ? result.entries : null);
        };
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn('Failed to get directory metadata:', error);
    return null;
  }
}

/**
 * Check if a file is available locally (downloaded)
 */
export async function isFileAvailable(
  source: 'github' | 'uploaded',
  identifier: string,
  branch: string,
  path: string
): Promise<boolean> {
  try {
    const database = await ensureDB();
    const key = `repos/${source}/${identifier}/${branch}/${path}`;

    return new Promise<boolean>((resolve, reject) => {
      const transaction = database.transaction([FILES_STORE], 'readonly');
      const filesStore = transaction.objectStore(FILES_STORE);
      const request = filesStore.get(key);

      request.onsuccess = () => {
        transaction.oncomplete = () => {
          resolve(request.result !== undefined);
        };
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return false;
  }
}

/**
 * Store file in storage
 */
export async function storeFileInStorage(
  source: 'github' | 'uploaded',
  identifier: string,
  branch: string,
  filePath: string,
  content: string | ArrayBuffer
): Promise<void> {
  try {
    const database = await ensureDB();
    const key = getFileKey(source, identifier, branch, filePath);

    // Convert content to ArrayBuffer for consistent storage
    let contentBuffer: ArrayBuffer;
    if (typeof content === 'string') {
      const encoder = new TextEncoder();
      contentBuffer = encoder.encode(content).buffer;
    } else {
      contentBuffer = content;
    }

    const size = contentBuffer.byteLength;

    // Store file in its own transaction
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([FILES_STORE], 'readwrite');
      const filesStore = transaction.objectStore(FILES_STORE);

      const request = filesStore.put({
        key,
        source,
        identifier,
        branch,
        filePath,
        content: contentBuffer,
        size,
        lastModified: Date.now(),
      });

      request.onsuccess = () => {
        // Wait for transaction to complete
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });

    // Update metadata with debouncing to avoid transaction conflicts during bulk downloads
    scheduleMetadataUpdate(source, identifier, branch);
  } catch (error) {
    console.error('Failed to store file in storage:', error);
    throw new Error(`Failed to store file: ${filePath}`);
  }
}

/**
 * Schedule a debounced metadata update to avoid transaction conflicts
 */
function scheduleMetadataUpdate(
  source: 'github' | 'uploaded',
  identifier: string,
  branch: string
): void {
  const metadataKey = getMetadataKey(source, identifier);

  // Clear existing timeout if any
  if (metadataUpdateQueue.has(metadataKey)) {
    clearTimeout(metadataUpdateQueue.get(metadataKey)!);
  }

  // Schedule new update
  const timeout = setTimeout(async () => {
    metadataUpdateQueue.delete(metadataKey);
    try {
      await updateRepositoryMetadata(source, identifier, branch);
    } catch (error) {
      console.error('Failed to update repository metadata:', {
        source,
        identifier,
        branch,
        error: error instanceof Error ? error.message : String(error),
      });
      // Metadata update failure is non-critical - file storage still succeeded
    }
  }, METADATA_UPDATE_DELAY);

  metadataUpdateQueue.set(metadataKey, timeout);
}

/**
 * Update repository metadata (called separately to avoid transaction conflicts)
 */
async function updateRepositoryMetadata(
  source: 'github' | 'uploaded',
  identifier: string,
  branch: string
): Promise<void> {
  try {
    const database = await ensureDB();
    const metadataKey = getMetadataKey(source, identifier);

    // Get existing metadata in a separate transaction
    const metadata = await new Promise<RepositoryMetadata | null>((resolve, reject) => {
      const transaction = database.transaction([METADATA_STORE], 'readonly');
      const metadataStore = transaction.objectStore(METADATA_STORE);
      const request = metadataStore.get(metadataKey);

      request.onsuccess = () => {
        transaction.oncomplete = () => resolve(request.result || null);
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });

    const branches = metadata ? [...metadata.branches] : [];
    if (!branches.includes(branch)) {
      branches.push(branch);
    }

    // Create display name
    let displayName = identifier;
    if (source === 'github') {
      displayName = identifier.replace('~', '/');
    }

    // Update metadata in its own transaction
    // Note: We don't recalculate totalSize on every file write to avoid performance issues
    // The size will be recalculated when needed (e.g., when viewing storage usage)
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([METADATA_STORE], 'readwrite');
      const metadataStore = transaction.objectStore(METADATA_STORE);

      const request = metadataStore.put({
        id: metadataKey,
        source,
        identifier,
        branches: branches.sort(),
        totalSize: metadata?.totalSize || 0, // Keep existing size, recalculate when needed
        lastAccessed: Date.now(),
        displayName,
      });

      request.onsuccess = () => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    // Don't throw - metadata update failure shouldn't block file storage
    // Error is logged by caller with more context
    throw error; // Re-throw so caller can log with context
  }
}

/**
 * Force immediate metadata update
 * Call this when root directory metadata is downloaded to ensure metadata is stored
 * Note: We don't calculate total size since we're always lazy loading (size is unknown)
 */
export async function finalizeRepositoryMetadata(
  source: 'github' | 'uploaded',
  identifier: string,
  branch: string
): Promise<void> {
  // Clear any pending debounced updates
  const metadataKey = getMetadataKey(source, identifier);
  if (metadataUpdateQueue.has(metadataKey)) {
    clearTimeout(metadataUpdateQueue.get(metadataKey)!);
    metadataUpdateQueue.delete(metadataKey);
  }

  try {
    const database = await ensureDB();

    // Get existing metadata
    const metadata = await new Promise<RepositoryMetadata | null>((resolve, reject) => {
      const transaction = database.transaction([METADATA_STORE], 'readonly');
      const metadataStore = transaction.objectStore(METADATA_STORE);
      const request = metadataStore.get(metadataKey);

      request.onsuccess = () => {
        transaction.oncomplete = () => resolve(request.result || null);
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });

    const branches = metadata ? [...metadata.branches] : [];
    if (!branches.includes(branch)) {
      branches.push(branch);
    }

    // Calculate size of currently downloaded files only (not total repository size)
    const downloadedSize = await calculateRepositorySize(source, identifier);

    // Create display name
    let displayName = identifier;
    if (source === 'github') {
      displayName = identifier.replace('~', '/');
    }

    // Update metadata (size is only for downloaded files, not total)
    const metadataToStore = {
      id: metadataKey,
      source,
      identifier,
      branches: branches.sort(),
      totalSize: downloadedSize, // Only size of downloaded files
      lastAccessed: Date.now(),
      displayName,
    };
    console.log('[Repo Storage] Storing repository metadata:', {
      source,
      identifier,
      branch,
      metadata: metadataToStore,
    });

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([METADATA_STORE], 'readwrite');
      const metadataStore = transaction.objectStore(METADATA_STORE);

      const request = metadataStore.put(metadataToStore);

      request.onsuccess = () => {
        transaction.oncomplete = () => {
          console.log('[Repo Storage] Repository metadata stored successfully:', {
            source,
            identifier,
            branch,
          });
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[Repo Storage] Failed to finalize repository metadata:', {
      source,
      identifier,
      branch,
      error,
    });
    throw error;
  }
}

/**
 * Calculate repository size
 */
async function calculateRepositorySize(
  source: 'github' | 'uploaded',
  identifier: string
): Promise<number> {
  try {
    const database = await ensureDB();
    const transaction = database.transaction([FILES_STORE], 'readonly');
    const store = transaction.objectStore(FILES_STORE);
    const index = store.index('identifier');

    let totalSize = 0;

    return new Promise<number>((resolve, reject) => {
      const request = index.openCursor(IDBKeyRange.only(identifier));

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const record = cursor.value;
          if (record.source === source) {
            totalSize += record.size || 0;
          }
          cursor.continue();
        } else {
          resolve(totalSize);
        }
      };

      request.onerror = () => reject(request.error);
    });
  } catch {
    return 0;
  }
}

/**
 * Get storage usage information
 */
export async function getStorageUsage(): Promise<StorageUsage> {
  try {
    return await withOpenDatabase((database) => {
      const transaction = database.transaction([METADATA_STORE], 'readonly');
      const store = transaction.objectStore(METADATA_STORE);

      const repositories: RepositoryMetadata[] = [];
      let totalSize = 0;

      return new Promise<StorageUsage>((resolve, reject) => {
        const request = store.openCursor();

        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            const metadata = cursor.value as RepositoryMetadata;
            repositories.push(metadata);
            totalSize += metadata.totalSize;
            cursor.continue();
          } else {
            // Get available space if supported
            let availableSpace: number | undefined;
            if ('storage' in navigator && 'estimate' in navigator.storage) {
              navigator.storage
                .estimate()
                .then((estimate) => {
                  if (estimate.quota && estimate.usage) {
                    availableSpace = estimate.quota - estimate.usage;
                  }
                  resolve({
                    totalSize,
                    repositories: repositories.sort((a, b) => b.lastAccessed - a.lastAccessed),
                    availableSpace,
                  });
                })
                .catch(() => {
                  resolve({
                    totalSize,
                    repositories: repositories.sort((a, b) => b.lastAccessed - a.lastAccessed),
                    availableSpace: undefined,
                  });
                });
            } else {
              resolve({
                totalSize,
                repositories: repositories.sort((a, b) => b.lastAccessed - a.lastAccessed),
                availableSpace: undefined,
              });
            }
          }
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    });
  } catch (error) {
    console.error('Failed to get storage usage:', error);
    return {
      totalSize: 0,
      repositories: [],
      availableSpace: undefined,
    };
  }
}

/**
 * Clear entire repository (all branches)
 */
export async function clearRepository(
  source: 'github' | 'uploaded',
  identifier: string
): Promise<void> {
  try {
    const database = await ensureDB();
    const transaction = database.transaction([FILES_STORE, METADATA_STORE], 'readwrite');
    const filesStore = transaction.objectStore(FILES_STORE);
    const metadataStore = transaction.objectStore(METADATA_STORE);
    const index = filesStore.index('identifier');

    // Delete all files for this repository
    await new Promise<void>((resolve, reject) => {
      const request = index.openCursor(IDBKeyRange.only(identifier));

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const record = cursor.value;
          if (record.source === source) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };

      request.onerror = () => reject(request.error);
    });

    // Delete metadata
    const metadataKey = getMetadataKey(source, identifier);
    await new Promise<void>((resolve, reject) => {
      const request = metadataStore.delete(metadataKey);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    console.log(`Cleared repository: ${source}/${identifier}`);
  } catch (error) {
    console.error('Failed to clear repository:', error);
    throw new Error(`Failed to clear repository: ${source}/${identifier}`);
  }
}

/**
 * Check if repository exists (has any branches)
 */
export async function repositoryExists(
  source: 'github' | 'uploaded',
  identifier: string
): Promise<boolean> {
  try {
    console.log('[Repo Storage] Checking repository existence:', { source, identifier });
    const branches = await getAvailableBranches(source, identifier);
    console.log('[Repo Storage] Available branches:', {
      source,
      identifier,
      branches,
      count: branches.length,
    });
    const exists = branches.length > 0;
    console.log('[Repo Storage] Repository exists:', { source, identifier, exists });
    return exists;
  } catch (error) {
    console.error('[Repo Storage] Error checking repository existence:', {
      source,
      identifier,
      error,
    });
    return false;
  }
}

/**
 * Generate repository identifier for GitHub repos
 */
export function getGitHubRepoIdentifier(owner: string, repo: string): string {
  return `${owner}~${repo}`;
}

/**
 * Parse GitHub repository identifier back to owner/repo
 */
export function parseGitHubRepoIdentifier(identifier: string): { owner: string; repo: string } {
  const [owner, repo] = identifier.split('~');
  return { owner, repo };
}

/**
 * Get tree structure key
 */
function getTreeStructureKey(
  source: 'github' | 'uploaded',
  identifier: string,
  branch: string
): string {
  return `tree/${source}/${identifier}/${branch}`;
}

/**
 * Store complete tree structure for a repository branch
 */
export async function storeTreeStructure(
  source: 'github' | 'uploaded',
  identifier: string,
  branch: string,
  tree: FileNode[]
): Promise<void> {
  try {
    console.log('[Repo Storage] Storing tree structure:', {
      source,
      identifier,
      branch,
      treeSize: tree.length,
    });
    const database = await ensureDB();

    // Check if TREE_STRUCTURE_STORE exists
    if (!database.objectStoreNames.contains(TREE_STRUCTURE_STORE)) {
      console.error('[Repo Storage] TREE_STRUCTURE_STORE not found in database');
      throw new Error('TREE_STRUCTURE_STORE not found in database - database needs upgrade');
    }

    const key = getTreeStructureKey(source, identifier, branch);
    console.log('[Repo Storage] Tree structure key:', { key });

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([TREE_STRUCTURE_STORE], 'readwrite');
      const treeStore = transaction.objectStore(TREE_STRUCTURE_STORE);

      const treeData = {
        key,
        source,
        identifier,
        branch,
        tree,
        createdAt: Date.now(),
      };
      console.log('[Repo Storage] Putting tree structure data:', {
        key,
        source,
        identifier,
        branch,
        treeLength: tree.length,
      });

      const request = treeStore.put(treeData);

      request.onsuccess = () => {
        transaction.oncomplete = () => {
          console.log('[Repo Storage] Tree structure stored successfully:', {
            source,
            identifier,
            branch,
          });
          resolve();
        };
        transaction.onerror = () => {
          console.error(
            '[Repo Storage] Transaction error storing tree structure:',
            transaction.error
          );
          reject(transaction.error);
        };
      };
      request.onerror = () => {
        console.error('[Repo Storage] Request error storing tree structure:', request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('[Repo Storage] Failed to store tree structure:', {
      source,
      identifier,
      branch,
      error,
    });
    throw new Error(`Failed to store tree structure: ${source}/${identifier}/${branch}`);
  }
}

/**
 * Get complete tree structure for a repository branch
 */
export async function getTreeStructure(
  source: 'github' | 'uploaded',
  identifier: string,
  branch: string
): Promise<FileNode[] | null> {
  try {
    return await withOpenDatabase((database) => {
      // Check if TREE_STRUCTURE_STORE exists
      if (!database.objectStoreNames.contains(TREE_STRUCTURE_STORE)) {
        console.warn('TREE_STRUCTURE_STORE not found in database - database may need upgrade');
        return Promise.resolve(null);
      }

      const key = getTreeStructureKey(source, identifier, branch);

      return new Promise<FileNode[] | null>((resolve, reject) => {
        const transaction = database.transaction([TREE_STRUCTURE_STORE], 'readonly');
        const treeStore = transaction.objectStore(TREE_STRUCTURE_STORE);
        const request = treeStore.get(key);

        request.onsuccess = () => {
          transaction.oncomplete = () => {
            const result = request.result as TreeStructure | undefined;
            resolve(result ? result.tree : null);
          };
          transaction.onerror = () => reject(transaction.error);
        };
        request.onerror = () => reject(request.error);
      });
    });
  } catch (error) {
    console.warn('Failed to get tree structure:', error);
    return null;
  }
}

/**
 * Check if tree structure exists for a repository branch
 */
export async function hasTreeStructure(
  source: 'github' | 'uploaded',
  identifier: string,
  branch: string
): Promise<boolean> {
  try {
    const tree = await getTreeStructure(source, identifier, branch);
    return tree !== null && tree.length > 0;
  } catch {
    return false;
  }
}
