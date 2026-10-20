import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route(
    ":networkId/verified-accounts/:accountId",
    "routes/verified-account.tsx",
  ),
  route(":networkId/verified-notes/:noteId", "routes/verified-note.tsx"),
] satisfies RouteConfig;
