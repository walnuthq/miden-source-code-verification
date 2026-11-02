import { createApp } from "./app.ts";
import { PORT } from "./lib/constants.ts";

const app = createApp();

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
