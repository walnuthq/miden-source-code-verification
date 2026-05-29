import { Router } from "express";
import { verifyAccountComponent } from "@/lib/verify-account-component.js";
import { getVerifiedAccount } from "@/db/verified-accounts.js";

const router = Router();

type VerifyAccountRequestBody = {
  accountId?: string;
  files?: Record<string, string>;
};

router.post("/:networkId/verified-accounts", async (req, res) => {
  const { accountId, files } = req.body as VerifyAccountRequestBody;
  if (!accountId) {
    res.status(400).json({ error: "missing accountId" });
    return;
  }
  if (!files || typeof files !== "object") {
    res.status(400).json({ error: "missing files" });
    return;
  }
  if (!files["Cargo.toml"]) {
    res.status(400).json({ error: "missing Cargo.toml" });
    return;
  }
  try {
    const verified = await verifyAccountComponent({
      networkId: req.params.networkId,
      accountId,
      files,
    });
    res.json({ verified });
  } catch (error) {
    console.error(error);
    const message =
      error instanceof Error ? error.message : "verification failed";
    res.status(500).json({ error: message });
  }
});

router.get("/:networkId/verified-accounts/:accountId", async (req, res) => {
  const { networkId, accountId } = req.params;
  try {
    const verifiedAccount = await getVerifiedAccount({
      networkId,
      accountId,
    });
    if (!verifiedAccount) {
      res.status(404).json({ error: "verified account not found" });
      return;
    }
    res.json(verifiedAccount);
  } catch (error) {
    console.error(error);
    const message =
      error instanceof Error
        ? error.message
        : "verified account retrieval failed";
    res.status(500).json({ error: message });
  }
});

export default router;
