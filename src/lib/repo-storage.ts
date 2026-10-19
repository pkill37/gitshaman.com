// Repository storage utilities using IndexedDB
// Provides storage for GitHub-downloaded repositories
// Falls back gracefully if IndexedDB is not available

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

const DB_NAME = 'explorar-repo-storage';
const DB_VERSION = 4; // Increment version to ensure tree structure store exists
const FILES_STORE = 'files';
const METADATA_STORE = 'metadata';
const DIRECTORY_STORE = 'directories'; // Store directory listings for lazy loading
const TREE_STRUCTURE_STORE = 'treeStructure'; // Store complete tree structure

let db: IDBDatabase | null = null;
let initPromise: Promise<void> | null = null;

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

function getFromStore<T>(
  database: IDBDatabase,
  storeName: string,
  key: IDBValidKey
): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    const transaction = database.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(key);

    request.onsuccess = () => {
      transaction.oncomplete = () => resolve((request.result as T | undefined) ?? null);
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  });
}

function putInStore(
  database: IDBDatabase,
  storeName: string,
  value: unknown,
  onComplete?: () => void
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(value);

    request.onsuccess = () => {
      transaction.oncomplete = () => {
        onComplete?.();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  });
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
 * Get metadata key for a repository
 */
function getMetadataKey(source: 'github' | 'uploaded', identifier: string): string {
  return `${source}:${identifier}`;
}

function visitRepositoryRecords(
  index: IDBIndex,
  source: RepositoryMetadata['source'],
  identifier: string,
  visit: (cursor: IDBCursorWithValue) => void
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = index.openCursor(IDBKeyRange.only(identifier));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      if (cursor.value.source === source) visit(cursor);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

function includeRepositoryBranch(metadata: RepositoryMetadata | null, branch: string): string[] {
  const branches = metadata ? [...metadata.branches] : [];
  if (!branches.includes(branch)) branches.push(branch);
  return branches;
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
    const metadata = await getFromStore<RepositoryMetadata>(database, METADATA_STORE, metadataKey);

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

    await visitRepositoryRecords(index, source, identifier, (cursor) => {
      branches.add(cursor.value.branch);
    });

    // Also check tree structure store for branches
    if (database.objectStoreNames.contains(TREE_STRUCTURE_STORE)) {
      const treeTransaction = database.transaction([TREE_STRUCTURE_STORE], 'readonly');
      const treeStore = treeTransaction.objectStore(TREE_STRUCTURE_STORE);
      const treeIndex = treeStore.index('identifier');

      await visitRepositoryRecords(treeIndex, source, identifier, (cursor) => {
        branches.add(cursor.value.branch);
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

  await putInStore(database, DIRECTORY_STORE, {
    key,
    source,
    identifier,
    branch,
    path,
    entries,
    lastModified: Date.now(),
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

    const result = await getFromStore<{ entries: FileEntry[] }>(database, DIRECTORY_STORE, key);
    return result?.entries ?? null;
  } catch (error) {
    console.warn('Failed to get directory metadata:', error);
    return null;
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
  const metadataKey = getMetadataKey(source, identifier);

  try {
    const database = await ensureDB();

    // Get existing metadata
    const metadata = await getFromStore<RepositoryMetadata>(database, METADATA_STORE, metadataKey);

    const branches = includeRepositoryBranch(metadata, branch);

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

    await putInStore(database, METADATA_STORE, metadataToStore, () => {
      console.log('[Repo Storage] Repository metadata stored successfully:', {
        source,
        identifier,
        branch,
      });
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

    return visitRepositoryRecords(index, source, identifier, (cursor) => {
      totalSize += cursor.value.size || 0;
    }).then(() => totalSize);
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
    await visitRepositoryRecords(index, source, identifier, (cursor) => {
      cursor.delete();
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
