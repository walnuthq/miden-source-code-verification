import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Request } from "express";
import { maspKey } from "miden-source-code-verification-utils/api-registry";

// The artifact's key is the registry's wire too (the file name it is served
// at), so it lives in `miden-source-code-verification-utils/api-registry`;
// re-exported here for the stores that file artifacts by it.
export { maspKey };

/**
 * Object storage for compiled packages (`.masp`), keyed by package commitment.
 * Kept out of Postgres so registry responses don't carry the artifact. The
 * registry only depends on this interface; each deployment supplies its own
 * backend (a local directory on Node, an R2 bucket on Cloudflare Workers).
 */
export type MaspStore = {
  put(commitment: string, masp: Uint8Array): Promise<void>;
  /** `null` when no artifact is stored for `commitment`. */
  get(commitment: string): Promise<Uint8Array | null>;
  /** Removes the artifact; deleting one that isn't stored is no error. */
  delete(commitment: string): Promise<void>;
};

/** A {@link MaspStore} backed by a local directory, created on first write. */
export const createFsMaspStore = (dir: string): MaspStore => ({
  async put(commitment, masp) {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, maspKey(commitment)), masp);
  },
  async get(commitment) {
    try {
      return await readFile(join(dir, maspKey(commitment)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  },
  async delete(commitment) {
    await rm(join(dir, maspKey(commitment)), { force: true });
  },
});

/** The store `createApp` attached to the app handling `req`. */
export const getMaspStore = (req: Request): MaspStore => req.app.locals.maspStore;
