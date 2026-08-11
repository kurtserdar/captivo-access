// guacamole-common-js ships no type declarations. The native gateway session
// client uses it dynamically (typed as any at the call site); this ambient
// declaration lets the module resolve under strict TypeScript.
declare module "guacamole-common-js";
