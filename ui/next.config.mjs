import { fileURLToPath } from "node:url";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

const config = (phase) => ({
  agentRules: false,
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
  ...(phase === PHASE_DEVELOPMENT_SERVER
    ? { async rewrites() {
        return [{ source: "/api/:path*", destination: `${process.env.CREW_SERVER_URL ?? "http://127.0.0.1:4000"}/api/:path*` }];
      } }
    : { output: "export" }),
  trailingSlash: true,
});

export default config;
