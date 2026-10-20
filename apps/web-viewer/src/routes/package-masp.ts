import { data } from "react-router";

import { getPackageMasp } from "@/lib/api-registry.server";
import type { Route } from "./+types/package-masp";

// A resource route proxying the registry's compiled package download, so the
// Download MASP link stays same-origin (the browser only honours a `download`
// name on those) and the registry is still only called from the server.
export async function loader({ params }: Route.LoaderArgs) {
  const { networkId, file } = params;
  const upstream = await getPackageMasp({ networkId, file });
  if (!upstream) {
    throw data(null, { status: 404 });
  }
  // Not the registry's `Content-Disposition`: the same-origin link's `download`
  // attribute already names the file (see `maspFileName`), and a header name
  // would override it, which could only make the two disagree.
  const headers = new Headers();
  for (const name of ["Content-Type", "Cache-Control"]) {
    const value = upstream.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }
  return new Response(upstream.body, { headers });
}
