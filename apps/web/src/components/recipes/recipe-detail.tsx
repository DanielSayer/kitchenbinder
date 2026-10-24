import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getRouteApi,
  useLocation,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { TRPCClientError } from "@trpc/client";
import {
  ArrowLeft,
  Clock,
  Flame,
  MoreHorizontal,
  ShoppingBasket,
  Star,
} from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AddToCollectionSheet } from "@/components/collections/add-to-collection-sheet";
import { householdTone } from "@/components/collections/use-collections";
import { ErrorNotice, LoadingState } from "@/components/feedback";
import { useHouseholdScope } from "@/components/households/household-context";
import {
  RecipeCover,
  StickyCta,
  toneColor,
  toneForTags,
  undoToast,
} from "@/components/pantry";
import { authClient } from "@/lib/auth-client";
import { useTRPC, useTRPCClient } from "@/utils/trpc";
import { CookMode } from "./cook-mode";
import { CookingHistory } from "./cooking-history";
import { FavouriteButton } from "./favourite-button";
import { ingredientKeys, useIngredientProgress } from "./ingredient-progress";
import { RecipeActionsSheet } from "./recipe-actions-sheet";
import { RecipeBody } from "./recipe-body";
import {
  readRecipeDraft,
  recipeDraftKey,
  writeRecipeDraft,
} from "./recipe-draft";
import { RecipeEditor } from "./recipe-editor";
import { shortRecipeTime } from "./recipe-time";
import { parseServings } from "./scale-ingredients";
import { useRestoreRecipe } from "./use-restore-recipe";

const detailRoute = getRouteApi("/_auth/recipes/$recipeId");

function formatCookedOn(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${value}T00:00:00`));
}

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function sourceHost(url: string | null) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function RecipeDetail({ id }: { id: string }) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const { data: session } = authClient.useSession();
  const userId = session?.user.id;
  const draftKey = recipeDraftKey(userId ?? "guest", id);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();
  const householdId = useHouseholdScope();
  const { cook } = detailRoute.useSearch();
  const fromRecipeCollection = useLocation({
    select: (location) => location.state.fromRecipeCollection,
  });
  const recipe = useQuery(trpc.recipes.get.queryOptions({ id }));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    setEditing(!!readRecipeDraft(draftKey));
  }, [draftKey]);
  const [sheet, setSheet] = useState<"actions" | "collections" | null>(null);
  const [servings, setServings] = useState<number | null>(null);
  const restore = useRestoreRecipe();
  const progress = useIngredientProgress(
    userId ? `cooking-progress:${userId}:${id}` : undefined,
  );

  const returnToCollection = () => {
    if (fromRecipeCollection) router.history.back();
    else void navigate({ to: "/recipes" });
  };
  // Close with Back when we pushed the cook entry; otherwise replace it.
  const openedCook = useRef(false);
  const setCooking = (open: boolean) => {
    if (open) {
      openedCook.current = true;
      void navigate({
        to: "/recipes/$recipeId",
        params: { recipeId: id },
        search: { cook: true },
        state: (old) => old,
      });
    } else if (cook && openedCook.current) {
      openedCook.current = false;
      router.history.back();
    } else if (cook)
      void navigate({
        to: "/recipes/$recipeId",
        params: { recipeId: id },
        search: {},
        replace: true,
      });
  };

  const update = useMutation(
    trpc.recipes.update.mutationOptions({
      onSuccess: async () => {
        writeRecipeDraft(draftKey, null);
        await Promise.all([
          recipe.refetch(),
          queryClient.invalidateQueries({
            queryKey: trpc.recipes.list.queryKey(),
          }),
        ]);
        setEditing(false);
        toast.success("Recipe updated.");
      },
    }),
  );

  const copyRequest = useRef<{
    id: string;
    draft: string;
    source: string;
  } | null>(null);
  const copy = useMutation(trpc.recipes.createManual.mutationOptions());

  // Undo, not "are you sure": soft-delete now, restore on Undo.
  const remove = useMutation(
    trpc.recipes.delete.mutationOptions({
      onSuccess: async () => {
        const shared = recipe.data?.sharedWith.some((item) => !item.personal);
        returnToCollection();
        undoToast(
          shared
            ? "Recipe deleted for everyone it's shared with"
            : "Recipe deleted",
          { duration: 8000, onUndo: () => restore.mutate({ id }) },
        );
        await queryClient.invalidateQueries();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const addToList = useMutation(
    trpc.shopping.addRecipes.mutationOptions({
      onSuccess: async ({ addedRecipes }) => {
        await queryClient.invalidateQueries({
          queryKey: trpc.shopping.pathKey(),
        });
        toast.success(
          addedRecipes
            ? "Ingredients added to your shopping list."
            : "This recipe is already on your list.",
        );
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const logCook = () => {
    const entryId = crypto.randomUUID();
    setCooking(false);
    void client.recipes.saveCooking
      .mutate({ id, entryId, cookedOn: today(), note: "" })
      .then(async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.recipes.pathKey(),
        });
        undoToast("Cook logged for today. Enjoy!", {
          onUndo: () =>
            void client.recipes.deleteCooking.mutate({ id, entryId }).then(() =>
              queryClient.invalidateQueries({
                queryKey: trpc.recipes.pathKey(),
              }),
            ),
        });
      })
      .catch((error: Error) => toast.error(error.message));
  };

  const data = recipe.data;
  const content = data?.content;
  const base = parseServings(content?.servings);
  const factor = base && servings ? servings / base : 1;
  const keys = content ? ingredientKeys(content.ingredients) : [];
  const time = content ? shortRecipeTime(content) : null;
  const host = sourceHost(data?.sourceUrl ?? null);
  const sharedHouseholds = data?.sharedWith.filter((item) => !item.personal);

  return (
    <main
      id="main-content"
      className="recipe-page"
      data-editing={editing || undefined}
    >
      <LoadingState pending={recipe.isPending} label="Loading recipe...">
        {recipe.error && (
          <div className="page-width">
            <ErrorNotice
              message={recipe.error.message}
              retry={() => void recipe.refetch()}
            />
          </div>
        )}

        {data && content && (!recipe.isError || editing) ? (
          editing ? (
            <div className="page-width recipe-editing">
              <button
                type="button"
                className="back-link"
                onClick={() => setEditing(false)}
              >
                <ArrowLeft size={17} aria-hidden="true" /> Back to recipe
              </button>
              <h1 className="recipe-title">Edit {data.title}</h1>
              <RecipeEditor
                key={draftKey}
                draftKey={draftKey}
                content={data.content}
                savedRevision={data.revision}
                loadLatest={async () => {
                  const result = await recipe.refetch();
                  if (result.error) throw result.error;
                  if (!result.data) throw new Error("Recipe not found.");
                  return result.data;
                }}
                pending={update.isPending || copy.isPending}
                onSave={async (next, expectedRevision) => {
                  if (expectedRevision === null)
                    throw new Error("Reload the recipe before saving.");
                  try {
                    await update.mutateAsync({
                      id,
                      content: next,
                      expectedRevision,
                    });
                  } catch (error) {
                    if (
                      error instanceof TRPCClientError &&
                      error.data?.code === "CONFLICT"
                    )
                      return "conflict";
                    throw error;
                  }
                }}
                onSaveCopy={async (next) => {
                  const draft = JSON.stringify(next);
                  if (
                    copyRequest.current?.draft !== draft ||
                    copyRequest.current.source !== draftKey
                  ) {
                    copyRequest.current = {
                      id: crypto.randomUUID(),
                      draft,
                      source: draftKey,
                    };
                  }
                  const saved = await copy.mutateAsync({
                    id: copyRequest.current.id,
                    content: next,
                  });
                  writeRecipeDraft(draftKey, null);
                  await queryClient.invalidateQueries({
                    queryKey: trpc.recipes.list.queryKey(),
                  });
                  await navigate({
                    to: "/recipes/$recipeId",
                    params: { recipeId: saved.id },
                  });
                  toast.success("Copy saved to your recipes.");
                }}
                onCancel={() => setEditing(false)}
              />
            </div>
          ) : (
            <>
              <div className="recipe-hero">
                <RecipeCover
                  id={data.id}
                  title={data.title}
                  photo={data.photo}
                  tone={toneForTags(data.tags.map((tag) => tag.name))}
                  size="detail"
                />
                <div className="recipe-float-bar">
                  <button
                    type="button"
                    className="glass-button"
                    aria-label="Back to recipes"
                    onClick={returnToCollection}
                  >
                    <ArrowLeft size={22} aria-hidden="true" />
                  </button>
                  <span className="recipe-float-group">
                    <FavouriteButton
                      id={data.id}
                      title={data.title}
                      isFavourite={data.isFavourite}
                      className="glass-button"
                    />
                    <button
                      type="button"
                      className="glass-button"
                      aria-label="Recipe actions"
                      aria-haspopup="dialog"
                      onClick={() => setSheet("actions")}
                    >
                      <MoreHorizontal size={22} aria-hidden="true" />
                    </button>
                  </span>
                </div>
              </div>

              <div className="recipe-sheet page-width">
                <div className="recipe-pills">
                  {!data.isOwner ? (
                    <span className="recipe-pill recipe-pill-owner">
                      Shared by {data.owner?.name ?? "a former member"}
                    </span>
                  ) : null}
                  {sharedHouseholds?.map((household) => (
                    <span
                      key={household.id}
                      className="recipe-pill recipe-pill-household"
                      style={
                        {
                          "--hc": toneColor(householdTone(household.color)),
                        } as CSSProperties
                      }
                    >
                      {household.name}
                    </span>
                  ))}
                  {data.tags.map((tag) => (
                    <span key={tag.id} className="recipe-pill">
                      {tag.name}
                    </span>
                  ))}
                </div>
                <h1 className="recipe-title">{data.title}</h1>
                <div className="recipe-meta-line">
                  {time ? (
                    <span>
                      <b>{time}</b>
                    </span>
                  ) : null}
                  {data.rating ? (
                    <span className="recipe-meta-stars">
                      <Star
                        size={14}
                        fill="currentColor"
                        className="star-icon"
                        aria-hidden="true"
                      />
                      {data.rating}
                      <span className="pantry-visually-hidden"> out of 5</span>
                    </span>
                  ) : (
                    <span>Not rated</span>
                  )}
                  {host ? (
                    <a
                      href={data.sourceUrl ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                    >
                      from {host}
                    </a>
                  ) : data.origin === "generated" ? (
                    <span>AI-generated · give it a read first</span>
                  ) : null}
                </div>

                <dl className="recipe-facts">
                  {content.prepMinutes !== null ? (
                    <div>
                      <dt>Prep</dt>
                      <dd>{content.prepMinutes} min</dd>
                    </div>
                  ) : null}
                  {content.cookMinutes !== null ? (
                    <div>
                      <dt>Cook</dt>
                      <dd>{content.cookMinutes} min</dd>
                    </div>
                  ) : null}
                  {content.totalMinutes != null ? (
                    <div>
                      <dt>Total</dt>
                      <dd>{content.totalMinutes} min</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Ingredients</dt>
                    <dd>{content.ingredients.length}</dd>
                  </div>
                </dl>

                {data.cookedCount > 0 ? (
                  <a className="recipe-history-card" href="#recipe-history">
                    <Clock size={18} aria-hidden="true" />
                    <span>
                      Cooked{" "}
                      <b>
                        {data.cookedCount}{" "}
                        {data.cookedCount === 1 ? "time" : "times"}
                      </b>
                      {data.lastCookedOn
                        ? ` · last on ${formatCookedOn(data.lastCookedOn)}`
                        : ""}
                    </span>
                  </a>
                ) : null}

                {content.description ? (
                  <p className="recipe-description">{content.description}</p>
                ) : null}

                <RecipeBody
                  key={`body-${userId}-${id}`}
                  content={content}
                  servings={servings ?? base}
                  onServingsChange={setServings}
                  progress={progress}
                />

                {userId ? (
                  <div id="recipe-history">
                    <CookingHistory
                      key={`cooking-${userId}-${id}`}
                      id={id}
                      userId={userId}
                    />
                  </div>
                ) : null}

                <StickyCta className="recipe-cta">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Add ingredients to shopping list"
                    title="Add to shopping list"
                    disabled={addToList.isPending}
                    onClick={() =>
                      addToList.mutate({ recipeIds: [id], householdId })
                    }
                  >
                    <ShoppingBasket size={24} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => setCooking(true)}
                  >
                    <Flame size={18} aria-hidden="true" /> Start cooking
                  </button>
                </StickyCta>
              </div>

              <RecipeActionsSheet
                open={sheet === "actions"}
                onOpenChange={(open) => setSheet(open ? "actions" : null)}
                recipe={data}
                onEdit={() => setEditing(true)}
                onDelete={() => remove.mutate({ id })}
                onAddToCollection={() => setSheet("collections")}
              />
              <AddToCollectionSheet
                open={sheet === "collections"}
                onOpenChange={(open) => setSheet(open ? "collections" : null)}
                recipeIds={[id]}
                memberOf={data.collectionIds}
              />
              {cook ? (
                <CookMode
                  recipeId={id}
                  content={content}
                  factor={factor}
                  ingredientChecks={{
                    keys,
                    checked: progress.checked,
                    toggle: (key) => {
                      const next = new Set(progress.checked);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      progress.update(next);
                    },
                  }}
                  onClose={() => setCooking(false)}
                  onFinish={logCook}
                />
              ) : null}
            </>
          )
        ) : null}
      </LoadingState>
    </main>
  );
}
