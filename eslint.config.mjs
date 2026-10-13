import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  // Evidence screenshots are dynamic, auth-free API responses; next/image optimization adds nothing there.
  { rules: { "@next/next/no-img-element": "off" } },
  { ignores: [".next/**", "node_modules/**", "data/**", "test-results/**", "playwright-report/**", "next-env.d.ts"] },
];

export default config;
