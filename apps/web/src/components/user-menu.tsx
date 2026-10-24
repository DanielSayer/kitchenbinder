import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@prep-sheet/ui/components/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
  ChevronDown,
  CreditCard,
  LifeBuoy,
  LogIn,
  LogOut,
  Settings,
  Shield,
  UserRound,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { InstallMenuItem } from "./install-app";
import { initialsOf, isYouPath } from "./shell/destinations";

/** Sign out, clear cached queries and return home. */
export function useSignOut() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return async function signOut() {
    const result = await authClient.signOut();

    if (result.error) {
      toast.error("Couldn't sign out. Please try again.");

      return;
    }

    queryClient.clear();
    await router.invalidate();
    await router.navigate({ to: "/" });
  };
}

export default function UserMenu() {
  const { data: session, isPending } = authClient.useSession();
  const signOut = useSignOut();
  const accountActive = useRouterState({
    select: (state) => isYouPath(state.location.pathname),
  });

  if (isPending)
    return (
      <span
        className="account-placeholder"
        role="status"
        aria-label="Loading account"
      />
    );

  if (!session)
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          className="account account-trigger"
          aria-label="Account menu"
          data-active={accountActive}
        >
          <span className="avatar">
            <UserRound size={16} />
          </span>
          <ChevronDown
            size={14}
            className="account-chevron"
            aria-hidden="true"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="collection-select-menu account-menu"
          align="end"
          sideOffset={8}
        >
          <InstallMenuItem />
          <DropdownMenuItem
            className="collection-select-manage"
            render={<Link to="/login" />}
          >
            <LogIn size={16} /> Sign in
          </DropdownMenuItem>
          <DropdownMenuItem
            className="collection-select-manage"
            render={<Link to="/pricing" />}
          >
            <CreditCard size={16} /> Plans &amp; pricing
          </DropdownMenuItem>
          <DropdownMenuItem
            className="collection-select-manage"
            render={<Link to="/support" />}
          >
            <LifeBuoy size={16} /> Support / report a problem
          </DropdownMenuItem>
          <DropdownMenuItem
            className="collection-select-manage"
            render={<Link to="/privacy" />}
          >
            <Shield size={16} /> Privacy
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="account account-trigger"
        aria-label="Account menu"
        data-active={accountActive}
      >
        <span className="avatar" aria-hidden="true">
          {initialsOf(session.user.name)}
        </span>

        <span className="account-name">{session.user.name}</span>
        <ChevronDown size={14} className="account-chevron" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="collection-select-menu account-menu"
        align="end"
        sideOffset={8}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="account-menu-name">
            {session.user.name}
          </DropdownMenuLabel>
          <InstallMenuItem />
          <DropdownMenuItem
            className="collection-select-manage"
            render={<Link to="/settings" />}
          >
            <Settings size={16} /> Settings
          </DropdownMenuItem>
          <DropdownMenuItem
            className="collection-select-manage"
            render={<Link to="/households" />}
          >
            <Users size={16} /> Households
          </DropdownMenuItem>
          <DropdownMenuItem
            className="collection-select-manage"
            render={<Link to="/support" />}
          >
            <LifeBuoy size={16} /> Support / report a problem
          </DropdownMenuItem>
          <DropdownMenuItem
            className="collection-select-manage"
            render={<Link to="/privacy" />}
          >
            <Shield size={16} /> Privacy
          </DropdownMenuItem>
          <DropdownMenuItem
            className="collection-select-manage"
            onClick={signOut}
          >
            <LogOut size={16} /> Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
