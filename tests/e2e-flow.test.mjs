import { chromium } from 'playwright';

const TIMEOUT = 30000;

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();

  context.on('page', page => {
    page.on('console', msg => console.log(`[${new URL(page.url()).hostname || '?'}] ${msg.text()}`));
    page.on('pageerror', err => console.error(`[PAGE ERROR] ${err.message}`));
  });

  try {
    console.log('\n=== Step 1: Open portal ===');
    const page = await context.newPage();
    await page.goto('http://requester.localhost:3000/portal/', { timeout: TIMEOUT });
    await page.waitForLoadState('networkidle');
    const title = await page.locator('h1').textContent();
    console.log('Page title:', title);
    assert(title.includes('Patient Portal Check-in'), 'Should be on portal page');

    console.log('\n=== Step 2: Click check-in ===');
    await page.getByRole('button', { name: 'Share with SMART Health Check-in' }).click();
    await page.waitForURL(/\/checkin\//, { timeout: TIMEOUT });
    await page.waitForLoadState('networkidle');
    console.log('Check-in URL:', page.url());
    const checkinTitle = await page.locator('h1').textContent();
    assert(checkinTitle.includes('Choose Your Health Data Source'), 'Should show picker');

    assert(page.url().includes('well_known%3A'), 'URL should contain well_known: client_id');
    assert(page.url().includes('request_uri='), 'URL should contain request_uri');
    assert(page.url().includes('shc_launch=replace'), 'URL should request same-tab launch');
    assert(page.url().includes('shc_handoff='), 'URL should contain handoff id');

    console.log('\n=== Step 3: Click Sample Health App ===');
    await page.locator('.card:not(.disabled)').filter({ hasText: 'Sample Health App' }).click();
    await page.waitForURL(/\/source-app\//, { timeout: TIMEOUT });
    await page.locator('.technical-details-meta').filter({ hasText: 'signature verified' }).waitFor({ timeout: TIMEOUT });
    console.log('Source app loaded and request verified');

    const sigStatus = await page.locator('.technical-details-meta').filter({ hasText: 'signature verified' }).count();
    console.log('Signature verified shown:', sigStatus > 0);
    assert(sigStatus > 0, 'Should show signature verified');

    await page.locator('details.technical-details').evaluate(el => { el.open = true; });
    const clientIdShown = await page.locator('.request-detail .value').filter({ hasText: 'well_known:' }).count();
    assert(clientIdShown > 0, 'Should show well_known: client_id');

    const autoFilled = await page.locator('.auto-filled-banner').textContent();
    assert(autoFilled.includes('auto-filled'), 'Should show auto-fill banner');

    console.log('\n=== Step 4: Share data ===');
    await page.locator('button.btn-primary').click();

    console.log('Waiting for same-device flow to complete...');
    await page.waitForSelector('.success-banner', { timeout: TIMEOUT });

    const successText = await page.locator('.success-banner').textContent();
    console.log('Success:', successText);
    assert(successText.includes('Registration information received'), 'Should show success');

    const receivedCount = await page.locator('.badge-received').count();
    console.log('Received task count:', receivedCount);
    assert(receivedCount === 4, 'All requested check-in tasks should be received');

    console.log('\n✅ ALL TESTS PASSED');

  } catch (err) {
    console.error('\n❌ TEST FAILED:', err.message);
    for (let i = 0; i < context.pages().length; i++) {
      try {
        await context.pages()[i].screenshot({ path: `/tmp/e2e-fail-${i}.png` });
        console.log(`Screenshot: /tmp/e2e-fail-${i}.png`);
      } catch {}
    }
    process.exit(1);
  } finally {
    await browser.close();
  }
}

function assert(cond, msg) { if (!cond) throw new Error(`Assertion failed: ${msg}`); }
main();
