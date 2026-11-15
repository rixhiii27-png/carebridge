import type { Firestore } from 'firebase-admin/firestore';

type RecordData = Record<string, unknown>;

function isServerTimestampSentinel(val: unknown): boolean {
  if (!val || typeof val !== 'object') return false;
  const ctorName = (val as { constructor?: { name?: string } }).constructor?.name ?? '';
  return ctorName.includes('ServerTimestamp') || ctorName.includes('FieldValue');
}

function resolveSentinels(obj: unknown, nowMs = Date.now()): unknown {
  if (isServerTimestampSentinel(obj)) {
    return {
      toMillis: () => nowMs,
      toDate: () => new Date(nowMs),
    };
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => resolveSentinels(item, nowMs));
  }
  if (obj && typeof obj === 'object') {
    const out: RecordData = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) {
        out[k] = resolveSentinels(v, nowMs);
      }
    }
    return out;
  }
  return obj;
}

export class InMemoryFirestore {
  readonly store = new Map<string, RecordData>();

  doc(docPath: string) {
    const cleanPath = docPath.replace(/^\/+/, '');
    const id = cleanPath.split('/').pop()!;
    const self = this;

    return {
      id,
      path: cleanPath,
      async get() {
        const data = self.store.get(cleanPath);
        return {
          id,
          exists: data !== undefined,
          ref: self.doc(cleanPath),
          data: () => (data ? { ...data } : undefined),
        };
      },
      async set(data: RecordData, opts?: { merge?: boolean }) {
        const resolved = resolveSentinels(data) as RecordData;
        if (opts?.merge && self.store.has(cleanPath)) {
          self.store.set(cleanPath, { ...self.store.get(cleanPath)!, ...resolved });
        } else {
          self.store.set(cleanPath, resolved);
        }
      },
      async update(data: RecordData) {
        if (!self.store.has(cleanPath)) {
          throw new Error(`Document not found at ${cleanPath}`);
        }
        const resolved = resolveSentinels(data) as RecordData;
        self.store.set(cleanPath, { ...self.store.get(cleanPath)!, ...resolved });
      },
      async delete() {
        self.store.delete(cleanPath);
      },
    };
  }

  collection(colPath: string) {
    const cleanCol = colPath.replace(/^\/+|\/+$/g, '');
    const self = this;

    const buildQuery = (
      filters: Array<{ field: string; op: string; value: unknown }> = [],
      maxResults?: number,
    ) => ({
      where(field: string, op: string, value: unknown) {
        return buildQuery([...filters, { field, op, value }], maxResults);
      },
      limit(n: number) {
        return buildQuery(filters, n);
      },
      async get() {
        const depth = cleanCol.split('/').length;
        const docs: Array<{ id: string; ref: ReturnType<InMemoryFirestore['doc']>; data: () => RecordData }> = [];

        for (const [docPath, raw] of self.store.entries()) {
          const parts = docPath.split('/');
          if (parts.length !== depth + 1) continue;
          const parent = parts.slice(0, depth).join('/');
          if (parent !== cleanCol) continue;

          const matches = filters.every((f) => {
            const val = raw[f.field];
            if (f.op === '==') return val === f.value;
            if (f.op === 'array-contains') return Array.isArray(val) && val.includes(f.value);
            return false;
          });
          if (!matches) continue;

          const id = parts[parts.length - 1];
          docs.push({
            id,
            ref: self.doc(docPath),
            data: () => ({ ...raw }),
          });
          if (maxResults !== undefined && docs.length >= maxResults) break;
        }

        return {
          empty: docs.length === 0,
          size: docs.length,
          docs,
        };
      },
    });

    return buildQuery();
  }

  batch() {
    const ops: Array<() => Promise<void>> = [];
    return {
      set: (ref: ReturnType<InMemoryFirestore['doc']>, data: RecordData, opts?: { merge?: boolean }) => {
        ops.push(() => ref.set(data, opts));
      },
      update: (ref: ReturnType<InMemoryFirestore['doc']>, data: RecordData) => {
        ops.push(() => ref.update(data));
      },
      delete: (ref: ReturnType<InMemoryFirestore['doc']>) => {
        ops.push(() => ref.delete());
      },
      commit: async () => {
        for (const op of ops) {
          await op();
        }
      },
    };
  }

  async runTransaction<T>(
    fn: (tx: {
      get: (ref: ReturnType<InMemoryFirestore['doc']>) => ReturnType<ReturnType<InMemoryFirestore['doc']>['get']>;
      set: (ref: ReturnType<InMemoryFirestore['doc']>, data: RecordData, opts?: { merge?: boolean }) => void;
      update: (ref: ReturnType<InMemoryFirestore['doc']>, data: RecordData) => void;
      delete: (ref: ReturnType<InMemoryFirestore['doc']>) => void;
    }) => Promise<T>,
  ): Promise<T> {
    const batch = this.batch();
    const tx = {
      get: (ref: ReturnType<InMemoryFirestore['doc']>) => ref.get(),
      set: (ref: ReturnType<InMemoryFirestore['doc']>, data: RecordData, opts?: { merge?: boolean }) =>
        batch.set(ref, data, opts),
      update: (ref: ReturnType<InMemoryFirestore['doc']>, data: RecordData) => batch.update(ref, data),
      delete: (ref: ReturnType<InMemoryFirestore['doc']>) => batch.delete(ref),
    };
    const result = await fn(tx);
    await batch.commit();
    return result;
  }

  asFirestore(): Firestore {
    return this as unknown as Firestore;
  }
}
