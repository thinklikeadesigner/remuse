import { resolve } from "node:path";
import { createJobServer } from "./http.ts";

const port = Number(process.env.PORT ?? "3000");
const rootDir = process.env.REMUSE_DATA_DIR ?? resolve("var/remuse");
const app = createJobServer({ rootDir });

app.server.listen(port, () => {
  console.log(`Remuse mock job backend listening on http://localhost:${port}`);
  console.log(`Artifact and job state root: ${rootDir}`);
});
