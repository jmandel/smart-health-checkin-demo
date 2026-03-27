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
    const popupPromise = context.waitForEvent('page', { timeout: TIMEOUT });
    await page.getByRole('button', { name: 'Share with SMART Health Check-in' }).click();
    const checkinPopup = await popupPromise;
    await checkinPopup.waitForLoadState('networkidle');
    console.log('Check-in URL:', checkinPopup.url());
    const checkinTitle = await checkinPopup.locator('h1').textContent();
    assert(checkinTitle.includes('Choose Your Health Data Source'), 'Should show picker');

    assert(checkinPopup.url().includes('well_known%3A'), 'URL should contain well_known: client_id');
    assert(checkinPopup.url().includes('request_uri='), 'URL should contain request_uri');

    console.log('\n=== Step 3: Click Sample Health App ===');
    const sourcePromise = context.waitForEvent('page', { timeout: TIMEOUT });
    await checkinPopup.locator('.card:not(.disabled)').filter({ hasText: 'Sample Health App' }).click();
    const sourcePage = await sourcePromise;

    await sourcePage.waitForSelector('.request-box', { timeout: TIMEOUT });
    console.log('Source app loaded and request verified');

    const sigStatus = await sourcePage.locator('.request-detail .value').filter({ hasText: 'Signature verified' }).count();
    console.log('Signature verified shown:', sigStatus > 0);
    assert(sigStatus > 0, 'Should show signature verified');

    const clientIdShown = await sourcePage.locator('.request-detail .value').filter({ hasText: 'well_known:' }).count();
    assert(clientIdShown > 0, 'Should show well_known: client_id');

    const autoFilled = await sourcePage.locator('.auto-filled-banner').textContent();
    assert(autoFilled.includes('auto-filled'), 'Should show auto-fill banner');

    console.log('\n=== Step 4: Share data ===');
    await sourcePage.locator('button.btn-primary').click();

    console.log('Waiting for same-device flow to complete...');
    await page.bringToFront();
    await page.waitForSelector('.success-banner', { timeout: TIMEOUT });

    const successText = await page.locator('.success-banner').textContent();
    console.log('Success:', successText);
    assert(successText.includes('Registration information received'), 'Should show success');

    const memberId = await page.locator('.insurance-card-value').first().textContent();
    console.log('Member ID:', memberId);
    assert(memberId.includes('W123456789'), 'Correct member ID');

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
