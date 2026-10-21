import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorNotice } from "@/components/feedback";
import { useTRPC } from "@/utils/trpc";
import { useCollection } from "./collection-context";
import { CollectionDropdown } from "./collection-dropdown";

export function CopyRecipe({
  id,
  sourceGroupId,
}: {
  id: string;
  sourceGroupId: string | null;
}) {
  const { groups } = useCollection();
  const trpc = useTRPC();
  const client = useQueryClient();
  const [target, setTarget] = useState("");
  const copy = useMutation(
    trpc.recipes.copy.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          client.invalidateQueries({ queryKey: trpc.recipes.list.queryKey() }),
          client.invalidateQueries({ queryKey: trpc.tags.list.queryKey() }),
        ]);
        toast.success("Recipe copied. Each copy can be edited separately.");
      },
    }),
  );
  return (
    <div className="recipe-copy">
      <CollectionDropdown
        label="Copy to another collection"
        value={target}
        disabled={copy.isPending}
        onValueChange={(value) => {
          setTarget(value);
          copy.reset();
        }}
        options={[
          ...(sourceGroupId
            ? [{ label: "Personal collection", value: "personal" }]
            : []),
          ...(groups.data
            ?.filter((group) => group.id !== sourceGroupId)
            .map((group) => ({ label: group.name, value: group.id })) ?? []),
        ]}
      />
      <button
        type="button"
        className="button button-small button-outline"
        disabled={!target || copy.isPending || copy.isSuccess}
        onClick={() =>
          copy.mutate({
            id,
            newId: crypto.randomUUID(),
            groupId: target === "personal" ? null : target,
          })
        }
      >
        {copy.isPending
          ? "Copying..."
          : copy.isSuccess
            ? "Copied"
            : "Copy recipe"}
      </button>
      <ErrorNotice message={copy.error?.message} />
    </div>
  );
}
