import nextVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...nextVitals,
  {
    // no-undef is off in the Next preset, which is why two route handlers
    // shipped calling sanitizeError() without importing it — a ReferenceError
    // raised inside the catch block that was meant to report the error.
    // Turning it on catches that class of bug at lint time.
    files: ["src/**/*.{js,mjs}", "scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
        URL: "readonly",
        Request: "readonly",
        Response: "readonly",
        Buffer: "readonly",
        Intl: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        structuredClone: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
    },
  },
];

export default config;
