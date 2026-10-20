import { resolve } from "node:path";
import { defineConfig } from "wxt";
import { getBuildSettings } from "./config/build";

const icons = {
  16: "branding/favicon-16.png",
  32: "branding/favicon-32.png",
  48: "branding/favicon-48.png",
  192: "branding/icon-192.png",
};

export default defineConfig({
  srcDir: "src",
  mode: "development",
  manifestVersion: 3,
  modules: ["@wxt-dev/module-react"],
  imports: false,
  webExt: { disabled: true },
  zip: { name: "kitchenbinder" },
  hooks: {
    "build:publicAssets": (wxt, files) => {
      for (const relativeDest of Object.values(icons)) {
        files.push({
          absoluteSrc: resolve(wxt.config.root, "../web/public", relativeDest),
          relativeDest,
        });
      }
    },
  },
  manifest: ({ mode }) => {
    const { origin, key, development } = getBuildSettings(mode);
    return {
      name: development ? "Kitchenbinder (development)" : "Kitchenbinder",
      description: "Save recipes from your browser to Kitchenbinder.",
      homepage_url: "https://kitchenbinder.app",
      key,
      permissions: ["activeTab", "scripting", "identity", "storage"],
      minimum_chrome_version: "116",
      host_permissions: [`${origin}/*`],
      icons,
      action: { default_title: "Kitchenbinder", default_icon: icons },
    };
  },
  vite: ({ mode }) => ({
    define: {
      "import.meta.env.WXT_PREP_SHEET_ORIGIN": JSON.stringify(
        getBuildSettings(mode).origin,
      ),
    },
  }),
});
