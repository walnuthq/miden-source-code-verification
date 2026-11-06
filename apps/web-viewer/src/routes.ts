import { index, type RouteConfig, route } from "@react-router/dev/routes";

// Both verified resource kinds are one page, so one route file serves both
// URLs; each registration needs its own id.
export default [
  index("routes/home.tsx"),
  route(
    ":networkId/verified-accounts/:accountId",
    "routes/verified-resource.tsx",
    { id: "verified-account" },
  ),
  route(":networkId/verified-notes/:noteId", "routes/verified-resource.tsx", {
    id: "verified-note",
  }),
] satisfies RouteConfig;
