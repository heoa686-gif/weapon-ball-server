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
  "Lưỡi hái":200,"Thương":200,"Kiếm Hoa Anh Đào":200,"Kiếm Ánh Trăng":200,
  "Song Đao Tử Thần":0,
  "Onglibus":0,
  "Toái Thủy Vũ Trượng":0
};

// Giá vàng: vũ khí đổi bằng vàng trong Gacha (phải khớp GOLD_CFG trong game)
const GOLD_CFG = { 'Onglibus': 250, 'Song Đao Tử Thần': 250, 'Toái Thủy Vũ Trượng': 250 };

// Mã code: MÃ (viết HOA) -> điểm thưởng
const CODES = {
  WEAPONBALLARENA: 200,
  CODEHACKGAME: 10000,
  NEWBIE: 500,
  NHAN10LUOTQUAY: { boxes: 10 },
  WEAPONBALLARENANUMBERONE: { boxes: 20, pts: 200 },
  // Nhận ngẫu nhiên 1 vũ khí giá 200 điểm mà tài khoản chưa có
  MEMBER: { weapon: true, price: 200 },
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
  {id:'d_sqfight',daily:1,need:3,pts:30,p:q=>q.d.sqfight},
  {id:'d_sqwin',daily:1,need:1,pts:50,p:q=>q.d.sqwin},
  {id:'w_sq10',need:10,pts:80,p:q=>q.all.sqfight},
  {id:'w_sqwin20',need:20,pts:150,p:q=>q.all.sqwin},
  {id:'w_pow500',need:500,pts:120,p:(q, u) => u.power || 0},
];

// Lưu trữ: nếu có SUPABASE_URL và SUPABASE_KEY thì lưu trên Supabase (không mất khi Render khởi động lại),
// nếu không thì lưu vào file data.json cục bộ.
const SB_URL = process.env.SUPABASE_URL || '';
const SB_KEY = process.env.SUPABASE_KEY || '';
const USE_SB = !!(SB_URL && SB_KEY);
const sbHeaders = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };

let db = { users: {}, sessions: {} };

async function loadDb() {
  if (USE_SB) {
    const r = await fetch(SB_URL + '/rest/v1/app_state?id=eq.1&select=data', { headers: sbHeaders });
    if (!r.ok) throw new Error('Không đọc được Supabase: HTTP ' + r.status);
    const rows = await r.json();
    if (rows.length && rows[0].data) db = rows[0].data;
    console.log('Đã tải dữ liệu từ Supabase');
    return;
  }
  try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) {}
}

// Ghi nối tiếp để các lần ghi không chèn lên nhau
let saveChain = Promise.resolve();
function save() {
  if (USE_SB) {
    const body = JSON.stringify([{ id: 1, data: db }]);
    saveChain = saveChain
      .then(() => fetch(SB_URL + '/rest/v1/app_state?on_conflict=id', {
        method: 'POST',
        headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates' },
        body,
      }))
      .then(r => { if (!r.ok) console.error('Lỗi lưu Supabase: HTTP ' + r.status); })
      .catch(e => console.error('Lỗi lưu Supabase: ' + e.message));
    return;
  }
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
  return { sqfight: 0, sqwin: 0, played: 0, kills: 0, casts: 0, wins: 0, win400: 0, hwin: 0, weps: [], reads: [] };
}
function freshAll() {
  return { sqfight: 0, sqwin: 0, played: 0, kills: 0, casts: 0, wins: 0, win400: 0, hwin: 0, reads: [], weps: [] };
}
// Lấy dữ liệu nhiệm vụ của tài khoản, làm mới phần hằng ngày nếu sang ngày mới
function ensureQ(u) {
  if (!u.q) u.q = { day: '', d: freshD(), all: freshAll(), dc: {}, claimed: {}, lastPlay: 0 };
  const k = vnDay();
  if (u.q.day !== k) { u.q.day = k; u.q.d = freshD(); u.q.dc = {}; }
  u.q.d = Object.assign({ sqfight: 0, sqwin: 0 }, u.q.d);
  u.q.all = Object.assign({ sqfight: 0, sqwin: 0 }, u.q.all);
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
    user: u.name, pts: u.pts, spent: u.spent, unlocked: u.admin ? Object.keys(LOCK_CFG) : u.unlocked, admin: u.admin, squad: u.squad || null, power: u.power || 0, earned: u.earned || 0, gold: u.gold || 0, gachaPity: (u.gacha && u.gacha.pity) || 0, boxes: u.boxes || 0,
    quests: { day: q.day, d: q.d, all: q.all, dc: q.dc, claimed: q.claimed },
  };
}

const SESSION_DAYS = 30;
const MAX_FAILS = 5;
const LOCK_MINUTES = 1;

// Phiên đăng nhập có hạn sử dụng; phiên cũ (không có hạn) bị xóa, người chơi đăng nhập lại
// Đấu đội hình: quản lý lượt đấu theo ngày
function fightOf(u) {
  const k = vnDay();
  if (!u.fight || u.fight.day !== k) u.fight = { day: k, count: 0, last: 0, opp: {} };
  return u.fight;
}

function auth(req) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  const s = db.sessions[t];
  if (!s || typeof s !== 'object') { if (s) { delete db.sessions[t]; save(); } return null; }
  if (s.exp < Date.now() || !db.users[s.ln]) { delete db.sessions[t]; save(); return null; }
  return { token: t, u: db.users[s.ln] };
}

function newSession(u) {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[token] = { ln: u.name.toLowerCase(), exp: Date.now() + SESSION_DAYS * 86400000 };
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

// Quay n lượt.
// Song Đao Tử Thần 0,8%, Onglibus 0,8%, Toái Thủy Vũ Trượng 0,8%. Vũ khí nào đã trúng thì KHÔNG trúng lại nữa.
// Khi đã có đủ cả 3 vũ khí: 1% mỗi lượt trúng 100 vàng (thay cho vũ khí). Còn lại là 1-2 vàng.
// Bảo hiểm chung 1 bộ đếm: 85 lượt liên tiếp không ra cây nào thì lượt 85 chắc chắn ra 1 vũ khí chưa có
// (chọn đều ngẫu nhiên trong số vũ khí còn thiếu). Trúng bất kỳ cây nào thì đếm lại từ đầu.
const SD = 'Song Đao Tử Thần', ONG = 'Onglibus', TOAI = 'Toái Thủy Vũ Trượng';
const GACHA_WEPS = [{ n: SD, p: 0.008 }, { n: ONG, p: 0.008 }, { n: TOAI, p: 0.008 }];
function rollPulls(u, n) {
  const g = u.gacha || (u.gacha = { pity: 0, next: null });
  g.next = null;
  u.unlocked = u.unlocked || [];
  const owns = w => u.unlocked.includes(w);
  const missing = () => GACHA_WEPS.map(x => x.n).filter(w => !owns(w));
  const results = [];
  for (let i = 0; i < n; i++) {
    g.pity++;
    let hit = null, forced = false;
    const miss = missing();
    if (g.pity >= 85 && miss.length > 0) {
      forced = true;
      hit = miss[Math.floor(Math.random() * miss.length)];
    }
    else {
      const r = Math.random();
      let t = 0;
      for (const w of GACHA_WEPS) {
        if (owns(w.n)) continue;
        t += w.p;
        if (r < t) { hit = w.n; break; }
      }
      if (!hit && miss.length === 0 && r < 0.01) {
        u.gold = (u.gold || 0) + 100;
        results.push({ kt: false, v: 100, bonus: true });
        continue;
      }
    }
    if (hit) {
      g.pity = 0;
      u.unlocked.push(hit);
      results.push({ kt: true, name: hit, forced, dup: false, bonus: 0 });
    } else {
      const v = Math.random() < 0.6 ? 1 : 2;
      u.gold = (u.gold || 0) + v;
      results.push({ kt: false, v });
    }
  }
  return results;
}

const routes = {
  '/api/box': async (req, res, b) => {
    const a = auth(req);
    if (!a) return fail(res, 401, 'Phiên đăng nhập đã hết hạn');
    const n = Number(b.n) === 10 ? 10 : 1;
    const cost = 10 * n;
    if (a.u.pts - a.u.spent < cost) return fail(res, 400, 'Không đủ điểm (cần ' + cost + ' điểm)');
    a.u.spent += cost;
    a.u.boxes = (a.u.boxes || 0) + n;
    save();
    send(res, 200, view(a.u));
  },
  '/api/squad': async (req, res, b) => {
    const a = auth(req);
    if (!a) return fail(res, 401, 'Phiên đăng nhập đã hết hạn');
    const sq = Array.isArray(b.squad) ? b.squad : [];
    if (sq.length !== 3) return fail(res, 400, 'Đội phải có đúng 3 bóng');
    const clean = sq.map(x => ({ w: String(x.w || '').slice(0, 40), hp: Math.floor(Number(x.hp)) }));
    if (clean.some(x => !x.w || !(x.hp >= 20 && x.hp <= 1500))) return fail(res, 400, 'Dữ liệu đội không hợp lệ');
    a.u.squad = clean;
    save();
    send(res, 200, view(a.u));
  },

  '/api/gacha': async (req, res, b) => {
    const a = auth(req);
    if (!a) return fail(res, 401, 'Phiên đăng nhập đã hết hạn');
    const n = Number(b.n) === 10 ? 10 : 1;
    if ((a.u.boxes || 0) < n) return fail(res, 400, 'Không đủ cục random (đang có ' + (a.u.boxes || 0) + ')');
    a.u.boxes -= n;
    const results = rollPulls(a.u, n);
    save();
    send(res, 200, { ...view(a.u), results });
  },

  '/api/match': async (req, res) => {
    const a = auth(req);
    if (!a) return fail(res, 401, 'Phiên đăng nhập đã hết hạn');
    const arr = Object.values(db.users).filter(u => u !== a.u && u.squad && u.squad.length === 3);
    if (!arr.length) return fail(res, 404, 'Chưa có đối thủ. Hãy lưu đội của bạn, hoặc chờ người khác lưu đội.');
    const u = arr[Math.floor(Math.random() * arr.length)];
    send(res, 200, { opp: { user: u.name, squad: u.squad } });
  },

  '/api/rank': async (req, res) => {
    const a = auth(req);
    if (!a) return fail(res, 401, 'Phiên đăng nhập đã hết hạn');
    const all = Object.values(db.users);
    const top = key => all.slice().sort((x, y) => (y[key] || 0) - (x[key] || 0)).slice(0, 20)
      .map(u => ({ user: u.name, power: u.power || 0, earned: u.earned || 0 }));
    const rankOf = key => all.filter(u => (u[key] || 0) > (a.u[key] || 0)).length + 1;
    send(res, 200, {
      power: top('power'),
      earned: top('earned'),
      me: { power: a.u.power || 0, earned: a.u.earned || 0, powerRank: rankOf('power'), earnedRank: rankOf('earned') },
    });
  },

  '/api/opponents': async (req, res) => {
    const a = auth(req);
    if (!a) return fail(res, 401, 'Phiên đăng nhập đã hết hạn');
    const arr = Object.values(db.users).filter(u => u !== a.u && u.squad && u.squad.length === 3);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    send(res, 200, { opps: arr.slice(0, 5).map(u => ({ user: u.name, squad: u.squad })) });
  },

  '/api/fight': async (req, res, b) => {
    const a = auth(req);
    if (!a) return fail(res, 401, 'Phiên đăng nhập đã hết hạn');
    const f = fightOf(a.u);
    const now = Date.now();
    if (now - f.last < 60000) return fail(res, 429, 'Chờ ' + Math.ceil((60000 - (now - f.last)) / 1000) + ' giây rồi đấu tiếp');
    if (f.count >= 10) return fail(res, 400, 'Hết lượt đấu hôm nay (tối đa 10 trận)');
    const oppName = String(b.opp || '').trim().toLowerCase();
    const opp = db.users[oppName];
    if (!opp || opp === a.u || !opp.squad) return fail(res, 400, 'Đối thủ không hợp lệ');
    const won = !!b.won;
    f.last = now;
    f.count++;
    let reward = 0, dpow = 0, note = '';
    if (f.opp[oppName]) note = 'Đã thưởng đối thủ này hôm nay';
    else {
      f.opp[oppName] = 1;
      const before = a.u.power || 0;
      if (won) {
        reward = 30;
        a.u.pts += reward;
        a.u.earned = (a.u.earned || 0) + reward;
        a.u.power = before + 100;
        dpow = 100;
      } else {
        a.u.power = Math.max(0, before - 100);
        dpow = a.u.power - before;
      }
    }
    const q = ensureQ(a.u);
    q.d.sqfight++; q.all.sqfight++;
    if (won) { q.d.sqwin++; q.all.sqwin++; }
    save();
    send(res, 200, { ...view(a.u), reward, dpow, won, note });
  },

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
    if (u.lockUntil && u.lockUntil > Date.now()) {
      const mins = Math.ceil((u.lockUntil - Date.now()) / 60000);
      return fail(res, 429, 'Đăng nhập sai quá nhiều lần. Thử lại sau ' + mins + ' phút.');
    }
    const h = Buffer.from(hashPass(String(b.pass || ''), u.salt), 'hex');
    if (!crypto.timingSafeEqual(h, Buffer.from(u.hash, 'hex'))) {
      u.fails = (u.fails || 0) + 1;
      if (u.fails >= MAX_FAILS) { u.lockUntil = Date.now() + LOCK_MINUTES * 60000; u.fails = 0; }
      save();
      return fail(res, 401, 'Sai tên hoặc mật khẩu');
    }
    u.fails = 0; u.lockUntil = 0;
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
      if (!a.u.admin && (Q.p(q, a.u) || 0) < Q.need) return fail(res, 400, 'Chưa hoàn thành nhiệm vụ');
      if (Q.daily) q.dc[Q.id] = 1; else q.claimed[Q.id] = 1;
      a.u.pts += Q.pts; a.u.earned = (a.u.earned || 0) + Q.pts; got++;
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
    if (!price) return fail(res, 400, 'Vũ khí này chỉ nhận từ 🎲 Quay random');
    if (a.u.unlocked.includes(weapon)) return fail(res, 400, 'Vũ khí này đã mở rồi');
    if (a.u.pts - a.u.spent < price) return fail(res, 400, 'Không đủ điểm');
    a.u.spent += price;
    a.u.unlocked.push(weapon);
    save();
    send(res, 200, view(a.u));
  },

  '/api/goldbuy': async (req, res, b) => {
    const a = auth(req);
    if (!a) return fail(res, 401, 'Phiên đăng nhập đã hết hạn');
    const weapon = String(b.weapon || '');
    const price = GOLD_CFG[weapon];
    if (price === undefined) return fail(res, 400, 'Vũ khí này không đổi bằng vàng');
    if (a.u.unlocked.includes(weapon)) return fail(res, 400, 'Vũ khí này đã mở rồi');
    if ((a.u.gold || 0) < price) return fail(res, 400, 'Không đủ vàng (cần ' + price + ' vàng)');
    a.u.gold -= price;
    a.u.unlocked.push(weapon);
    save();
    send(res, 200, view(a.u));
  },

  '/api/redeem': async (req, res, b) => {
    const a = auth(req);
    if (!a) return fail(res, 401, 'Phiên đăng nhập đã hết hạn');
    const key = String(b.code || '').trim().toUpperCase();
    const cfg = CODES[key];
    if (cfg === undefined) return fail(res, 400, 'Mã không hợp lệ');
    if (a.u.codes.includes(key)) return fail(res, 400, 'Tài khoản này đã dùng mã này rồi');
    let reward, rewardText;
    if (typeof cfg === 'number') {
      reward = cfg;
      a.u.pts += cfg; a.u.earned = (a.u.earned || 0) + cfg;
      rewardText = cfg + ' điểm';
    } else if (cfg.boxes !== undefined) {
      a.u.boxes = (a.u.boxes || 0) + cfg.boxes;
      const parts = [cfg.boxes + ' cục random'];
      if (cfg.pts) { a.u.pts += cfg.pts; a.u.earned = (a.u.earned || 0) + cfg.pts; parts.push(cfg.pts + ' điểm'); }
      reward = cfg.pts || 0;
      rewardText = parts.join(' và ');
    } else {
      const pool = Object.keys(LOCK_CFG).filter(w => LOCK_CFG[w] === cfg.price && w !== TOAI && !a.u.unlocked.includes(w));
      if (!pool.length) return fail(res, 400, 'Bạn đã có hết vũ khí giá ' + cfg.price + ' điểm');
      reward = pool[Math.floor(Math.random() * pool.length)];
      a.u.unlocked.push(reward);
      rewardText = 'vũ khí ' + reward;
    }
    a.u.codes.push(key);
    save();
    send(res, 200, { ...view(a.u), reward, rewardText });
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

async function startServer() {
await loadDb();
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
}
startServer().catch(e => { console.error(e.message); process.exit(1); });
