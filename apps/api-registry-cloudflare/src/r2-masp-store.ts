import {
  type MaspStore,
  maspKey,
} from "miden-source-code-verification-api-registry/storage";

// The registry's MASP store on an R2 bucket. The bucket comes from the
// per-request `env`, so it is resolved on each call rather than captured here.
export const createR2MaspStore = (getBucket: () => R2Bucket): MaspStore => ({
  async put(commitment, masp) {
    await getBucket().put(maspKey(commitment), masp, {
      httpMetadata: { contentType: "application/octet-stream" },
    });
  },
  async get(commitment) {
    const object = await getBucket().get(maspKey(commitment));
    return object ? new Uint8Array(await object.arrayBuffer()) : null;
  },
});
