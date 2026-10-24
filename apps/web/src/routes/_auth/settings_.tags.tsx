import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronRight, Plus, Tag, Tags, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { ErrorNotice, LoadingState } from "@/components/feedback";
import { Sheet } from "@/components/pantry";
import { ApplyTagDialog } from "@/components/recipes/bulk-tag-dialog";
import { SettingsPage } from "@/components/settings-page";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/_auth/settings_/tags")({
  ssr: false,
  component: TagSettings,
});

type TagDetails = { id: string; name: string; description: string };
type Draft = { id?: string; name: string; description: string };
type Open =
  | { kind: "edit"; draft: Draft }
  | { kind: "builtIn"; tag: TagDetails };

// Tags are personal: others see a recipe's tags read-only.
function TagSettings() {
  const trpc = useTRPC();
  const client = useQueryClient();
  const tags = useQuery(trpc.tags.list.queryOptions());
  const [open, setOpen] = useState<Open>();
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
        setOpen(undefined);
        setCreatedTag(saved);
        await refresh();
      },
    }),
  );
  const update = useMutation(
    trpc.tags.update.mutationOptions({
      onSuccess: async (saved) => {
        if (createdTag?.id === saved.id) setCreatedTag(saved);
        setOpen(undefined);
        await refresh();
      },
    }),
  );
  const remove = useMutation(
    trpc.tags.delete.mutationOptions({
      onSuccess: async (_result, variables) => {
        if (createdTag?.id === variables.id) setCreatedTag(undefined);
        setOpen(undefined);
        await refresh();
      },
    }),
  );
  const pending = create.isPending || update.isPending || remove.isPending;

  function show(next: Open) {
    create.reset();
    update.reset();
    remove.reset();
    setOpen(next);
  }
  function apply(tag: TagDetails) {
    setOpen(undefined);
    setApplyTag(tag);
  }

  const own = tags.data?.filter((tag) => tag.userId) ?? [];
  const builtIn = tags.data?.filter((tag) => !tag.userId) ?? [];
  const newTag = () =>
    show({ kind: "edit", draft: { name: "", description: "" } });

  return (
    <SettingsPage
      title="Tags"
      sub="New recipes use your tags automatically. People you share recipes with see them but can't change them."
    >
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
      <LoadingState pending={tags.isPending} label="Loading tags...">
        <ErrorNotice
          message={tags.error?.message}
          retry={() => void tags.refetch()}
        />
        {tags.data && (
          <>
            <p className="grouped-label">Your tags</p>
            <ul className="pantry-list">
              {own.map((tag) => (
                <TagRow
                  key={tag.id}
                  tag={tag}
                  onOpen={() =>
                    show({
                      kind: "edit",
                      draft: {
                        id: tag.id,
                        name: tag.name,
                        description: tag.description,
                      },
                    })
                  }
                />
              ))}
              <li>
                <button
                  type="button"
                  className="pantry-row household-new"
                  onClick={newTag}
                >
                  <span className="pantry-row-icon">
                    <Plus size={20} aria-hidden="true" />
                  </span>
                  <span className="pantry-row-text">
                    <b>New tag</b>
                    {own.length === 0 && (
                      <small>Make your own, like Lunchbox or Date night</small>
                    )}
                  </span>
                </button>
              </li>
            </ul>
            {builtIn.length > 0 && (
              <>
                <p className="grouped-label">Built in</p>
                <ul className="pantry-list">
                  {builtIn.map((tag) => (
                    <TagRow
                      key={tag.id}
                      tag={tag}
                      onOpen={() => show({ kind: "builtIn", tag })}
                    />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </LoadingState>
      <p className="muted tag-page-note">
        Deleting a tag removes it from your recipes. A new tag won't change
        existing recipes until you add it to them.
      </p>

      <TagSheet
        open={open}
        onChange={(draft) => setOpen({ kind: "edit", draft })}
        onClose={() => {
          if (!pending) setOpen(undefined);
        }}
        pending={pending}
        saving={create.isPending || update.isPending}
        deleting={remove.isPending}
        error={
          create.error?.message ||
          update.error?.message ||
          remove.error?.message
        }
        onSave={(value) => {
          if (value.id) update.mutate({ ...value, id: value.id });
          else create.mutate(value);
        }}
        onDelete={(id) => remove.mutate({ id })}
        onApply={apply}
      />
      {applyTag && (
        <ApplyTagDialog
          tag={applyTag}
          onClose={() => setApplyTag(undefined)}
          onApplied={() => {
            if (createdTag?.id === applyTag.id) setCreatedTag(undefined);
          }}
        />
      )}
    </SettingsPage>
  );
}

function TagRow({ tag, onOpen }: { tag: TagDetails; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        className="pantry-row tag-list-row"
        onClick={onOpen}
      >
        <span className="pantry-row-icon" aria-hidden="true">
          <Tag size={20} />
        </span>
        <span className="pantry-row-text">
          <b>{tag.name}</b>
          {tag.description ? <small>{tag.description}</small> : null}
        </span>
        <ChevronRight size={18} className="pantry-row-go" aria-hidden="true" />
      </button>
    </li>
  );
}

function TagSheet({
  open,
  onChange,
  onClose,
  onSave,
  onDelete,
  onApply,
  pending,
  saving,
  deleting,
  error,
}: {
  open: Open | undefined;
  onChange: (draft: Draft) => void;
  onClose: () => void;
  onSave: (draft: Draft) => void;
  onDelete: (id: string) => void;
  onApply: (tag: TagDetails) => void;
  pending: boolean;
  saving: boolean;
  deleting: boolean;
  error?: string;
}) {
  const formId = useId();
  const draft = open?.kind === "edit" ? open.draft : undefined;
  const existing = draft?.id
    ? { id: draft.id, name: draft.name, description: draft.description }
    : undefined;
  return (
    <Sheet
      open={open !== undefined}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={
        open?.kind === "builtIn"
          ? open.tag.name
          : existing
            ? "Edit tag"
            : "New tag"
      }
      footer={
        open?.kind === "builtIn" ? (
          <button
            type="button"
            className="button button-primary button-block"
            onClick={() => onApply(open.tag)}
          >
            <Tags size={18} aria-hidden="true" /> Add to recipes
          </button>
        ) : (
          <button
            type="submit"
            form={formId}
            className="button button-primary button-block"
            disabled={pending || !draft?.name.trim()}
          >
            {saving
              ? existing
                ? "Saving..."
                : "Adding..."
              : existing
                ? "Save changes"
                : "Add tag"}
          </button>
        )
      }
    >
      {open?.kind === "builtIn" && (
        <div className="tag-sheet-built-in">
          <span className="built-in">Built in</span>
          <p>{open.tag.description}</p>
        </div>
      )}
      {draft && (
        <form
          id={formId}
          className="tag-form tag-sheet-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.name.trim() && !pending) onSave(draft);
          }}
        >
          <label>
            Tag name
            <input
              required
              maxLength={40}
              value={draft.name}
              disabled={pending}
              onChange={(event) =>
                onChange({ ...draft, name: event.target.value })
              }
              placeholder="e.g. Lunchbox"
            />
          </label>
          <label>
            When to use it <span className="muted">optional</span>
            <input
              maxLength={300}
              value={draft.description}
              disabled={pending}
              onChange={(event) =>
                onChange({ ...draft, description: event.target.value })
              }
              placeholder="e.g. Easy to pack and eat cold"
            />
          </label>
          <ErrorNotice message={error} />
          {existing && (
            <div className="tag-sheet-actions">
              <button
                type="button"
                className="button button-outline"
                disabled={pending}
                onClick={() => onApply(existing)}
              >
                <Tags size={18} aria-hidden="true" /> Add to recipes
              </button>
              <button
                type="button"
                className="button button-ghost tag-sheet-delete"
                disabled={pending}
                onClick={() => onDelete(existing.id)}
              >
                <Trash2 size={18} aria-hidden="true" />
                {deleting ? "Deleting..." : "Delete tag"}
              </button>
            </div>
          )}
        </form>
      )}
    </Sheet>
  );
}
