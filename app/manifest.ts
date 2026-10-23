import type { MetadataRoute } from "next";

/** Lets the app be added to a phone's home screen and open full-screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Finance",
    short_name: "Finance",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
