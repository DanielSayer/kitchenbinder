import { describe, expect, it } from "vitest";
import { allowance } from "./policy";

describe("plan allowances", () => {
  const now = new Date("2026-12-31T23:59:59Z");
  const later = new Date("2027-01-20T00:00:00Z");
  it("uses a lifetime Free allowance for expired, revoked and unpaid plans", () => {
    for (const status of [
      "free",
      "past_due",
      "canceled",
      "unpaid",
      "incomplete",
      "unknown",
    ])
      expect(allowance(status, later, now)).toMatchObject({
        tier: "free",
        bucket: "free",
        since: null,
        credits: 3,
        recipes: 10,
      });
    expect(allowance("active", now, now).tier).toBe("free");
    expect(allowance("active", null, now).tier).toBe("free");
  });
  it("gives trials one total allowance and ends at the expiry instant", () => {
    expect(allowance("trialing", later, now)).toMatchObject({
      tier: "pro",
      bucket: "trial",
      since: null,
      credits: 10,
    });
    expect(allowance("trialing", later, later).tier).toBe("free");
  });
  it("uses calendar months across year boundaries, independent of subscription ID", () => {
    expect(allowance("active", later, now)).toMatchObject({
      bucket: "pro",
      credits: 50,
      since: new Date("2026-12-01T00:00:00Z"),
      resetsAt: new Date("2027-01-01T00:00:00Z"),
    });
    expect(
      allowance("active", later, new Date("2027-01-01T00:00:00Z")).since,
    ).toEqual(new Date("2027-01-01T00:00:00Z"));
  });
});
