const JSZip = require('../node_modules/jszip');
const fs = require('fs');
const path = require('path');

const base = path.join(__dirname, '..', 'remotion-template-advanced-v2');
const outPath = path.join(__dirname, '..', 'remotion-template-advanced-v2.zip');

const files = [
  'courseforge-remotion-template.json',
  'package.json',
  'src/index.tsx',
];

const zip = new JSZip();
for (const f of files) {
  const content = fs.readFileSync(path.join(base, f));
  // always use forward slashes in ZIP entries
  zip.file(f.split(path.sep).join('/'), content);
}

zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }).then(buf => {
  fs.writeFileSync(outPath, buf);
  console.log('ZIP creado:', outPath, '(' + buf.length + ' bytes)');
  // verify paths
  return JSZip.loadAsync(buf);
}).then(z => {
  Object.keys(z.files).forEach(name => console.log(' -', name));
});
