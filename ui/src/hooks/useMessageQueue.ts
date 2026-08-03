import { useCallback, useEffect, useRef, useState } from "react";

const QUEUE_STORAGE_PREFIX = "cursor-bridge-message-queue-v1:";

export type QueuedImage = {
  id: string;
  name: string;
  dataUrl: string;
  bytes: number;
};

export type QueuedMessage = {
  id: string;
  prompt: string;
  includeDevLogs: boolean;
  images: QueuedImage[];
  createdAt: number;
};

function storageKey(draftKey: string) {
  return `${QUEUE_STORAGE_PREFIX}${draftKey}`;
}

function newDraftKeyFor(draftKey: string): string | null {
  const sep = draftKey.indexOf(":");
  if (sep < 0) return null;
  const project = draftKey.slice(0, sep);
  const agent = draftKey.slice(sep + 1);
  if (!project || agent === "new") return null;
  return `${project}:new`;
}

function isValidImage(img: unknown): img is QueuedImage {
  if (!img || typeof img !== "object") return false;
  const o = img as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.dataUrl === "string" &&
    typeof o.bytes === "number"
  );
}

function isValidMessage(item: unknown): item is QueuedMessage {
  if (!item || typeof item !== "object") return false;
  const o = item as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.prompt === "string" &&
    typeof o.includeDevLogs === "boolean" &&
    Array.isArray(o.images) &&
    o.images.every(isValidImage) &&
    typeof o.createdAt === "number"
  );
}

function loadQueue(draftKey: string): QueuedMessage[] {
  try {
    const raw = localStorage.getItem(storageKey(draftKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidMessage);
  } catch {
    return [];
  }
}

function saveQueue(draftKey: string, queue: QueuedMessage[]) {
  const key = storageKey(draftKey);
  try {
    if (queue.length === 0) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(queue));
  } catch {
    try {
      const slim = queue.map((m) => ({ ...m, images: [] as QueuedImage[] }));
      localStorage.setItem(key, JSON.stringify(slim));
    } catch {
      // ignore
    }
  }
}

function loadQueueWithMigration(draftKey: string): QueuedMessage[] {
  const queue = loadQueue(draftKey);
  if (queue.length > 0) return queue;

  const fromNewKey = newDraftKeyFor(draftKey);
  if (!fromNewKey) return queue;

  const fromNew = loadQueue(fromNewKey);
  if (fromNew.length === 0) return queue;

  saveQueue(draftKey, fromNew);
  saveQueue(fromNewKey, []);
  return fromNew;
}

function nextId() {
  return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function useMessageQueue(draftKey: string) {
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const queueRef = useRef<QueuedMessage[]>([]);

  useEffect(() => {
    const next = loadQueueWithMigration(draftKey);
    queueRef.current = next;
    setQueue(next);
    setHydratedKey(draftKey);
  }, [draftKey]);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    if (hydratedKey !== draftKey) return;
    saveQueue(draftKey, queue);
  }, [draftKey, hydratedKey, queue]);

  const enqueue = useCallback(
    (message: Omit<QueuedMessage, "id" | "createdAt">) => {
      const item: QueuedMessage = {
        ...message,
        id: nextId(),
        createdAt: Date.now(),
      };
      setQueue((prev) => {
        const next = [...prev, item];
        queueRef.current = next;
        return next;
      });
      return item;
    },
    [],
  );

  const remove = useCallback((id: string) => {
    setQueue((prev) => {
      const next = prev.filter((m) => m.id !== id);
      queueRef.current = next;
      return next;
    });
  }, []);

  const update = useCallback(
    (id: string, patch: Partial<Omit<QueuedMessage, "id">>) => {
      setQueue((prev) => {
        const next = prev.map((m) => (m.id === id ? { ...m, ...patch } : m));
        queueRef.current = next;
        return next;
      });
    },
    [],
  );

  const take = useCallback((id: string): QueuedMessage | null => {
    const found = queueRef.current.find((m) => m.id === id) ?? null;
    if (!found) return null;
    setQueue((prev) => {
      const next = prev.filter((m) => m.id !== id);
      queueRef.current = next;
      return next;
    });
    return found;
  }, []);

  const shift = useCallback((): QueuedMessage | null => {
    const first = queueRef.current[0] ?? null;
    if (!first) return null;
    setQueue((prev) => {
      const next = prev.slice(1);
      queueRef.current = next;
      return next;
    });
    return first;
  }, []);

  const unshift = useCallback((item: QueuedMessage) => {
    setQueue((prev) => {
      const next = [item, ...prev.filter((m) => m.id !== item.id)];
      queueRef.current = next;
      return next;
    });
  }, []);

  return {
    queue,
    peek: queue[0] ?? null,
    enqueue,
    remove,
    update,
    take,
    shift,
    unshift,
  };
}
