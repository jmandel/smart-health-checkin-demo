const { test, expect } = require('@playwright/test');

test.describe('SMART Health Check-in Flow', () => {
  test('should complete full registration flow', async ({ page, context }) => {
    // Navigate to the requester page
    await page.goto('http://requester.localhost:3000');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Verify we're on Dr. Mandel's clinic page
    await expect(page.locator('h2.clinic-name')).toContainText("Dr. Mandel's Family Medicine");

    // Verify the task list shows pending items
    await expect(page.locator('#task-insurance .task-badge')).toContainText('Pending');
    await expect(page.locator('#task-clinical .task-badge')).toContainText('Pending');
    await expect(page.locator('#task-intake .task-badge')).toContainText('Pending');

    // Check transaction log is initialized
    await expect(page.locator('#log-content')).toContainText('Waiting for request');

    // Click the "Share with SMART Health Check-in" button
    const checkinButton = page.locator('#btn-checkin');
    await expect(checkinButton).toBeVisible();
    await expect(checkinButton).toContainText('Share with SMART Health Check-in');

    // Listen for popup
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Share with SMART Health Check-in' }).click();

    // Wait for the check-in popup to open
    const popup = await popupPromise;

    // Debug: Print console logs from popup
    popup.on('console', msg => console.log(`[Popup Console] ${msg.text()}`));

    await popup.waitForLoadState('networkidle');

    // Verify we're on the check-in page
    await expect(popup.locator('h1')).toContainText('Connect');
    // Verify we're on the check-in page
    await expect(popup.locator('h1')).toContainText('Connect');
    // Security update: We now show the origin, not the self-asserted name
    // The origin in the test environment is http://requester.localhost:3000
    await expect(popup.locator('h1')).toContainText("requester.localhost:3000");

    // Verify the footer shows security message
    await expect(popup.locator('footer')).toContainText('Secure Routing by SMART Health Check-in');
    await expect(popup.locator('footer')).toContainText('We do not store your data');

    // Verify apps are displayed in categories
    await expect(popup.locator('.section-title').first()).toBeVisible();
    await expect(popup.getByText('Health Plans')).toBeVisible();

    // Click on Sample Health App (should be in "Connected Apps" category)
    const sample-healthCard = popup.locator('.card:not(.disabled)').filter({ hasText: 'Sample Health App' });
    await expect(sample-healthCard).toBeVisible();

    // Listen for the source app page
    const sourcePromise = context.waitForEvent('page');
    await sample-healthCard.click();

    // Wait for the source page to open
    const sourcePage = await sourcePromise;

    // Debug: Print console logs from source page (Sample Health App)
    sourcePage.on('console', msg => console.log(`[Sample Health App Console] ${msg.text()}`));

    await sourcePage.waitForLoadState('networkidle');

    // Verify we're on the Sample Health App page
    await expect(sourcePage.locator('h1')).toContainText('Sample Health App');

    // Verify the auto-fill banner is shown
    await expect(sourcePage.locator('.auto-filled-banner')).toContainText('We found matching records');
    await expect(sourcePage.locator('.auto-filled-banner')).toContainText('auto-filled your Intake Form');

    // Verify pre-filled fields are highlighted
    const preFilledFields = sourcePage.locator('.auto-filled-field');
    await expect(preFilledFields.first()).toBeVisible();

    // Verify the insurance card preview is shown
    await expect(sourcePage.locator('.card-preview')).toContainText('Aetna PPO');

    // Verify questionnaire fields are present and pre-filled
    await expect(sourcePage.locator('input[id*="q-0-1"]')).toHaveValue(/.+/); // Name should be filled
    await expect(sourcePage.locator('input[id*="q-0-2"]')).toHaveValue(/.+/); // DOB should be filled

    // Click the "Share Selected Data" button
    const shareButton = sourcePage.locator('button.btn-primary', { hasText: 'Share Selected Data' });
    await expect(shareButton).toBeVisible();
    await shareButton.click();

    // Wait for redirect back to requester (the source page will navigate)
    // Wait for redirect back to requester (the source page will navigate and close)
    // await sourcePage.waitForURL(/requester\.localhost:3000/); // Page closes too fast for this

    // Wait for the popup to close (optional, but good practice)
    try {
      await sourcePage.waitForEvent('close', { timeout: 5000 });
    } catch (e) {
      // Ignore if already closed
    }

    // Switch back to the original requester page
    await page.bringToFront();

    // Wait for the response to be processed
    await page.waitForTimeout(2000);

    // Verify the tasks are marked as completed
    await expect(page.locator('#task-insurance .task-badge')).toContainText('Received', { timeout: 10000 });
    await expect(page.locator('#task-clinical .task-badge')).toContainText('Received');
    await expect(page.locator('#task-intake .task-badge')).toContainText('Received');

    // Verify checkmarks are shown
    await expect(page.locator('#task-insurance .task-status')).toContainText('✓');
    await expect(page.locator('#task-clinical .task-status')).toContainText('✓');
    await expect(page.locator('#task-intake .task-status')).toContainText('✓');

    // Verify the success banner is displayed
    await expect(page.locator('.success-banner')).toContainText('Registration information received successfully');

    // Verify the insurance card is rendered
    await expect(page.locator('.insurance-card')).toBeVisible();
    await expect(page.locator('.insurance-card-header')).toContainText('DIGITAL INSURANCE CARD');

    // Verify the button shows completion
    await expect(checkinButton).toContainText('Registration Complete');

    // Verify the transaction log shows the full flow
    await expect(page.locator('#log-content')).toContainText('Outgoing Request');
    await expect(page.locator('#log-content')).toContainText('Response Received');
    await expect(page.locator('#log-content')).toContainText('Transaction Complete');

    console.log('✓ Full SMART Health Check-in flow completed successfully!');
  });

  test('should show proper branding and context', async ({ page }) => {
    await page.goto('http://requester.localhost:3000');
    await page.waitForLoadState('networkidle');

    // Verify branding
    await expect(page.locator('.logo')).toContainText('DM');
    await expect(page.locator('.clinic-name')).toContainText("Dr. Mandel's Family Medicine");

    // Verify registration UI elements
    await expect(page.locator('h1')).toContainText('New Patient Registration');
    await expect(page.locator('.subtitle')).toContainText('Please complete your registration');

    // Verify the manual entry link
    await expect(page.locator('.manual-link a')).toContainText('fill out forms manually');
    await expect(page.locator('.manual-link a')).toContainText('15-20 mins');

    // Verify transaction log is present
    await expect(page.locator('.log-title')).toContainText('System Transaction Log');
  });
});
