// ESLint rules for ExtendScript (.jsx): parsed as ES5, linted against an explicit After Effects global list.
// ExtendScript is ES3 plus a few ES5 leniencies, so ES5 syntax is parsed and the ES5 library surface it lacks is banned.
import type { Linter } from "eslint";

/** Host globals the maintained .jsx files use, plus the After Effects DOM classes the same files reference by name. */
export const EXTENDSCRIPT_GLOBALS: Readonly<Linter.Globals> = Object.freeze(Object.fromEntries([
  "$", "alert", "confirm", "prompt", "system", "File", "Folder", "Window", "UnitValue", "isValid",
  "app", "CompItem", "FootageItem", "FolderItem", "AVLayer", "ShapeLayer", "TextLayer", "CameraLayer", "LightLayer",
  "Property", "PropertyGroup", "MaskPropertyGroup", "PropertyType", "PropertyValueType", "Shape", "MarkerValue",
  "TextDocument", "KeyframeEase", "KeyframeInterpolationType",
  "AutoOrientType", "BlendingMode", "CloseOptions", "FrameBlendingType", "GetSettingsFormat", "ImportAsType", "ImportOptions",
  "LayerQuality", "LayerSamplingQuality", "LightType", "MaskFeatherFalloff", "MaskMode", "MaskMotionBlur",
  "ParagraphJustification", "RQItemStatus", "SolidSource", "TrackMatteType",
].map((name) => [name, "readonly" as const])));

const BANNED_METHODS = "forEach|map|filter|reduce|reduceRight|some|every|trim|bind";
const EVAL_FILE_MESSAGE = "$.evalFile inside a function evaluates in that function's scope and the library's declarations vanish; call it only at the top level of a file.";

const bannedMethodPairs: ReadonlyArray<readonly [string, string]> = [
  ["Array", "isArray"], ["Object", "keys"], ["Object", "create"], ["Object", "defineProperty"],
  ["Object", "defineProperties"], ["Object", "freeze"], ["Object", "getPrototypeOf"], ["Date", "now"],
];
const bannedObjectMethods = bannedMethodPairs.map(([object, property]) => ({ object, property, message: `${object}.${property} does not exist in ExtendScript.` }));

/** The rule table for `.jsx` files. */
export const jsxRules: Linter.RulesRecord = {
  "no-undef": "error",
  "no-unused-vars": ["error", { vars: "all", args: "none", caughtErrors: "none" }],
  eqeqeq: ["error", "always"],
  "no-redeclare": "error",
  "no-shadow": "error",
  "no-eval": "error",
  "no-with": "error",
  "no-implied-eval": "error",
  "no-new-func": "error",
  "no-caller": "error",
  "no-proto": "error",
  "no-sequences": "error",
  "no-throw-literal": "error",
  curly: ["error", "multi-line"],
  "no-fallthrough": "error",
  "no-self-compare": "error",
  "no-unreachable": "error",
  "default-case": "error",
  "comma-dangle": ["error", "never"],
  "no-restricted-properties": ["error", ...bannedObjectMethods],
  "no-restricted-syntax": [
    "error",
    { selector: `CallExpression[callee.property.name=/^(${BANNED_METHODS})$/]`, message: "This Array/String/Function method does not exist in ExtendScript; write the loop." },
    { selector: "Property[kind='get'], Property[kind='set']", message: "Object literal getters and setters are not available in ExtendScript." },
    { selector: ":function MemberExpression[object.name='$'][property.name='evalFile']", message: EVAL_FILE_MESSAGE },
    { selector: ":function MemberExpression[object.name='$'][computed=true][property.value='evalFile']", message: EVAL_FILE_MESSAGE },
  ],
};
