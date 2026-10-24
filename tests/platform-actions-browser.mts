import assert from 'node:assert/strict';
import type { Page } from 'playwright';
/** Runs only inside the isolated online queue CI fixture; all command traffic is intercepted. */
export async function verifyPlatformActions(page: Page) {
  await page.unroute('**/api/integrations/booking-platform/**');
  const sent: { id: string; bookingId: string; action: string; targetId?: string; data: Record<string, unknown> }[] = [];
  const cancellation = (id: string, status: string, accepted = false) => ({ id, status, accepted_at: accepted ? '2026-01-01' : null, offer_expires_at: '2099-01-01T00:00:00Z' });
  const records = [cancellation('requested', 'REQUESTED'), cancellation('unaccepted', 'AWAITING_ACCEPTANCE'), cancellation('accepted', 'AWAITING_ACCEPTANCE', true), cancellation('pending', 'SUPPLIER_PENDING'), cancellation('done', 'CONFIRMED'), cancellation('unknown', 'UNKNOWN')];
  await page.route('**/api/integrations/booking-platform/**', async route => {
    if (route.request().method() !== 'POST') {
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
  console.log('PASS platform actions browser: supported, unsupported, pending, unknown, close/back, repeated click and exact retry');
}
