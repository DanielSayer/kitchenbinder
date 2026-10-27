// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it } from "vitest";
import { BillingPlan } from "./billing-plan";

type Plan = Parameters<typeof BillingPlan>[0]["plan"];

const free: Plan = {
  tier: "free",
  bucket: "free",
  recipes: 10,
  saved: 3,
  credits: 3,
  used: 2,
  since: null,
  resetsAt: null,
  createHousehold: false,
  available: true,
  hasCustomer: false,
  cancelAtPeriodEnd: false,
  validUntil: null,
  trialEligible: false,
  pricing: {
    free: { recipes: 10, aiCredits: 3, createHousehold: false },
    pro: { recipes: null, aiCredits: 50, createHousehold: true },
    trial: { days: 7, aiCredits: 10 },
    ai: {
      enabled: true,
      dailyAttemptsPerAccount: 50,
      pendingPerAccount: 5,
      concurrentAttempts: 2,
      reserveCentsPerAttempt: 25,
      dailyBudgetCents: 2500,
    },
  },
};

function show(plan: Plan = free) {
  return render(
    createElement(BillingPlan, {
      plan,
      action: null,
      secondaryActions: null,
    }),
  );
}

afterEach(cleanup);

it("keeps the saved count after a downgrade while bounding the meter", () => {
  show({ ...free, saved: 34, used: 3 });
  const recipes = screen.getByRole("meter", { name: "Recipes" });
  expect(recipes.getAttribute("value")).toBe("10");
  expect(recipes.getAttribute("aria-valuetext")).toBe("34 of 10 saved");
  expect(screen.getByText(/Your existing recipes are safe/)).toBeTruthy();
  expect(screen.queryByText(/add recipes manually/i)).toBeNull();
});

it("shows an exhausted credit allowance without negative remaining credits", () => {
  show({ ...free, used: 4 });
  const credits = screen.getByRole("meter", { name: "AI credits" });
  expect(credits.getAttribute("value")).toBe("0");
  expect(credits.getAttribute("aria-valuetext")).toBe("0 of 3 remaining");
  expect(screen.getByText(/add recipes manually/)).toBeTruthy();
});

it("gives unlimited trial storage no meter and distinguishes its credit allowance", () => {
  show({
    ...free,
    tier: "pro",
    bucket: "trial",
    recipes: null,
    credits: 10,
    createHousehold: true,
    saved: 34,
    used: 0,
    resetsAt: "2026-10-26T00:00:00.000Z",
  });
  expect(screen.queryByRole("meter", { name: "Recipes" })).toBeNull();
  expect(
    screen.getByRole("meter", { name: "AI credits" }).getAttribute("max"),
  ).toBe("10");
  expect(screen.getByText("Trial allowance")).toBeTruthy();
  expect(
    screen.getByText("The 7-day Pro trial includes 10 AI credits total."),
  ).toBeTruthy();
  expect(screen.queryByText(/Resets/)).toBeNull();
});

it("shows cancellation instead of trial renewal copy and ignores stale Free cancellation flags", () => {
  const view = show({
    ...free,
    tier: "pro",
    bucket: "trial",
    recipes: null,
    credits: 10,
    createHousehold: true,
    cancelAtPeriodEnd: true,
    validUntil: "2026-10-26T00:00:00.000Z",
    resetsAt: "2026-10-26T00:00:00.000Z",
  });
  expect(screen.getByText(/Trial ends.*Your recipes stay/)).toBeTruthy();
  expect(screen.queryByText(/Pro A\$4.99/)).toBeNull();
  view.unmount();
  show({
    ...free,
    cancelAtPeriodEnd: true,
    validUntil: "2026-10-19T00:00:00.000Z",
  });
  expect(screen.queryByText(/Pro ends/)).toBeNull();
});

it("does not promise a monthly credit reset after Pro is scheduled to end", () => {
  show({
    ...free,
    tier: "pro",
    bucket: "pro",
    recipes: null,
    createHousehold: true,
    credits: 50,
    used: 50,
    since: "2026-10-01T00:00:00.000Z",
    resetsAt: "2026-11-01T00:00:00.000Z",
    cancelAtPeriodEnd: true,
    validUntil: "2026-10-26T00:00:00.000Z",
  });
  expect(screen.queryByText(/Resets/)).toBeNull();
  expect(screen.getByText(/Pro ends/)).toBeTruthy();
  expect(
    screen.getByRole("meter", { name: "AI credits" }).getAttribute("value"),
  ).toBe("0");
});
