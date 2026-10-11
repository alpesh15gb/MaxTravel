// Accessibility and legibility audit for the isolated review workspace.
// Run after visual-review-server.mjs. Never targets live data.
//
//   REVIEW_PORT=3321 node tests/visual-review-server.mjs   # terminal A
//   node tests/a11y-audit.mjs                               # terminal B
//
// Rules: WCAG 2.2 AA unless noted. Contrast uses reported 4.5:1 for normal text / 3:1
// for large text (>=24px, or >=18.66px at weight >=700). Target size uses the AA
// 24x24 minimum (2.5.8) with the inline-text exception, and reports the 44x44
// advisory separately so the two are never confused.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "./browser.mjs";

const fixture = JSON.parse(fs.readFileSync("tests/.runtime/visual-review-current.json", "utf8"));
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.base)) throw new Error("Audit must use an isolated loopback server");
const rules = (process.argv.find(a => a.startsWith("--rules="))?.slice(8) ?? "contrast,names,taps,focus,modal,semantics").split(",");
const outDir = path.resolve("test-artifacts/a11y");
fs.mkdirSync(outDir, { recursive: true });

const findings = [];
const indeterminate = [];
const failedRoutes = [];
const add = (kind, detail) => findings.push({ kind, ...detail });
// Counted so the gate can tell a clean run from one that quietly audited nothing: a report that
// visited no routes, walked no focus rings and opened no dialogs must never be able to pass it.
const coverage = { rules, routes: 0, routeVisits: 0, focusWalks: 0, phoneWalks: 0, dialogs: 0 };

const routes = [
  ["dashboard", "/dashboard"], ["customers", "/customers"],
  ["customer-detail", `/customers/${fixture.customerId}`], ["new-customer", "/customers?action=new"],
  ["visa", "/visa"], ["visa-detail", `/visa/${fixture.visaCaseId}`], ["new-visa", "/visa/new"],
  ["ticketing", "/ticketing"], ["booking-detail", `/ticketing/${fixture.bookingId}`], ["new-booking", "/ticketing/new"],
  ["documents", "/documents"], ["payments", "/payments"], ["reports", "/reports"], ["refunds", "/refunds"],
  ["suppliers", "/suppliers"], ["tasks", "/tasks"], ["whatsapp", "/whatsapp"],
  ["team", "/employees"], ["checklists", "/checklists"], ["audit", "/audit"],
  ["settings", "/settings"], ["notifications", "/notifications"],
];

// ---------------------------------------------------------------- in-page audit
function auditPage() {
  const alpha = c => (c.length > 3 ? c[3] : 1);
  const parse = value => {
    const m = /^rgba?\(([^)]+)\)$/.exec(value || "");
    if (!m) return null;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some(Number.isNaN)) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const channel = v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const luminance = c => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const round = n => Math.round(n * 100) / 100;
  const describe = el => {
    const cls = typeof el.className === "string" ? el.className.replace(/\s+/g, " ").trim().slice(0, 160) : "";
    const text = (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);
    const chain = [];
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (n.id) { chain.unshift(`#${n.id}`); break; }
      if (typeof n.className === "string" && n.className.trim()) chain.unshift("." + n.className.trim().split(/\s+/)[0]);
    }
    return { tag: el.tagName.toLowerCase(), cls, text, path: chain.slice(-4).join(" > ").slice(0, 200) };
  };
  const visible = el => {
    const r = el.getBoundingClientRect();
    if (r.width * r.height <= 4) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    if (Number(cs.opacity) < 0.15) return false;
    if (cs.clipPath !== "none" || el.hasAttribute("hidden")) return false;
    return true;
  };
  // Effective background behind an element: composite ancestor backgrounds root-first.
  function backdrop(el) {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== "none" || cs.backdropFilter !== "none") return { unknown: `background-image/backdrop-filter on ${describe(n).path}` };
      layers.unshift({ bg: parse(cs.backgroundColor), opacity: Number(cs.opacity) });
    }
    let result = { r: 255, g: 255, b: 255, a: 1 };
    for (const layer of layers) {
      if (!layer.bg || layer.bg.a === 0) continue;
      // An ancestor's opacity thins its own background before it is composited down.
      const a = layer.bg.a * layer.opacity;
      if (a <= 0) continue;
      result = over({ ...layer.bg, a }, result);
    }
    return { color: result };
  }

  const contrast = [];
  const nonText = [];
  const indeterminate = [];

  const textHosts = [...document.querySelectorAll("main *, header *, nav *, footer *, [role=dialog] *")]
    .filter(el => !el.closest("svg") && el.tagName !== "OPTION")
    .filter(el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 0))
    .filter(visible);

  for (const el of textHosts) {
    const cs = getComputedStyle(el);
    if (cs.webkitBackgroundClip === "text" || cs.backgroundClip === "text") { indeterminate.push({ ...describe(el), why: "gradient text" }); continue; }
    const fg = parse(cs.color);
    if (!fg || fg.a === 0) { indeterminate.push({ ...describe(el), why: "transparent or unparsable color" }); continue; }
    const back = backdrop(el);
    if (back.unknown) { indeterminate.push({ ...describe(el), why: back.unknown }); continue; }
    const bg = back.color;
    // Paint the text colour over its own surface; a fully opaque colour is unchanged.
    const painted = over(fg, bg);
    const size = Number.parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const required = large ? 3 : 4.5;
    const value = round(ratio(painted, bg));
    if (value + 0.005 < required) {
      contrast.push({ ...describe(el), ratio: value, required, fontSize: round(size), weight, fg: cs.color, bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})` });
    }
  }

  // Meaningful non-text: icon-only controls must reach 3:1 against their surface.
  for (const el of [...document.querySelectorAll("main button, main a[href], header button, nav a[href]")].filter(visible)) {
    const text = (el.textContent || "").trim();
    if (text) continue;
    const svg = el.querySelector("svg");
    if (!svg) continue;
    const back = backdrop(el);
    if (back.unknown) continue;
    const cs = getComputedStyle(svg);
    const color = parse(cs.stroke !== "none" ? cs.stroke : cs.fill) ?? parse(getComputedStyle(el).color);
    if (!color || color.a === 0) continue;
    const value = round(ratio(over(color, back.color), back.color));
    if (value + 0.005 < 3) nonText.push({ ...describe(el), ratio: value, required: 3, svg: cs.stroke, bg: `rgb(${Math.round(back.color.r)}, ${Math.round(back.color.g)}, ${Math.round(back.color.b)})` });
  }

  // Accessible names for form controls.
  const names = [];
  const labelled = new Set();
  for (const el of document.querySelectorAll("[id][aria-labelledby]")) for (const id of el.getAttribute("aria-labelledby").split(/\s+/)) labelled.add(id);
  const nameOf = el => {
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return { name: aria.trim(), via: "aria-label" };
    const ids = el.getAttribute("aria-labelledby");
    if (ids) {
      const text = ids.split(/\s+/).map(id => document.getElementById(id)?.textContent || "").join(" ").replace(/\s+/g, " ").trim();
      if (text) return { name: text, via: "aria-labelledby" };
    }
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label?.textContent.trim()) return { name: label.textContent.trim(), via: "label[for]" };
    }
    const wrap = el.closest("label");
    if (wrap?.textContent.trim()) return { name: wrap.textContent.trim(), via: "wrapping label" };
    const title = el.getAttribute("title");
    if (title?.trim()) return { name: title.trim(), via: "title" };
    return null;
  };
  // aria-label is a valid accessible name, so it is deliberately not flagged.
  for (const el of [...document.querySelectorAll("main input, main select, main textarea, [role=dialog] input, [role=dialog] select, [role=dialog] textarea")].filter(visible)) {
    if (["hidden", "submit", "button", "reset", "image"].includes(el.type)) continue;
    const found = nameOf(el);
    if (!found) names.push({ ...describe(el), why: el.getAttribute("placeholder") ? "placeholder-only" : "no accessible name" });
    else if (found.via === "title") names.push({ ...describe(el), why: "named only via title, which is not exposed everywhere", name: found.name });
  }
  for (const el of [...document.querySelectorAll("main button, main a[href], header button, nav button")].filter(visible)) {
    if ((el.textContent || "").trim()) continue;
    const found = nameOf(el);
    if (!found) names.push({ ...describe(el), why: "icon-only control with no accessible name" });
  }
  for (const el of [...document.querySelectorAll("main img, header img")].filter(visible)) {
    if (el.getAttribute("alt") === null) names.push({ ...describe(el), why: "img without alt attribute" });
  }

  // Target size (2.5.8, AA 24x24) with the inline-text exception.
  const targets = [];
  const advisory = [];
  const undersized = [];
  // Every target is an obstacle for the 24px circle test, not only the undersized ones: a small
  // control sitting 4px from a large one is just as hard to hit, and ignoring the large ones here
  // was a hole in this rule.
  const obstacles = [];
  for (const el of [...document.querySelectorAll("main a[href], main button, main input, main select, main textarea, main summary, header a[href], header button, nav a[href], nav button, [role=dialog] button, [role=dialog] input, [role=dialog] select, [role=dialog] textarea")].filter(visible)) {
    if (el.type === "hidden") continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const inlineText = cs.display === "inline" && [...(el.parentElement?.childNodes ?? [])].some(n => n.nodeType === 3 && n.textContent.trim());
    const w = Math.round(r.width);
    const h = Math.round(r.height);
    const item = { ...describe(el), width: w, height: h, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
    if (Math.min(w, h) < 24 && !inlineText) undersized.push(item);
    else if (Math.min(w, h) < 44) advisory.push({ ...item, exemptInline: inlineText });
    else obstacles.push(item);
  }
  // WCAG 2.5.8 exempts an undersized target when a 24px circle centred on it does not
  // reach any other target, so adjacency alone is not a violation.
  const reaches = (a, b) => {
    const cx = a.rect.x + a.rect.w / 2;
    const cy = a.rect.y + a.rect.h / 2;
    const nx = Math.max(b.rect.x, Math.min(cx, b.rect.x + b.rect.w));
    const ny = Math.max(b.rect.y, Math.min(cy, b.rect.y + b.rect.h));
    return Math.hypot(cx - nx, cy - ny) < 12;
  };
  const spacingExempt = [];
  for (const item of undersized) {
    const clash = undersized.concat(advisory, obstacles).find(other => other !== item && reaches(item, other));
    if (clash) targets.push({ ...item, interferesWith: `${clash.tag} "${clash.text}" (${clash.width}x${clash.height})` });
    else spacingExempt.push(item);
  }

  // Document semantics.
  const headings = [...document.querySelectorAll("main h1, main h2, main h3, main h4, main h5, main h6")]
    .filter(el => el.getBoundingClientRect().width > 0)
    .map(el => ({ level: Number(el.tagName[1]), text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60) }));
  const skips = [];
  let previous = 0;
  for (const h of headings) {
    if (previous && h.level > previous + 1) skips.push({ from: previous, to: h.level, text: h.text });
    previous = h.level;
  }
  const ids = [...document.querySelectorAll("[id]")].map(el => el.id);
  const duplicates = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  const hiddenFocusable = [...document.querySelectorAll('[aria-hidden="true"] a[href], [aria-hidden="true"] button, [aria-hidden="true"] input, [aria-hidden="true"] select, [aria-hidden="true"] textarea, [aria-hidden="true"] [tabindex]:not([tabindex="-1"])')]
    .filter(el => el.getClientRects().length)
    .map(el => ({ ...describe(el), ancestorHidden: true }));
  const labelledbyTargets = [...document.querySelectorAll("[aria-labelledby]")].flatMap(el => el.getAttribute("aria-labelledby").split(/\s+/).filter(id => !document.getElementById(id)).map(id => ({ ...describe(el), missing: id })));
  const describedbyTargets = [...document.querySelectorAll("[aria-describedby]")].flatMap(el => el.getAttribute("aria-describedby").split(/\s+/).filter(id => !document.getElementById(id)).map(id => ({ ...describe(el), missing: id })));

  return {
    contrast, nonText, indeterminate, names, targets, advisory, spacingExempt, headings,
    semantics: {
      lang: document.documentElement.getAttribute("lang") || "",
      h1: headings.filter(h => h.level === 1).length,
      skips, duplicates, hiddenFocusable, labelledbyTargets, describedbyTargets,
      landmarkMain: document.querySelectorAll("main").length,
      unlabelledLandmarks: [...document.querySelectorAll("nav, aside, [role=region]")]
        .filter(el => el.getBoundingClientRect().width > 0)
        .filter(el => !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby") && !el.querySelector("h1, h2, h3"))
        .map(el => describe(el)),
      landmarkTotal: document.querySelectorAll("nav, aside, [role=region]").length,
    },
    counts: { textHosts: textHosts.length },
  };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL: fixture.base, viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const browserErrors = [];
page.on("pageerror", e => browserErrors.push(`Page error: ${e.message}`));
page.on("console", m => { if (m.type() === "error") browserErrors.push(`Console: ${m.text()}`); });

async function go(route) {
  browserErrors.length = 0;
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.locator("main").waitFor();
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(120);
}

async function auditRoute(name, route) {
  for (const [size, width, height] of [["desktop", 1440, 900], ["phone", 390, 844]]) {
    await page.setViewportSize({ width, height });
    try {
      await go(route);
    } catch (error) {
      failedRoutes.push({ route, size, error: error.message.slice(0, 200) });
      continue;
    }
    const suffix = ` · ${size} ${width}px`;
    coverage.routeVisits += 1;
    const result = await page.evaluate(auditPage);
    for (const item of result.contrast) add("contrast", { route: name, size, width, ...item });
    for (const item of result.nonText) add("non-text-contrast", { route: name, size, width, ...item });
    for (const item of result.names) add("accessible-name", { route: name, size, width, ...item });
    if (size === "phone") for (const item of result.targets) add("target-size", { route: name, size, width, ...item });
    for (const item of result.semantics.skips) add("heading-order", { route: name, size, width, ...item });
    for (const item of result.semantics.duplicates) add("duplicate-id", { route: name, size, width, id: item });
    for (const item of result.semantics.hiddenFocusable) add("focusable-in-aria-hidden", { route: name, size, width, ...item });
    for (const item of result.semantics.labelledbyTargets) add("broken-aria-labelledby", { route: name, size, width, ...item });
    for (const item of result.semantics.describedbyTargets) add("broken-aria-describedby", { route: name, size, width, ...item });
    if (!result.semantics.lang) add("missing-lang", { route: name, size, width });
    if (result.semantics.h1 !== 1) add("h1-count", { route: name, size, width, h1: result.semantics.h1 });
    if (result.semantics.landmarkMain !== 1) add("main-landmark-count", { route: name, size, width, main: result.semantics.landmarkMain });
    for (const item of result.semantics.unlabelledLandmarks) add("unlabelled-landmark", { route: name, size, width, ...item, of: result.semantics.landmarkTotal });
    for (const item of result.spacingExempt) indeterminate.push({ route: name, size, why: `target ${item.width}x${item.height} exempt via 2.5.8 spacing`, text: item.text });
    for (const item of result.indeterminate) indeterminate.push({ route: name, size, ...item });
    console.log(`${name}${suffix}: ${result.contrast.length} contrast, ${result.names.length} name, ${result.targets.length} target, ${result.nonText.length} non-text, ${result.indeterminate.length} indeterminate`);
  }
}

try {
  // A workspace that is not listening would otherwise surface as a raw Playwright stack, and the
  // report written by the finally block below would show a clean-looking audit that looked at
  // nothing — which is why the gate refuses a report with no coverage.
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Work email", { exact: true }).fill("review@visual.test");
    await page.getByLabel("Password", { exact: true }).fill("Review-Visual-2026!");
    await page.getByRole("button", { name: "Sign in to workspace", exact: true }).click();
    await page.waitForURL("**/dashboard", { waitUntil: "domcontentloaded" });
  } catch (error) {
    throw new Error(`Could not sign in to the review workspace at ${fixture.base} — ${String(error.message).split("\n")[0]}. Is the review server still running on that port?`);
  }

  if (rules.includes("contrast") || rules.includes("names") || rules.includes("taps") || rules.includes("semantics")) {
    for (const [name, route] of routes) await auditRoute(name, route);
  }

  // ---- focus visibility.
  // Real Tab presses only: a programmatic .focus() does not reliably match :focus-visible, so
  // it reports rings that a keyboard user sees and misses rings they would get. Each stop is
  // compared against its own styles once focus has moved on, which is the blurred baseline.
  const FOCUS_PROPS = ["outlineStyle", "outlineWidth", "outlineColor", "outlineOffset", "boxShadow", "borderTopColor", "borderLeftColor", "borderBottomColor", "backgroundColor", "color", "textDecorationLine", "textDecorationColor", "filter"];
  const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
  async function focusWalk(name, route) {
    await page.setViewportSize({ width: 1440, height: 900 });
    try { await go(route); } catch { return null; }
    coverage.focusWalks += 1;
    await page.evaluate(() => { document.activeElement?.blur?.(); window.__walk = { seq: [], last: null, lastInfo: null }; });
    let firstKey = null;
    for (let i = 0; i < 150; i++) {
      await page.keyboard.press("Tab");
      const step = await page.evaluate(({ props, selector }) => {
        const S = window.__walk;
        const read = el => { const cs = getComputedStyle(el); return Object.fromEntries(props.map(p => [p, cs[p]])); };
        const el = document.activeElement;
        if (S.last) { S.seq.push({ ...S.lastInfo, blurred: read(S.last) }); S.last = null; }
        if (!el || el === document.body || !el.matches(selector)) return { stop: true };
        const key = `${el.tagName}|${(el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40)}|${String(el.className).slice(0, 80)}`;
        S.last = el;
        // A finding nobody can locate is not a finding: carry the control's own label, type and
        // placeholder, since an unlabelled `.field` input otherwise reports as nothing but `input`.
        S.lastInfo = {
          key,
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute("type") || (el.tagName === "INPUT" ? "text" : ""),
          cls: String(el.className || "").replace(/\s+/g, " ").slice(0, 130),
          text: (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40),
          label: (el.getAttribute("aria-label") || el.closest("label")?.textContent || el.getAttribute("placeholder") || "").replace(/\s+/g, " ").trim().slice(0, 40),
          placeholder: el.getAttribute("placeholder") || "",
          focused: read(el),
        };
        return { stop: false, key };
      }, { props: FOCUS_PROPS, selector: FOCUSABLE });
      if (step.stop) break;
      if (firstKey === null) firstKey = step.key;
      else if (step.key === firstKey && i > 5) break;
    }
    const result = await page.evaluate(props => {
      const S = window.__walk;
      const read = el => { const cs = getComputedStyle(el); return Object.fromEntries(props.map(p => [p, cs[p]])); };
      // The walk ends the moment the cycle returns to its first stop, so whatever is focused then
      // never got its "styles after focus moved on" reading — and comparing its focused styles with
      // themselves reported a textbook-perfect control as having no indicator at all. Blur it first.
      if (S.last) {
        if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur?.();
        S.seq.push({ ...S.lastInfo, blurred: read(S.last) });
        S.last = null;
      }
      // An indicator only counts when a person can see it. `alphaOf` reads the strongest alpha out
      // of a colour or a shadow stack, so the 10%-alpha glow that used to stand in for a ring here
      // no longer passes as one.
      const alphaOf = value => {
        const parts = [...String(value).matchAll(/rgba?\(([^)]+)\)/g)];
        if (!parts.length) return value === "none" ? 0 : 1;
        return Math.max(...parts.map(m => {
          const n = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
          return n.length > 3 ? n[3] : 1;
        }));
      };
      const missing = [];
      const rings = new Map();
      for (const s of S.seq) {
        const f = s.focused;
        const changed = props.some(p => f[p] !== s.blurred[p]);
        const outline = f.outlineStyle !== "none" && Number.parseFloat(f.outlineWidth) > 0 && alphaOf(f.outlineColor) >= 0.9;
        const shadow = f.boxShadow !== s.blurred.boxShadow && alphaOf(f.boxShadow) >= 0.25;
        const border = ["borderTopColor", "borderLeftColor", "borderBottomColor"].some(p => f[p] !== s.blurred[p]);
        if (outline || shadow || border) {
          const ring = outline ? `outline ${f.outlineWidth} ${f.outlineStyle} opaque` : shadow ? "box-shadow" : "border colour change only";
          rings.set(ring, (rings.get(ring) || 0) + 1);
        } else {
          missing.push({
            tag: s.tag, type: s.type, cls: s.cls, text: s.text, label: s.label, placeholder: s.placeholder,
            why: changed ? "focus style changes, but too faint to see" : "nothing changes on focus",
            focused: { outline: `${f.outlineWidth} ${f.outlineStyle} ${f.outlineColor}`, boxShadow: String(f.boxShadow).slice(0, 60) },
          });
        }
      }
      return { stops: S.seq.length, missing, rings: [...rings].map(([ring, count]) => ({ ring, count })) };
    }, FOCUS_PROPS);
    for (const item of result.missing) add("focus-visibility", { route: name, size: "desktop", ...item });
    console.log(`${name}: focus — ${result.stops} stops, ${result.missing.length} without an indicator${result.missing.length ? ` (${result.missing.map(m => m.text || m.tag).slice(0, 5).join(", ")})` : ""}${result.rings.length ? ` rings ${result.rings.map(r => r.ring + " x" + r.count).join(", ")}` : ""}`);
    return result;
  }
  // ---- phone focus order.
  // Off-canvas is not out of reach: the nav rail is a drawer below lg, and a transform alone leaves
  // its controls tabbable while parked off-screen. Walk the phone tab order and report any stop a
  // person could not see.
  async function phoneFocusOrder(name, route) {
    await page.setViewportSize({ width: 390, height: 844 });
    try { await go(route); } catch { return; }
    coverage.phoneWalks += 1;
    await page.evaluate(() => document.activeElement?.blur?.());
    const hidden = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const step = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return { stop: true };
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          stop: false,
          offscreen: r.right <= 1 || r.left >= window.innerWidth - 1 || r.bottom <= 1 || cs.visibility === "hidden" || Number(cs.opacity) < 0.1,
          label: `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 30)}"`,
        };
      });
      if (step.stop) break;
      if (step.offscreen) hidden.push(step.label);
    }
    if (hidden.length) add("focus-offscreen", { route: name, size: "phone", count: hidden.length, text: `${hidden.length} invisible stop${hidden.length === 1 ? "" : "s"}: ${hidden.slice(0, 3).join(", ")}` });
    console.log(`${name}: phone focus — ${hidden.length} invisible tab stops${hidden.length ? ` (${hidden.slice(0, 3).join(", ")})` : ""}`);
  }
  if (rules.includes("focus")) {
    for (const [name, route] of routes.slice(0, 12)) await focusWalk(name, route);
    for (const [name, route] of ["dashboard", "customers", "tasks"].map(n => [n, routes.find(r => r[0] === n)[1]])) await phoneFocusOrder(name, route);
  }

  // ---- dialogs: naming, initial focus, trap, Escape, restore.
  if (rules.includes("modal")) {
    for (const [name, route, trigger, expected] of [
      ["tasks", "/tasks", "New task", "New task"],
      ["customers", "/customers", null, null],
      ["booking", `/ticketing/${fixture.bookingId}`, "Record actual tickets", "Record actual tickets"],
    ]) {
      if (!trigger) continue;
      await page.setViewportSize({ width: 1440, height: 900 });
      try { await go(route); } catch { continue; }
      const button = page.getByRole("button", { name: trigger, exact: true }).first();
      if (!(await button.count())) { add("dialog", { route: name, why: `trigger "${trigger}" not found` }); continue; }
      await button.click();
      const dialog = page.getByRole("dialog").first();
      await dialog.waitFor();
      coverage.dialogs += 1;
      const state = await page.evaluate(() => {
        const el = document.activeElement;
        const modal = () => {
          const native = [...document.querySelectorAll("dialog")].filter(d => d.matches(":modal"));
          if (native.length) return native[native.length - 1];
          const visible = [...document.querySelectorAll('[role=dialog], dialog[open]')].filter(d => !d.hidden && d.getBoundingClientRect().width > 0);
          return visible[visible.length - 1] ?? null;
        };
        window.__modal = modal;
        const dialog = modal();
        return {
          selector: dialog ? (dialog.matches(":modal") ? "dialog:modal" : "[role=dialog]") : null,
          modalCount: [...document.querySelectorAll("dialog")].filter(d => d.matches(":modal")).length,
          tag: dialog?.tagName.toLowerCase() ?? null,
          ariaModal: dialog?.getAttribute("aria-modal") ?? null,
          nativeModal: dialog instanceof HTMLDialogElement ? dialog.matches(":modal") : false,
          focusInside: Boolean(dialog && el && dialog.contains(el)),
          focus: el ? { tag: el.tagName.toLowerCase(), name: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40) } : null,
        };
      });
      let escaped = null;
      const outside = [];
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press("Tab");
        const where = await page.evaluate(() => {
          const d = window.__modal?.();
          const el = document.activeElement;
          return { inside: Boolean(d && el && d.contains(el)), label: el ? (el.getAttribute("aria-label") || el.textContent || el.tagName).replace(/\s+/g, " ").trim().slice(0, 30) : null };
        });
        if (!where.inside) { escaped = i; outside.push(where.label); break; }
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(180);
      const closed = await page.evaluate(() => !window.__modal?.());
      const restored = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return "<body>";
        return (el.getAttribute("aria-label") || el.textContent || el.tagName).replace(/\s+/g, " ").trim().slice(0, 40);
      });
      const problems = [];
      if (state.modalCount > 1) problems.push(`${state.modalCount} modal dialogs open at once`);
      if (!state.focusInside) problems.push(`initial focus outside the dialog (${state.focus?.name || state.focus?.tag})`);
      if (escaped !== null) problems.push(`focus left after ${escaped + 1} Tab presses, reaching "${outside[0]}"`);
      if (!closed) problems.push("Escape did not close the dialog");
      if (closed && restored !== expected) problems.push(`focus returned to "${restored}" instead of the "${expected}" trigger`);
      for (const problem of problems) add("dialog-focus", { route: name, size: "desktop", why: problem, selector: state.selector });
      console.log(`${name} dialog: ${problems.length ? problems.join("; ") : "focus trapped, Escape closes, focus restored"}`);
      if (!closed) await page.keyboard.press("Escape");
    }
  }
} finally {
  const grouped = {};
  for (const finding of findings) {
    const key = finding.kind;
    grouped[key] = grouped[key] || [];
    grouped[key].push(finding);
  }
  const duplicates = kind => {
    const seen = new Map();
    for (const item of grouped[kind] ?? []) {
      const key = [item.route, item.size, item.cls, item.fg, item.bg, item.ratio, item.width, item.height, item.why, item.missing].join("|");
      const entry = seen.get(key) ?? { ...item, count: 0, examples: [] };
      entry.count += 1;
      if (entry.examples.length < 3 && item.text && !entry.examples.includes(item.text)) entry.examples.push(item.text);
      seen.set(key, entry);
    }
    return [...seen.values()].sort((a, b) => (a.ratio ?? 0) - (b.ratio ?? 0));
  };
  coverage.routes = routes.length;
  const report = {
    route: fixture.base,
    generatedAt: new Date().toISOString(),
    coverage,
    passed: findings.length === 0,
    totals: Object.fromEntries(Object.entries(grouped).map(([kind, list]) => [kind, list.length])),
    grouped: Object.fromEntries(Object.entries(grouped).map(([kind]) => [kind, duplicates(kind)])),
    indeterminate,
    failedRoutes,
  };
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));

  const lines = [`# Accessibility audit`, ``, `Workspace: ${fixture.base}`, ``, `Totals: ${JSON.stringify(report.totals)}`, ``];
  for (const [kind, list] of Object.entries(report.grouped)) {
    if (!list.length) continue;
    lines.push(`## ${kind} (${list.length} unique, ${grouped[kind].length} findings)`, ``);
    for (const item of list.slice(0, 60)) {
      const where = [item.route, item.size].filter(Boolean).join(" ");
      const what = item.ratio ? `ratio ${item.ratio} < ${item.required}` : item.why || item.ring || `w${item.width} h${item.height}`;
      lines.push(`- **${where}** \`${item.tag}\` ${what} ${item.cls ? `\`${item.cls}\`` : ""} ${item.examples?.length ? `— ${item.examples.join(" / ")}` : item.text ? `— ${item.text}` : ""}`.replace(/\s+/g, " "));
    }
    lines.push(``);
  }
  if (indeterminate.length) lines.push(`## indeterminate (manually judged, ${indeterminate.length})`, ``, ...indeterminate.slice(0, 40).map(i => `- ${i.route} ${i.size} ${i.why} — ${i.text}`), ``);
  if (failedRoutes.length) lines.push(`## routes that did not load`, ``, ...failedRoutes.map(f => `- ${f.route} ${f.size}: ${f.error}`));
  fs.writeFileSync(path.join(outDir, "report.md"), lines.join("\n"));
  await browser.close();
  console.log(`\ntotals ${JSON.stringify(report.totals)}`);
  console.log(`indeterminate ${indeterminate.length}`);
  console.log(`report: test-artifacts/a11y/report.md`);
  process.exitCode = findings.length === 0 ? 0 : 1;
}
