import { expect, it } from "vitest";
import { AccountRequestLimit } from "./account-request-limit";

it("charges every operation in a batch, isolates accounts and expires windows", () => {
  const limit = new AccountRequestLimit(10);
  expect(limit.take("a", 5, 0)).toBeNull();
  expect(limit.take("a", 5, 0)).toBeNull();
  expect(limit.take("a", 1, 1_000)).toBe(59);
  expect(limit.take("b", 1, 1_000)).toBeNull();
  expect(limit.take("a", 1, 60_000)).toBeNull();
});

it("bounds tracked accounts without evicting an active rate limit", () => {
  const limit = new AccountRequestLimit(1, 60_000, 2);
  expect(limit.take("a", 1, 0)).toBeNull();
  expect(limit.take("b", 1, 0)).toBeNull();
  expect(limit.take("c", 1, 0)).toBe(60);
  expect(limit.take("a", 1, 1_000)).toBe(59);
  expect(limit.take("c", 1, 60_000)).toBeNull();
});
