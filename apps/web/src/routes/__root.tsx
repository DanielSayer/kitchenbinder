import type { AppRouter } from "@prep-sheet/api/routers/index";
import { Toaster } from "@prep-sheet/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { AccountQueryBoundary } from "../components/account-query-boundary";
import { CollectionProvider } from "../components/groups/collection-context";
import Header from "../components/header";
import { getSiteOrigin } from "../functions/get-site-origin";

import appCss from "../index.css?url";

interface RouterAppContext {
  trpc: TRPCOptionsProxy<AppRouter>;
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  loader: () => getSiteOrigin(),
  head: ({ loaderData }) => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      {
        title: "Kitchenbinder · Good recipes, all together",
      },
      {
        name: "description",
        content:
          "Your recipes, ready to cook. Save and organise recipes with Kitchenbinder.",
      },
      { name: "theme-color", content: "#faf7ef" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Kitchenbinder" },
      {
        property: "og:title",
        content: "Kitchenbinder · Good recipes, all together",
      },
      {
        property: "og:description",
        content:
          "Your recipes, ready to cook. Save and organise recipes with Kitchenbinder.",
      },
      {
        property: "og:image",
        content: `${loaderData}/branding/share-1200x630.png`,
      },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:type", content: "image/png" },
      {
        property: "og:image:alt",
        content:
          "Kitchenbinder. Your recipes, ready to cook. Recipe sheet and kitchen knife logo.",
      },
      { name: "twitter:card", content: "summary_large_image" },
      {
        name: "twitter:title",
        content: "Kitchenbinder · Good recipes, all together",
      },
      {
        name: "twitter:description",
        content:
          "Your recipes, ready to cook. Save and organise recipes with Kitchenbinder.",
      },
      {
        name: "twitter:image",
        content: `${loaderData}/branding/share-1200x630.png`,
      },
      {
        name: "twitter:image:alt",
        content: "Kitchenbinder. Your recipes, ready to cook.",
      },
    ],
    links: [
      { rel: "icon", href: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      {
        rel: "icon",
        href: "/branding/favicon-32.png",
        type: "image/png",
        sizes: "32x32",
      },
      {
        rel: "icon",
        href: "/branding/favicon-16.png",
        type: "image/png",
        sizes: "16x16",
      },
      {
        rel: "apple-touch-icon",
        href: "/apple-touch-icon.png",
        sizes: "180x180",
      },
      { rel: "manifest", href: "/site.webmanifest" },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),

  component: RootDocument,
});

function RootDocument() {
  return (
    <html lang="en">
      <head>
        {import.meta.env.DEV && (
          <script src="/@prep-sheet/local-cache-recovery.js" />
        )}
        <HeadContent />
      </head>

      <body>
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>

        <div className="app-shell">
          <AccountQueryBoundary>
            <CollectionProvider>
              <Header />
              <Outlet />
            </CollectionProvider>
          </AccountQueryBoundary>
        </div>

        <Toaster richColors theme="light" />
        <Scripts />
      </body>
    </html>
  );
}
