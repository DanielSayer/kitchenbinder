import { FolderMinus, FolderPlus, Tags as TagsIcon, X } from "lucide-react";
import type { CollectionSummary } from "@/components/collections/use-collections";
import { AddRecipesButton } from "../shopping/add-recipes";

export function LibrarySelectionBar({
  selectedIds,
  pickTarget,
  current,
  hasTags,
  onCancel,
  onAddToTarget,
  onAddToCollection,
  onRemove,
  onTag,
}: {
  selectedIds: string[];
  pickTarget: CollectionSummary | null;
  current?: CollectionSummary;
  hasTags: boolean;
  onCancel: () => void;
  onAddToTarget: (target: CollectionSummary) => void;
  onAddToCollection: () => void;
  onRemove: () => void;
  onTag: () => void;
}) {
  return (
    <section className="library-bulk-bar" aria-label="Selected recipes">
      <div className="library-bulk-summary">
        <strong aria-live="polite">{selectedIds.length} selected</strong>
        <button
          type="button"
          className="icon-button"
          aria-label="Cancel recipe selection"
          onClick={onCancel}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      {selectedIds.length > 100 && (
        <p role="status">Choose up to 100 recipes.</p>
      )}
      <div className="library-bulk-actions">
        {pickTarget ? (
          <button
            type="button"
            className="button button-primary"
            disabled={selectedIds.length === 0}
            onClick={() => onAddToTarget(pickTarget)}
          >
            <FolderPlus size={18} aria-hidden="true" /> Add to {pickTarget.name}
          </button>
        ) : (
          <>
            <AddRecipesButton recipeIds={selectedIds} compact />
            <button
              type="button"
              className="button button-small button-outline"
              disabled={selectedIds.length === 0}
              onClick={onAddToCollection}
            >
              <FolderPlus size={17} aria-hidden="true" /> Add to collection
            </button>
            {current?.isOwner ? (
              <button
                type="button"
                className="button button-small button-outline"
                disabled={selectedIds.length === 0}
                onClick={onRemove}
              >
                <FolderMinus size={17} aria-hidden="true" /> Remove
              </button>
            ) : null}
            <button
              type="button"
              className="button button-small button-outline"
              disabled={
                selectedIds.length === 0 || selectedIds.length > 100 || !hasTags
              }
              onClick={onTag}
            >
              <TagsIcon size={17} aria-hidden="true" /> Tag
            </button>
          </>
        )}
      </div>
    </section>
  );
}
