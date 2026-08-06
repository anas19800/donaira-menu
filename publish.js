/* توليد نسخة ثابتة من المنيو ونشرها على GitHub Pages */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const docs = path.join(root, 'docs');

// ---- build static site into docs/ ----
fs.rmSync(docs, { recursive: true, force: true });
fs.mkdirSync(docs, { recursive: true });

const db = JSON.parse(fs.readFileSync(path.join(root, 'data', 'db.json'), 'utf8'));
fs.writeFileSync(
  path.join(docs, 'data.json'),
  JSON.stringify({ settings: db.settings, categories: db.categories, items: db.items }),
  'utf8'
);

// copy uploaded images (logo etc.)
const up = path.join(root, 'data', 'uploads');
const dup = path.join(docs, 'uploads');
fs.mkdirSync(dup, { recursive: true });
if (fs.existsSync(up)) {
  for (const f of fs.readdirSync(up)) fs.copyFileSync(path.join(up, f), path.join(dup, f));
}

// adapt menu.html for static hosting:
// live data from the GitHub "data" branch (falls back to the baked data.json),
// uploaded images from raw.githubusercontent, external image URLs direct
const RAW = 'https://raw.githubusercontent.com/anas19800/donaira-menu/data/data';
let html = fs.readFileSync(path.join(root, 'public', 'menu.html'), 'utf8');
html = html.replace(
  "DB = await (await fetch('/api/all')).json();",
  `let _r; try { _r = await fetch('${RAW}/db.json?t='+Date.now()); if(!_r.ok) throw 0; } catch(e) { _r = await fetch('./data.json?t='+Date.now()); } DB = await _r.json();`
);
html = html.replace(
  "function imgSrc(u){ return u ? (u.startsWith('/') ? u : '/img?u='+encodeURIComponent(u)) : ''; }",
  `function imgSrc(u){ return u ? (u.startsWith('/uploads/') ? '${RAW}'+u : u) : ''; }`
);
fs.writeFileSync(path.join(docs, 'index.html'), html, 'utf8');
fs.writeFileSync(path.join(docs, '.nojekyll'), '');
console.log('تم بناء النسخة الثابتة في docs/');

// ---- push to GitHub ----
if (process.argv.includes('--push')) {
  execSync('git add docs data/db.json', { cwd: root });
  try {
    execSync('git commit -m "نشر المنيو"', { cwd: root, stdio: 'pipe' });
  } catch (e) {
    console.log('لا تغييرات جديدة للحفظ');
  }
  execSync('git push origin main', { cwd: root, stdio: 'pipe' });
  try {
    execSync('git push origin main:data', { cwd: root, stdio: 'pipe' });
  } catch (e) {
    console.log('تنبيه: فرع البيانات (data) فيه تعديلات أحدث من السحابة — لم يُستبدل');
  }
  console.log('تم الرفع إلى GitHub — سيتحدث الموقع خلال دقيقة تقريباً');
}
