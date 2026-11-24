import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "KWADERNO — Sari-sari Store Manager",
    short_name: "KWADERNO",
    description: "Inventory, sales and utang for sari-sari stores.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f6fafa",
    theme_color: "#0e7c86",
    orientation: "portrait",
    id: "/dashboard",
    scope: "/",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
