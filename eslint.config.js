import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      ".output",
      ".vercel",
      ".vinxi",
      ".tanstack",
      ".vly-run",
      ".lovable",
      "node_modules",
      "**/*.gen.ts",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      // Stilistik kural: modern TS'te ve özellikle React bileşenlerinde (JSX/null/
      // portal döndürebilirler) yüzlerce gereksiz anotasyon üretiyordu. `strict`
      // zaten çıkarım doğruluğunu güvence altına alır; typescript-eslint bu kuralı
      // "stylistic" kategorisinde tutar ve kullanımını önermez.
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-debugger": "error",
      "no-var": "error",
      "prefer-const": "error",
      "prefer-arrow-callback": "error",
      "no-unneeded-ternary": "error",
      // `== null` / `!= null` null VEYA undefined'ı tek seferde yakalayan
      // yerleşik ve güvenli bir kalıptır; yalnız bu karşılaştırma serbest bırakılır.
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  eslintPluginPrettier,
  {
    // `vite.config.ts` kasıtlı olarak `// @ts-nocheck` ile yazılmıştır (dinamik
    // eklenti içe aktarımları tip güvenli değil) ve Freebuff kuralları gereği bu
    // dosya değiştirilmez. Prettier de kapalı: böylece Vite/HMR yapılandırması
    // ve Freebuff'ın zorunlu ayarları yeniden yazılmadan korunur.
    files: ["vite.config.ts"],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "prettier/prettier": "off",
    },
  },
);
