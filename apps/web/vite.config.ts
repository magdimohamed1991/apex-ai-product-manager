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
              // Use a dynamic variable to hide the import specifier from static analysis
              const moduleName = './src/api-server.ts'
              const { handleApiRequest } = await import(moduleName)
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
  }
})
