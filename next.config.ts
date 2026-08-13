import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Evite que Turbopack ne remonte vers un package-lock.json trouve dans un
  // dossier parent hors de ce depot git (C:\Users\jajep) pour determiner la
  // racine du workspace.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
