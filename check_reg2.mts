import { functionDeclarations } from "./src/tools/registry.js";
console.log("count:", functionDeclarations.length);
console.log(JSON.stringify(functionDeclarations, null, 1).slice(0, 3500));
