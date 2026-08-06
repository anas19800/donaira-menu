/* دونيرا - نظام إدارة المنيو */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const XLSX = require('xlsx');

const PORT = process.env.PORT || 3000;
// إعدادات السحابة (تُفعّل تلقائياً عند وجود متغيرات البيئة على الاستضافة)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || 'anas19800/donaira-menu';
const DATA_BRANCH = process.env.DATA_BRANCH || 'data';
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const IMG_CACHE_DIR = path.join(DATA_DIR, 'imgcache');

for (const d of [DATA_DIR, UPLOADS_DIR, IMG_CACHE_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ---------- DB ----------
function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

let db = null;
function loadDb() {
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } else {
    db = {
      settings: {
        name_ar: 'دونيرا',
        name_en: 'DONAIRA',
        slogan: '',
        currency: 'ر.س',
        publicUrl: '',
        logo: '/uploads/logo.png',
        social: ''
      },
      categories: [],
      items: [],
      templates: []
    };
    seedFromCsv();
    saveDb();
  }
  // defaults for older records
  if (!db.templates) db.templates = [];
}
function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  scheduleSync();
}

// ---------- مزامنة البيانات مع GitHub (وضع السحابة) ----------
function ghApi(p, opt = {}) {
  return fetch('https://api.github.com' + p, {
    ...opt,
    headers: {
      'Authorization': 'token ' + GITHUB_TOKEN,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'donaira-menu',
      ...(opt.headers || {})
    }
  });
}
async function ghGetFile(filePath) {
  const r = await ghApi(`/repos/${GITHUB_REPO}/contents/${filePath}?ref=${DATA_BRANCH}`);
  if (!r.ok) return null;
  return r.json();
}
async function ghPutFile(filePath, buf, msg) {
  try {
    const cur = await ghGetFile(filePath);
    const body = { message: msg, branch: DATA_BRANCH, content: buf.toString('base64') };
    if (cur && cur.sha) body.sha = cur.sha;
    const r = await ghApi(`/repos/${GITHUB_REPO}/contents/${filePath}`, { method: 'PUT', body: JSON.stringify(body) });
    if (!r.ok) console.error('فشل رفع', filePath, 'إلى GitHub:', r.status, (await r.text()).slice(0, 200));
    else console.log('تمت مزامنة', filePath, 'مع GitHub');
    return r.ok;
  } catch (e) {
    console.error('خطأ مزامنة GitHub:', e.message);
    return false;
  }
}
let syncTimer = null;
function scheduleSync() {
  if (!GITHUB_TOKEN) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    ghPutFile('data/db.json', Buffer.from(JSON.stringify(db, null, 2)), 'تحديث بيانات المنيو');
  }, 3000);
}
async function pullFromGitHub() {
  if (!GITHUB_TOKEN) return;
  try {
    const f = await ghGetFile('data/db.json');
    if (f && f.content) {
      fs.writeFileSync(DB_FILE, Buffer.from(f.content, 'base64'));
      console.log('تم سحب أحدث بيانات المنيو من GitHub');
    }
    const r = await ghApi(`/repos/${GITHUB_REPO}/contents/data/uploads?ref=${DATA_BRANCH}`);
    if (r.ok) {
      const list = await r.json();
      for (const it of list) {
        const local = path.join(UPLOADS_DIR, it.name);
        if (!fs.existsSync(local) && it.download_url) {
          const fr = await fetch(it.download_url);
          fs.writeFileSync(local, Buffer.from(await fr.arrayBuffer()));
        }
      }
    }
  } catch (e) {
    console.error('فشل السحب من GitHub:', e.message);
  }
}

function isArabic(s) {
  return /[؀-ۿ]/.test(s || '');
}

function seedFromCsv() {
  const seedFile = path.join(__dirname, 'seed_menu.csv');
  if (!fs.existsSync(seedFile)) return;
  try {
    const wb = XLSX.read(fs.readFileSync(seedFile), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    importRows(rows, 'replace');
    console.log('تم استيراد البيانات الأولية من seed_menu.csv');
  } catch (e) {
    console.error('فشل الاستيراد الأولي:', e.message);
  }
}

// rows: array of arrays, first row = headers
function importRows(rows, mode) {
  if (!rows || rows.length < 2) throw new Error('الملف فارغ أو غير صالح');
  const headers = rows[0].map((h) => String(h || '').trim().toLowerCase());

  // flexible header mapping (arabic or english)
  const col = (names) => {
    for (const n of names) {
      const i = headers.findIndex((h) => h === n.toLowerCase());
      if (i !== -1) return i;
    }
    return -1;
  };
  const cCat = col(['القسم', 'category', 'المجموعة', 'التصنيف']);
  const cName = col(['اسم المنتج', 'الاسم', 'name', 'الاسم العربي', 'name_ar', 'اسم عربي']);
  const cNameEn = col(['الاسم الانجليزي', 'الاسم الإنجليزي', 'name_en', 'english name', 'اسم انجليزي']);
  const cPrice = col(['السعر', 'price']);
  const cPrice2 = col(['السعر 2', 'price2', 'سعر 2']);
  const cPriceL = col(['تسمية السعر', 'price_label']);
  const cPrice2L = col(['تسمية السعر 2', 'price2_label']);
  const cImg = col(['رابط الصورة', 'الصورة', 'image', 'image url', 'صورة']);
  const cDesc = col(['الوصف', 'description', 'desc', 'الشرح']);
  const cDescEn = col(['الوصف الانجليزي', 'الوصف الإنجليزي', 'desc_en', 'description_en']);
  const cCal = col(['السعرات', 'calories', 'السعرات الحرارية', 'kcal']);
  const cVis = col(['ظاهر', 'visible', 'إظهار']);

  if (cCat === -1 || cName === -1 || cPrice === -1) {
    throw new Error('يجب أن يحتوي الملف على أعمدة: القسم، اسم المنتج، السعر');
  }

  if (mode === 'replace') {
    db.categories = [];
    db.items = [];
  }

  let added = 0, updated = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;
    const catName = String(row[cCat] || '').trim();
    const name = String(row[cName] || '').trim();
    if (!catName || !name) continue;

    // find or create category
    let cat = db.categories.find(
      (c) => c.name_ar === catName || c.name_en === catName
    );
    if (!cat) {
      cat = {
        id: newId(),
        name_ar: isArabic(catName) ? catName : '',
        name_en: isArabic(catName) ? '' : catName,
        order: db.categories.length,
        visible: true
      };
      if (!cat.name_ar) cat.name_ar = catName; // always keep something displayable
      db.categories.push(cat);
    }

    const nameEn = cNameEn !== -1 ? String(row[cNameEn] || '').trim() : '';
    const name_ar = isArabic(name) ? name : (nameEn && isArabic(nameEn) ? nameEn : '');
    const name_en = !isArabic(name) ? name : nameEn;

    const price = parseFloat(row[cPrice]) || 0;
    const data = {
      name_ar,
      name_en,
      price,
      price2: cPrice2 !== -1 && row[cPrice2] !== undefined && row[cPrice2] !== '' ? parseFloat(row[cPrice2]) || null : null,
      price_label: cPriceL !== -1 ? String(row[cPriceL] || '').trim() : '',
      price2_label: cPrice2L !== -1 ? String(row[cPrice2L] || '').trim() : '',
      image: cImg !== -1 ? String(row[cImg] || '').trim() : '',
      desc_ar: cDesc !== -1 ? String(row[cDesc] || '').trim() : '',
      desc_en: cDescEn !== -1 ? String(row[cDescEn] || '').trim() : '',
      calories: cCal !== -1 && row[cCal] !== undefined && row[cCal] !== '' ? parseInt(row[cCal]) || null : null,
      visible: cVis !== -1 ? !['0', 'no', 'لا', 'false'].includes(String(row[cVis]).trim().toLowerCase()) : true
    };

    // merge: match by category + arabic/english name
    let item = db.items.find(
      (i) => i.categoryId === cat.id && (i.name_ar === name || i.name_en === name)
    );
    if (item) {
      Object.assign(item, data);
      updated++;
    } else {
      db.items.push({
        id: newId(),
        categoryId: cat.id,
        order: db.items.filter((i) => i.categoryId === cat.id).length,
        ...data
      });
      added++;
    }
  }
  return { added, updated };
}

// ---------- App ----------
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));

// ---------- حماية لوحة التحكم بكلمة مرور (وضع السحابة) ----------
function authToken() {
  return crypto.createHash('sha256').update('donaira-auth|' + ADMIN_PASSWORD).digest('hex');
}
function isAuthed(req) {
  if (!ADMIN_PASSWORD) return true;
  const m = /(?:^|;\s*)auth=([a-f0-9]+)/.exec(req.headers.cookie || '');
  return !!(m && m[1] === authToken());
}
app.use((req, res, next) => {
  if (!ADMIN_PASSWORD) return next();
  const p = req.path;
  const isPublic =
    p === '/' || p === '/menu' || p === '/menu.html' || p === '/login' ||
    p === '/img' || p.startsWith('/uploads/') || p === '/api/all' || p === '/favicon.ico';
  if (isPublic || isAuthed(req)) return next();
  if (p.startsWith('/api/')) return res.status(401).json({ error: 'غير مصرح — سجّل الدخول' });
  return res.redirect('/login');
});
app.get('/login', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>دخول الإدارة — دونيرا</title>
<style>body{font-family:'Segoe UI',Tahoma,sans-serif;background:#f6f4f1;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#fff;border-radius:16px;padding:36px;box-shadow:0 10px 40px rgba(0,0,0,.1);text-align:center;width:320px}
h1{color:#a3121f;font-size:22px;margin:0 0 18px}
input{width:100%;padding:11px;border:1.5px solid #ddd;border-radius:10px;font-size:15px;box-sizing:border-box;margin-bottom:12px;text-align:center}
button{width:100%;padding:11px;border:none;border-radius:10px;background:#ec1c24;color:#fff;font-size:15px;font-weight:bold;cursor:pointer}
.err{color:#c0392b;font-size:13px;margin-bottom:8px}</style></head><body>
<div class="card"><h1>🍽️ إدارة منيو دونيرا</h1>
${req.query.e ? '<div class="err">كلمة المرور غير صحيحة</div>' : ''}
<form method="POST" action="/login"><input type="password" name="password" placeholder="كلمة المرور" autofocus required>
<button>دخول</button></form></div></body></html>`);
});
app.post('/login', (req, res) => {
  if ((req.body.password || '') === ADMIN_PASSWORD) {
    res.setHeader('Set-Cookie', `auth=${authToken()}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`);
    return res.redirect('/admin');
  }
  res.redirect('/login?e=1');
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, newId() + ext);
    }
  }),
  limits: { fileSize: 15 * 1024 * 1024 }
});
const uploadMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// ---- data ----
app.get('/api/all', (req, res) => {
  res.json(db);
});

// ---- settings ----
app.put('/api/settings', (req, res) => {
  Object.assign(db.settings, req.body);
  saveDb();
  res.json(db.settings);
});

// ---- categories ----
app.post('/api/categories', (req, res) => {
  const c = {
    id: newId(),
    name_ar: req.body.name_ar || '',
    name_en: req.body.name_en || '',
    order: db.categories.length,
    visible: true
  };
  db.categories.push(c);
  saveDb();
  res.json(c);
});
app.put('/api/categories/reorder', (req, res) => {
  const ids = req.body.ids || [];
  ids.forEach((id, i) => {
    const c = db.categories.find((x) => x.id === id);
    if (c) c.order = i;
  });
  saveDb();
  res.json({ ok: true });
});
app.put('/api/categories/:id', (req, res) => {
  const c = db.categories.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'غير موجود' });
  Object.assign(c, req.body, { id: c.id });
  saveDb();
  res.json(c);
});
app.delete('/api/categories/:id', (req, res) => {
  db.categories = db.categories.filter((x) => x.id !== req.params.id);
  db.items = db.items.filter((x) => x.categoryId !== req.params.id);
  saveDb();
  res.json({ ok: true });
});

// ---- items ----
app.post('/api/items', (req, res) => {
  const it = {
    id: newId(),
    categoryId: req.body.categoryId,
    name_ar: req.body.name_ar || '',
    name_en: req.body.name_en || '',
    desc_ar: req.body.desc_ar || '',
    desc_en: req.body.desc_en || '',
    price: parseFloat(req.body.price) || 0,
    price2: req.body.price2 ? parseFloat(req.body.price2) : null,
    price_label: req.body.price_label || '',
    price2_label: req.body.price2_label || '',
    calories: req.body.calories ? parseInt(req.body.calories) : null,
    image: req.body.image || '',
    visible: req.body.visible !== false,
    order: db.items.filter((i) => i.categoryId === req.body.categoryId).length
  };
  db.items.push(it);
  saveDb();
  res.json(it);
});
app.put('/api/items/reorder', (req, res) => {
  const ids = req.body.ids || [];
  ids.forEach((id, i) => {
    const it = db.items.find((x) => x.id === id);
    if (it) it.order = i;
  });
  saveDb();
  res.json({ ok: true });
});
app.put('/api/items/:id', (req, res) => {
  const it = db.items.find((x) => x.id === req.params.id);
  if (!it) return res.status(404).json({ error: 'غير موجود' });
  const b = req.body;
  if (b.price !== undefined) b.price = parseFloat(b.price) || 0;
  if (b.price2 !== undefined) b.price2 = b.price2 === null || b.price2 === '' ? null : parseFloat(b.price2);
  if (b.calories !== undefined) b.calories = b.calories === null || b.calories === '' ? null : parseInt(b.calories);
  Object.assign(it, b, { id: it.id });
  saveDb();
  res.json(it);
});
app.delete('/api/items/:id', (req, res) => {
  db.items = db.items.filter((x) => x.id !== req.params.id);
  saveDb();
  res.json({ ok: true });
});

// ---- templates ----
app.post('/api/templates', (req, res) => {
  const t = {
    id: newId(),
    name: req.body.name || 'قالب جديد',
    createdAt: new Date().toISOString(),
    config: req.body.config || {}
  };
  db.templates.push(t);
  saveDb();
  res.json(t);
});
app.put('/api/templates/:id', (req, res) => {
  const t = db.templates.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'غير موجود' });
  if (req.body.name) t.name = req.body.name;
  if (req.body.config) t.config = req.body.config;
  saveDb();
  res.json(t);
});
app.delete('/api/templates/:id', (req, res) => {
  db.templates = db.templates.filter((x) => x.id !== req.params.id);
  saveDb();
  res.json({ ok: true });
});

// ---- import / export ----
app.post('/api/import', uploadMem.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف' });
    const isCsv = (req.file.originalname || '').toLowerCase().endsWith('.csv');
    const wb = isCsv
      ? XLSX.read(req.file.buffer.toString('utf8').replace(/^﻿/, ''), { type: 'string' })
      : XLSX.read(req.file.buffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    const mode = req.query.mode === 'replace' ? 'replace' : 'merge';
    const result = importRows(rows, mode);
    saveDb();
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

function exportRows() {
  const cats = [...db.categories].sort((a, b) => a.order - b.order);
  const rows = [[
    'القسم', 'اسم المنتج', 'الاسم الانجليزي', 'السعر', 'السعر 2',
    'تسمية السعر', 'تسمية السعر 2', 'الوصف', 'الوصف الانجليزي',
    'السعرات', 'رابط الصورة', 'ظاهر'
  ]];
  for (const c of cats) {
    const items = db.items
      .filter((i) => i.categoryId === c.id)
      .sort((a, b) => a.order - b.order);
    for (const i of items) {
      rows.push([
        c.name_ar || c.name_en, i.name_ar || i.name_en, i.name_en, i.price,
        i.price2 ?? '', i.price_label || '', i.price2_label || '',
        i.desc_ar || '', i.desc_en || '', i.calories ?? '',
        i.image || '', i.visible ? '1' : '0'
      ]);
    }
  }
  return rows;
}

app.get('/api/export.xlsx', (req, res) => {
  const ws = XLSX.utils.aoa_to_sheet(exportRows());
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Menu');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="menu.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});
app.get('/api/export.csv', (req, res) => {
  const ws = XLSX.utils.aoa_to_sheet(exportRows());
  const csv = '﻿' + XLSX.utils.sheet_to_csv(ws);
  res.setHeader('Content-Disposition', 'attachment; filename="menu.csv"');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.send(csv);
});

// ---- image upload ----
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف' });
  if (GITHUB_TOKEN) {
    ghPutFile('data/uploads/' + req.file.filename, fs.readFileSync(req.file.path), 'رفع صورة');
  }
  res.json({ url: '/uploads/' + req.file.filename });
});

// ---- image proxy (for PDF canvas rendering of external images) ----
app.get('/img', async (req, res) => {
  const u = req.query.u;
  if (!u) return res.status(400).end();
  if (u.startsWith('/')) {
    // local file — redirect
    return res.redirect(u);
  }
  try {
    const hash = crypto.createHash('md5').update(u).digest('hex');
    const metaFile = path.join(IMG_CACHE_DIR, hash + '.json');
    const binFile = path.join(IMG_CACHE_DIR, hash + '.bin');
    if (fs.existsSync(binFile) && fs.existsSync(metaFile)) {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      res.setHeader('Content-Type', meta.type);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(fs.readFileSync(binFile));
    }
    const r = await fetch(u);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const type = r.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(binFile, buf);
    fs.writeFileSync(metaFile, JSON.stringify({ type }));
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---- publish to GitHub Pages ----
app.post('/api/publish', async (req, res) => {
  if (GITHUB_TOKEN) {
    // وضع السحابة: رفع البيانات فوراً — صفحة الزبائن تقرأها مباشرة
    clearTimeout(syncTimer);
    const ok = await ghPutFile('data/db.json', Buffer.from(JSON.stringify(db, null, 2)), 'نشر المنيو');
    return ok ? res.json({ ok: true }) : res.status(500).json({ error: 'فشلت المزامنة مع GitHub' });
  }
  const { execFile } = require('child_process');
  execFile(process.execPath, [path.join(__dirname, 'publish.js'), '--push'], { cwd: __dirname, timeout: 120000 }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: ((stderr || '') + (err.message || '')).slice(-500) });
    res.json({ ok: true, log: stdout });
  });
});

// ---- pages ----
app.get('/', (req, res) => res.redirect('/admin'));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/menu', (req, res) => res.sendFile(path.join(__dirname, 'public', 'menu.html')));
app.get('/print', (req, res) => res.sendFile(path.join(__dirname, 'public', 'print.html')));

(async () => {
  await pullFromGitHub();
  loadDb();
  app.listen(PORT, () => {
    console.log('نظام المنيو يعمل على  http://localhost:' + PORT);
    console.log('  الإدارة:   http://localhost:' + PORT + '/admin');
    console.log('  المنيو:    http://localhost:' + PORT + '/menu');
    console.log('  الطباعة:   http://localhost:' + PORT + '/print');
    if (ADMIN_PASSWORD) console.log('  الحماية بكلمة مرور: مفعّلة');
    if (GITHUB_TOKEN) console.log('  مزامنة GitHub: مفعّلة (' + GITHUB_REPO + ' → ' + DATA_BRANCH + ')');
  });
})();
