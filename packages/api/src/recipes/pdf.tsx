import nunitoRegular from "@fontsource/nunito/files/nunito-latin-400-normal.woff?inline";
import nunitoSemiBold from "@fontsource/nunito/files/nunito-latin-700-normal.woff?inline";
import nunitoBold from "@fontsource/nunito/files/nunito-latin-800-normal.woff?inline";
import type { RecipeContent } from "@prep-sheet/db/recipe-content";
import {
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
} from "@react-pdf/renderer";
import logo from "../../../../apps/web/public/branding/logo-horizontal.png?inline";

Font.register({
  family: "Nunito",
  fonts: [
    {
      src: nunitoRegular,
      fontWeight: 400,
    },
    {
      src: nunitoSemiBold,
      fontWeight: 700,
    },
    {
      src: nunitoBold,
      fontWeight: 800,
    },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

// Pantry tokens (DESIGN.md). Mostly white page so it is cheap to print.
const ink = "#2b1d14";
const ink2 = "#6e5a49";
const ink3 = "#a08b77";
const line = "#e3d5be";
const rule = "#cfd8e3";
const tomato = "#c2412d";
const olive = "#5e6b2f";

// lineHeight on Page stops render() page numbers drawing, so body text
// sets it per style. A percentage needs an explicit fontSize alongside it.
const body = { fontSize: 10.5, lineHeight: "145%" };

const s = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingLeft: 80,
    paddingRight: 40,
    paddingBottom: 52,
    fontFamily: "Nunito",
    fontSize: 10.5,
    color: ink,
  },
  margin: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 58,
    borderLeftWidth: 0.9,
    borderLeftColor: tomato,
  },
  hole: {
    position: "absolute",
    left: 22,
    width: 15,
    height: 15,
    borderRadius: 7.5,
    borderWidth: 0.9,
    borderColor: line,
  },
  brandLogo: { width: 100, height: 18, objectFit: "contain", marginTop: 4 },
  title: {
    fontSize: 28,
    fontWeight: 800,
    lineHeight: 1.1,
    letterSpacing: -0.4,
    marginTop: 24,
    marginBottom: 6,
  },
  description: { ...body, fontSize: 11.5, color: ink2, marginBottom: 14 },
  meta: { flexDirection: "row", gap: 8, marginTop: 4, marginBottom: 26 },
  metaItem: {
    flex: 1,
    borderWidth: 0.9,
    borderColor: line,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  metaLabel: {
    fontSize: 7.5,
    fontWeight: 700,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: ink3,
  },
  metaValue: { fontSize: 15, fontWeight: 800 },
  heading: {
    fontSize: 20,
    fontWeight: 800,
    letterSpacing: -0.4,
    marginBottom: 12,
  },
  ingredientRow: { flexDirection: "row", gap: 22 },
  ingredient: { flex: 1, flexDirection: "row", gap: 9, marginBottom: 8 },
  checkbox: {
    width: 10,
    height: 10,
    marginTop: 2,
    borderWidth: 1,
    borderColor: olive,
    borderRadius: 3,
  },
  ingredientText: { ...body, flex: 1 },
  step: { flexDirection: "row", gap: 14, marginBottom: 14 },
  number: {
    width: 28,
    fontSize: 16,
    fontWeight: 800,
    color: tomato,
    lineHeight: 1,
    marginTop: -2,
  },
  stepText: { ...body, flex: 1, fontSize: 11 },
  notes: { marginTop: 20 },
  notesHeading: { fontSize: 15, fontWeight: 800, marginBottom: 2 },
  notesText: {
    fontSize: 10.5,
    lineHeight: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: rule,
  },
  noteLine: { height: 21, borderBottomWidth: 0.5, borderBottomColor: rule },
  source: { fontSize: 8.5, color: ink3, marginTop: 12 },
  sourceLink: { color: ink2 },
  footer: {
    position: "absolute",
    left: 80,
    right: 40,
    bottom: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    fontSize: 8,
    color: ink3,
  },
  pageNumber: {
    position: "absolute",
    right: 40,
    bottom: 22,
    width: 80,
    textAlign: "right",
    fontSize: 8,
    color: ink3,
  },
});

function minutes(value: number | null) {
  if (value === null) return null;
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  return value % 60 ? `${hours} h ${value % 60} min` : `${hours} h`;
}

export async function recipePdf(
  content: RecipeContent,
  sourceUrl: string | null,
  origin: string,
) {
  const meta = [
    { label: "Serves", value: content.servings },
    { label: "Prep", value: minutes(content.prepMinutes) },
    { label: "Cook", value: minutes(content.cookMinutes) },
    { label: "Total", value: minutes(content.totalMinutes) },
  ].filter((item) => item.value !== null && item.value !== "");
  const columnLength = Math.ceil(content.ingredients.length / 2);
  return renderToBuffer(
    <Document title={content.title} author="Kitchenbinder">
      <Page size="A4" style={s.page}>
        {/* Loose-leaf binder page: margin rule and punched holes. */}
        <View style={s.margin} fixed />
        {[120, 421, 722].map((top) => (
          <View key={top} style={[s.hole, { top }]} fixed />
        ))}
        <Image src={logo} style={s.brandLogo} />
        <Text style={s.title}>{content.title}</Text>
        {content.description && (
          <Text style={s.description}>{content.description}</Text>
        )}
        {meta.length > 0 && (
          <View style={s.meta} wrap={false}>
            {meta.map((item) => (
              <View key={item.label} style={s.metaItem}>
                <Text style={s.metaLabel}>{item.label}</Text>
                <Text style={s.metaValue}>{item.value}</Text>
              </View>
            ))}
          </View>
        )}
        <Text style={s.heading} minPresenceAhead={30}>
          Ingredients
        </Text>
        {content.ingredients.slice(0, columnLength).map((item, index) => (
          <View key={`${index}-${item}`} style={s.ingredientRow} wrap={false}>
            {[item, content.ingredients[index + columnLength]].map(
              (ingredient, column) => (
                <View key={column} style={s.ingredient}>
                  {ingredient && (
                    <>
                      <View style={s.checkbox} />
                      <Text style={s.ingredientText}>{ingredient}</Text>
                    </>
                  )}
                </View>
              ),
            )}
          </View>
        ))}
        <Text style={[s.heading, { marginTop: 16 }]} minPresenceAhead={50}>
          Method
        </Text>
        {content.steps.map((step, index) => (
          <View key={`${index}-${step}`} style={s.step} wrap={false}>
            <Text style={s.number}>{String(index + 1).padStart(2, "0")}</Text>
            <Text style={s.stepText}>{step}</Text>
          </View>
        ))}
        <View style={s.notes} wrap={false}>
          <Text style={s.notesHeading}>Kitchen notes</Text>
          {content.notes && <Text style={s.notesText}>{content.notes}</Text>}
          <View style={s.noteLine} />
          <View style={s.noteLine} />
          {!content.notes && <View style={s.noteLine} />}
        </View>
        {sourceUrl && (
          <Text style={s.source}>
            Original recipe:{" "}
            <Link src={sourceUrl} style={s.sourceLink}>
              {sourceUrl}
            </Link>
          </Text>
        )}
        {origin === "generated" && (
          <Text style={s.source}>
            AI-generated recipe. Review the ingredients and method before
            cooking.
          </Text>
        )}
        <View style={s.footer} fixed>
          <Svg viewBox="0 0 64 64" style={{ width: 10, height: 10 }}>
            <Path
              fill={tomato}
              fillRule="evenodd"
              d="M10 13Q10 6 17 6H21Q28 6 28 13V29L42 17Q46 13 50 16L52 18Q55 21 51 25L39 35L53 49Q58 54 53 57Q49 61 44 56L28 40V51Q28 58 21 58H17Q10 58 10 51ZM23.5 20a4.5 4.5 0 1 0 -9.0 0a4.5 4.5 0 1 0 9.0 0ZM23.5 44a4.5 4.5 0 1 0 -9.0 0a4.5 4.5 0 1 0 9.0 0Z"
            />
          </Svg>
          <Text>kitchenbinder.app</Text>
        </View>
        <Text
          style={s.pageNumber}
          fixed
          render={({ pageNumber, totalPages }) =>
            totalPages > 1 ? `Page ${pageNumber} of ${totalPages}` : ""
          }
        />
      </Page>
    </Document>,
  );
}
