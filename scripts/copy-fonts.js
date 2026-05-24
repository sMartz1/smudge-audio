const fs = require('fs');
const path = require('path');

const FONTS = [
  {
    src: 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
    dest: 'fonts/inter-variable.woff2'
  },
  {
    src: 'node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
    dest: 'fonts/jetbrains-mono-variable.woff2'
  }
];

const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, 'fonts'), { recursive: true });

for (const f of FONTS) {
  const src = path.join(root, f.src);
  const dest = path.join(root, f.dest);
  if (!fs.existsSync(src)) {
    console.warn(`[copy-fonts] missing source: ${f.src}`);
    continue;
  }
  fs.copyFileSync(src, dest);
  console.log(`[copy-fonts] ${f.dest}`);
}
