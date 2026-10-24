import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronRight,
  CircleUserRound,
  Download,
  KeyRound,
  LifeBuoy,
  LogOut,
  Plus,
  Puzzle,
  Shield,
  Sparkles,
  Tag,
  Trash2,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Billing } from "@/components/billing";
import { ConnectedExtensions } from "@/components/connected-extensions";
import { ErrorNotice, LoadingState } from "@/components/feedback";
import {
  useHousehold,
  useHouseholdSheet,
} from "@/components/households/household-context";
import {
  HouseholdMark,
  MemberAvatars,
  memberCount,
} from "@/components/households/household-ui";
import { InstallButton } from "@/components/install-app";
import {
  LinkedAccounts,
  linkedProviderNames,
  useLinkedAccounts,
} from "@/components/linked-accounts";
import { Sheet } from "@/components/pantry";
import { ReportForm } from "@/components/report-form";
import { initialsOf } from "@/components/shell/destinations";
import { SupportContact } from "@/components/support-contact";
import { useSignOut } from "@/components/user-menu";
import { getSupportContact } from "@/functions/get-support-contact";
import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/_auth/settings")({
  loader: () => getSupportContact(),
  validateSearch: (search): { billing?: string } => ({
    billing: search.billing === "1" || search.billing === 1 ? "1" : undefined,
  }),
  ssr: false,
  component: You,
});

type YouSheet = "plan" | "extensions" | "accounts" | "help";

const sheetTitles: Record<YouSheet, string> = {
  plan: "Plan & billing",
  extensions: "Browser extension",
  accounts: "Linked accounts",
  help: "Help & feedback",
};

/** "You": everything that isn't cooking, in grouped lists. */
function You() {
  const { email: supportEmail } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const signOut = useSignOut();
  const accounts = useLinkedAccounts();
  const [sheet, setSheet] = useState<YouSheet | null>(
    search.billing ? "plan" : null,
  );
  const providers = linkedProviderNames(accounts.data);

  function close() {
    setSheet(null);
    if (search.billing)
      void navigate({ to: "/settings", search: {}, replace: true });
  }

  return (
    <main id="main-content" className="page-width you-page">
      {session && (
        <div className="you-me">
          <span className="avatar" aria-hidden="true">
            {initialsOf(session.user.name)}
          </span>
          <div>
            <b>{session.user.name}</b>
            <small>
              {session.user.email}
              {providers ? ` · ${providers}` : ""}
            </small>
          </div>
          <button
            type="button"
            className="button button-ghost button-small you-sign-out you-sign-out-desktop"
            onClick={() => void signOut()}
          >
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
        </div>
      )}

      <PlanCard onOpen={() => setSheet("plan")} />

      <YouHouseholds />

      <p className="grouped-label">Recipes</p>
      <div className="pantry-list">
        <YouRow icon={<Tag size={20} />} to="/settings/tags">
          Tags
        </YouRow>
        <YouRow icon={<Trash2 size={20} />} to="/recipes/deleted">
          Recently deleted
        </YouRow>
      </div>

      <p className="grouped-label">App</p>
      <div className="pantry-list">
        <InstallButton className="pantry-row">
          <span className="pantry-row-icon">
            <Download size={20} aria-hidden="true" />
          </span>
          <span className="pantry-row-text">
            <b>Install on home screen</b>
          </span>
          <ChevronRight
            size={18}
            className="pantry-row-go"
            aria-hidden="true"
          />
        </InstallButton>
        <YouRow
          icon={<Puzzle size={20} />}
          onClick={() => setSheet("extensions")}
        >
          Browser extension
        </YouRow>
        <YouRow
          icon={<KeyRound size={20} />}
          sub={providers || undefined}
          onClick={() => setSheet("accounts")}
        >
          Linked accounts
        </YouRow>
      </div>

      <p className="grouped-label">Help &amp; privacy</p>
      <div className="pantry-list">
        <YouRow icon={<LifeBuoy size={20} />} onClick={() => setSheet("help")}>
          Help &amp; feedback
        </YouRow>
        <YouRow icon={<Shield size={20} />} to="/privacy">
          Privacy
        </YouRow>
        <YouRow
          icon={<CircleUserRound size={20} />}
          to="/settings/delete-account"
        >
          Delete account
        </YouRow>
      </div>

      <button
        type="button"
        className="button button-ghost button-block you-sign-out you-sign-out-mobile"
        onClick={() => void signOut()}
      >
        Sign out
      </button>

      <Sheet
        open={sheet !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title={sheet ? sheetTitles[sheet] : ""}
        className="you-sheet"
      >
        {sheet === "plan" && <Billing />}
        {sheet === "extensions" && <ConnectedExtensions />}
        {sheet === "accounts" && <LinkedAccounts />}
        {sheet === "help" && (
          <div className="you-help">
            <ReportForm />
            <SupportContact email={supportEmail} />
            <Link to="/support" className="text-button">
              More help
            </Link>
          </div>
        )}
      </Sheet>
    </main>
  );
}

function YouRow({
  icon,
  children,
  sub,
  to,
  onClick,
}: {
  icon: ReactNode;
  children: ReactNode;
  sub?: ReactNode;
  to?:
    | "/recipes/deleted"
    | "/privacy"
    | "/settings/tags"
    | "/settings/delete-account";
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="pantry-row-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="pantry-row-text">
        <b>{children}</b>
        {sub ? <small>{sub}</small> : null}
      </span>
      <ChevronRight size={18} className="pantry-row-go" aria-hidden="true" />
    </>
  );
  return to ? (
    <Link to={to} className="pantry-row">
      {content}
    </Link>
  ) : (
    <button type="button" className="pantry-row" onClick={onClick}>
      {content}
    </button>
  );
}

function PlanCard({ onOpen }: { onOpen: () => void }) {
  const trpc = useTRPC();
  const status = useQuery(trpc.billing.status.queryOptions());
  const plan = status.data;
  if (status.isError)
    return (
      <ErrorNotice
        message="Couldn't load your plan."
        retry={() => void status.refetch()}
      />
    );
  const tier = !plan
    ? "Plan"
    : plan.tier === "pro"
      ? plan.bucket === "trial"
        ? "Pro trial"
        : "Pro plan"
      : "Free plan";
  let usage: ReactNode = null;
  if (plan) {
    const remaining = Math.max(0, plan.credits - plan.used);
    const limit = plan.recipes;
    const value = limit === null ? remaining : plan.saved;
    const max = Math.max(1, limit === null ? plan.credits : limit);
    const label =
      limit === null
        ? `${remaining} of ${plan.credits} AI credits left`
        : `${plan.saved} of ${limit} recipes saved`;
    usage = (
      <>
        <small>{label}</small>
        <meter
          min={0}
          max={max}
          value={Math.min(value, max)}
          aria-label={label}
        />
      </>
    );
  }
  return (
    <>
      <p className="grouped-label">Plan</p>
      <div className="pantry-list">
        <button
          type="button"
          className="pantry-row you-plan"
          aria-busy={!plan}
          onClick={onOpen}
        >
          <span className="pantry-row-icon" aria-hidden="true">
            <Sparkles size={20} />
          </span>
          <span className="pantry-row-text">
            <b>{tier}</b>
            {usage}
          </span>
          {plan?.tier === "free" && (
            <span className="you-plan-upgrade">See Pro</span>
          )}
          <ChevronRight
            size={18}
            className="pantry-row-go"
            aria-hidden="true"
          />
        </button>
      </div>
    </>
  );
}

function YouHouseholds() {
  const { households } = useHousehold();
  const { openHouseholds } = useHouseholdSheet();
  return (
    <>
      <p className="grouped-label">Households</p>
      <LoadingState
        pending={households.isPending}
        label="Loading households..."
      >
        <ErrorNotice
          message={households.error ? "Couldn't load households." : undefined}
          retry={() => void households.refetch()}
        />
        <div className="pantry-list">
          {households.data?.map((item) => (
            <button
              key={item.id}
              type="button"
              className="pantry-row"
              onClick={() =>
                openHouseholds({ name: "manage", householdId: item.id })
              }
            >
              <HouseholdMark color={item.color} />
              <span className="pantry-row-text">
                <b>{item.name}</b>
                <small>
                  {item.personal
                    ? "Only you · private"
                    : memberCount(item.members.length)}
                </small>
              </span>
              <MemberAvatars members={item.members} />
              <ChevronRight
                size={18}
                className="pantry-row-go"
                aria-hidden="true"
              />
            </button>
          ))}
          <button
            type="button"
            className="pantry-row household-new"
            onClick={() => openHouseholds({ name: "new" })}
          >
            <span className="pantry-row-icon">
              <Plus size={20} aria-hidden="true" />
            </span>
            <span className="pantry-row-text">
              <b>New household</b>
            </span>
          </button>
        </div>
      </LoadingState>
    </>
  );
}
