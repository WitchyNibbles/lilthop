import grimoire from "./.grimoire/eslint.config.mjs";
import { caseTwinsPlugin } from "./tools/caseTwins.mjs";

export default [
  { ignores: [".grimoire/", "dist/", "src-tauri/target/", "src-tauri/gen/"] },
  {
    plugins: { repo: caseTwinsPlugin(import.meta.dirname) },
    rules: { "repo/no-case-twins": "error" },
  },
  ...grimoire,
];
