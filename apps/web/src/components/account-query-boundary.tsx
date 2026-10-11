import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { type ReactNode, useLayoutEffect, useState } from "react";
import { authClient } from "../lib/auth-client";
import { createQueryClient } from "../utils/query-client";
import { TRPCProvider, useTRPCClient } from "../utils/trpc";

// The router's request-scoped client still handles SSR hydration. All app
// content uses this inner provider, which retires that client on the first
// identity change and never reuses a retired client, even for the same account.
export function AccountQueryBoundary({ children }: { children: ReactNode }) {
  const { data: session } = authClient.useSession();
  const accountId = session?.user.id ?? null;
  const initialQueryClient = useQueryClient();
  const trpcClient = useTRPCClient();
  const router = useRouter();
  const [scope, setScope] = useState(() => ({
    accountId,
    queryClient: initialQueryClient,
  }));

  useLayoutEffect(() => {
    if (scope.accountId === accountId) return;

    // Cancellation and removal are synchronous. Replacement also isolates
    // transports that ignore abort and late mutation callbacks holding the
    // old client: neither can write into the next account's active cache.
    void scope.queryClient.cancelQueries();
    scope.queryClient.clear();
    const queryClient = createQueryClient();
    router.update({
      context: {
        ...router.options.context,
        queryClient,
        trpc: createTRPCOptionsProxy({ client: trpcClient, queryClient }),
      },
    });
    setScope({ accountId, queryClient });
  }, [accountId, router, scope, trpcClient]);

  // Effects alone are too late: fresh or stale data could otherwise render
  // with the new session before the previous account's cache is retired.
  if (scope.accountId !== accountId) return null;

  return (
    <QueryClientProvider client={scope.queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={scope.queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
