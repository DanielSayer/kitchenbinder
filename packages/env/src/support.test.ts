import { describe, expect, it } from "vitest";
import { getSupportConfig } from "./support";

describe("runtime support configuration", () => {
  it.each(["development", "test"])(
    "allows an explicit unavailable contact in %s",
    (NODE_ENV) => {
      expect(getSupportConfig({ NODE_ENV, SUPPORT_EMAIL: " " })).toEqual({
        email: null,
        operator: null,
      });
    },
  );
  it.each([
    {},
    { SUPPORT_EMAIL: "help@example.test" },
    { SUPPORT_OPERATOR: "Test queue operator" },
  ])("refuses incomplete production ownership %j", (config) => {
    expect(() =>
      getSupportConfig({ NODE_ENV: "production", ...config }),
    ).toThrow("Production requires");
  });
  it.each([
    "mailto:help@example.test",
    "help@example.test?bcc=other@example.test",
    "help@example.test\r\nBcc:other@example.test",
    "help@example.test,other@example.test",
    "not-an-email",
  ])("rejects unsafe mailbox %s", (SUPPORT_EMAIL) => {
    expect(() => getSupportConfig({ SUPPORT_EMAIL })).toThrow();
  });
  it("reads changed runtime configuration without baking it into the image", () => {
    expect(
      getSupportConfig({
        NODE_ENV: "production",
        SUPPORT_EMAIL: " help@example.test ",
        SUPPORT_OPERATOR: " Test queue operator ",
      }),
    ).toEqual({ email: "help@example.test", operator: "Test queue operator" });
    expect(
      getSupportConfig({ SUPPORT_EMAIL: "other@example.test" }).email,
    ).toBe("other@example.test");
  });
});
