import { parentPort, workerData } from "node:worker_threads";
import { recipeContentSchema } from "@prep-sheet/db/recipe-content";
import { z } from "zod";
import { recipePdf } from "./pdf";

const payload = z
  .object({
    content: recipeContentSchema,
    sourceUrl: z.string().max(4096).nullable(),
    origin: z.string().max(32),
  })
  .parse(workerData);
const pdf = await recipePdf(payload.content, payload.sourceUrl, payload.origin);
const bytes = new Uint8Array(pdf);
parentPort?.postMessage(bytes, [bytes.buffer]);
