import assert from 'node:assert/strict';
import type { Locator, Page } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Capture the real expanded panel, without hiding surrounding content or changing its styles. */
async function captureActionState(page: Page, panel: Locator, state: 'ready' | 'uncertain-recovery') {
  const originalViewport = page.viewportSize();
  const output = resolve('test-artifacts/online-bookings');
  await mkdir(output, { recursive: true });
  const evidence: unknown[] = [];
  try {
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      const controls: [string, Locator][] = [
        ['Action', panel.getByLabel('Action', { exact: true })],
        ['Close / back', panel.getByRole('button', { name: 'Close / back to bookings', exact: true })],
      ];
      if (state === 'ready') controls.push(
        ['Related request', panel.getByLabel('Related request or payment')],
        ['Execute', panel.getByRole('button', { name: 'Submit accepted cancellation / check status', exact: true })],
      );
      else controls.push(
        ['Original command recovery', panel.getByRole('button', { name: 'Retry the original command safely', exact: true })],
        ['Uncertain outcome', panel.getByRole('status').filter({ hasText: 'Synthetic unknown outcome' })],
      );
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${state}: no document overflow at ${width}px`);
      for (const [label, control] of controls) {
        await control.scrollIntoViewIfNeeded();
        assert(await control.isVisible(), `${state}: ${label} visible at ${width}px`);
        const geometry = await control.evaluate(element => {
          const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
          const clippedBy: string[] = [];
          for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
            const ancestorStyle = getComputedStyle(ancestor), boundary = ancestor.getBoundingClientRect();
            if (['hidden', 'clip', 'auto', 'scroll'].includes(ancestorStyle.overflowX) && (rect.left < boundary.left - 1 || rect.right > boundary.right + 1)) clippedBy.push(ancestor.tagName);
          }
          return { left: rect.left, right: rect.right, width: rect.width, height: rect.height, fontSize: parseFloat(style.fontSize), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, clippedBy };
        });
        evidence.push({ state, viewportWidth: width, label, ...geometry });
        assert(geometry.left >= -1 && geometry.right <= width + 1 && geometry.width > 0 && geometry.height > 0, `${state}: ${label} fits viewport at ${width}px: ${JSON.stringify(geometry)}`);
        assert.equal(geometry.clippedBy.length, 0, `${state}: ${label} not clipped by ancestors at ${width}px`);
        assert(geometry.fontSize >= 12 && geometry.scrollWidth <= geometry.clientWidth + 1, `${state}: ${label} readable without horizontal text clipping at ${width}px: ${JSON.stringify(geometry)}`);
      }
      if (state === 'ready') {
        assert.equal(await panel.getByLabel('Related request or payment').inputValue(), 'accepted');
        assert(await panel.getByRole('button', { name: 'Submit accepted cancellation / check status', exact: true }).isEnabled());
      }
      // Element capture includes the entire bounded six-record panel, including its status and recovery controls.
      await panel.screenshot({ path: resolve(output, `platform-action-${state}-${width}.png`), timeout: 10_000 });
    }
  } finally {
    await writeFile(resolve(output, `platform-action-${state}-geometry.json`), JSON.stringify(evidence, null, 2));
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
}

/** Runs only inside the isolated online queue CI fixture; all command traffic is intercepted. */
export async function verifyPlatformActions(page: Page) {
  await page.unroute('**/api/integrations/booking-platform/**');
  let commandReads = 0;
  const sent: { id: string; bookingId: string; action: string; targetId?: string; data: Record<string, unknown> }[] = [];
  const cancellation = (id: string, status: string, accepted = false) => ({ id, status, accepted_at: accepted ? '2026-01-01' : null, offer_expires_at: '2099-01-01T00:00:00Z' });
  const records = [cancellation('requested', 'REQUESTED'), cancellation('unaccepted', 'AWAITING_ACCEPTANCE'), cancellation('accepted', 'AWAITING_ACCEPTANCE', true), cancellation('pending', 'SUPPLIER_PENDING'), cancellation('done', 'CONFIRMED'), cancellation('unknown', 'UNKNOWN')];
  await page.route('**/api/integrations/booking-platform/**', async route => {
    if (route.request().method() !== 'POST') {
      commandReads++;
      const pending = sent.find(command => command.action === 'CANCELLATION_EXECUTE');
      return route.fulfill({ json: { commands: pending ? [{ ...pending, state: 'UNKNOWN' }] : [] } });
    }
    const body = route.request().postDataJSON(); sent.push(body);
    if (body.action === 'STATUS') return route.fulfill({ json: { commandRecorded: true, order: { reference: 'Synthetic booking', status: 'CONFIRMED', revision: 1 }, cancellations: records } });
    await new Promise(resolve => setTimeout(resolve, 250));
    // A successful HTTP transport must not turn an unknown command into success.
    if (sent.filter(command => command.action === 'CANCELLATION_EXECUTE').length === 2) return route.fulfill({ json: { message: 'Synthetic missing command confirmation' } });
    return route.fulfill({ json: { uncertain: true, error: 'Synthetic unknown outcome. Retry exact command.' } });
  });
  const panel = page.locator('tbody tr').first().locator('details').first();
  if (await panel.getAttribute('open') === null) await panel.locator('summary').first().click();
  await panel.getByLabel('Action', { exact: true }).selectOption('STATUS');
  await panel.getByRole('button', { name: 'Read live booking status', exact: true }).click();
  await panel.getByText('Synthetic booking · Confirmed · Revision 1', { exact: true }).waitFor();
  await panel.getByLabel('Action', { exact: true }).selectOption('CANCELLATION_EXECUTE');
  const target = panel.getByLabel('Related request or payment');
  for (const id of ['requested','unaccepted','done','unknown']) assert(await target.locator(`option[value="${id}"]`).isDisabled(), id);
  for (const id of ['accepted','pending']) assert(!(await target.locator(`option[value="${id}"]`).isDisabled()), id);
  assert.match(await target.locator('option[value="accepted"]').innerText(), /Offer available/);
  assert.doesNotMatch(await target.locator('option[value="accepted"]').innerText(), /Awaiting acceptance/);
  await target.selectOption('accepted');
  await captureActionState(page, panel, 'ready');
  await target.selectOption('pending');
  const execute = panel.getByRole('button', { name: 'Submit accepted cancellation / check status', exact: true });
  // Two native synchronous clicks cover the pre-render repeated-click window.
  await execute.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await panel.getByRole('status').filter({ hasText: 'Synthetic unknown outcome' }).waitFor();
  assert.equal(sent.filter(x => x.action === 'CANCELLATION_EXECUTE').length, 1);
  await panel.getByRole('button', { name: 'Close / back to bookings' }).click();
  assert.equal(await panel.getAttribute('open'), null);
  assert.equal(sent.length, 2, 'Close performs no cancellation or financial action');
  await panel.locator('summary').first().click();
  assert.equal(await target.inputValue(), 'pending');
  await panel.getByRole('status').filter({ hasText: 'Synthetic unknown outcome' }).waitFor();
  await execute.click();
  await panel.getByRole('status').filter({ hasText: 'Outcome is uncertain' }).waitFor();
  const attempts = sent.filter(x => x.action === 'CANCELLATION_EXECUTE');
  assert.equal(attempts.length, 2); assert.equal(attempts[0].id, attempts[1].id, 'Exact retry survives close/back');
  const queueUrl = page.url();
  await page.goto(new URL('/online-bookings?q=synthetic-no-match', queueUrl).href);
  await page.goBack();
  await page.getByRole('heading', { name: 'Online bookings', exact: true }).waitFor();
  if (await panel.getAttribute('open') === null) await panel.locator('summary').first().click();
  await panel.getByRole('button', { name: 'Retry the original command safely' }).click();
  await panel.getByRole('status').filter({ hasText: 'Synthetic unknown outcome' }).waitFor();
  assert.equal(sent.at(-1)!.id, attempts[0].id, 'Browser Back recovers the persisted original command');
  assert.equal(await panel.getByRole('button', { name: 'Retry the original command safely' }).count(), 1, 'Unknown recovery remains visible');
  const technicalReference = panel.locator('details').filter({ has: page.getByText('Technical command reference', { exact: true }) });
  assert.equal(await technicalReference.getAttribute('open'), null, 'Technical UUID is collapsed by default');
  assert.equal(await technicalReference.locator('code').textContent(), attempts[0].id, 'Exact recovery reference is retained');
  assert(!(await technicalReference.locator('code').isVisible()), 'UUID does not compete with primary recovery guidance');
  const readsBeforeTechnicalToggle = commandReads;
  const unresolvedBeforeTechnicalToggle = await panel.getByText('Outcome unresolved:', { exact: false }).innerText();
  const toggleTechnicalReference = async () => {
    // Observe the actual native toggle, then allow React's synthetic propagation and the next paint to finish.
    const toggled = technicalReference.evaluate(element => new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Technical details toggle did not complete')), 5000);
      element.addEventListener('toggle', () => { clearTimeout(timer); resolve(); }, { once: true });
    }));
    await Promise.all([toggled, technicalReference.locator('summary').click()]);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.equal(commandReads, readsBeforeTechnicalToggle, 'Inner details do not reload the outer command list');
    assert.equal(await panel.getByText('Outcome unresolved:', { exact: false }).innerText(), unresolvedBeforeTechnicalToggle, 'Inner details preserve unresolved outcome');
    assert.equal(await technicalReference.locator('code').textContent(), attempts[0].id, 'Inner details preserve the original command key');
    assert.equal(await panel.getByRole('button', { name: 'Retry the original command safely' }).count(), 1, 'Recovery remains available');
  };
  await toggleTechnicalReference();
  assert(await technicalReference.locator('code').isVisible(), 'Staff can still inspect the original reference');
  await toggleTechnicalReference();
  await captureActionState(page, panel, 'uncertain-recovery');
  console.log('PASS platform actions browser: supported, unsupported, pending, unknown, close/back, repeated click and exact retry');
}
