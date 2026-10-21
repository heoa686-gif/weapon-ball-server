// Weapon Ball Arena - máy chủ tài khoản (điểm và nhiệm vụ do máy chủ quyết định)
// Yêu cầu: Node.js 18 trở lên, không cần cài thêm thư viện.
// Chạy:  ADMIN_KEY=mat_khau_admin_cua_ban PORT=8080 node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

// Giá các vũ khí khóa (phải khớp LOCK_CFG trong game)
const LOCK_CFG = {
  "Kiếm Tiên":300,"Tuyệt Thế Kiếm Thần":300,"Kiếm Thánh":300,"Kiếm Quỷ":300,"Thiên Long Kiếm":300,
  "Hắc Kiếm":200,"Bạch Kiếm":200,"Gươm thần":200,"Muramasa":200,"Huyết Kiếm":200,
  "Lưỡi hái":200,"Thương":200,"Kiếm Hoa Anh Đào":200,"Kiếm Ánh Trăng":200
};

// Mã code: MÃ (viết HOA) -> điểm thưởng
const CODES = {
  WEAPONBALLARENA: 200,
};

// Nhiệm vụ: tiến độ được tính từ dữ liệu máy chủ giữ, không tin số liệu từ game
const QUESTS = [
  {id:'d_play',daily:1,need:3,pts:30,p:q=>q.d.played},
  {id:'d_kill',daily:1,need:10,pts:30,p:q=>q.d.kills},
  {id:'d_cast',daily:1,need:15,pts:25,p:q=>q.d.casts},
  {id:'d_win',daily:1,need:1,pts:30,p:q=>q.d.wins},
  {id:'d_win10',daily:1,need:10,pts:100,p:q=>q.d.win400},
  {id:'d_read',daily:1,need:1,pts:20,p:q=>q.d.reads.length},
  {id:'h_win3',need:3,pts:60,p:q=>q.all.hwin},
  {id:'d_weps2',daily:1,need:2,pts:40,p:q=>q.d.weps.length},
  {id:'s_read',need:3,pts:40,p:q=>q.all.reads.length},
  {id:'w_win5',need:5,pts:60,p:q=>q.all.wins},
  {id:'w_hk',need:1,pts:50,p:q=>q.all.hwin},
  {id:'w_5w',need:5,pts:80,p:q=>q.all.weps.length},
  {id:'a_play20',need:20,pts:70,p:q=>q.all.played},
  {id:'a_kill50',need:50,pts:80,p:q=>q.all.kills},
  {id:'a_cast100',need:100,pts:90,p:q=>q.all.casts},
  {id:'a_read6',need:6,pts:60,p:q=>q.all.reads.length},
];

let db = { users: {}, sessions: {} };
try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) {}

function save() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DATA_FILE);
}

function hashPass(pass, salt) {
  return crypto.scryptSync(pass, salt, 64).toString('hex');
}

// Ngày theo giờ Việt Nam (UTC+7): nhiệm vụ hằng ngày làm mới lúc 0:00
function vnDay() {
  return new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
}
function freshD() {
  return { played: 0, kills: 0, casts: 0, wins: 0, win400: 0, hwin: 0, weps: [], reads: [] };
}
function freshAll() {
  return { played: 0, kills: 0, casts: 0, wins: 0, win400: 0, hwin: 0, reads: [], weps: [] };
}
// Lấy dữ liệu nhiệm vụ của tài khoản, làm mới phần hằng ngày nếu sang ngày mới
function ensureQ(u) {
  if (!u.q) u.q = { day: '', d: freshD(), all: freshAll(), dc: {}, claimed: {}, lastPlay: 0 };
  const k = vnDay();
  if (u.q.day !== k) { u.q.day = k; u.q.d = freshD(); u.q.dc = {}; }
  return u.q;
}

function send(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  });
  res.end(JSON.stringify(obj));
}
const fail = (res, code, msg) => send(res, code, { error: msg });

function readBody(req) {
  return new Promise((ok, bad) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 100000) { req.destroy(); bad(new Error('Dữ liệu quá lớn')); } });
    req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch (e) { bad(new Error('Dữ liệu không hợp lệ')); } });
  });
}

function view(u) {
  const q = ensureQ(u);
  return {
    user: u.name, pts: u.pts, spent: u.spent, unlocked: u.admin ? Object.keys(LOCK_CFG) : u.unlocked, admin: u.admin,
    quests: { day: q.day, d: q.d, all: q.all, dc: q.dc, claimed: q.claimed },
  };
}

function auth(req) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  const ln = db.sessions[t];
  if (!ln || !db.users[ln]) return null;
  return { token: t, u: db.users[ln] };
}

function newSession(u) {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[token] = u.name.toLowerCase();
  save();
  return token;
}

// Áp dụng một sự kiện tiến độ từ game, có giới hạn để chặn gian lận
function applyEvent(u, ev) {
  const q = ensureQ(u), A = q.all, D = q.d, now = Date.now();
  const k = String(ev.k || '');
  const n = Math.max(0, Math.min(30, Math.floor(Number(ev.n) || 0)));
  const v = String(ev.v || '').slice(0, 40);
  const add = (a, d, key) => { if (d > 0) { A[key] += d; D[key] += d; } };
  switch (k) {
    case 'played':
      if (now - q.lastPlay < 15000 || D.played >= 40) return;
      q.lastPlay = now; A.played++; D.played++; return;
    case 'kills': {
      const a = Math.min(n, 25 * A.played - A.kills);
      add(A, Math.min(a, 25 * D.played - D.kills), 'kills'); return;
    }
    case 'casts': {
      const a = Math.min(n, 60 * A.played - A.casts);
      add(A, Math.min(a, 60 * D.played - D.casts), 'casts'); return;
    }
    case 'wins': {
      const a = Math.min(n, A.played - A.wins);
      add(A, Math.min(a, D.played - D.wins), 'wins'); return;
    }
    case 'win400': {
      const a = Math.min(n, A.wins - A.win400);
      add(A, Math.min(a, D.wins - D.win400), 'win400'); return;
    }
    case 'hwin': {
      const a = Math.min(n, A.wins - A.hwin);
      add(A, Math.min(a, D.wins - D.hwin), 'hwin'); return;
    }
    case 'read':
      if (!v) return;
      if (!A.reads.includes(v) && A.reads.length < 50) A.reads.push(v);
      if (!D.reads.includes(v) && D.reads.length < 20) D.reads.push(v);
      return;
    case 'wep':
      if (!v) return;
      if (!A.weps.includes(v) && A.weps.length < 100) A.weps.push(v);
      if (!D.weps.includes(v) && D.weps.length < 40) D.weps.push(v);
      return;
  }
}

const routes = {
  '/api/register': async (req, res, b) => {
    const name = String(b.user || '').trim();
    const pass = String(b.pass || '');
    if (name.length < 3 || name.length > 16) return fail(res, 400, 'Tên phải từ 3 đến 16 ký tự');
    if (pass.length < 6) return fail(res, 400, 'Mật khẩu phải có ít nhất 6 ký tự');
    const ln = name.toLowerCase();
    if (db.users[ln]) return fail(res, 400, 'Tên này đã có người dùng');
    const salt = crypto.randomBytes(16).toString('hex');
    db.users[ln] = { name, salt, hash: hashPass(pass, salt), pts: 0, spent: 0, unlocked: [], codes: [], admin: false, q: null };
    const token = newSession(db.users[ln]);
    send(res, 200, { token, ...view(db.users[ln]) });
  },

  '/api/login': async (req, res, b) => {
    const ln = String(b.user || '').trim().toLowerCase();
    const u = db.users[ln];
    if (!u) return fail(res, 401, 'Sai tên hoặc mật khẩu');
    const h = Buffer.from(hashPass(String(b.pass || ''), u.salt), 'hex');
    if (!crypto.timingSafeEqual(h, Buffer.from(u.hash, 'hex'))) return fail(res, 401, 'Sai tên hoặc mật khẩu');
    const token = newSession(u);
    send(res, 200, { token, ...view(u) });
  },

  '/api/state': async (req, res) => {
    const a = auth(req);
    if (!a) return fail(res, 401, 'Phiên đăng nhập đã hết hạn');
    send(res, 200, view(a.u));
  },

  // Không còn nhận điểm từ game: chỉ trả về trạng thái hiện tại
  '/api/sync': async (req, res) => {
    const a = auth(req);
    if (!a) return fail(res, 401, 'Phiên đăng nhập đã hết hạn');
    send(res, 200, view(a.u));
  },

  '/api/progress': async (req, res, b) => {
    const a = auth(req);
    if (!a) return fail(res, 401, 'Phiên đăng nhập đã hết hạn');
    const events = Array.isArray(b.events) ? b.events.slice(0, 50) : [];
    events.forEach(ev => applyEvent(a.u, ev || {}));
    save();
    send(res, 200, view(a.u));
  },

  '/api/claim': async (req, res, b) => {
    const a = auth(req);
    if (!a) return fail(res, 401, 'Phiên đăng nhập đã hết hạn');
    const q = ensureQ(a.u);
    const id = String(b.id || '');
    // Admin: id 'all' nhận tất cả nhiệm vụ; admin nhận được mọi nhiệm vụ không cần đủ tiến độ
    if (id === 'all') {
      if (!a.u.admin) return fail(res, 403, 'Chỉ admin mới nhận tất cả');
    }
    const targets = id === 'all' ? QUESTS : [QUESTS.find(x => x.id === id)];
    if (!targets[0]) return fail(res, 400, 'Nhiệm vụ không hợp lệ');
    let got = 0;
    for (const Q of targets) {
      const done = Q.daily ? !!q.dc[Q.id] : !!q.claimed[Q.id];
      if (done) { if (id !== 'all') return fail(res, 400, 'Đã nhận thưởng rồi'); continue; }
      if (!a.u.admin && Q.p(q) < Q.need) return fail(res, 400, 'Chưa hoàn thành nhiệm vụ');
      if (Q.daily) q.dc[Q.id] = 1; else q.claimed[Q.id] = 1;
      a.u.pts += Q.pts; got++;
    }
    if (id === 'all' && !got) return fail(res, 400, 'Không còn nhiệm vụ nào để nhận');
    save();
    send(res, 200, view(a.u));
  },

  '/api/buy': async (req, res, b) => {
    const a = auth(req);
    if (!a) return fail(res, 401, 'Phiên đăng nhập đã hết hạn');
    const weapon = String(b.weapon || '');
    const price = LOCK_CFG[weapon];
    if (price === undefined) return fail(res, 400, 'Vũ khí không hợp lệ');
    if (a.u.unlocked.includes(weapon)) return fail(res, 400, 'Vũ khí này đã mở rồi');
    if (a.u.pts - a.u.spent < price) return fail(res, 400, 'Không đủ điểm');
    a.u.spent += price;
    a.u.unlocked.push(weapon);
    save();
    send(res, 200, view(a.u));
  },

  '/api/redeem': async (req, res, b) => {
    const a = auth(req);
    if (!a) return fail(res, 401, 'Phiên đăng nhập đã hết hạn');
    const key = String(b.code || '').trim().toUpperCase();
    const reward = CODES[key];
    if (reward === undefined) return fail(res, 400, 'Mã không hợp lệ');
    if (a.u.codes.includes(key)) return fail(res, 400, 'Tài khoản này đã dùng mã này rồi');
    a.u.codes.push(key);
    a.u.pts += reward;
    save();
    send(res, 200, { ...view(a.u), reward });
  },

  '/api/admin': async (req, res, b) => {
    const a = auth(req);
    if (!a) return fail(res, 401, 'Phiên đăng nhập đã hết hạn');
    if (String(b.key || '') !== ADMIN_KEY) return fail(res, 403, 'Sai mã admin');
    a.u.admin = true;
    save();
    send(res, 200, view(a.u));
  },
};

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const handler = routes[req.url.split('?')[0]];
  if (req.method !== 'POST' || !handler) return fail(res, 404, 'Không tìm thấy');
  try {
    const body = await readBody(req);
    await handler(req, res, body);
  } catch (e) {
    fail(res, 400, e.message || 'Lỗi máy chủ');
  }
}).listen(PORT, () => console.log('Weapon Ball Arena server chạy tại cổng ' + PORT));
