import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import { auth } from "./index";
import { mcpResource } from "./oauth";

export const authorizationMetadata = oauthProviderAuthServerMetadata(auth);
export const openIdMetadata = oauthProviderOpenIdConfigMetadata(auth);
export function protectedResourceMetadata() {
  return Response.json(
    {
      resource: mcpResource,
      authorization_servers: [new URL("/api/auth", mcpResource).href],
      scopes_supported: ["kitchenbinder", "offline_access"],
      bearer_methods_supported: ["header"],
      resource_name: "Kitchenbinder",
      resource_documentation: new URL("/mcp", mcpResource).href,
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      },
    },
  );
}
