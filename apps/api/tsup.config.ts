import { defineConfig } from "tsup";

// Production build of the API (used by `npm run build` / `npm start` on a host such as Render).
// The shared workspace packages (@edurev/types, @edurev/mock-data) are TypeScript source, which Node can't load
// at runtime, so they are bundled into dist/server.js. npm dependencies (express, mongoose, nodemailer…) stay external.
export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  noExternal: [/^@edurev\//],
});
