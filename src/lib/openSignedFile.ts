/**
 * Opens a short-lived signed file URL in a new tab.
 *
 * Two things make this fiddly, and both were live bugs:
 *
 * 1. The tab must be opened *synchronously*, before the request is awaited. A window opened after
 *    an await is blocked by every mainstream popup blocker, so the button appeared to do nothing.
 * 2. The URL returned by the API is relative (`/api/documents/stream?t=…`). Assigning a relative
 *    path to the placeholder tab does not resolve, because that tab's document is `about:blank`.
 *    It has to be made absolute against the current origin first.
 *
 * Returns null on success, or a message the caller should show the person.
 */
export async function openSignedFile(
  request: () => Promise<Response>,
  unavailable = "Could not open this file.",
): Promise<string | null> {
  const tab = window.open("", "_blank");
  try {
    const response = await request();
    const body = await response.json().catch(() => ({} as { url?: string; error?: string }));
    if (!response.ok || !body.url) {
      tab?.close();
      return body.error ?? unavailable;
    }
    if (!tab) return "Your browser blocked the new tab. Allow pop-ups for this site, then try again.";
    tab.location.href = new URL(body.url, window.location.origin).href;
    return null;
  } catch {
    tab?.close();
    return "Connection failed. The file did not open — please try again.";
  }
}
