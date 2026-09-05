import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Photo de 3 MiB + enveloppe multipart ; limite fichier verifiee cote action.
    serverActions: { bodySizeLimit: "4mb" },
  },
  // Evite que Turbopack ne remonte vers un package-lock.json trouve dans un
  // dossier parent hors de ce depot git (C:\Users\jajep) pour determiner la
  // racine du workspace.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
