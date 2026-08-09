/* eslint-disable @typescript-eslint/no-explicit-any */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

export default defineConfig(({ command }) => {
  const plugins: any[] = [react(), tailwindcss()];

  if (command === "serve") {
    plugins.push({
      name: "api-server-middleware",
      configureServer(server: any) {
        server.middlewares.use(async (req: any, res: any, next: any) => {
          if (req.url && req.url.startsWith("/api")) {
            // Use a dynamic variable to hide the import specifier from static analysis
            const moduleName = "./src/api-server.ts";
            const { handleApiRequest } = await import(moduleName);
            const handled = await handleApiRequest(req, res);
            if (!handled) {
              next();
            }
          } else {
            next();
          }
        });
      },
    });
  }

  return {
    plugins,
    resolve: {
      alias: {
        "@": resolve(__dirname, "./src"),
      },
    },
  };
});
