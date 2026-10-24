import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

type Listener = (
  value: unknown,
  sender: { id?: string; url?: string; tab?: object },
  respond: (value: unknown) => void,
) => boolean;
const fake = vi.hoisted(() => ({
  addListener: vi.fn<(listener: Listener) => void>(),
  get: vi.fn<(key: string) => Promise<Record<string, unknown>>>(),
  set: vi.fn<(value: Record<string, unknown>) => Promise<void>>(),
  remove: vi.fn<(key: string) => Promise<void>>(),
  setAccessLevel: vi.fn<() => Promise<void>>(),
  launch: vi.fn<() => Promise<string>>(),
  query: vi.fn(),
  executeScript: vi.fn(),
}));
vi.mock("wxt/browser", () => ({
  browser: {
    tabs: { query: fake.query },
    scripting: { executeScript: fake.executeScript },
    runtime: {
      id: "kjmnecmcpdklkaaiklbfoialfdiamabj",
      getURL: (path: string) =>
        `chrome-extension://kjmnecmcpdklkaaiklbfoialfdiamabj${path}`,
      onMessage: { addListener: fake.addListener },
    },
    storage: {
      local: {
        get: fake.get,
        set: fake.set,
        remove: fake.remove,
        setAccessLevel: fake.setAccessLevel,
      },
      session: { setAccessLevel: fake.setAccessLevel },
    },
    identity: {
      getRedirectURL: () =>
        "https://kjmnecmcpdklkaaiklbfoialfdiamabj.chromiumapp.org/prep-sheet",
      launchWebAuthFlow: fake.launch,
    },
  },
}));
vi.mock("./config", () => ({ prepSheetOrigin: "http://localhost:3001" }));

import background from "../entrypoints/background";

const sender = {
  id: "kjmnecmcpdklkaaiklbfoialfdiamabj",
  url: "chrome-extension://kjmnecmcpdklkaaiklbfoialfdiamabj/popup.html",
};
const credential = {
  token: `pse_${"a".repeat(43)}`,
  origin: "http://localhost:3001",
  expiresAt: new Date(Date.now() + 86400_000).toISOString(),
  account: { id: "test", name: "Test account", email: "test@example.test" },
};
const fetchMock = vi.fn<typeof fetch>();
function listener() {
  const call = fake.addListener.mock.lastCall;
  if (!call) throw new Error("Listener missing");
  return call[0];
}
const send = (kind: string) =>
  new Promise<unknown>((resolve) => listener()({ kind }, sender, resolve));

describe("extension worker credential isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fake.get.mockResolvedValue({});
    fake.set.mockResolvedValue();
    fake.remove.mockResolvedValue();
    fake.setAccessLevel.mockResolvedValue();
    vi.stubGlobal("fetch", fetchMock);
    background.main();
  });
  it("restricts storage before access and rejects content scripts and other senders", async () => {
    await send("status");
    expect(fake.setAccessLevel).toHaveBeenCalledWith({
      accessLevel: "TRUSTED_CONTEXTS",
    });
    expect(
      listener()({ kind: "status" }, { ...sender, tab: {} }, vi.fn()),
    ).toBe(false);
    expect(
      listener()(
        { kind: "status" },
        { ...sender, url: "https://example.test" },
        vi.fn(),
      ),
    ).toBe(false);
    expect(
      listener()({ kind: "status" }, { ...sender, id: "other" }, vi.fn()),
    ).toBe(false);
    expect(
      listener()({ kind: "fetch", token: "secret" }, sender, vi.fn()),
    ).toBe(false);
  });
  it("persists before sending, recovers the same ID after suspension and isolates accounts", async () => {
    const storage: Record<string, unknown> = { credential };
    fake.get.mockImplementation(async (key) => ({ [key]: storage[key] }));
    fake.set.mockImplementation(async (value) => {
      Object.assign(storage, value);
    });
    fake.remove.mockImplementation(async (key) => {
      delete storage[key];
    });
    const command = {
      kind: "save-import",
      input: {
        content: "Soup ingredients and instructions. ".repeat(5),
        sourceUrl: "https://recipes.test/soup",
        householdId: null,
      },
    };
    const key = `import:http://localhost:3001:${credential.account.id}`;
    fetchMock.mockImplementationOnce(async () => {
      expect(storage[key]).toBeDefined();
      throw new Error("Connection lost after submission");
    });
    const first = await new Promise((resolve) =>
      listener()(command, sender, resolve),
    );
    expect(first).toMatchObject({ ok: false });
    const stored = z.object({ id: z.uuid() }).parse(storage[key]);
    background.main(); // New worker globals; durable storage survives.
    fetchMock.mockImplementation(async (_url, options) => {
      const body = z
        .object({ id: z.uuid() })
        .parse(JSON.parse(String(options?.body)));
      expect(body.id).toBe(stored.id);
      return Response.json({
        kind: "saved",
        id: body.id,
        recipeId: body.id,
        title: "Soup",
      });
    });
    expect(await send("recover-import")).toMatchObject({
      ok: true,
      data: { kind: "saved", id: stored.id },
    });
    expect(
      await new Promise((resolve) => listener()(command, sender, resolve)),
    ).toMatchObject({ ok: true, data: { kind: "saved", id: stored.id } });
    expect(storage[key]).toEqual(expect.objectContaining({ id: stored.id }));
    storage.credential = {
      ...credential,
      account: { ...credential.account, id: "other" },
    };
    expect(await send("recover-import")).toEqual({ ok: true, data: null });
    expect(listener()(command, { ...sender, tab: {} }, vi.fn())).toBe(false);
  });
  it("keeps a pending ID while processing and requires a terminal result before starting another", async () => {
    const key = `import:http://localhost:3001:${credential.account.id}`;
    const pending = {
      id: crypto.randomUUID(),
      content: "Soup recipe. ".repeat(10),
      sourceUrl: "https://recipes.test/soup",
      householdId: null,
    };
    fake.get.mockImplementation(async (name) => ({
      [name]: name === "credential" ? credential : pending,
    }));
    fetchMock.mockResolvedValue(
      Response.json(
        { error: "Your import is still processing." },
        { status: 409 },
      ),
    );
    expect(await send("reset-import")).toMatchObject({ ok: false });
    expect(fake.remove).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(Response.json({ ok: true }));
    expect(await send("reset-import")).toEqual({ ok: true, data: null });
    expect(fake.remove).toHaveBeenCalledWith(key);
  });
  it("remembers validated collections per account and recovers stale access without changing pending work", async () => {
    const householdId = crypto.randomUUID();
    const storage: Record<string, unknown> = { credential };
    fake.get.mockImplementation(async (key) => ({ [key]: storage[key] }));
    fake.set.mockImplementation(async (value) => {
      Object.assign(storage, value);
    });
    fetchMock.mockImplementation(async () =>
      Response.json([
        { id: null, name: "My recipes" },
        { id: householdId, name: "Family" },
      ]),
    );
    const select = () =>
      new Promise((resolve) =>
        listener()(
          { kind: "select-collection", householdId, accountId: "test" },
          sender,
          resolve,
        ),
      );
    expect(await select()).toMatchObject({ ok: true, data: { householdId } });
    background.main();
    expect(await send("destinations")).toMatchObject({
      data: { householdId, changed: false },
    });
    storage.credential = {
      ...credential,
      account: { ...credential.account, id: "other" },
    };
    expect(await send("destinations")).toMatchObject({
      data: { householdId: null },
    });
    expect(await select()).toMatchObject({ ok: false, reconnect: true });
    storage.credential = credential;
    const key = "import:http://localhost:3001:test";
    storage[key] = {
      id: crypto.randomUUID(),
      content: "Recipe ".repeat(20),
      sourceUrl: "https://recipes.test/soup",
      householdId,
      title: "Soup",
      collectionName: "Family",
    };
    fetchMock.mockImplementation(async () =>
      Response.json([{ id: null, name: "My recipes" }]),
    );
    expect(await send("destinations")).toMatchObject({
      data: { householdId: null, changed: true },
    });
    expect(await send("pending-import")).toMatchObject({
      data: { householdId, title: "Soup", collectionName: "Family" },
    });
    expect(await select()).toMatchObject({ ok: false });
  });
  it("retains pending identity through revoked access and requires reset even for a changed terminal payload", async () => {
    const pending = {
      id: crypto.randomUUID(),
      content: "Recipe ".repeat(20),
      sourceUrl: "https://recipes.test/soup",
      householdId: null,
      title: "Soup",
      collectionName: "My recipes",
    };
    fake.get.mockImplementation(async (key) => ({
      [key]: key === "credential" ? credential : pending,
    }));
    fetchMock.mockImplementation(
      async () => new Response(null, { status: 401 }),
    );
    expect(await send("recover-import")).toMatchObject({
      ok: false,
      reconnect: true,
    });
    expect(fake.remove).not.toHaveBeenCalled();
    fetchMock.mockImplementation(async (_url, options) => {
      expect(JSON.parse(String(options?.body))).toEqual({
        id: pending.id,
        content: pending.content.trim(),
        sourceUrl: pending.sourceUrl,
        householdId: null,
      });
      return Response.json({
        kind: "failed",
        id: pending.id,
        message: "Processing failed",
      });
    });
    expect(await send("recover-import")).toMatchObject({
      data: { kind: "failed", id: pending.id },
    });
    expect(
      await new Promise((resolve) =>
        listener()(
          {
            kind: "save-import",
            input: {
              content: "A different recipe ".repeat(10),
              sourceUrl: pending.sourceUrl,
              householdId: null,
            },
          },
          sender,
          resolve,
        ),
      ),
    ).toMatchObject({ data: { kind: "failed", id: pending.id } });
    expect(fake.set).not.toHaveBeenCalled();
  });
  it("restores the selected recipe and rejects selections outside the captured page", async () => {
    const capture = {
      kind: "captured",
      sourceUrl: "https://recipes.test/soup",
      recipes: [
        { title: "Soup", content: "Ingredients", format: "text" },
        { title: "Bread", content: "Instructions", format: "text" },
      ],
    };
    const storage: Record<string, unknown> = { capture };
    fake.get.mockImplementation(async (key) => ({ [key]: storage[key] }));
    fake.set.mockImplementation(async (value) => {
      Object.assign(storage, value);
    });
    await new Promise((resolve) =>
      listener()(
        { kind: "select-recipe", sourceUrl: capture.sourceUrl, selected: 1 },
        sender,
        resolve,
      ),
    );
    background.main();
    expect(await send("recover-capture")).toMatchObject({
      capture,
      selection: { selected: 1 },
    });
    await new Promise((resolve) =>
      listener()(
        { kind: "select-recipe", sourceUrl: "https://other.test", selected: 0 },
        sender,
        resolve,
      ),
    );
    expect(await send("recover-capture")).toMatchObject({
      selection: { selected: 1 },
    });
  });
  it("captures only the active top frame in the isolated world without accessing credentials or the API", async () => {
    fake.query.mockResolvedValue([
      { id: 42, url: "https://recipes.test/soup" },
    ]);
    const result = {
      kind: "captured",
      sourceUrl: "https://recipes.test/soup",
      recipes: [
        {
          title: "Soup",
          content: "Ingredients and instructions",
          format: "text",
        },
      ],
    };
    fake.executeScript.mockResolvedValue([{ result }]);
    expect(await send("capture")).toEqual(result);
    expect(fake.query).toHaveBeenCalledWith({
      active: true,
      currentWindow: true,
    });
    expect(fake.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 42, frameIds: [0] },
        world: "ISOLATED",
        func: expect.any(Function),
      }),
    );
    expect(fake.get).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      listener()({ kind: "capture" }, { ...sender, tab: {} }, vi.fn()),
    ).toBe(false);
    expect(listener()({ kind: "capture", tabId: 123 }, sender, vi.fn())).toBe(
      false,
    );
  });
  it("handles restricted pages, injection failures and malformed capture results", async () => {
    fake.query.mockResolvedValue([{ id: 42, url: "chrome://settings" }]);
    expect(await send("capture")).toEqual({
      kind: "error",
      code: "unsupported",
    });
    expect(fake.executeScript).not.toHaveBeenCalled();
    fake.query.mockResolvedValue([
      { id: 42, url: "https://recipes.test/soup" },
    ]);
    fake.executeScript.mockRejectedValue(new Error("Permission denied"));
    expect(await send("capture")).toEqual({
      kind: "error",
      code: "unavailable",
    });
    fake.executeScript.mockResolvedValue([
      { result: { kind: "captured", recipes: [] } },
    ]);
    expect(await send("capture")).toEqual({
      kind: "error",
      code: "unavailable",
    });
  });
  it("returns only account information to the popup and omits website cookies", async () => {
    fake.get.mockResolvedValue({ credential });
    fetchMock.mockResolvedValue(
      Response.json({
        account: credential.account,
        expiresAt: credential.expiresAt,
      }),
    );
    const result = await send("status");
    expect(result).toEqual({
      ok: true,
      state: {
        kind: "connected",
        account: credential.account,
        expiresAt: credential.expiresAt,
      },
    });
    expect(JSON.stringify(result)).not.toContain(credential.token);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/extensions/me",
      expect.objectContaining({
        credentials: "omit",
        redirect: "error",
        headers: expect.objectContaining({
          Authorization: `Bearer ${credential.token}`,
        }),
      }),
    );
  });
  it("clears expired and revoked access, but preserves tokens on network failure", async () => {
    fake.get.mockResolvedValue({
      credential: { ...credential, expiresAt: "2000-01-01T00:00:00.000Z" },
    });
    expect(await send("status")).toMatchObject({
      ok: true,
      state: { kind: "disconnected" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    fake.get.mockResolvedValue({ credential });
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    await send("status");
    expect(fake.remove).toHaveBeenCalledTimes(2);
    fetchMock.mockRejectedValue(new Error("Network unavailable"));
    expect(await send("disconnect")).toMatchObject({ ok: false });
    expect(fake.remove).toHaveBeenCalledTimes(2);
  });
  it("does not send credentials to a different configured website", async () => {
    fake.get.mockResolvedValue({
      credential: { ...credential, origin: "https://different.test" },
    });
    expect(await send("status")).toMatchObject({
      ok: true,
      state: { kind: "disconnected" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("keeps connection work in the worker and rejects a mismatched callback state", async () => {
    let finish: (value: string) => void = () => {
      throw new Error("Flow not started");
    };
    fake.launch.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    expect(await send("connect")).toMatchObject({
      ok: true,
      state: { kind: "connecting" },
    });
    await vi.waitFor(() => expect(fake.launch).toHaveBeenCalled());
    expect(await send("status")).toMatchObject({
      ok: true,
      state: { kind: "connecting" },
    });
    finish(
      `https://kjmnecmcpdklkaaiklbfoialfdiamabj.chromiumapp.org/prep-sheet?state=wrong&code=${"a".repeat(43)}`,
    );
    await vi.waitFor(async () => {
      const result = z
        .object({ state: z.object({ kind: z.literal("disconnected") }) })
        .safeParse(await send("status"));
      expect(result.success).toBe(true);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fake.set).not.toHaveBeenCalled();
  });
});
