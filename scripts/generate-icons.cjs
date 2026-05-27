const fs = require("node:fs/promises");
const path = require("node:path");

const sharp = require("sharp");
const toIco = require("to-ico");

const ROOT = path.resolve(__dirname, "..");
const SVG = path.join(ROOT, "public", "icone-disnatia.svg");
const APP = path.join(ROOT, "src", "app");
const PUBLIC = path.join(ROOT, "public");
const ASPECT = 356.044 / 334.681;

async function renderIcon(size, background = null) {
  const padding = Math.max(1, Math.round(size * 0.1));
  const inner = size - padding * 2;

  let width;
  let height;

  if (ASPECT >= 1) {
    width = inner;
    height = Math.max(1, Math.round(inner / ASPECT));
  } else {
    height = inner;
    width = Math.max(1, Math.round(inner * ASPECT));
  }

  const logo = await sharp(SVG)
    .resize(width, height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const canvas = sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: background ?? { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });

  return canvas
    .composite([{ input: logo, left: Math.floor((size - width) / 2), top: Math.floor((size - height) / 2) }])
    .png()
    .toBuffer();
}

async function savePng(filePath, size, background = null) {
  const png = await renderIcon(size, background);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, png);
}

async function saveIco(filePath, sizes) {
  const pngs = await Promise.all(sizes.map((size) => renderIcon(size)));
  const ico = await toIco(pngs);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, ico);
}

async function main() {
  const white = { r: 255, g: 255, b: 255, alpha: 1 };

  await saveIco(path.join(APP, "favicon.ico"), [16, 32, 48]);
  await savePng(path.join(APP, "icon.png"), 32);
  await savePng(path.join(APP, "apple-icon.png"), 180, white);
  await savePng(path.join(PUBLIC, "icon-192.png"), 192, white);
  await savePng(path.join(PUBLIC, "icon-512.png"), 512, white);
  await fs.copyFile(SVG, path.join(APP, "icon.svg"));

  console.log("Generated icons in src/app and public");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
