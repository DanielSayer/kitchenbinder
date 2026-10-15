import { writeFileSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";

if (workerData.origin === "spin") {
  writeFileSync(`${workerData.sourceUrl}.started`, "CPU work started");
  const until = Date.now() + 1_500;
  while (Date.now() < until) {
    /* Simulate synchronous layout work. */
  }
  writeFileSync(workerData.sourceUrl, "CPU work survived the deadline");
}
if (workerData.origin === "fail") throw new Error("Test worker failure");
parentPort.postMessage(new Uint8Array([37, 80, 68, 70, 45]));
