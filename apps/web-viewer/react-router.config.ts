import type { Config } from "@react-router/dev/config";

export default {
  // Same `src/` layout as the other front-ends (React Router defaults to `app/`).
  appDirectory: "src",
  // Server-render every page so verified resources have indexable HTML and
  // per-page meta tags.
  ssr: true,
} satisfies Config;
