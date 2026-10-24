/** Actual component render with controlled hook stubs; no browser or external requests. */
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const source = fs.readFileSync(new URL("../src/app/login/LoginForm.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source.replace(/^import .*;$/gm, "").replace("export default function", "function"), {compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
function render(ready, busy=false) {
  let call=0; const effects=[];
  const Component=new Function("React","useState","useEffect","useRouter","Icon","Field",`${compiled}; return LoginForm;`)(
    React, initial => [call++===0?ready:typeof initial==="boolean"?busy:initial,()=>{}], effect => effects.push(effect),()=>({}),()=>null,
    ({label,children})=>React.createElement("label",null,label,children));
  const html=renderToStaticMarkup(React.createElement(Component,{agencyName:"Synthetic",created:false}));
  assert.equal(effects.length,1,"Hydration has an explicit readiness transition");
  return html;
}
for(const [ready,busy,count] of [[false,false,4],[true,false,0],[true,true,4]]) {
  const html=render(ready,busy);
  assert.equal((html.match(/disabled=""/g)||[]).length,count,`ready=${ready}, busy=${busy}: all fields and submit share the gate`);
  assert.match(html,/Sign in to workspace|Signing in/);
}
const dashboard=fs.readFileSync(new URL("../src/app/(app)/dashboard/DashboardClient.tsx",import.meta.url),"utf8");
assert.match(dashboard,/<span id="today-work-area-label"[^>]*>Work area<\/span><select aria-labelledby="today-work-area-label"/);
console.log("PASS actual login render: pre-hydration and busy controls disabled, hydrated controls enabled; Today select explicitly named by visible label.");
