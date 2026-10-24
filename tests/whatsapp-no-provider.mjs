/** Fixture-only fail-closed transport guard, loaded before Next. Never used by the application. */
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    console.error("WHATSAPP_FIXTURE_EXTERNAL_FETCH_BLOCKED");
    throw new Error("Synthetic WhatsApp tests forbid all external/provider fetches.");
  }
  return originalFetch(input, init);
};
