import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Request } from "express";
import {
  type MaspVariant,
  maspKey,
} from "miden-source-code-verification-utils/api-registry";

// The artifact's key is the registry's wire too (the file name it is served
// at), so it lives in `miden-source-code-verification-utils/api-registry`;
// re-exported here with the variant for the stores that file artifacts by it.
export { type MaspVariant, maspKey };

/**
 * Object storage for compiled packages (`.masp`), keyed by package commitment.
 * Kept out of Postgres so registry responses don't carry the artifact. The
 * registry only depends on this interface; each deployment supplies its own
 * backend (a local directory on Node, an R2 bucket on Cloudflare Workers).
 */
export type MaspStore = {
  put(
    commitment: string,
    masp: Uint8Array,
    variant?: MaspVariant,
  ): Promise<void>;
  /** `null` when no artifact is stored for `commitment`. */
  get(commitment: string, variant?: MaspVariant): Promise<Uint8Array | null>;
  /** Removes the artifact, if one is stored. */
  delete(commitment: string, variant?: MaspVariant): Promise<void>;
};

/** A {@link MaspStore} backed by a local directory, created on first write. */
export const createFsMaspStore = (dir: string): MaspStore => ({
  async put(commitment, masp, variant) {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, maspKey(commitment, variant)), masp);
  },
  async get(commitment, variant) {
    try {
      return await readFile(join(dir, maspKey(commitment, variant)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  },
  async delete(commitment, variant) {
    await rm(join(dir, maspKey(commitment, variant)), { force: true });
  },
});

/** The store `createApp` attached to the app handling `req`. */
export const getMaspStore = (req: Request): MaspStore =>
  req.app.locals.maspStore;
