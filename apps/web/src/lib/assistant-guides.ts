// Menu names verified 2026-11-15 against Claude and OpenAI help docs:
// https://support.claude.com/en/articles/11175166
// https://help.openai.com/en/articles/12584461
// Keep client-specific wording here so menu changes need only one edit.
export const assistantGuides = [
  {
    id: "claude",
    name: "Claude",
    steps: [
      "Open Claude on the web or desktop app, then go to Customize, then Connectors.",
      "Choose Add, then Add custom connector.",
      "Name it Kitchenbinder, paste the connection link above, then choose Add.",
      "Choose Connect, then sign in to Kitchenbinder and allow access.",
      "In a chat, select + then Connectors and make sure Kitchenbinder is on.",
    ],
    note: "Works on every Claude plan, including Free. On Team or Enterprise, your workspace owner may need to add it for you.",
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    steps: [
      "Open ChatGPT on the web, then go to Plugins.",
      "Select +, then Add custom MCP server.",
      "Name it Kitchenbinder, paste the connection link above and choose OAuth sign-in.",
      "Confirm the warning, select Create as a plugin, then install it.",
      "Sign in to Kitchenbinder and allow access. In a chat, type @ and pick Kitchenbinder.",
    ],
    note: "ChatGPT currently allows custom connections only on Business, Enterprise and Edu plans, and your workspace admin may need to allow it. On other plans, use Claude.",
  },
];
