import { createApp } from "@/app.js";
import { PORT } from "@/lib/constants.js";

const app = createApp();

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
