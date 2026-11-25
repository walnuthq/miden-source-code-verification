import db from "./index.ts";

export const getPackage = (commitment: string) =>
  db.query.packagesTable.findFirst({
    where: { commitment },
  });
