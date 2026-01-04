/**
 * Generate PNG icons from SVG using Playwright
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function generateIcons() {
  const svgPath = path.join(__dirname, 'public', 'icon.svg');
  const svgContent = fs.readFileSync(svgPath, 'utf8');

  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Create HTML with SVG
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { margin: 0; padding: 0; background: transparent; }
        svg { display: block; }
      </style>
    </head>
    <body>${svgContent}</body>
    </html>
  `;

  // Generate different sizes
  const sizes = [16, 32, 64, 128, 256, 512];

  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(html);
    await page.screenshot({
      path: path.join(__dirname, 'public', `icon-${size}.png`),
      omitBackground: true
    });
    console.log(`Generated icon-${size}.png`);
  }

  // Main icon (256px)
  await page.setViewportSize({ width: 256, height: 256 });
  await page.setContent(html);
  await page.screenshot({
    path: path.join(__dirname, 'public', 'icon.png'),
    omitBackground: true
  });
  console.log('Generated icon.png (256px)');

  await browser.close();
  console.log('Done!');
}

generateIcons().catch(console.error);
