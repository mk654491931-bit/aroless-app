/**
 * Advanced Caching Strategies
 * Multi-tier caching: Memory -> IndexedDB -> LocalStorage -> Network
 */

import { useEffect, useState } from "react";

/**
 * Cache tiers in order of preference
 */
export enum CacheTier {
  MEMORY = "memory",
  INDEXED_DB = "indexeddb",
  LOCAL_STORAGE = "localstorage",
  SESSION_STORAGE = "sessionstorage",
}

/**
 * Cache entry metadata
 */
interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl?: number; // Time to live in milliseconds
  tier: CacheTier;
  size: number;
}

/**
 * Multi-tier cache manager
 */
export class MultiTierCache {
  private memoryCache = new Map<string, CacheEntry<any>>();
  private maxMemorySize = 10 * 1024 * 1024; // 10MB
  private currentMemorySize = 0;
  private db: IDBDatabase | null = null;
  private readonly dbName = "AppCacheDB";
  private readonly storeName = "CacheStore";

  constructor() {
    this.initDB();
  }

  private async initDB() {
    if (typeof indexedDB === "undefined") return;

    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "key" });
        }
      };
    });
  }

  /**
   * Get from cache with fallback tiers
   */
  async get<T>(key: string): Promise<T | null> {
    // 1. Memory cache
    const memEntry = this.memoryCache.get(key);
    if (memEntry && this.isValid(memEntry)) {
      return memEntry.value;
    }

    // 2. IndexedDB
    if (this.db) {
      const dbEntry = await this.getFromDB(key);
      if (dbEntry && this.isValid(dbEntry)) {
        // Restore to memory
        this.setMemory(key, dbEntry.value, dbEntry.ttl);
        return dbEntry.value;
      }
    }

    // 3. LocalStorage
    const localEntry = this.getFromLocalStorage(key);
    if (localEntry && this.isValid(localEntry)) {
      return localEntry.value;
    }

    return null;
  }

  /**
   * Set cache with multi-tier strategy
   */
  async set<T>(
    key: string,
    value: T,
    options: {
      ttl?: number;
      tier?: CacheTier;
      size?: number;
    } = {}
  ) {
    const { ttl, tier = CacheTier.MEMORY, size = this.estimateSize(value) } =
      options;

    if (tier === CacheTier.MEMORY || tier === CacheTier.INDEXED_DB) {
      this.setMemory(key, value, ttl, size);
    }

    if ((tier === CacheTier.INDEXED_DB || tier === CacheTier.LOCAL_STORAGE) && this.db) {
      await this.setInDB(key, value, ttl);
    }

    if (tier === CacheTier.LOCAL_STORAGE) {
      this.setInLocalStorage(key, value, ttl);
    }
  }

  /**
   * Delete from cache
   */
  async delete(key: string) {
    this.memoryCache.delete(key);

    if (this.db) {
      await this.deleteFromDB(key);
    }

    try {
      localStorage.removeItem(`cache_${key}`);
    } catch {}
  }

  /**
   * Clear all cache
   */
  async clear() {
    this.memoryCache.clear();
    this.currentMemorySize = 0;

    if (this.db) {
      const tx = this.db.transaction(this.storeName, "readwrite");
      tx.objectStore(this.storeName).clear();
    }

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith("cache_")) {
          localStorage.removeItem(key);
        }
      }
    } catch {}
  }

  // Private helper methods

  private setMemory<T>(key: string, value: T, ttl?: number, size = 0) {
    const entry: CacheEntry<T> = {
      value,
      timestamp: Date.now(),
      ttl,
      tier: CacheTier.MEMORY,
      size,
    };

    // Memory pressure handling
    if (this.currentMemorySize + size > this.maxMemorySize) {
      this.evictMemory();
    }

    this.memoryCache.set(key, entry);
    this.currentMemorySize += size;
  }

  private evictMemory() {
    // LRU eviction
    let oldest: [string, CacheEntry<any>] | null = null;
    let oldestAge = 0;

    for (const entry of this.memoryCache.entries()) {
      const age = Date.now() - entry[1].timestamp;
      if (age > oldestAge) {
        oldest = entry;
        oldestAge = age;
      }
    }

    if (oldest) {
      this.currentMemorySize -= oldest[1].size;
      this.memoryCache.delete(oldest[0]);
    }
  }

  private async getFromDB(key: string): Promise<CacheEntry<any> | null> {
    if (!this.db) return null;

    return new Promise((resolve) => {
      const tx = this.db!.transaction(this.storeName, "readonly");
      const request = tx.objectStore(this.storeName).get(key);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  }

  private async setInDB<T>(key: string, value: T, ttl?: number) {
    if (!this.db) return;

    const entry: CacheEntry<T> = {
      key,
      value,
      timestamp: Date.now(),
      ttl,
      tier: CacheTier.INDEXED_DB,
      size: this.estimateSize(value),
    };

    return new Promise<void>((resolve) => {
      const tx = this.db!.transaction(this.storeName, "readwrite");
      const request = tx.objectStore(this.storeName).put(entry);

      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  }

  private async deleteFromDB(key: string) {
    if (!this.db) return;

    return new Promise<void>((resolve) => {
      const tx = this.db!.transaction(this.storeName, "readwrite");
      const request = tx.objectStore(this.storeName).delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  }

  private getFromLocalStorage(key: string): CacheEntry<any> | null {
    try {
      const data = localStorage.getItem(`cache_${key}`);
      if (!data) return null;
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  private setInLocalStorage<T>(key: string, value: T, ttl?: number) {
    try {
      const entry: CacheEntry<T> = {
        value,
        timestamp: Date.now(),
        ttl,
        tier: CacheTier.LOCAL_STORAGE,
        size: 0,
      };
      localStorage.setItem(`cache_${key}`, JSON.stringify(entry));
    } catch (error) {
      console.error("LocalStorage cache error:", error);
    }
  }

  private isValid(entry: CacheEntry<any>): boolean {
    if (!entry.ttl) return true;
    return Date.now() - entry.timestamp < entry.ttl;
  }

  private estimateSize(obj: any): number {
    const json = JSON.stringify(obj);
    return new Blob([json]).size;
  }

  getStats() {
    return {
      memorySize: this.currentMemorySize,
      memoryItems: this.memoryCache.size,
      maxMemorySize: this.maxMemorySize,
    };
  }
}

/**
 * Singleton cache instance
 */
let cacheInstance: MultiTierCache | null = null;

export function getCache(): MultiTierCache {
  if (!cacheInstance) {
    cacheInstance = new MultiTierCache();
  }
  return cacheInstance;
}

/**
 * Request deduplication
 */
class RequestDeduplicator {
  private pending = new Map<string, Promise<any>>();

  async dedupe<T>(key: string, factory: () => Promise<T>): Promise<T> {
    if (this.pending.has(key)) {
      return this.pending.get(key)!;
    }

    const promise = factory()
      .then((result) => {
        this.pending.delete(key);
        return result;
      })
      .catch((error) => {
        this.pending.delete(key);
        throw error;
      });

    this.pending.set(key, promise);
    return promise;
  }
}

export const requestDeduplicator = new RequestDeduplicator();

/**
 * Cache-aside pattern hook
 */
export function useCacheAside<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: {
    ttl?: number;
    tier?: CacheTier;
  } = {}
) {
  const cache = getCache();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    const fetch = async () => {
      try {
        setLoading(true);

        // Try cache first
        const cached = await cache.get<T>(key);
        if (cached) {
          if (mounted) setData(cached);
          setLoading(false);
          return;
        }

        // Fetch from source
        const result = await requestDeduplicator.dedupe(key, fetcher);
        if (mounted) {
          setData(result);
          await cache.set(key, result, options);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetch();

    return () => {
      mounted = false;
    };
  }, [key, fetcher, cache, options]);

  return { data, loading, error };
}
