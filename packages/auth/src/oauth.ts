import {
  getOAuthProviderApi,
  type OAuthOptions,
} from "@better-auth/oauth-provider";
import { env } from "@prep-sheet/env/server";
import {
  APIError,
  createAuthEndpoint,
  sessionMiddleware,
} from "better-auth/api";
import { z } from "zod";

export const mcpResource = `${new URL(env.BETTER_AUTH_URL).origin}/api/mcp`;
export const oauthOptions = {
  loginPage: "/login",
  consentPage: "/connect-assistant",
  scopes: ["openid", "profile", "email", "offline_access", "kitchenbinder"],
  grantTypes: ["authorization_code", "refresh_token"],
  allowDynamicClientRegistration: true,
  allowUnauthenticatedClientRegistration: true,
  clientRegistrationDefaultResources: [mcpResource],
  resources: [{ identifier: mcpResource, name: "Kitchenbinder" }],
  extensions: [
    {
      claims: {
        accessToken: async ({ ctx, user, client }) => {
          if (!user) return {};
          const consent = await ctx.context.adapter.findOne<{ id: string }>({
            model: "oauthConsent",
            where: [
              { field: "clientId", value: client.clientId },
              { field: "userId", value: user.id },
            ],
          });
          if (!consent) throw new APIError("UNAUTHORIZED");
          return { kitchenbinder_grant: consent.id };
        },
      },
    },
  ],
  // Resource/client administration is never part of an assistant connection.
  resourcePrivileges: () => false,
} satisfies OAuthOptions<string[]>;

const identity = z.object({
  sub: z.string().min(1),
  sid: z.string().min(1),
  client_id: z.string().min(1),
  aud: z.union([z.string(), z.array(z.string())]),
  scope: z.string(),
  iat: z.number(),
  kitchenbinder_grant: z.string().min(1),
  cnf: z.unknown().optional(),
});

/** Uses the provider's local signature, expiry, client and session validation. */
export function mcpIdentityPlugin() {
  return {
    id: "kitchenbinder-mcp",
    endpoints: {
      mcpIdentity: createAuthEndpoint(
        "/mcp/identity",
        { method: "GET" },
        async (ctx) => {
          const token = ctx.headers
            ?.get("authorization")
            ?.match(/^Bearer (\S+)$/i)?.[1];
          if (!token) throw new APIError("UNAUTHORIZED");
          const payload = identity.safeParse(
            await getOAuthProviderApi(
              ctx,
              oauthOptions,
            ).requireActiveAccessToken(token),
          );
          if (!payload.success) throw new APIError("UNAUTHORIZED");
          const claims = payload.data;
          const audiences =
            typeof claims.aud === "string" ? [claims.aud] : claims.aud;
          if (
            !audiences.includes(mcpResource) ||
            !claims.scope.split(" ").includes("kitchenbinder") ||
            claims.cnf
          ) {
            throw new APIError("UNAUTHORIZED");
          }
          // Deleting a provider consent alone does not revoke an existing JWT.
          // Check the grant on every request, including grants recreated after revoke.
          const consent = await ctx.context.adapter.findOne<{
            id: string;
            scopes: string[];
          }>({
            model: "oauthConsent",
            where: [
              { field: "clientId", value: claims.client_id },
              { field: "userId", value: claims.sub },
            ],
          });
          if (
            !consent?.scopes.includes("kitchenbinder") ||
            consent.id !== claims.kitchenbinder_grant
          ) {
            throw new APIError("UNAUTHORIZED");
          }
          return {
            userId: claims.sub,
            sessionId: claims.sid,
            clientId: claims.client_id,
          };
        },
      ),
      disconnectAssistant: createAuthEndpoint(
        "/mcp/disconnect",
        {
          method: "POST",
          use: [sessionMiddleware],
          body: z.object({ id: z.string().min(1) }),
        },
        async (ctx) => {
          const consent = await ctx.context.adapter.findOne<{
            clientId: string;
            userId: string;
          }>({
            model: "oauthConsent",
            where: [{ field: "id", value: ctx.body.id }],
          });
          if (!consent || consent.userId !== ctx.context.session.user.id)
            throw new APIError("NOT_FOUND");
          const where = [
            { field: "clientId", value: consent.clientId },
            { field: "userId", value: consent.userId },
          ];
          // Revoke refresh tokens too, so reconnect requires fresh authorisation.
          for (const model of ["oauthAccessToken", "oauthRefreshToken"]) {
            await ctx.context.adapter.updateMany({
              model,
              where,
              update: { revoked: new Date() },
            });
          }
          await ctx.context.adapter.delete({
            model: "oauthConsent",
            where: [{ field: "id", value: ctx.body.id }],
          });
          return { success: true };
        },
      ),
    },
  };
}
