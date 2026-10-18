import nunitoRegular from "@fontsource/nunito/files/nunito-latin-400-normal.woff?inline";
import nunitoBold from "@fontsource/nunito/files/nunito-latin-800-normal.woff?inline";
import type { RecipeContent } from "@prep-sheet/db/recipe-content";
import {
  Document,
  Font,
  Image,
  Link,
  Page,
  renderToBuffer,
  StyleSheet,
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
      src: nunitoBold,
      fontWeight: 800,
    },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

const s = StyleSheet.create({
  page: {
    paddingTop: 32,
    paddingLeft: 34,
    paddingRight: 34,
    paddingBottom: 36,
    fontFamily: "Nunito",
    fontSize: 10.5,
    color: "#334451",
    lineHeight: 1.4,
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 22,
    gap: 9,
  },
  brandLogo: { width: 150, height: 50, objectFit: "contain" },
  title: {
    fontSize: 30,
    fontWeight: 800,
    color: "#063338",
    lineHeight: 1.12,
    marginBottom: 10,
  },
  description: { fontSize: 12, color: "#63747b", marginBottom: 16 },
  meta: {
    flexDirection: "row",
    backgroundColor: "#eff3ee",
    paddingVertical: 13,
    marginBottom: 6,
    borderRadius: 10,
  },
  metaItem: { flex: 1, paddingHorizontal: 20 },
  metaDivider: { borderLeftWidth: 0.5, borderLeftColor: "#9eafaa" },
  metaLabel: { fontSize: 10, color: "#334451" },
  metaValue: { fontSize: 14, fontWeight: 800, color: "#063338" },
  heading: {
    fontSize: 20,
    color: "#063338",
    fontWeight: 800,
    marginTop: 16,
    marginBottom: 16,
  },
  ingredientRow: { flexDirection: "row", gap: 22 },
  ingredient: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 7,
    gap: 10,
  },
  checkbox: {
    width: 11,
    height: 11,
    marginTop: 2,
    borderWidth: 0.7,
    borderColor: "#164449",
    borderRadius: 2,
  },
  ingredientText: { flex: 1 },
  step: { flexDirection: "row", marginBottom: 13, gap: 12 },
  number: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#dce7d6",
    textAlign: "center",
    paddingTop: 3,
    fontSize: 14,
    fontWeight: 800,
    color: "#063338",
  },
  stepText: { flex: 1 },
  note: {
    marginTop: 8,
    padding: 12,
    backgroundColor: "#fff5dd",
    borderRadius: 8,
  },
  noteHeading: {
    fontSize: 13,
    fontWeight: 800,
    color: "#063338",
    marginBottom: 5,
  },
  noteLine: {
    height: 18,
    borderBottomWidth: 0.5,
    borderBottomColor: "#d6cdb6",
  },
  source: { fontSize: 9, marginTop: 20, color: "#5f665c" },
});

export async function recipePdf(
  content: RecipeContent,
  sourceUrl: string | null,
  origin: string,
) {
  const meta = [
    { label: "Serves", value: content.servings },
    {
      label: "Prep time",
      value: content.prepMinutes !== null ? `${content.prepMinutes} min` : null,
    },
    {
      label: "Cook time",
      value: content.cookMinutes !== null ? `${content.cookMinutes} min` : null,
    },
    {
      label: "Elapsed time",
      value:
        content.totalMinutes != null ? `${content.totalMinutes} min` : null,
    },
  ].filter((item) => item.value !== null && item.value !== "");
  const columnLength = Math.ceil(content.ingredients.length / 2);
  return renderToBuffer(
    <Document title={content.title} author="Kitchenbinder">
      <Page size="A4" style={s.page}>
        <View style={s.brand}>
          <Image src={logo} style={s.brandLogo} />
        </View>
        <Text style={s.title}>{content.title}</Text>
        {content.description && (
          <Text style={s.description}>{content.description}</Text>
        )}
        {meta.length > 0 && (
          <View style={s.meta} wrap={false}>
            {meta.map((item, index) => (
              <View
                key={item.label}
                style={index > 0 ? [s.metaItem, s.metaDivider] : s.metaItem}
              >
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
        <Text style={s.heading} minPresenceAhead={50}>
          Let's make it
        </Text>
        {content.steps.map((step, index) => (
          <View key={`${index}-${step}`} style={s.step} wrap={false}>
            <Text style={s.number}>{index + 1}</Text>
            <Text style={s.stepText}>{step}</Text>
          </View>
        ))}
        {sourceUrl && (
          <Text style={s.source}>
            Original recipe: <Link src={sourceUrl}>{sourceUrl}</Link>
          </Text>
        )}
        {origin === "generated" && (
          <Text style={s.source}>
            AI-generated recipe. Review the ingredients and method before
            cooking.
          </Text>
        )}
        <View style={s.note}>
          <Text style={s.noteHeading} minPresenceAhead={36}>
            Kitchen notes
          </Text>
          {content.notes ? (
            <Text>{content.notes}</Text>
          ) : (
            <View wrap={false}>
              <View style={s.noteLine} />
              <View style={s.noteLine} />
            </View>
          )}
        </View>
      </Page>
    </Document>,
  );
}
