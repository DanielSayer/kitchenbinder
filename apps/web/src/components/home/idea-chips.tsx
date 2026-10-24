import { Chip, ChipRow, type PantryTone } from "@/components/pantry";

const ideas: { label: string; prompt: string; tone: PantryTone }[] = [
  {
    label: "Cosy dal",
    prompt: "A cosy vegetarian dal for four",
    tone: "olive",
  },
  {
    label: "Salmon traybake",
    prompt: "Quick salmon traybake, under 30 minutes",
    tone: "sage",
  },
  {
    label: "Lemon pasta",
    prompt:
      "Lemon and chickpea pasta with spinach for two people, ready in 25 minutes",
    tone: "butter",
  },
  {
    label: "Leftover chicken",
    prompt: "Something with leftover roast chicken",
    tone: "tomato",
  },
];

/** Tap an idea to fill the composer; we generate a recipe from it. */
export function IdeaChips({
  disabled,
  onSelect,
}: {
  disabled: boolean;
  onSelect: (value: string) => void;
}) {
  return (
    <ChipRow className="add-ideas" aria-label="Recipe ideas">
      {ideas.map((idea) => (
        <Chip
          key={idea.label}
          dot={idea.tone}
          disabled={disabled}
          onClick={() => {
            onSelect(idea.prompt);
            document.getElementById("recipe-input")?.focus();
          }}
        >
          {idea.label}
        </Chip>
      ))}
    </ChipRow>
  );
}
