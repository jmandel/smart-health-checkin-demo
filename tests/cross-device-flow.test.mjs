/**
 * Cross-device E2E test: kiosk starts transaction, source app completes on "another device"
 */
import { chromium } from 'playwright';

const TIMEOUT = 30000;

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();

  context.on('page', page => {
    page.on('console', msg => {
      try { console.log(`  [${new URL(page.url()).host}] ${msg.text()}`); } catch {}
    });
    page.on('pageerror', err => console.error(`  [PAGE ERROR] ${err.message}`));
  });

  try {
    // Step 1: Open kiosk and log in
    console.log('\n=== Step 1: Open kiosk and log in ===');
    const kioskPage = await context.newPage();
    await kioskPage.goto('http://requester.localhost:3000/kiosk/', { timeout: TIMEOUT });
    await kioskPage.waitForLoadState('networkidle');

    const title = await kioskPage.locator('h1').textContent();
    console.log('Page title:', title);
    assert(title.includes('Front Desk Check-in'), 'Should be on kiosk page');

    // Fill login form (pre-filled with frontdesk/demo)
    await kioskPage.locator('button[type="submit"]').click();
    console.log('Logged in');

    // Step 2: Wait for QR to appear
    console.log('\n=== Step 2: Wait for QR code ===');
    await kioskPage.waitForSelector('canvas', { timeout: TIMEOUT });
    console.log('QR code rendered');

    // Get the launch URL from the copy input
    const launchUrl = await kioskPage.locator('.qr-link-input').inputValue();
    console.log('Launch URL:', launchUrl.substring(0, 80) + '...');
    assert(launchUrl.includes('well_known'), 'Launch URL should contain well_known');

    // Step 3: Open the launch URL in a new page (simulating patient's phone)
    console.log('\n=== Step 3: Open launch URL (patient device) ===');
    const patientPage = await context.newPage();
    await patientPage.goto(launchUrl, { timeout: TIMEOUT });
    await patientPage.waitForLoadState('networkidle');

    const checkinTitle = await patientPage.locator('h1').textContent();
    console.log('Checkin title:', checkinTitle);
    assert(checkinTitle.includes('Choose Your Health Data Source'), 'Should show picker');

    // Step 4: Click Sample Health App
    console.log('\n=== Step 4: Click Sample Health App ===');
    const sourcePromise = context.waitForEvent('page', { timeout: TIMEOUT });
    await patientPage.locator('.card:not(.disabled)').filter({ hasText: 'Sample Health App' }).click();
    const sourcePage = await sourcePromise;

    await sourcePage.locator('.technical-details-meta').filter({ hasText: 'signature verified' }).waitFor({ timeout: TIMEOUT });
    console.log('Source app loaded, request verified');

    const sigVerified = await sourcePage.locator('.technical-details-meta').filter({ hasText: 'signature verified' }).count();
    assert(sigVerified > 0, 'Should show signature verified');

    // Step 5: Share data and wait for kiosk to receive it
    console.log('\n=== Step 5: Share data ===');
    await sourcePage.locator('button.btn-primary').click();
    // Source app may close itself — that's expected in cross-device

    console.log('\n=== Step 6: Kiosk receives data via long-poll ===');
    await kioskPage.bringToFront();
    await kioskPage.waitForSelector('.success-banner', { timeout: TIMEOUT });

    const successText = await kioskPage.locator('.success-banner').textContent();
    console.log('Kiosk success:', successText);
    assert(successText.includes('check-in received'), 'Kiosk should show success');

    console.log('\n✅ ALL TESTS PASSED - Cross-device flow works!');

  } catch (err) {
    console.error('\n❌ TEST FAILED:', err.message);
    for (let i = 0; i < context.pages().length; i++) {
      try {
        await context.pages()[i].screenshot({ path: `/tmp/cross-device-fail-${i}.png` });
        console.log(`Screenshot: /tmp/cross-device-fail-${i}.png (${context.pages()[i].url()})`);
      } catch {}
    }
    process.exit(1);
  } finally {
    await browser.close();
  }
}

function assert(cond, msg) { if (!cond) throw new Error(`Assertion failed: ${msg}`); }
main();
