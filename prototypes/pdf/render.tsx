/** @jsxRuntime classic */
/** @jsx React.createElement */
// PDF style prototypes. Run: pnpm exec tsx prototypes/pdf/render.tsx
// Resolves react-pdf from packages/api so this stays out of production code.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(`${root}packages/api/package.json`);
const React = (await import(pathToFileURL(require.resolve("react")).href)).default;
const {
  Document,
  Font,
  Image,
  Link,
  Page,
  Path,
  renderToBuffer,
  StyleSheet,
  Svg,
  Text,
  View,
} = await import(pathToFileURL(require.resolve("@react-pdf/renderer")).href);

// Data URLs, as production does; react-pdf treats Windows paths as URLs.
const dataUrl = (path: string, type: string) =>
  `data:${type};base64,${readFileSync(path).toString("base64")}`;
const fontDir = `${root}packages/api/node_modules/@fontsource/nunito/files/`;
const font = (name: string) => dataUrl(`${fontDir}nunito-latin-${name}.woff`, "font/woff");
Font.register({
  family: "Nunito",
  fonts: [
    { src: font("400-normal"), fontWeight: 400 },
    { src: font("700-normal"), fontWeight: 700 },
    { src: font("800-normal"), fontWeight: 800 },
    {
      src: font("700-italic"),
      fontWeight: 700,
      fontStyle: "italic",
    },
  ],
});
Font.registerHyphenationCallback((word: string) => [word]);
const logo = dataUrl(`${root}apps/web/public/branding/logo-horizontal.png`, "image/png");

// Pantry tokens (DESIGN.md)
// Page-level lineHeight breaks render() page numbers (react-pdf), so set it per text.
const lh = "145%";
const c = {
  ink: "#2b1d14",
  ink2: "#6e5a49",
  ink3: "#a08b77",
  line: "#e3d5be",
  tomato: "#c2412d",
  tomatoSoft: "#f6dcd3",
  olive: "#5e6b2f",
  butter: "#edb94a",
  butterInk: "#8a5d0a",
};

type Recipe = {
  title: string;
  description: string;
  servings: string | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes: number | null;
  ingredients: string[];
  steps: string[];
  notes: string;
  sourceUrl: string | null;
};

const short: Recipe = {
  title: "Lemon & chickpea pasta",
  description: "A quick weeknight dinner with lemon, garlic and a little parmesan.",
  servings: "2",
  prepMinutes: 10,
  cookMinutes: 15,
  totalMinutes: 25,
  ingredients: [
    "200 g pasta",
    "1 tin chickpeas, drained",
    "1 lemon, zest and juice",
    "2 handfuls baby spinach",
    "2 cloves garlic, sliced",
    "2 tbsp olive oil",
    "Parmesan, to serve",
    "Salt and black pepper",
  ],
  steps: [
    "Cook the pasta in well-salted water until just tender. Save a mug of the cooking water before draining.",
    "Meanwhile, soften the garlic in the olive oil over a low heat. Add the chickpeas and warm through for 3–4 minutes.",
    "Toss in the pasta, lemon zest and spinach. Add a splash of pasta water and stir until glossy.",
    "Season, add lemon juice to taste and finish with plenty of parmesan.",
  ],
  notes: "",
  sourceUrl: "https://www.example.com/recipes/lemon-chickpea-pasta",
};

const long: Recipe = {
  title: "Slow-roast lamb shoulder with boulangère potatoes",
  description:
    "Sunday lunch for a crowd. The lamb roasts low and slow over sliced potatoes, which soak up all the juices.",
  servings: "6–8",
  prepMinutes: 30,
  cookMinutes: 270,
  totalMinutes: 300,
  ingredients: [
    "2 kg lamb shoulder, bone in",
    "1 bulb garlic, cloves peeled",
    "4 sprigs rosemary",
    "6 anchovy fillets",
    "2 tbsp olive oil",
    "1.5 kg floury potatoes, thinly sliced",
    "2 onions, thinly sliced",
    "500 ml hot chicken stock",
    "200 ml white wine",
    "30 g butter",
    "1 tbsp thyme leaves",
    "1 lemon, zest only",
    "Small bunch mint, chopped",
    "1 tbsp red wine vinegar",
    "1 tsp caster sugar",
    "Salt and black pepper",
  ],
  steps: [
    "Take the lamb out of the fridge an hour before cooking. Heat the oven to 160°C fan.",
    "Pound half the garlic, the rosemary leaves and anchovies to a rough paste with the olive oil and plenty of pepper.",
    "Use a small knife to make deep cuts all over the lamb, then rub the paste into the cuts and over the surface.",
    "Layer the potatoes and onions in a large roasting tin, seasoning and scattering thyme and the remaining garlic between the layers.",
    "Pour over the stock and wine, dot with butter, then sit the lamb on top. Cover tightly with foil.",
    "Roast for 4 hours, basting once or twice, until the lamb pulls apart easily with a fork.",
    "Remove the foil, turn the oven up to 200°C fan and roast for a further 30 minutes until the potatoes are golden at the edges.",
    "Meanwhile, stir the mint, vinegar, sugar and 2 tbsp boiling water together for a quick mint sauce.",
    "Rest the lamb for 20 minutes under loose foil. Scatter with lemon zest and serve with the potatoes and mint sauce.",
    "Leftover lamb keeps for 3 days in the fridge; shred it into flatbreads with yoghurt and pickled onions.",
  ],
  notes:
    "Ask the butcher to score the fat for you. Works just as well with goat shoulder; add 30 minutes.",
  sourceUrl: "https://www.example.com/recipes/slow-roast-lamb-shoulder-boulangere",
};

function meta(r: Recipe) {
  const min = (m: number | null) => {
    if (m === null) return null;
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  };
  return [
    { label: "Serves", value: r.servings },
    { label: "Prep", value: min(r.prepMinutes) },
    { label: "Cook", value: min(r.cookMinutes) },
    { label: "Total", value: min(r.totalMinutes) },
  ].filter((m): m is { label: string; value: string } => !!m.value);
}

// Title with last word in tomato italic (design system accent).
function AccentTitle({ title, style }: { title: string; style: object }) {
  const i = title.lastIndexOf(" ");
  if (i < 0) return <Text style={style}>{title}</Text>;
  return (
    <Text style={style}>
      {title.slice(0, i + 1)}
      <Text style={{ color: c.tomato, fontStyle: "italic", fontWeight: 700 }}>
        {title.slice(i + 1)}
      </Text>
    </Text>
  );
}

function Mark({ size, color = c.tomato }: { size: number; color?: string }) {
  return (
    <Svg viewBox="0 0 64 64" style={{ width: size, height: size }}>
      <Path
        fill={color}
        fillRule="evenodd"
        d="M10 13Q10 6 17 6H21Q28 6 28 13V29L42 17Q46 13 50 16L52 18Q55 21 51 25L39 35L53 49Q58 54 53 57Q49 61 44 56L28 40V51Q28 58 21 58H17Q10 58 10 51ZM23.5 20a4.5 4.5 0 1 0 -9.0 0a4.5 4.5 0 1 0 9.0 0ZM23.5 44a4.5 4.5 0 1 0 -9.0 0a4.5 4.5 0 1 0 9.0 0Z"
      />
    </Svg>
  );
}

function PageNumber({ style }: { style: object }) {
  return (
    <Text
      style={style}
      fixed
      render={({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
        totalPages > 1 ? `Page ${pageNumber} of ${totalPages}` : ""
      }
    />
  );
}

/* ───────────── A · Index card ─────────────
   Clean white page, hairline rules, tomato used only for type accents.
   Punch-ring checkboxes nod to the binder mark. */
const a = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingHorizontal: 44,
    paddingBottom: 54,
    fontFamily: "Nunito",
    fontSize: 10.5,
    color: c.ink,
  },
  top: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 28,
  },
  logo: { width: 112, height: 20, objectFit: "contain" },
  eyebrow: {
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 1.3,
    color: c.tomato,
    textTransform: "uppercase",
  },
  title: { fontSize: 30, fontWeight: 800, lineHeight: 1.08, letterSpacing: -0.5, marginBottom: 8 },
  description: { fontSize: 12, lineHeight: lh, color: c.ink2, marginBottom: 18, maxWidth: 440 },
  meta: {
    flexDirection: "row",
    borderTopWidth: 0.75,
    borderBottomWidth: 0.75,
    borderColor: c.line,
    paddingVertical: 10,
    marginBottom: 24,
  },
  metaItem: { marginRight: 34 },
  metaLabel: { fontSize: 7.5, fontWeight: 700, letterSpacing: 1.1, textTransform: "uppercase", color: c.ink3 },
  metaValue: { fontSize: 13, fontWeight: 800 },
  heading: { fontSize: 18, fontWeight: 800, letterSpacing: -0.3, marginBottom: 12 },
  ingredientRow: { flexDirection: "row", gap: 24 },
  ingredient: { flex: 1, flexDirection: "row", gap: 9, marginBottom: 7, paddingBottom: 6, borderBottomWidth: 0.5, borderBottomColor: c.line },
  ring: { width: 9, height: 9, marginTop: 2.5, borderRadius: 4.5, borderWidth: 1.1, borderColor: c.tomato },
  step: { flexDirection: "row", gap: 14, marginBottom: 12 },
  stepNumber: { width: 22, fontSize: 16, fontWeight: 800, color: c.tomato, lineHeight: 1, marginTop: -2, textAlign: "right" },
  stepText: { flex: 1, fontSize: 11, lineHeight: lh },
  notes: { marginTop: 14, paddingTop: 12, borderTopWidth: 0.75, borderTopColor: c.line },
  noteLine: { height: 22, borderBottomWidth: 0.5, borderBottomColor: c.line },
  source: { fontSize: 8.5, color: c.ink3, marginTop: 14 },
  footer: {
    position: "absolute",
    left: 44,
    right: 44,
    bottom: 24,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 8,
    color: c.ink3,
  },
});

function VariantA({ r }: { r: Recipe }) {
  const col = Math.ceil(r.ingredients.length / 2);
  return (
    <Page size="A4" style={a.page}>
      <View style={a.top}>
        <Image src={logo} style={a.logo} />
        <Text style={a.eyebrow}>Recipe</Text>
      </View>
      <AccentTitle title={r.title} style={a.title} />
      {r.description && <Text style={a.description}>{r.description}</Text>}
      <View style={a.meta} wrap={false}>
        {meta(r).map((m) => (
          <View key={m.label} style={a.metaItem}>
            <Text style={a.metaLabel}>{m.label}</Text>
            <Text style={a.metaValue}>{m.value}</Text>
          </View>
        ))}
      </View>
      <Text style={a.heading} minPresenceAhead={30}>Ingredients</Text>
      {r.ingredients.slice(0, col).map((item, i) => (
        <View key={item} style={a.ingredientRow} wrap={false}>
          {[item, r.ingredients[i + col]].map((ing, k) => (
            <View key={k} style={[a.ingredient, ing ? {} : { borderBottomWidth: 0 }]}>
              {ing && <View style={a.ring} />}
              {ing && <Text style={{ flex: 1, fontSize: 10.5, lineHeight: lh }}>{ing}</Text>}
            </View>
          ))}
        </View>
      ))}
      <Text style={[a.heading, { marginTop: 18 }]} minPresenceAhead={50}>Method</Text>
      {r.steps.map((step, i) => (
        <View key={step} style={a.step} wrap={false}>
          <Text style={a.stepNumber}>{i + 1}</Text>
          <Text style={a.stepText}>{step}</Text>
        </View>
      ))}
      <View style={a.notes} wrap={false}>
        <Text style={[a.eyebrow, { marginBottom: 6 }]}>Kitchen notes</Text>
        {r.notes ? (
          <Text style={{ fontSize: 10.5, lineHeight: lh }}>{r.notes}</Text>
        ) : (
          <View>
            <View style={a.noteLine} />
            <View style={a.noteLine} />
            <View style={a.noteLine} />
          </View>
        )}
      </View>
      {r.sourceUrl && (
        <Text style={a.source}>
          Original recipe: <Link src={r.sourceUrl} style={{ color: c.ink2 }}>{r.sourceUrl}</Link>
        </Text>
      )}
      <View style={a.footer} fixed>
        <Text>kitchenbinder.app</Text>
      </View>
      <PageNumber style={{ position: "absolute", right: 44, bottom: 24, width: 80, textAlign: "right", fontSize: 8, color: c.ink3 }} />
    </Page>
  );
}

/* ───────────── B · Binder page ─────────────
   Loose-leaf page: punched holes + tomato margin rule down the left.
   Recipe-card split: ingredients sidebar, method in the wide column. */
const b = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingLeft: 80,
    paddingRight: 40,
    paddingBottom: 52,
    fontFamily: "Nunito",
    fontSize: 10.5,
    color: c.ink,
  },
  margin: { position: "absolute", top: 0, bottom: 0, left: 58, borderLeftWidth: 0.9, borderLeftColor: c.tomato },
  hole: { position: "absolute", left: 22, width: 15, height: 15, borderRadius: 7.5, borderWidth: 0.9, borderColor: c.line },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 },
  logo: { width: 100, height: 18, objectFit: "contain", marginTop: 4 },
  title: { fontSize: 28, fontWeight: 800, lineHeight: 1.1, letterSpacing: -0.4, marginTop: 18, marginBottom: 6 },
  description: { fontSize: 11.5, lineHeight: lh, color: c.ink2, marginBottom: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 22 },
  chip: { flexDirection: "row", borderWidth: 0.8, borderColor: c.line, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10, fontSize: 9.5 },
  chipLabel: { color: c.ink2, marginRight: 4 },
  chipValue: { fontWeight: 800 },
  cols: { flexDirection: "row", gap: 24 },
  side: { width: 165 },
  main: { flex: 1 },
  heading: { fontSize: 15, fontWeight: 800, marginBottom: 10, paddingBottom: 6, borderBottomWidth: 1.4, borderBottomColor: c.ink },
  ingredient: { flexDirection: "row", gap: 7, paddingVertical: 4.5, borderBottomWidth: 0.5, borderBottomColor: c.line },
  box: { width: 8.5, height: 8.5, marginTop: 2.5, borderWidth: 0.9, borderColor: c.ink2, borderRadius: 2 },
  step: { flexDirection: "row", gap: 10, marginBottom: 11 },
  stepNumber: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: c.tomato, color: c.tomato, fontSize: 9, fontWeight: 800, textAlign: "center", paddingTop: 2.5 },
  notes: { marginTop: 20 },
  ruled: { height: 21, borderBottomWidth: 0.5, borderBottomColor: "#cfd8e3" },
  source: { fontSize: 8.5, color: c.ink3, marginTop: 12 },
  footer: { position: "absolute", left: 80, right: 40, bottom: 22, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: c.ink3 },
});

function VariantB({ r }: { r: Recipe }) {
  return (
    <Page size="A4" style={b.page}>
      <View style={b.margin} fixed />
      {[120, 421, 722].map((top) => (
        <View key={top} style={[b.hole, { top }]} fixed />
      ))}
      <View style={b.header}>
        <Image src={logo} style={b.logo} />
      </View>
      <Text style={b.title}>{r.title}</Text>
      {r.description && <Text style={b.description}>{r.description}</Text>}
      <View style={b.chips}>
        {meta(r).map((m) => (
          <View key={m.label} style={b.chip}>
            <Text style={b.chipLabel}>{m.label}</Text>
            <Text style={b.chipValue}>{m.value}</Text>
          </View>
        ))}
      </View>
      <View style={b.cols}>
        <View style={b.side}>
          <Text style={b.heading}>Ingredients</Text>
          {r.ingredients.map((ing) => (
            <View key={ing} style={b.ingredient} wrap={false}>
              <View style={b.box} />
              <Text style={{ flex: 1, fontSize: 10, lineHeight: lh }}>{ing}</Text>
            </View>
          ))}
        </View>
        <View style={b.main}>
          <Text style={b.heading}>Method</Text>
          {r.steps.map((step, i) => (
            <View key={step} style={b.step} wrap={false}>
              <Text style={b.stepNumber}>{i + 1}</Text>
              <Text style={{ flex: 1, fontSize: 10.5, lineHeight: lh }}>{step}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={b.notes} wrap={false}>
        <Text style={[b.heading, { borderBottomWidth: 0, paddingBottom: 0, marginBottom: 2 }]}>Kitchen notes</Text>
        {r.notes ? (
          <Text style={{ lineHeight: 2, borderBottomWidth: 0.5, borderBottomColor: "#cfd8e3" }}>{r.notes}</Text>
        ) : null}
        <View style={b.ruled} />
        <View style={b.ruled} />
        {!r.notes && <View style={b.ruled} />}
      </View>
      {r.sourceUrl && (
        <Text style={b.source}>
          Original recipe: <Link src={r.sourceUrl} style={{ color: c.ink2 }}>{r.sourceUrl}</Link>
        </Text>
      )}
      <View style={b.footer} fixed>
        <Text>Printed from kitchenbinder</Text>
      </View>
      <PageNumber style={{ position: "absolute", right: 40, bottom: 22, width: 80, textAlign: "right", fontSize: 8, color: c.ink3 }} />
    </Page>
  );
}

/* ───────────── C · Pantry label ─────────────
   Bolder, closest to the app: eyebrow headings with numbered sections,
   accent italic title, olive done-ticks, butter-outlined notes card. */
const cs = StyleSheet.create({
  page: {
    paddingTop: 34,
    paddingHorizontal: 40,
    paddingBottom: 56,
    fontFamily: "Nunito",
    fontSize: 10.5,
    color: c.ink,
  },
  top: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 26, paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: c.tomato },
  logo: { width: 118, height: 21, objectFit: "contain" },
  title: { fontSize: 34, fontWeight: 800, lineHeight: 1.04, letterSpacing: -0.8, marginBottom: 10 },
  description: { fontSize: 12.5, lineHeight: lh, color: c.ink2, marginBottom: 20 },
  stats: { flexDirection: "row", gap: 8, marginBottom: 26 },
  stat: { flex: 1, borderWidth: 0.9, borderColor: c.line, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  statLabel: { fontSize: 7.5, fontWeight: 700, letterSpacing: 1.1, textTransform: "uppercase", color: c.ink3 },
  statValue: { fontSize: 15, fontWeight: 800 },
  section: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginBottom: 12 },
  sectionNo: { fontSize: 11, fontWeight: 800, color: c.tomato, letterSpacing: 1 },
  sectionTitle: { fontSize: 20, fontWeight: 800, letterSpacing: -0.4, marginBottom: 12 },
  ingredientRow: { flexDirection: "row", gap: 22 },
  ingredient: { flex: 1, flexDirection: "row", gap: 9, marginBottom: 8 },
  box: { width: 10, height: 10, marginTop: 2, borderWidth: 1, borderColor: c.olive, borderRadius: 3 },
  step: { flexDirection: "row", gap: 14, marginBottom: 14 },
  stepTag: { width: 34, paddingTop: 1 },
  stepLabel: { fontSize: 6.5, fontWeight: 700, letterSpacing: 1, color: c.ink3 },
  stepNumber: { width: 28, fontSize: 16, fontWeight: 800, color: c.tomato, lineHeight: 1, marginTop: -2 },
  stepText: { flex: 1, fontSize: 11, lineHeight: lh },
  notes: { marginTop: 10, borderWidth: 1, borderColor: c.butter, borderRadius: 14, padding: 14 },
  noteTitle: { fontSize: 8, fontWeight: 700, letterSpacing: 1.3, textTransform: "uppercase", color: c.butterInk, marginBottom: 6 },
  noteLine: { height: 20, borderBottomWidth: 0.5, borderBottomColor: c.line },
  source: { fontSize: 8.5, color: c.ink3, marginTop: 14 },
  footer: { position: "absolute", left: 40, right: 40, bottom: 24, flexDirection: "row", justifyContent: "space-between", alignItems: "center", fontSize: 8, color: c.ink3 },
});

function VariantC({ r }: { r: Recipe }) {
  const col = Math.ceil(r.ingredients.length / 2);
  return (
    <Page size="A4" style={cs.page}>
      <View style={cs.top}>
        <Image src={logo} style={cs.logo} />
      </View>
      <AccentTitle title={r.title} style={cs.title} />
      {r.description && <Text style={cs.description}>{r.description}</Text>}
      <View style={cs.stats} wrap={false}>
        {meta(r).map((m) => (
          <View key={m.label} style={cs.stat}>
            <Text style={cs.statLabel}>{m.label}</Text>
            <Text style={cs.statValue}>{m.value}</Text>
          </View>
        ))}
      </View>
      <Text style={cs.sectionTitle} minPresenceAhead={30}>
        <Text style={cs.sectionNo}>01  </Text>Ingredients
      </Text>
      {r.ingredients.slice(0, col).map((item, i) => (
        <View key={item} style={cs.ingredientRow} wrap={false}>
          {[item, r.ingredients[i + col]].map((ing, k) => (
            <View key={k} style={cs.ingredient}>
              {ing && <View style={cs.box} />}
              {ing && <Text style={{ flex: 1, fontSize: 10.5, lineHeight: lh }}>{ing}</Text>}
            </View>
          ))}
        </View>
      ))}
      <Text style={[cs.sectionTitle, { marginTop: 16 }]} minPresenceAhead={50}>
        <Text style={cs.sectionNo}>02  </Text>Let's make it
      </Text>
      {r.steps.map((step, i) => (
        <View key={step} style={cs.step} wrap={false}>
          <Text style={cs.stepNumber}>{String(i + 1).padStart(2, "0")}</Text>
          <Text style={cs.stepText}>{step}</Text>
        </View>
      ))}
      <View style={cs.notes} wrap={false}>
        <Text style={cs.noteTitle}>Kitchen notes</Text>
        {r.notes ? (
          <Text style={{ fontSize: 10.5, lineHeight: lh }}>{r.notes}</Text>
        ) : (
          <View>
            <View style={cs.noteLine} />
            <View style={cs.noteLine} />
          </View>
        )}
      </View>
      {r.sourceUrl && (
        <Text style={cs.source}>
          Original recipe: <Link src={r.sourceUrl} style={{ color: c.ink2 }}>{r.sourceUrl}</Link>
        </Text>
      )}
      <View style={cs.footer} fixed>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Mark size={10} />
          <Text>kitchenbinder.app</Text>
        </View>
      </View>
      <PageNumber style={{ position: "absolute", right: 40, bottom: 24, width: 80, textAlign: "right", fontSize: 8, color: c.ink3 }} />
    </Page>
  );
}

/* ───────────── D · Binder + Pantry ─────────────
   B's loose-leaf chrome, logo and plain title; C's stat cards,
   two-column ingredients and numbered method. */
function VariantD({ r }: { r: Recipe }) {
  const col = Math.ceil(r.ingredients.length / 2);
  return (
    <Page size="A4" style={b.page}>
      <View style={b.margin} fixed />
      {[120, 421, 722].map((top) => (
        <View key={top} style={[b.hole, { top }]} fixed />
      ))}
      <View style={b.header}>
        <Image src={logo} style={b.logo} />
      </View>
      <Text style={b.title}>{r.title}</Text>
      {r.description && <Text style={b.description}>{r.description}</Text>}
      <View style={[cs.stats, { marginTop: 4 }]} wrap={false}>
        {meta(r).map((m) => (
          <View key={m.label} style={cs.stat}>
            <Text style={cs.statLabel}>{m.label}</Text>
            <Text style={cs.statValue}>{m.value}</Text>
          </View>
        ))}
      </View>
      <Text style={cs.sectionTitle} minPresenceAhead={30}>
        Ingredients
      </Text>
      {r.ingredients.slice(0, col).map((item, i) => (
        <View key={item} style={cs.ingredientRow} wrap={false}>
          {[item, r.ingredients[i + col]].map((ing, k) => (
            <View key={k} style={cs.ingredient}>
              {ing && <View style={cs.box} />}
              {ing && <Text style={{ flex: 1, fontSize: 10.5, lineHeight: lh }}>{ing}</Text>}
            </View>
          ))}
        </View>
      ))}
      <Text style={[cs.sectionTitle, { marginTop: 16 }]} minPresenceAhead={50}>
        Method
      </Text>
      {r.steps.map((step, i) => (
        <View key={step} style={cs.step} wrap={false}>
          <Text style={cs.stepNumber}>{String(i + 1).padStart(2, "0")}</Text>
          <Text style={cs.stepText}>{step}</Text>
        </View>
      ))}
      <View style={b.notes} wrap={false}>
        <Text style={[b.heading, { borderBottomWidth: 0, paddingBottom: 0, marginBottom: 2 }]}>Kitchen notes</Text>
        {r.notes ? (
          <Text style={{ fontSize: 10.5, lineHeight: 2, borderBottomWidth: 0.5, borderBottomColor: "#cfd8e3" }}>{r.notes}</Text>
        ) : null}
        <View style={b.ruled} />
        <View style={b.ruled} />
        {!r.notes && <View style={b.ruled} />}
      </View>
      {r.sourceUrl && (
        <Text style={b.source}>
          Original recipe: <Link src={r.sourceUrl} style={{ color: c.ink2 }}>{r.sourceUrl}</Link>
        </Text>
      )}
      <View style={b.footer} fixed>
        <Text>Printed from kitchenbinder</Text>
      </View>
      <PageNumber style={{ position: "absolute", right: 40, bottom: 22, width: 80, textAlign: "right", fontSize: 8, color: c.ink3 }} />
    </Page>
  );
}

const out = fileURLToPath(new URL("./out/", import.meta.url));
mkdirSync(out, { recursive: true });
const variants = { a: VariantA, b: VariantB, c: VariantC, d: VariantD };
for (const [key, Variant] of Object.entries(variants)) {
  for (const [name, r] of Object.entries({ short, long })) {
    const buf = await renderToBuffer(
      <Document title={r.title} author="Kitchenbinder">
        <Variant r={r} />
      </Document>,
    );
    writeFileSync(`${out}${key}-${name}.pdf`, buf);
    console.log(`${key}-${name}.pdf`, buf.length);
  }
}
