import { useEffect, useRef, useState } from "react";

const searchDebounceMs = 250;

/** Keep typing immediate while the URL follows after a pause. */
export function useLibrarySearch(
  search: string,
  onSearch: (text: string) => void,
) {
  const [input, setInput] = useState({ source: search, text: search });
  const timer = useRef<number | undefined>(undefined);
  // Back/forward navigation replaces idle input. An in-flight draft keeps its text.
  if (input.source !== search) {
    setInput({
      source: search,
      text: timer.current === undefined ? search : input.text,
    });
  }
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function typeSearch(text: string) {
    setInput((current) => ({ ...current, text }));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      onSearch(text);
    }, searchDebounceMs);
  }
  return { searchText: input.text, typeSearch };
}
