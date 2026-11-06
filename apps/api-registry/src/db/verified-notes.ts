import db from "./index.ts";

export const getVerifiedNoteByScript = ({
  networkId,
  script,
}: {
  networkId: string;
  script: string;
}) =>
  db.query.verifiedNoteScriptTable.findFirst({
    where: { networkId, script },
    with: { package: true },
  });
