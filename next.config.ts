import type { NextConfig } from "next";

const isExport = process.env.NEXT_EXPORT === "true";

const nextConfig: NextConfig = {
  ...(isExport && {
    output: "export",
    assetPrefix: "./",
  }),
};

export default nextConfig;
