import { register } from "tsx/esm/api";
import { verifyRelease } from "./release-environment.mjs";

await verifyRelease();
register();
await import("../packages/api/src/import-worker.ts");
