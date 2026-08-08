import type { NextConfig } from "next";

const githubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = githubPages
  ? {
      output: "export",
      trailingSlash: true,
    }
  : {};

export default nextConfig;
