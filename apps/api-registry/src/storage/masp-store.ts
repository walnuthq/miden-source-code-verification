import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Request } from "express";

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
};

/** The object key of a package's artifact, e.g. `0xd4ae…9d.masp`. */
export const maspKey = (commitment: string) =>
  `${commitment.toLowerCase()}.masp`;

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
});

/** The store `createApp` attached to the app handling `req`. */
export const getMaspStore = (req: Request): MaspStore =>
  req.app.locals.maspStore;
