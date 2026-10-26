// ESLint flat configuration: type-aware TypeScript rules, structural-limit warnings and the ExtendScript ES5 profile.
import type { Linter } from "eslint";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import { GENERATED_FILES, SKIP_DIRECTORIES } from "./scripts/lib/sources.ts";
import { EXTENDSCRIPT_GLOBALS, jsxRules } from "./scripts/lib/jsx-lint.ts";

interface ConfigEntry extends Omit<Linter.Config, "plugins"> {
  readonly plugins?: Readonly<Record<string, typeof tsPlugin>>;
}

const typed = ["**/*.{ts,tsx}"];
const untyped = ["**/*.mjs"];
const extendscript = ["**/*.jsx"];
const ignored = [
  ...[...SKIP_DIRECTORIES].map((name) => `**/${name}/**`),
  ...[...GENERATED_FILES],
  "artifacts/**",
  ".local/**",
  ".bug-scrub/**",
  "release-out/**",
  "coverage/**",
];

const RESTRICTED_TYPE_MESSAGE = "Name the shape: use a precise interface, a union, or a decoded type from @extynt/decode.";
const restrictedTypes = Object.fromEntries(
  ["object", "Function", "{}", "Record<string, unknown>", "Record<string, any>"].map((name) => [name, { message: RESTRICTED_TYPE_MESSAGE }]),
);

const limits: Linter.RulesRecord = {
  complexity: ["warn", { max: 8 }],
  "max-depth": ["warn", 3],
  "max-lines": ["warn", { max: 400, skipBlankLines: true, skipComments: true }],
  "max-lines-per-function": ["warn", { max: 40, skipBlankLines: true, skipComments: true, IIFEs: true }],
  "max-params": ["warn", 4],
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-non-null-assertion": "error",
  "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
  "@typescript-eslint/no-restricted-types": ["error", { types: restrictedTypes }],
  "no-restricted-syntax": [
    "error",
    {
      selector: "TSAsExpression > TSAsExpression",
      message: "Do not escape a type contract with a double assertion; parse or narrow unknown data.",
    },
    {
      selector: "TSAsExpression > TSTypeAssertion, TSTypeAssertion > TSAsExpression, TSTypeAssertion > TSTypeAssertion",
      message: "Do not escape a type contract with a double assertion; parse or narrow unknown data.",
    },
    {
      selector: "TSAsExpression[typeAnnotation.type='TSAnyKeyword']",
      message: "Assertions to any are not permitted.",
    },
    {
      selector: "TSTypeAssertion[typeAnnotation.type='TSAnyKeyword']",
      message: "Assertions to any are not permitted.",
    },
  ],
};

const typeAware: Linter.RulesRecord = {
  "@typescript-eslint/no-unsafe-assignment": "error",
  "@typescript-eslint/no-unsafe-call": "error",
  "@typescript-eslint/no-unsafe-member-access": "error",
  "@typescript-eslint/no-unsafe-return": "error",
  "@typescript-eslint/no-unsafe-argument": "error",
  "@typescript-eslint/use-unknown-in-catch-callback-variable": "error",
  "@typescript-eslint/dot-notation": "error",
  "@typescript-eslint/no-unnecessary-type-assertion": "warn",
  "@typescript-eslint/no-unnecessary-type-arguments": "warn",
};

const extendscriptBlock: ConfigEntry = {
  files: extendscript,
  languageOptions: { ecmaVersion: 5, sourceType: "script", globals: EXTENDSCRIPT_GLOBALS },
  rules: {
    complexity: limits.complexity,
    "max-depth": limits["max-depth"],
    "max-lines": limits["max-lines"],
    "max-lines-per-function": ["warn", { max: 40, skipBlankLines: true, skipComments: true, IIFEs: false }],
    "max-params": limits["max-params"],
    ...jsxRules,
  },
};

const LINE_LENGTH = { code: 160, ignoreStrings: true, ignoreTemplateLiterals: true, ignoreUrls: true };
const lineLength: ConfigEntry[] = [{ files: ["tools/**/*.{ts,tsx,mjs}", "scripts/**/*.{ts,tsx,mjs}", "tests/**/*.{ts,tsx,mjs}", "**/*.jsx"], rules: { "max-len": ["error", LINE_LENGTH] } }];

const config: ConfigEntry[] = [
  { ignores: ignored },
  {
    files: typed,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: { ...limits, ...typeAware },
  },
  {
    files: untyped,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        projectService: false,
      },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: limits,
  },
  extendscriptBlock,
  ...lineLength,
];

export default config;
