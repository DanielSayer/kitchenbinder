import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTRPC } from "../utils/trpc";
import { ErrorNotice } from "./feedback";
import type { SignInProvider } from "./social-sign-in";

export function SignInProviders({
  children,
}: {
  children: (providers: SignInProvider[]) => ReactNode;
}) {
  const trpc = useTRPC();
  const providers = useQuery(trpc.signInProviders.queryOptions());
  if (providers.isPending)
    return <p role="status">Loading sign-in methods...</p>;
  if (providers.isError)
    return (
      <ErrorNotice
        message="Couldn't load sign-in methods."
        retry={() => void providers.refetch()}
      />
    );
  if (providers.data.length === 0)
    return (
      <p role="status">
        Sign-in is temporarily unavailable. Please try again later.
      </p>
    );
  return children(providers.data);
}
