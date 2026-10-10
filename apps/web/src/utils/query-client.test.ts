import { toast } from "sonner";
import { expect, it, vi } from "vitest";
import { createQueryClient } from "./query-client";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

it("still reports query failures without local error handling", async () => {
  const client = createQueryClient();
  const error = new Error("Couldn't load recipes.");
  await expect(
    client.fetchQuery({
      queryKey: ["recipes"],
      queryFn: () => Promise.reject(error),
      retry: false,
    }),
  ).rejects.toBe(error);
  expect(toast.error).toHaveBeenCalledWith(error.message, {
    action: { label: "retry", onClick: expect.any(Function) },
  });
  client.clear();
});
