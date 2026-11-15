// TODO(architect): verify exact menu names against current Claude and ChatGPT UIs.
// Keep client-specific wording here so menu changes need only one edit.
export const assistantGuides = [
  {
    id: "claude",
    name: "Claude",
    steps: [
      "Open Claude on the web or desktop, then open Settings.",
      "Choose Connectors, then Add custom connector.",
      "Paste the connection link above and choose Connect.",
      "Sign in to Kitchenbinder and allow the connection.",
    ],
    note: "Your Claude plan and workspace settings may affect which connections are available.",
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    steps: [
      "Open Settings in ChatGPT, then Apps or Connectors.",
      "Choose the option to add a custom connection. Turn on developer mode if your settings require it.",
      "Paste the connection link above and connect.",
      "Sign in to Kitchenbinder and allow the connection.",
    ],
    note: "Custom connections may depend on your ChatGPT plan or workspace permissions.",
  },
];
