// Standalone Node test entry points are already server processes. Resolve only
// Next's marker to its official empty server implementation; app/browser builds
// retain the normal server-only protection.
import { registerHooks } from "node:module";
registerHooks({resolve(specifier,context,nextResolve){if(specifier==="server-only")return {url:new URL("../node_modules/server-only/empty.js",import.meta.url).href,shortCircuit:true};return nextResolve(specifier,context);}});
