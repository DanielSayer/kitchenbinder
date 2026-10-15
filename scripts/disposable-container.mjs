import { spawnSync } from "node:child_process";

const active = new Set();
// SIGKILL or a Docker daemon outage still requires operator cleanup of the
// labelled container. Normal exits and CLI interrupts remove owned containers.
process.once("exit", () => {
  for (const name of active)
    spawnSync("docker", ["rm", "--force", name], {
      stdio: "ignore",
      timeout: 10_000,
    });
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => process.exit(1));

export function ownContainer(name) {
  if (!/^prep-sheet-(backup|recovery)-[0-9a-f-]{36}$/.test(name))
    throw new Error("Expected a disposable container identity");
  active.add(name);
  return () => {
    const result = spawnSync("docker", ["rm", "--force", name], {
      stdio: ["ignore", "ignore", "pipe"],
      encoding: "utf8",
      timeout: 10_000,
    });
    const removed =
      result.status === 0 || result.stderr?.includes("No such container");
    if (removed) active.delete(name);
    else {
      process.stderr.write('{"event":"disposable_container_cleanup_failed"}\n');
      process.exitCode = 1;
    }
    return removed;
  };
}
