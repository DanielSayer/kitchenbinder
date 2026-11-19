import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import {
  type CallToolResult,
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { completeAccountDeletion } from "@prep-sheet/api/account-deletion";
import { auth } from "@prep-sheet/auth";
import {
  issueToken,
  refreshToken,
  registerClient,
  signIn,
  testAuth,
  tokenResult,
} from "@prep-sheet/auth/testing/oauth";
import { db } from "@prep-sheet/db";
import { session, user } from "@prep-sheet/db/schema/auth";
import { billingAccount } from "@prep-sheet/db/schema/billing";
import { household } from "@prep-sheet/db/schema/household";
import { recipeImport } from "@prep-sheet/db/schema/import";
import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
} from "@prep-sheet/db/schema/oauth";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { accountDeletionRequest } from "@prep-sheet/db/schema/support";
import { count, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { handleMcpRequest } from "./index";

const userIds: string[] = [];
const clientIds: string[] = [];
const connections: Client[] = [];
let base: string;
let paid: Awaited<ReturnType<typeof signIn>>;
let free: Awaited<ReturnType<typeof signIn>>;
let token: string;
let client: Client;
let savedRecipeId: string;
let shoppingItemId: string;
const server = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value))
        value.forEach((entry) => {
          headers.append(key, entry);
        });
      else if (value !== undefined) headers.set(key, value);
    }
    const request = new Request(`${base}${req.url}`, {
      method: req.method,
      headers,
      ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
    });
    const response = req.url?.startsWith("/api/auth/")
      ? await testAuth.handler(request)
      : await handleMcpRequest(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body)
      for await (const chunk of response.body) res.write(chunk);
    res.end();
  } catch {
    res.writeHead(500);
    res.end("Test HTTP adapter failed");
  }
});
const send = async (request: Request) => {
  const original = new URL(request.url);
  return fetch(`${base}${original.pathname}${original.search}`, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    duplex: "half",
    redirect: "manual",
  });
};
async function connect(accessToken: string, modern = false) {
  const client = new Client(
    { name: "Kitchenbinder integration", version: "1" },
    modern
      ? { versionNegotiation: { mode: { pin: "2026-07-28" } } }
      : undefined,
  );
  connections.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
    }),
  );
  return client;
}
function data(result: CallToolResult) {
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  return z.object({ data: z.unknown() }).parse(result.structuredContent).data;
}
beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing HTTP port");
  base = `http://127.0.0.1:${address.port}`;
  paid = await signIn(`${randomUUID()}@example.test`);
  free = await signIn(`${randomUUID()}@example.test`);
  userIds.push(paid.user.id, free.user.id);
  await db.insert(billingAccount).values({
    userId: paid.user.id,
    status: "active",
    validUntil: new Date(Date.now() + 86400_000),
  });
  const registration = await registerClient(send);
  clientIds.push(registration.client_id);
  token = (await issueToken(paid.cookie, registration.client_id, send))
    .access_token;
  client = await connect(token);
});
afterAll(async () => {
  await Promise.all(connections.map((client) => client.close()));
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (clientIds.length)
    await db
      .delete(oauthClient)
      .where(inArray(oauthClient.clientId, clientIds));
  if (userIds.length) {
    await db.delete(recipe).where(inArray(recipe.userId, userIds));
    await db.delete(household).where(inArray(household.ownerId, userIds));
    await db.delete(user).where(inArray(user.id, userIds));
  }
  await db.$client.end();
});

describe("real OAuth and Streamable HTTP MCP connection", () => {
  it.each(["expired", "deleted", "signed out"])(
    "keeps access and refresh working after web sessions are %s",
    async (mode) => {
      const login = await signIn(`${randomUUID()}@example.test`);
      userIds.push(login.user.id);
      await db.insert(billingAccount).values({
        userId: login.user.id,
        status: "active",
        validUntil: new Date(Date.now() + 86400_000),
      });
      const { client_id: clientId } = await registerClient(send);
      clientIds.push(clientId);
      const tokens = await issueToken(login.cookie, clientId, send);
      if (!tokens.refresh_token) throw new Error("Missing refresh token");
      const connection = await connect(tokens.access_token);
      if (mode === "expired") {
        await db
          .update(session)
          .set({ expiresAt: new Date(0) })
          .where(eq(session.userId, login.user.id));
      } else if (mode === "deleted") {
        await db.delete(session).where(eq(session.userId, login.user.id));
      } else {
        await testAuth.api.signOut({
          headers: new Headers({ cookie: login.cookie }),
        });
      }
      const sessions = await db
        .select()
        .from(session)
        .where(eq(session.userId, login.user.id));
      expect(sessions.every((entry) => entry.expiresAt <= new Date())).toBe(
        true,
      );
      expect(
        data(
          await connection.callTool({
            name: "get_account_overview",
            arguments: {},
          }),
        ),
      ).toMatchObject({ name: "MCP test", plan: "pro" });
      const refreshed = await refreshToken(
        tokens.refresh_token,
        clientId,
        send,
      );
      expect(refreshed.status).toBe(200);
      const next = tokenResult.parse(await refreshed.json());
      expect(next.refresh_token).toBeDefined();
      const renewed = await connect(next.access_token);
      expect(
        data(
          await renewed.callTool({
            name: "get_account_overview",
            arguments: {},
          }),
        ),
      ).toMatchObject({ name: "MCP test", plan: "pro" });
    },
  );
  it("rejects deleted users immediately and cascades their OAuth grants", async () => {
    const login = await signIn(`${randomUUID()}@example.test`);
    userIds.push(login.user.id);
    const { client_id: clientId } = await registerClient(send);
    clientIds.push(clientId);
    const tokens = await issueToken(login.cookie, clientId, send);
    if (!tokens.refresh_token) throw new Error("Missing refresh token");
    expect(
      (await (await connect(tokens.access_token)).listTools()).tools,
    ).toHaveLength(11);
    const requestId = randomUUID();
    await db
      .insert(accountDeletionRequest)
      .values({ id: requestId, userId: login.user.id });
    await completeAccountDeletion(requestId);
    expect(
      (
        await fetch(`${base}/api/mcp`, {
          headers: { authorization: `Bearer ${tokens.access_token}` },
        })
      ).status,
    ).toBe(401);
    for (const table of [oauthConsent, oauthAccessToken, oauthRefreshToken]) {
      expect(
        await db
          .select({ id: table.id })
          .from(table)
          .where(eq(table.userId, login.user.id)),
      ).toHaveLength(0);
    }
    expect((await refreshToken(tokens.refresh_token, clientId, send)).ok).toBe(
      false,
    );
  });
  it("challenges missing, malformed and wrong-audience tokens without accepting a login cookie", async () => {
    for (const headers of [
      {},
      { cookie: paid.cookie },
      { authorization: "Bearer invalid" },
    ]) {
      const response = await fetch(`${base}/api/mcp`, { headers });
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain(
        'resource_metadata="http://localhost:3001/.well-known/oauth-protected-resource/api/mcp"',
      );
    }
    expect(
      (
        await fetch(`${base}/api/mcp`, {
          headers: {
            origin: "https://untrusted.example.test",
            authorization: `Bearer ${token}`,
          },
        })
      ).status,
    ).toBe(403);
    const wrong = await testAuth.api.signJWT({
      body: {
        payload: {
          sub: paid.user.id,
          sid: (
            await testAuth.api.getSession({
              headers: new Headers({ cookie: paid.cookie }),
            })
          )?.session.id,
          azp: clientIds[0],
          aud: "https://wrong.example.test/api",
          scope: "kitchenbinder",
        },
      },
    });
    const rejected = await fetch(`${base}/api/mcp`, {
      headers: { authorization: `Bearer ${wrong.token}` },
    });
    expect(rejected.status).toBe(401);
    expect(
      (
        await fetch(`${base}/api/mcp`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(405);
  });
  it("lists all v1 tools on legacy and modern connections with descriptions and annotations", async () => {
    for (const connection of [client, await connect(token, true)]) {
      const tools = (await connection.listTools()).tools;
      expect(tools.map((tool) => tool.name).sort()).toEqual(
        [
          "get_account_overview",
          "search_recipes",
          "get_recipe",
          "get_meal_plan",
          "get_shopping_list",
          "add_shopping_items",
          "check_off_shopping_item",
          "create_recipe",
          "plan_meal",
          "remove_planned_meal",
          "add_recipe_to_shopping_list",
        ].sort(),
      );
      expect(
        tools.every(
          (tool) =>
            tool.description &&
            typeof tool.annotations?.readOnlyHint === "boolean",
        ),
      ).toBe(true);
      expect(
        tools.find((tool) => tool.name === "remove_planned_meal")?.annotations
          ?.destructiveHint,
      ).toBe(true);
    }
  });
  it("adds parsed shopping lines, recovers an identical retry and checks off an item", async () => {
    const input = {
      items: ["6 eggs", "500 g plain flour"],
      requestId: randomUUID(),
    };
    const added = data(
      await client.callTool({ name: "add_shopping_items", arguments: input }),
    );
    const item = z
      .object({ items: z.array(z.object({ id: z.uuid() })) })
      .parse(added).items[0];
    if (!item) throw new Error("Missing added item");
    shoppingItemId = item.id;
    data(
      await client.callTool({ name: "add_shopping_items", arguments: input }),
    );
    const list = data(
      await client.callTool({ name: "get_shopping_list", arguments: {} }),
    );
    expect(list).toMatchObject({
      items: [
        { text: "6 eggs" },
        { text: "500 g plain flour", ingredient: { unit: "g", quantity: 500 } },
      ],
    });
    data(
      await client.callTool({
        name: "check_off_shopping_item",
        arguments: { itemId: shoppingItemId },
      }),
    );
    expect(
      data(await client.callTool({ name: "get_shopping_list", arguments: {} })),
    ).toMatchObject({ items: [{ status: "bought" }, { status: "needed" }] });
  });
  it("saves through createManual, reuses its parser and retry identity, and spends no AI credits", async () => {
    const before = await db
      .select({ count: count() })
      .from(recipeImport)
      .where(eq(recipeImport.userId, paid.user.id));
    savedRecipeId = randomUUID();
    const input = {
      recipeId: savedRecipeId,
      title: "MCP pancakes",
      servings: "4",
      ingredients: ["500 g plain flour", "2 eggs", "250 mL milk"],
      steps: ["Mix the ingredients.", "Cook in a pan."],
      notes: "Family breakfast",
      sourceUrl: "https://example.test/pancakes",
    };
    data(await client.callTool({ name: "create_recipe", arguments: input }));
    data(await client.callTool({ name: "create_recipe", arguments: input }));
    const saved = data(
      await client.callTool({
        name: "get_recipe",
        arguments: { recipeId: savedRecipeId },
      }),
    );
    expect(saved).toMatchObject({
      id: savedRecipeId,
      title: input.title,
      ingredients: input.ingredients,
      steps: input.steps,
      ingredientData: [
        { parsed: { unit: "g", quantity: 500 } },
        { parsed: { quantity: 2 } },
        { parsed: { unit: "ml", quantity: 250 } },
      ],
    });
    expect(z.object({ notes: z.string() }).parse(saved).notes).toContain(
      input.sourceUrl,
    );
    expect(
      data(
        await client.callTool({
          name: "search_recipes",
          arguments: { query: "MCP pancakes" },
        }),
      ),
    ).toMatchObject({ total: 1 });
    expect(
      await db
        .select({ count: count() })
        .from(recipeImport)
        .where(eq(recipeImport.userId, paid.user.id)),
    ).toEqual(before);
    const changed = await client.callTool({
      name: "create_recipe",
      arguments: { ...input, title: "Changed" },
    });
    expect(changed.isError).toBe(true);
    const [stored] = await db
      .select()
      .from(recipe)
      .where(eq(recipe.id, savedRecipeId));
    expect(stored?.origin).toBe("manual");
  });
  it("plans meals, removes them by revision and adds recipe lines", async () => {
    const planned = data(
      await client.callTool({
        name: "plan_meal",
        arguments: { recipeId: savedRecipeId, date: "2026-11-16" },
      }),
    );
    expect(planned).toMatchObject({
      date: "2026-11-16",
      slot: "Dinner",
      baseServingsAssumed: false,
    });
    const plan = z
      .object({
        revision: z.number(),
        meals: z.array(
          z.object({
            id: z.uuid(),
            baseServings: z.number(),
            cook: z.number(),
            eat: z.number(),
          }),
        ),
      })
      .parse(
        data(
          await client.callTool({
            name: "get_meal_plan",
            arguments: { start: "2026-11-16", end: "2026-11-22" },
          }),
        ),
      );
    const meal = plan.meals[0];
    if (!meal) throw new Error("Missing planned meal");
    expect(meal).toMatchObject({
      id: z.object({ mealId: z.uuid() }).parse(planned).mealId,
      baseServings: 4,
      cook: 4,
      eat: 4,
    });
    const retry = {
      mealId: meal.id,
      recipeId: savedRecipeId,
      date: "2026-11-16",
    };
    data(await client.callTool({ name: "plan_meal", arguments: retry }));
    expect(
      (
        await client.callTool({
          name: "plan_meal",
          arguments: { ...retry, date: "2026-11-17" },
        })
      ).isError,
    ).toBe(true);
    const stale = await client.callTool({
      name: "remove_planned_meal",
      arguments: { mealId: meal.id, revision: plan.revision - 1 },
    });
    expect(stale.isError).toBe(true);
    data(
      await client.callTool({
        name: "remove_planned_meal",
        arguments: { mealId: meal.id, revision: plan.revision },
      }),
    );
    for (let i = 0; i < 2; i++)
      data(
        await client.callTool({
          name: "add_recipe_to_shopping_list",
          arguments: { recipeId: savedRecipeId },
        }),
      );
    const list = z
      .object({ items: z.array(z.object({ recipeId: z.string().nullable() })) })
      .parse(
        data(
          await client.callTool({ name: "get_shopping_list", arguments: {} }),
        ),
      );
    expect(
      list.items.filter((item) => item.recipeId === savedRecipeId),
    ).toHaveLength(3);
    expect(
      data(
        await client.callTool({ name: "get_account_overview", arguments: {} }),
      ),
    ).toMatchObject({
      name: "MCP test",
      plan: "pro",
      households: [{ personal: true }],
    });
  });
  it("checks household permissions through the existing routers", async () => {
    const [other] = await db
      .select()
      .from(household)
      .where(eq(household.ownerId, free.user.id));
    if (!other) throw new Error("Missing personal household");
    for (const name of [
      "get_shopping_list",
      "get_meal_plan",
      "add_shopping_items",
    ]) {
      const denied = await client.callTool({
        name,
        arguments: {
          householdId: other.id,
          ...(name === "add_shopping_items" ? { items: ["stolen eggs"] } : {}),
        },
      });
      expect(denied.isError).toBe(true);
    }
  });
  it("allows free-user authorisation but checks paid entitlement on every call, including lapses", async () => {
    const registration = await registerClient(send);
    clientIds.push(registration.client_id);
    const freeToken = (
      await issueToken(free.cookie, registration.client_id, send)
    ).access_token;
    const freeClient = await connect(freeToken);
    expect((await freeClient.listTools()).tools.length).toBe(11);
    const denied = await freeClient.callTool({
      name: "add_shopping_items",
      arguments: { items: ["eggs"] },
    });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied)).toContain("/pricing");
    await db
      .update(billingAccount)
      .set({ validUntil: new Date(Date.now() - 1000) })
      .where(eq(billingAccount.userId, paid.user.id));
    const lapsed = await client.callTool({
      name: "get_recipe",
      arguments: { recipeId: savedRecipeId },
    });
    expect(lapsed.isError).toBe(true);
    expect(JSON.stringify(lapsed)).toContain("PRO_REQUIRED");
    await db
      .update(billingAccount)
      .set({ validUntil: new Date(Date.now() + 86400_000) })
      .where(eq(billingAccount.userId, paid.user.id));
    data(
      await client.callTool({
        name: "get_recipe",
        arguments: { recipeId: savedRecipeId },
      }),
    );
  });
  it("disconnects immediately and rejects the old token over HTTP", async () => {
    const [consent] = await db
      .select()
      .from(oauthConsent)
      .where(eq(oauthConsent.userId, paid.user.id));
    if (!consent) throw new Error("Missing consent");
    await auth.api.disconnectAssistant({
      headers: new Headers({ cookie: paid.cookie }),
      body: { id: consent.id },
    });
    expect(
      (
        await fetch(`${base}/api/mcp`, {
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(401);
    const clientId = clientIds[0];
    if (!clientId) throw new Error("Missing client");
    const reconnected = await issueToken(paid.cookie, clientId, send);
    // Re-consenting immediately must never revive a disconnected JWT, even
    // when both grants were created within the same timestamp second.
    expect(
      (
        await fetch(`${base}/api/mcp`, {
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(401);
    expect(
      (await (await connect(reconnected.access_token)).listTools()).tools,
    ).toHaveLength(11);
  });
});
