import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.dirname(fileURLToPath(import.meta.url));
const tplPath = path.join(root, 'plugin.template.html');
const vcPath = path.join(root, 'assets', 'vconsole.min.js');
const outPath = path.join(root, 'log-viewer.html');
const mdPath = path.join(root, 'README.md');
const distDir = path.join(root, 'dist');
const zipPath = path.join(root, 'log-viewer.zip');

const tpl = fs.readFileSync(tplPath, 'utf8');
if (tpl.includes('<!--__VCONSOLE__-->')) throw new Error('template still contains vconsole inline marker');
if (!fs.existsSync(vcPath)) throw new Error('missing assets/vconsole.min.js');

// 1) 单文件：不再内联 vConsole，所有内联脚本都必须 < 256KB
let maxScript = 0;
const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(tpl))) {
  const attrs = m[1];
  const src = m[2];
  if (/type="text\/markdown"/.test(attrs)) continue;
  const kb = Buffer.byteLength(src) / 1024;
  if (kb > maxScript) maxScript = kb;
  if (kb > 256) throw new Error('inline script exceeds 256KB: ' + kb.toFixed(1) + 'KB');
}
fs.writeFileSync(outPath, tpl, 'utf8');

// 2) README
const md = /<script type="text\/markdown">([\s\S]*?)<\/script>/.exec(tpl);
if (md) fs.writeFileSync(mdPath, md[1].trim() + '\n', 'utf8');

// 3) zip 暂存：plugin.html + README.md + assets/vconsole.min.js
fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });
fs.copyFileSync(outPath, path.join(distDir, 'plugin.html'));
fs.copyFileSync(mdPath, path.join(distDir, 'README.md'));
fs.copyFileSync(vcPath, path.join(distDir, 'assets', 'vconsole.min.js'));

// 4) 打包 zip（显式 arcname，保证 assets/ 目录层级）
try {
  const py = [
    'import zipfile',
    'z = zipfile.ZipFile("log-viewer.zip", "w", zipfile.ZIP_DEFLATED)',
    'z.write("dist/plugin.html", "plugin.html")',
    'z.write("dist/README.md", "README.md")',
    'z.write("dist/assets/vconsole.min.js", "assets/vconsole.min.js")',
    'z.close()'
  ].join('; ');
  execFileSync('python', ['-c', py], { cwd: root, stdio: 'inherit' });
} catch (e) {
  console.warn('zip 打包失败（可手动压缩 dist/ 目录）：', e.message);
}

console.log('built log-viewer.html:', (Buffer.byteLength(tpl) / 1024).toFixed(1), 'KB');
console.log('max inline script:', maxScript.toFixed(1), 'KB (limit 256KB)');
console.log('vconsole asset:', (fs.statSync(vcPath).size / 1024).toFixed(1), 'KB (limit 4MB)');
if (fs.existsSync(zipPath)) console.log('log-viewer.zip:', (fs.statSync(zipPath).size / 1024).toFixed(1), 'KB');
