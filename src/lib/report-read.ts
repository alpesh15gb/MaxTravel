/** Read-only report deadline. This never retries a write or invents an empty report. */
export const REPORT_READ_TIMEOUT_MS = 35_000;
export class ReportReadTimeout extends Error {
 constructor() { super("The report took too long to respond. No results were applied. Check your connection and retry the same report."); this.name = "ReportReadTimeout"; }
}

/** Bound both transport and JSON decoding, including transports that ignore abort. */
export async function readReportJson<T>(url: string, { signal, timeoutMs = REPORT_READ_TIMEOUT_MS, fetcher = fetch }: { signal: AbortSignal; timeoutMs?: number; fetcher?: typeof fetch }): Promise<{ response: Response; data: T }> {
 if (signal.aborted) throw signal.reason ?? new DOMException("Report read cancelled", "AbortError");
 const controller = new AbortController();
 let timer: ReturnType<typeof setTimeout> | undefined;
 let cancel = () => {};
 const cancelled = new Promise<never>((_, reject) => {
  cancel = () => { const reason = signal.reason ?? new DOMException("Report read cancelled", "AbortError"); reject(reason); controller.abort(reason); };
  signal.addEventListener("abort", cancel, { once: true });
  timer = setTimeout(() => { const error = new ReportReadTimeout(); reject(error); controller.abort(error); }, timeoutMs);
 });
 try {
  const reading = (async () => { const response = await fetcher(url, { signal: controller.signal }); const data = await response.json() as T; return { response, data }; })();
  return await Promise.race([reading, cancelled]);
 } finally {
  if (timer !== undefined) clearTimeout(timer);
  signal.removeEventListener("abort", cancel);
 }
}
