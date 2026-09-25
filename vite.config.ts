import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  server: {
    watch: {
      // server/data guarda la colección de Anki y ~200.000 ficheros de media: nada que vigilar.
      ignored: ["**/server/**", "**/test-dicts/**"],
    },
  },
  optimizeDeps: {
    // Sin esto, Vite busca los puntos de entrada con un glob **/*.html por todo el proyecto, que
    // ahora incluye los ~200.000 ficheros de server/data/collection.media: `npm run dev` se queda
    // colgado en "scanning dependencies". Solo hay un HTML, así que se lo decimos.
    entries: ["index.html"],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "辞書 → Anki",
        short_name: "辞書",
        description: "Diccionario japonés que crea tarjetas de Anki",
        lang: "es",
        display: "standalone",
        background_color: "#fbfbf8",
        theme_color: "#fbfbf8",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
});
