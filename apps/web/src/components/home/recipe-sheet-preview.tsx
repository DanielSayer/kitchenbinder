const ingredients = [
  "200 g pasta",
  "1 tin chickpeas, drained",
  "1 lemon, zest and juice",
  "2 handfuls baby spinach",
  "2 cloves garlic, sliced",
  "2 tbsp olive oil",
  "Parmesan, to serve",
  "Salt and black pepper",
];

// Follows the structure of packages/api/src/recipes/pdf.tsx.
// A fixed example, separate from the user's recipe draft.
export function RecipeSheetPreview() {
  return (
    <aside className="sheet-preview" aria-label="Example printable recipe">
      <article className="sample-sheet">
        <div className="sample-sheet-brand">
          <img src="/branding/icon-192.png" alt="" width={32} height={32} />
          <span>kitchenbinder</span>
          <small>Example recipe</small>
        </div>
        <h2>Lemon &amp; chickpea pasta</h2>
        <p className="sample-description">
          A quick dinner with lemon, garlic and a little parmesan.
        </p>
        <dl className="sample-meta">
          <div>
            <dt>Serves</dt>
            <dd>2</dd>
          </div>
          <div>
            <dt>Prep time</dt>
            <dd>10 min</dd>
          </div>
          <div>
            <dt>Cook time</dt>
            <dd>15 min</dd>
          </div>
        </dl>
        <h3>Ingredients</h3>
        <ul className="sample-ingredients">
          {ingredients.map((ingredient) => (
            <li key={ingredient}>{ingredient}</li>
          ))}
        </ul>
        <h3>Let&apos;s make it</h3>
        <ol className="sample-steps">
          <li>
            Cook the pasta in salted water. Save a mug of the cooking water
            before draining.
          </li>
          <li>
            Soften the garlic in olive oil. Add the chickpeas and warm through.
          </li>
          <li>
            Toss in the pasta, lemon and spinach. Add a splash of pasta water,
            season and finish with parmesan.
          </li>
        </ol>
        <section className="sample-notes" aria-label="Recipe notes">
          <h3>Kitchen notes</h3>
          <p className="sample-note-text">
            Add the lemon juice a little at a time, tasting as you go.
          </p>
        </section>
      </article>
    </aside>
  );
}
