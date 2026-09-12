import { IStorageService } from './IStorageService.js';
import { LocalStorageService } from './LocalStorageService.js';

/**
 * The process-wide storage service, built on first use.
 *
 * Deliberately lazy. LocalStorageService validates ENCRYPTION_KEY in its
 * constructor, so building one at module scope — as routes/documents.ts and the
 * documents resolver both used to — makes merely *importing* those modules
 * depend on `.env` having been loaded already. Under ESM that ordering is not
 * something an import site can guarantee, which is what broke booting the
 * server from `.env` alone (see loadEnv.ts).
 *
 * Deferring to the first call keeps the module graph importable whatever the
 * env load order, for the same reason services/encryption.ts initialises its
 * key lazily. It also means the two call sites now share one instance instead
 * of constructing one each.
 */
let storageService: IStorageService | null = null;

export function getStorageService(): IStorageService {
  if (!storageService) {
    storageService = new LocalStorageService();
  }
  return storageService;
}
