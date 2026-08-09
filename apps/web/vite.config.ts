import { defineConfig } from 'vite'
import type { PluginOption, ViteDevServer, Connect } from 'vite'
import type { ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig(({ command }) => {
  const plugins: PluginOption[] = [react(), tailwindcss()]

  if (command === 'serve') {
    plugins.push({
      name: 'api-server-middleware',
      configureServer(server: ViteDevServer) {
        server.middlewares.use(
          async (req: Connect.IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
            if (req.url && req.url.startsWith('/api')) {
              // Load the API server through Vite's SSR transform pipeline.
              // A raw dynamic `import()` of the module (or a path relative
              // to the bundled config) fails: Node's native ESM loader
              // cannot resolve the workspace packages' extensionless
              // internal imports (@apex/ai-core → ./domain), and a
              // config-relative specifier breaks under Vite's native
              // config bundling.
              const { handleApiRequest } = await server.ssrLoadModule('./src/api-server.ts')
              const handled = await handleApiRequest(req, res)
              if (!handled) {
                next()
              }
            } else {
              next()
            }
          }
        )
      },
    })
  }

  return {
    plugins,
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
    server: {
      // The dev server runs inside sandboxed preview environments whose
      // hostnames are not known in advance; allow any host in development
      // only. Production serving is not handled by the Vite dev server.
      allowedHosts: true,
    },
  }
})
