import type { Response } from "express";

// Aborts when the client goes away before the response is sent, so
// api-compile stops building for a client nobody is waiting for anymore.
export const abortOnClose = (res: Response): AbortSignal => {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) {
      controller.abort();
    }
  });
  return controller.signal;
};
