const path = require('path');
const fs = require('fs');
const sharp = require(path.join(__dirname, '..', 'client', 'node_modules', 'sharp'));

(async () => {
  try {
    const src = path.join(__dirname, '..', 'client', 'public', 'icons', 'baty-icon.svg');
    const out192 = path.join(__dirname, '..', 'client', 'public', 'icons', 'baty-icon-192.png');
    const out512 = path.join(__dirname, '..', 'client', 'public', 'icons', 'baty-icon-512.png');

    if (!fs.existsSync(src)) {
      throw new Error(`SVG source not found: ${src}`);
    }

    // Generate 192x192 PNG (flattened with white background for iOS)
    await sharp(src, { density: 384 })
      .resize(192, 192)
      .flatten({ background: '#ffffff' })
      .png({ quality: 100 })
      .toFile(out192);

    // Generate 512x512 PNG (flattened with white background for iOS)
    await sharp(src, { density: 384 })
      .resize(512, 512)
      .flatten({ background: '#ffffff' })
      .png({ quality: 100 })
      .toFile(out512);

    console.log('Generated icons:', { out192, out512 });
  } catch (err) {
    console.error('Error generating icons:', err);
    process.exit(1);
  }
})();