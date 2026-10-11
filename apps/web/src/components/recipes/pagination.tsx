import { recipePageSize } from "@prep-sheet/db/recipe-list";
import { useCallback, useEffect, useState } from "react";

export { recipePageSize };

// Resolve changed filters during render so a new collection never requests the old page.
export function useRecipePage(key: string, initialPage = 0) {
  const [position, setPosition] = useState({ key, page: initialPage });
  if (position.key !== key) setPosition({ key, page: 0 });
  const page = position.key === key ? position.page : 0;
  const setPage = useCallback(
    (next: number) => setPosition({ key, page: next }),
    [key],
  );
  return { page, setPage };
}

export function RecipePagination({
  page,
  total,
  setPage,
  disabled = false,
}: {
  page: number;
  total: number;
  setPage: (page: number) => void;
  disabled?: boolean;
}) {
  const lastPage = Math.max(0, Math.ceil(total / recipePageSize) - 1);
  useEffect(() => {
    if (page > lastPage) setPage(lastPage);
  }, [page, lastPage, setPage]);
  if (total <= recipePageSize && page === 0) return null;
  return (
    <nav className="recipe-pagination" aria-label="Recipe pages">
      <button
        type="button"
        className="button button-small button-outline"
        disabled={disabled || page === 0}
        onClick={() => setPage(page - 1)}
      >
        Previous
      </button>
      <span role="status">
        Page {Math.min(page, lastPage) + 1} of {lastPage + 1}
      </span>
      <button
        type="button"
        className="button button-small button-outline"
        disabled={disabled || page >= lastPage}
        onClick={() => setPage(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
