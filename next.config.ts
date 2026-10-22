import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["postgres", "ws"]
};

export default config;
