import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  CreditCard,
  MessageSquare,
  Pencil,
  Puzzle,
  Shield,
  Tag,
  Tags,
  Trash2,
  UserRound,
} from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { AccountControls } from "@/components/account-controls";
import { Billing } from "@/components/billing";
import { ConnectedExtensions } from "@/components/connected-extensions";
import { ErrorNotice, LoadingState } from "@/components/feedback";
import {
  CollectionSelect,
  useCollection,
} from "@/components/groups/collection-context";
import { PrivacyPolicy } from "@/components/privacy-policy";
import { ApplyTagDialog } from "@/components/recipes/bulk-tag-dialog";
import { ReportForm } from "@/components/report-form";
import { SupportContact } from "@/components/support-contact";
import { getSupportContact } from "@/functions/get-support-contact";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/_auth/settings")({
  loader: () => getSupportContact(),
  validateSearch: (search): { billing?: string } => ({
    billing: search.billing === "1" || search.billing === 1 ? "1" : undefined,
  }),
  ssr: false,
  component: Settings,
});

const settingsTabs = [
  { id: "account", label: "Account", icon: UserRound },
  { id: "billing", label: "Plan & billing", icon: CreditCard },
  { id: "tags", label: "Tags", icon: Tag },
  { id: "extensions", label: "Extensions", icon: Puzzle },
  { id: "privacy", label: "Privacy policy", icon: Shield },
  { id: "report", label: "Report a problem", icon: MessageSquare },
];

function subscribeToMobileSettings(onChange: () => void) {
  const media = window.matchMedia("(max-width: 650px)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function Settings() {
  const { email: supportEmail } = Route.useLoaderData();
  const isMobile = useSyncExternalStore(
    subscribeToMobileSettings,
    () => window.matchMedia("(max-width: 650px)").matches,
    () => false,
  );
  const search = Route.useSearch();
  const [activeTab, setActiveTab] = useState(
    search.billing ? "billing" : "account",
  );
  return (
    <main id="main-content" className="page-width settings-page">
      <div className="page-heading">
        <div>
          <h1>
            Settings<span className="title-dot">.</span>
          </h1>
        </div>
      </div>
      <div className="settings-layout">
        <div
          className="settings-tabs"
          role="tablist"
          aria-label="Settings"
          aria-orientation={isMobile ? "horizontal" : "vertical"}
        >
          {settingsTabs.map(({ id, label, icon: Icon }, index) => (
            <button
              key={id}
              id={`settings-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              aria-controls={`settings-panel-${id}`}
              tabIndex={activeTab === id ? 0 : -1}
              onClick={() => setActiveTab(id)}
              onKeyDown={(event) => {
                let nextIndex = index;
                if (event.key === (isMobile ? "ArrowRight" : "ArrowDown"))
                  nextIndex = (index + 1) % settingsTabs.length;
                else if (event.key === (isMobile ? "ArrowLeft" : "ArrowUp"))
                  nextIndex =
                    (index + settingsTabs.length - 1) % settingsTabs.length;
                else if (event.key === "Home") nextIndex = 0;
                else if (event.key === "End")
                  nextIndex = settingsTabs.length - 1;
                else return;
                event.preventDefault();
                const next = settingsTabs[nextIndex];
                if (next) {
                  setActiveTab(next.id);
                  document.getElementById(`settings-tab-${next.id}`)?.focus();
                }
              }}
            >
              <Icon size={17} aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
        <div className="settings-panels">
          <div
            id="settings-panel-billing"
            role="tabpanel"
            aria-label="Plan & billing"
            hidden={activeTab !== "billing"}
          >
            <Billing />
          </div>
          <div
            id="settings-panel-account"
            role="tabpanel"
            aria-label="Account"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Tab panels need a keyboard focus target.
            tabIndex={0}
            hidden={activeTab !== "account"}
          >
            <AccountControls />
          </div>
          <div
            id="settings-panel-tags"
            role="tabpanel"
            aria-label="Tags"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Tab panels need a keyboard focus target.
            tabIndex={0}
            hidden={activeTab !== "tags"}
          >
            <CollectionTags />
          </div>
          <div
            id="settings-panel-extensions"
            role="tabpanel"
            aria-label="Extensions"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Tab panels need a keyboard focus target.
            tabIndex={0}
            hidden={activeTab !== "extensions"}
          >
            <ConnectedExtensions />
          </div>
          <div
            id="settings-panel-privacy"
            role="tabpanel"
            aria-label="Privacy policy"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Tab panels need a keyboard focus target.
            tabIndex={0}
            hidden={activeTab !== "privacy"}
          >
            <h2 className="settings-policy-heading">Privacy policy</h2>
            <PrivacyPolicy embedded />
          </div>
          <div
            id="settings-panel-report"
            role="tabpanel"
            aria-label="Report a problem"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Tab panels need a keyboard focus target.
            tabIndex={0}
            hidden={activeTab !== "report"}
          >
            <ReportForm />
            <SupportContact email={supportEmail} />
          </div>
        </div>
      </div>
    </main>
  );
}

function CollectionTags() {
  const { groupId } = useCollection();
  return <TagSettings key={groupId ?? "personal"} groupId={groupId} />;
}

function TagSettings({ groupId }: { groupId: string | null }) {
  const trpc = useTRPC();
  const client = useQueryClient();
  const tags = useQuery(trpc.tags.list.queryOptions({ groupId }));
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  type TagDetails = Pick<
    NonNullable<typeof tags.data>[number],
    "id" | "name" | "description"
  >;
  const [editing, setEditing] = useState<TagDetails>();
  const [applyTag, setApplyTag] = useState<TagDetails>();
  const [createdTag, setCreatedTag] = useState<TagDetails>();
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: trpc.tags.list.queryKey() }),
      client.invalidateQueries({ queryKey: trpc.recipes.pathKey() }),
    ]);
  };
  const create = useMutation(
    trpc.tags.create.mutationOptions({
      onSuccess: async (saved) => {
        setName("");
        setDescription("");
        setCreatedTag(saved);
        await refresh();
      },
    }),
  );
  const update = useMutation(
    trpc.tags.update.mutationOptions({
      onSuccess: async (saved) => {
        if (createdTag?.id === saved.id) setCreatedTag(saved);
        setEditing(undefined);
        await refresh();
      },
    }),
  );
  const remove = useMutation(
    trpc.tags.delete.mutationOptions({
      onSuccess: async (_result, variables) => {
        if (createdTag?.id === variables.id) setCreatedTag(undefined);
        await refresh();
      },
    }),
  );
  return (
    <>
      <section aria-labelledby="tags-heading">
        <h2 id="tags-heading">Collection tags</h2>
        <p className="settings-intro">
          New recipes use this collection's tags automatically. Everyone in a
          shared collection can see and edit its tags.
        </p>
        <CollectionSelect
          disabled={
            create.isPending ||
            update.isPending ||
            remove.isPending ||
            !!editing ||
            !!applyTag ||
            !!name ||
            !!description
          }
        />
        <form
          className="tag-form"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate({ name, description, groupId });
          }}
        >
          <label>
            Tag name
            <input
              required
              maxLength={40}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Lunchbox"
            />
          </label>
          <label>
            When to use it <span className="muted">optional</span>
            <input
              maxLength={300}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="e.g. Easy to pack and eat cold"
            />
          </label>
          <button
            className="button button-primary"
            type="submit"
            disabled={create.isPending || !name.trim()}
          >
            {create.isPending ? "Adding..." : "Add tag"}
          </button>
        </form>
        {createdTag && (
          <div className="tag-created-callout" role="status">
            <div>
              <strong>{createdTag.name} created.</strong>
              <p>Add it to recipes you already have.</p>
            </div>
            <div className="tag-row-actions">
              <button
                type="button"
                className="button button-small button-primary"
                onClick={() => setApplyTag(createdTag)}
              >
                <Tags size={16} aria-hidden="true" /> Add to recipes
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => setCreatedTag(undefined)}
              >
                Not now
              </button>
            </div>
          </div>
        )}
        <ErrorNotice message={create.error?.message || remove.error?.message} />
        <LoadingState pending={tags.isPending}>
          <ErrorNotice
            message={tags.error?.message}
            retry={() => void tags.refetch()}
          />
          <ul className="settings-tags">
            {tags.data?.map((tag) => (
              <li key={tag.id}>
                {editing?.id === tag.id ? (
                  <form
                    className="tag-edit-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      update.mutate({ ...editing, groupId });
                    }}
                  >
                    <label>
                      Tag name
                      <input
                        required
                        maxLength={40}
                        value={editing.name}
                        disabled={update.isPending}
                        onChange={(event) =>
                          setEditing({
                            ...editing,
                            name: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>
                        When to use it <span className="muted">optional</span>
                      </span>
                      <input
                        maxLength={300}
                        value={editing.description}
                        disabled={update.isPending}
                        onChange={(event) =>
                          setEditing({
                            ...editing,
                            description: event.target.value,
                          })
                        }
                      />
                    </label>
                    <ErrorNotice message={update.error?.message} />
                    <div className="tag-row-actions">
                      <button
                        type="submit"
                        className="button button-small button-primary"
                        disabled={update.isPending || !editing.name.trim()}
                      >
                        {update.isPending ? "Saving..." : "Save changes"}
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        disabled={update.isPending}
                        onClick={() => {
                          update.reset();
                          setEditing(undefined);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div>
                      <div className="tag-row-heading">
                        <strong>{tag.name}</strong>
                        {!tag.userId && !tag.groupId && (
                          <span className="built-in">Built in</span>
                        )}
                      </div>
                      <p>{tag.description}</p>
                    </div>
                    <div className="tag-row-actions">
                      <button
                        type="button"
                        className="button button-small button-outline"
                        onClick={() => setApplyTag(tag)}
                      >
                        <Tags size={16} aria-hidden="true" /> Add to recipes
                      </button>
                      {tag.userId || tag.groupId ? (
                        <>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Edit ${tag.name} tag`}
                            disabled={editing !== undefined}
                            onClick={() => {
                              update.reset();
                              setEditing({
                                id: tag.id,
                                name: tag.name,
                                description: tag.description,
                              });
                            }}
                          >
                            <Pencil size={17} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Delete ${tag.name} tag`}
                            disabled={remove.isPending}
                            onClick={() =>
                              remove.mutate({ id: tag.id, groupId })
                            }
                          >
                            <Trash2 size={17} />
                          </button>
                        </>
                      ) : null}
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </LoadingState>
        <p className="muted">
          Deleting a tag removes it from this collection's recipes. Adding a tag
          won't change existing recipes.
        </p>
      </section>
      {applyTag && (
        <ApplyTagDialog
          tag={applyTag}
          groupId={groupId}
          onClose={() => setApplyTag(undefined)}
          onApplied={() => {
            if (createdTag?.id === applyTag.id) setCreatedTag(undefined);
          }}
        />
      )}
    </>
  );
}
