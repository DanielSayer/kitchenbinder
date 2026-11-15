import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { ErrorNotice } from "@/components/feedback";
import { LargeTitle } from "@/components/pantry";
import { getSiteOrigin } from "@/functions/get-site-origin";
import { assistantGuides } from "@/lib/assistant-guides";
import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/mcp")({
  loader: () => getSiteOrigin(),
  head: () => ({
    meta: [{ title: "Connect your AI assistant | Kitchenbinder" }],
  }),
  component: AssistantGuide,
});
export function AssistantGuide() {
  const origin = Route.useLoaderData();
  const url = `${origin}/api/mcp`;
  const { data: session } = authClient.useSession();
  const trpc = useTRPC();
  const plan = useQuery({
    ...trpc.billing.status.queryOptions(),
    enabled: !!session,
  });
  const [selected, setSelected] = useState("claude");
  const guide =
    assistantGuides.find((guide) => guide.id === selected) ??
    assistantGuides[0];
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setError("");
    } catch {
      setCopied(false);
      setError("Couldn't copy the link. Select it above and copy it manually.");
    }
  }
  return (
    <main id="main-content" className="page-width assistant-page">
      <LargeTitle
        accent="AI assistant"
        sub="Use your recipes, meal plans and shopping lists in a conversation."
      >
        Connect your
      </LargeTitle>
      <section
        className="assistant-card assistant-link"
        aria-labelledby="connection-link-title"
      >
        <h2 id="connection-link-title">Start with this link</h2>
        <label htmlFor="assistant-url">
          Your Kitchenbinder connection link
        </label>
        <input
          id="assistant-url"
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          type="button"
          className="button button-primary button-block"
          onClick={() => void copy()}
        >
          {copied ? (
            <Check size={20} aria-hidden="true" />
          ) : (
            <Copy size={20} aria-hidden="true" />
          )}{" "}
          {copied ? "Copied" : "Copy connection link"}
        </button>
        <span role="status" className="sr-only">
          {copied ? "Connection link copied." : ""}
        </span>
        <ErrorNotice message={error} />
        <p className="assistant-note">
          {plan.data?.tier === "free"
            ? "You'll need to upgrade to Pro to use your assistant with Kitchenbinder. "
            : "Included with Kitchenbinder Pro. "}
          <Link to="/pricing" className="text-button">
            See plans
          </Link>
        </p>
      </section>
      <section
        className="assistant-card"
        aria-labelledby="assistant-steps-title"
      >
        <h2 id="assistant-steps-title">Choose your assistant</h2>
        <div className="assistant-choices">
          {assistantGuides.map((item) => (
            <button
              key={item.id}
              type="button"
              className="button button-outline"
              aria-pressed={selected === item.id}
              onClick={() => setSelected(item.id)}
            >
              {item.name}
            </button>
          ))}
        </div>
        {guide && (
          <>
            <ol className="assistant-steps">
              {guide.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p className="assistant-note">{guide.note}</p>
          </>
        )}
      </section>
      <section
        className="assistant-card"
        aria-labelledby="assistant-examples-title"
      >
        <h2 id="assistant-examples-title">Try asking</h2>
        <ul className="assistant-examples">
          <li>"Add eggs and milk to my shopping list."</li>
          <li>"What's planned for this week?"</li>
          <li>"Write me a recipe for a quick lentil curry and save it."</li>
          <li>"Plan that curry for Tuesday dinner in our family household."</li>
        </ul>
        <p className="assistant-note">
          Name your household when you want to change a shared list or plan.
          Otherwise, your assistant uses your personal household.
        </p>
      </section>
      <section className="assistant-faq" aria-label="Connection questions">
        <details>
          <summary>What can my assistant access?</summary>
          <p>
            It can read your account name, households, recipes, meal plans and
            shopping lists. It can save recipes and update plans and lists in
            any household you belong to. It cannot delete recipes or manage
            household members. Your assistant service handles anything you share
            in the conversation under its own privacy policy.
          </p>
        </details>
        <details>
          <summary>Does saving a recipe use my AI credits?</summary>
          <p>
            No. Your assistant writes the recipe using its own service. Saving
            it in Kitchenbinder uses no Kitchenbinder AI credits.
          </p>
        </details>
        <details>
          <summary>How do I disconnect?</summary>
          <p>
            Open{" "}
            <Link to="/settings" className="text-button">
              Settings
            </Link>{" "}
            in Kitchenbinder and choose Disconnect under Connected assistants.
            You can also remove the connection in your assistant's settings.
          </p>
        </details>
      </section>
    </main>
  );
}
