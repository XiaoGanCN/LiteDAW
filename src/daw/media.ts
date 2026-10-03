/* ============================================================================
   LiteDAW · MEDIA STORE
   Decoded audio lives in memory, but the *original file* is persisted here so a
   reload can rebuild every clip's buffer under the same id. Without this the
   project JSON restored fine while every clip came back unlinked, which read as
   "media unlink if refreshed".

   Only the source blob is stored — never the decoded PCM — so the cost is the
   file the user actually dropped in, and the decode path is identical on the
   way back in.
   ========================================================================= */

const DB_NAME = 'litedaw-media';
const STORE = 'media';

export interface StoredMedia {
  id: string;
  name: string;
  blob: Blob;
  type: string;
  bytes: number;
  addedAt: number;
}

/** Above this, we stop persisting and say so rather than filling the origin. */
export const MEDIA_BUDGET_BYTES = 512 * 1024 * 1024;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function putMedia(rec: Omit<StoredMedia, 'addedAt' | 'bytes'> & { bytes?: number }): Promise<boolean> {
  try {
    const existing = await totalBytes();
    const size = rec.bytes ?? rec.blob.size;
    if (existing + size > MEDIA_BUDGET_BYTES) return false;
    await tx('readwrite', (s) =>
      s.put({ ...rec, bytes: size, addedAt: Date.now() } satisfies StoredMedia),
    );
    return true;
  } catch {
    return false;
  }
}

export async function allMedia(): Promise<StoredMedia[]> {
  try {
    return (await tx<StoredMedia[]>('readonly', (s) => s.getAll() as IDBRequest<StoredMedia[]>)) ?? [];
  } catch {
    return [];
  }
}

export async function deleteMedia(id: string): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(id));
  } catch {
    /* nothing to remove */
  }
}

export async function clearMedia(): Promise<void> {
  try {
    await tx('readwrite', (s) => s.clear());
  } catch {
    /* already empty */
  }
}

export async function totalBytes(): Promise<number> {
  const rows = await allMedia();
  return rows.reduce((n, r) => n + (r.bytes ?? r.blob.size), 0);
}
