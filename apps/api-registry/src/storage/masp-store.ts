import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Request } from "express";

/**
 * Which build of a package an artifact is: the `release` build that verified,
 * or the `debug` build of the same sources, whose debug info names call-trace
 * frames. Both are keyed by the release build's commitment.
 */
export type MaspVariant = "release" | "debug";

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
};

/**
 * The object key of a package's artifact, e.g. `0xd4ae…9d.masp`, or
 * `0xd4ae…9d.debug.masp` for its debug build. It is also the file name the
 * registry serves it under, which {@link parseMaspKey} reads back.
 */
export const maspKey = (commitment: string, variant: MaspVariant = "release") =>
  `${commitment.toLowerCase()}${variant === "debug" ? ".debug" : ""}.masp`;

const MASP_KEY_PATTERN = /^(0x[0-9a-f]{64})(\.debug)?\.masp$/i;

/** The inverse of {@link maspKey}: `null` when `key` isn't one. */
export const parseMaspKey = (
  key: string,
): { commitment: string; variant: MaspVariant } | null => {
  const match = MASP_KEY_PATTERN.exec(key);
  if (!match?.[1]) {
    return null;
  }
  return {
    commitment: match[1].toLowerCase(),
    variant: match[2] ? "debug" : "release",
  };
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
});

/** The store `createApp` attached to the app handling `req`. */
export const getMaspStore = (req: Request): MaspStore =>
  req.app.locals.maspStore;
