const path = require('path');
const fs = require('fs');
const sharp = require(path.join(__dirname, '..', 'client', 'node_modules', 'sharp'));

(async () => {
  try {
    const src = path.join(__dirname, '..', 'client', 'public', 'icons', 'baty-icon.svg');
    const outDir = path.join(__dirname, '..', 'client', 'public', 'icons');
    if (!fs.existsSync(src)) throw new Error(`SVG source not found: ${src}`);

    // Helpers
    const makePng = async (size, outName, options = {}) => {
      const outPath = path.join(outDir, outName);
      const density = Math.max(384, size * 2); // high DPI for crisp edges
      let pipeline = sharp(src, { density }).resize(size, size, {
        fit: options.fit || 'cover',
        background: options.background || { r: 255, g: 255, b: 255, alpha: 1 },
      });
      if (options.flatten) pipeline = pipeline.flatten({ background: options.background });
      await pipeline.png({ quality: 100 }).toFile(outPath);
      return outPath;
    };

    // Standard PNGs (white background) — usados por iOS e favicon
    const out180 = await makePng(180, 'baty-icon-180.png', { flatten: true, background: '#ffffff' });
    const out192 = await makePng(192, 'baty-icon-192.png', { flatten: true, background: '#ffffff' });
    const out512 = await makePng(512, 'baty-icon-512.png', { flatten: true, background: '#ffffff' });

    // Maskable PNGs (transparente com área segura) — Android Launcher aplica máscara
    // Estratégia: fit contain para criar padding ~12–15% transparente nas bordas
    const outMask192 = await sharp(src, { density: 512 })
      .resize(192, 192, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ quality: 100 })
      .toFile(path.join(outDir, 'baty-icon-maskable-192.png'));

    const outMask512 = await sharp(src, { density: 1024 })
      .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ quality: 100 })
      .toFile(path.join(outDir, 'baty-icon-maskable-512.png'));

    console.log('Generated icons:', { out180, out192, out512, outMask192, outMask512 });
  } catch (err) {
    console.error('Error generating icons:', err);
    process.exit(1);
  }
})();