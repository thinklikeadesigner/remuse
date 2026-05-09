import { resolve } from "node:path";
import { createProvidersFromEnvironment } from "../providers/index.ts";
import { createJobServer } from "./http.ts";

const port = Number(process.env.PORT ?? "3000");
const rootDir = process.env.REMUSE_DATA_DIR ?? resolve("var/remuse");
const app = createJobServer({
  rootDir,
  providers: ({ artifactStore }) => createProvidersFromEnvironment({ artifactStore })
});

app.server.listen(port, () => {
  console.log(`Remuse job backend listening on http://localhost:${port}`);
  console.log(`Provider mode: ${process.env.REMUSE_PROVIDER ?? "mock"}`);
  console.log(`Artifact and job state root: ${rootDir}`);
});
