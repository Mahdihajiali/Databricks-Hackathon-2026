import { createApp, files, lakebase, server, type CacheConfig } from '@databricks/appkit';
import { setupReferralCopilotRoutes } from './routes/genie/referral-copilot-routes';
import { setupDataReadinessRoutes } from './routes/lakebase/data-readiness-routes';

type CacheStorage = NonNullable<CacheConfig['storage']>;

function createProcessCacheStorage(): CacheStorage {
  const entries = new Map<string, { value: unknown; expiry: number }>();

  return {
    get<T>(key: string) {
      const entry = entries.get(key);
      return Promise.resolve(entry ? { value: entry.value as T, expiry: entry.expiry } : null);
    },
    set<T>(key: string, entry: { value: T; expiry: number }) {
      entries.set(key, { value: entry.value, expiry: entry.expiry });
      return Promise.resolve();
    },
    delete(key: string) {
      entries.delete(key);
      return Promise.resolve();
    },
    clear() {
      entries.clear();
      return Promise.resolve();
    },
    has(key: string) {
      return Promise.resolve(entries.has(key));
    },
    size() {
      return Promise.resolve(entries.size);
    },
    isPersistent() {
      return false;
    },
    healthCheck() {
      return Promise.resolve(true);
    },
    close() {
      entries.clear();
      return Promise.resolve();
    },
  };
}

createApp({
  cache: {
    enabled: false,
    storage: createProcessCacheStorage(),
  },
  plugins: [
    files(),
    lakebase(),
    server(),
  ],
  async onPluginsReady(appkit) {
    setupReferralCopilotRoutes(appkit);
    await setupDataReadinessRoutes(appkit);
  },
}).catch(console.error);
