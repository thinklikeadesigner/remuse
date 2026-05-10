import { resolve } from "node:path";
import { createProvidersFromEnvironment } from "../providers/index.ts";
import { createJobServer } from "./http.ts";

const port = Number(process.env.PORT ?? "3000");
const rootDir = process.env.REMUSE_DATA_DIR ?? resolve("var/remuse");
const publicBaseUrl = process.env.REMUSE_PUBLIC_BASE_URL ?? `http://localhost:${port}`;
const autoOpenReview = process.env.REMUSE_AUTO_OPEN_REVIEW !== "0";
const app = createJobServer({
  rootDir,
  publicBaseUrl,
  autoOpenReview,
  providers: ({ artifactStore }) => createProvidersFromEnvironment({ artifactStore })
});

app.server.listen(port, () => {
  console.log(`Remuse job backend listening on http://localhost:${port}`);
  console.log(`Provider mode: ${process.env.REMUSE_PROVIDER ?? "mock"}`);
  console.log(`OpenDAW provider mode: ${process.env.REMUSE_OPENDAW_PROVIDER ?? "local-session"}`);
  console.log(`OpenDAW render backend: ${process.env.REMUSE_OPENDAW_RENDERER ?? "preview"}`);
  console.log(`Artifact and job state root: ${rootDir}`);
  console.log(`Review UI base: ${publicBaseUrl}`);
  console.log(`Auto-open review UI: ${autoOpenReview ? "enabled" : "disabled"}`);
});
