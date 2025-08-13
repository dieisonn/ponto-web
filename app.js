// app.js — Firebase + Firestore (sem geolocalização) + utilidades

export let app, auth, db;
let initializingPromise = null;

export async function initApp() {
  if (auth && db) return app;
  if (initializingPromise) return initializingPromise;

  const firebaseConfig = {
    apiKey: "AIzaSyDst0JRbIUJMy8F7NnL15czxRYI1J1Pv7U",
    authDomain: "pontoacco.firebaseapp.com",
    projectId: "pontoacco",
    storageBucket: "pontoacco.appspot.com",
    messagingSenderId: "937835585493",
    appId: "1:937835585493:web:c58497ea4baa9a8456675c"
  };

  initializingPromise = (async () => {
    const appModule  = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js');
    const authModule = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
    const fsModule   = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');

    app  = appModule.initializeApp(firebaseConfig);
    auth = authModule.getAuth(app);
    db   = fsModule.getFirestore(app);
    return app;
  })();

  return initializingPromise;
}

/* ===== helpers auth/roles ===== */
export async function onUserChanged(cb) {
  await initApp();
  const m = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
  m.onAuthStateChanged(auth, cb);
}

export async function ensureRoleDoc(uid) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const ref = fs.doc(db, 'roles', uid);
  const s   = await fs.getDoc(ref);
  if (!s.exists()) await fs.setDoc(ref, { role: 'user' }, { merge: true });
}

export async function isAdmin(uid) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const ref = fs.doc(db, 'roles', uid);
  const s   = await fs.getDoc(ref);
  return s.exists() && s.data()?.role === 'admin';
}

export async function getProfile(uid) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const s  = await fs.getDoc(fs.doc(db,'roles',uid));
  return s.exists() ? s.data() : null;
}

function yyyymm(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,'0');
  return `${y}${m}`;
}

/* ===== fila offline (localStorage) ===== */
const QKEY = 'ponto_queue_v1';

function loadQueue() {
  try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch { return []; }
}
function saveQueue(arr) { localStorage.setItem(QKEY, JSON.stringify(arr)); }

export function getQueueSize() { return loadQueue().length; }

/* ===== detecção do próximo tipo ===== */
export async function nextTypeFor(uid) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');

  // pega a última batida do mês atual (ordena por 'at' desc; se faltar, cai pra 'ts')
  const now = new Date();
  const period = yyyymm(now);
  let last = null;

  const col = fs.collection(db,'punches', uid, period);
  const q1  = fs.query(col, fs.orderBy('at','desc'), fs.limit(1));
  const s1  = await fs.getDocs(q1);
  if (!s1.empty) last = s1.docs[0].data();
  else {
    const q2 = fs.query(col, fs.orderBy('ts','desc'), fs.limit(1));
    const s2 = await fs.getDocs(q2);
    if (!s2.empty) last = s2.docs[0].data();
  }

  const lastType = last?.type || 'saida'; // se não existe, começa com 'entrada'
  return lastType === 'entrada' ? 'saida' : 'entrada';
}

/* ===== gravação ===== */
export async function addPunch(note = '', atDate, forceType = null) {
  await initApp();
  const fs   = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user = auth.currentUser;
  if (!user) throw new Error('Não autenticado');

  const at = atDate instanceof Date ? atDate : new Date();
  const type = forceType || await nextTypeFor(user.uid);
  const period = yyyymm(at);
  const dayISO = at.toISOString().slice(0,10);

  const data = {
    ts: fs.Timestamp.now(),
    at: fs.Timestamp.fromDate(at),
    day: dayISO,                  // facilita consultas sem índice composto
    email: user.email || '',
    uid: user.uid,
    type,
    note
  };

  try {
    await fs.addDoc(fs.collection(db,'punches', user.uid, period), data);
    return { ok: true, type };
  } catch (e) {
    // salva na fila local
    const q = loadQueue();
    q.push({ when: Date.now(), data, path: ['punches', user.uid, period] });
    saveQueue(q);
    throw new Error('Sem conexão ou sem permissão. A batida foi colocada na fila para sincronizar mais tarde.');
  }
}

/* ===== sincronização da fila ===== */
export async function flushQueue() {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const arr = loadQueue();
  const keep = [];
  for (let i=0;i<arr.length;i++) {
    const item = arr[i];
    try {
      await fs.addDoc(fs.collection(db, ...item.path), item.data);
    } catch {
      keep.push(item); // ainda não deu
    }
  }
  saveQueue(keep);
  return { synced: arr.length - keep.length, pending: keep.length };
}

/* ===== consultas (sem índices compostos) ===== */

// lista do dia do usuário (filtra por 'day' e ordena no cliente)
export async function listPunchesByDayForUser(uid, dayISO) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const d = new Date(dayISO);
  const period = yyyymm(d);

  const col = fs.collection(db,'punches', uid, period);
  const q   = fs.query(col, fs.where('day','==', dayISO), fs.limit(500)); // sem orderBy -> sem índice composto
  const s   = await fs.getDocs(q);
  const rows = s.docs.map(doc => ({ _id: doc.id, ...doc.data() }));

  rows.sort((a,b) => {
    const ta = a.at?.toMillis ? a.at.toMillis() : (a.ts?.toMillis ? a.ts.toMillis() : 0);
    const tb = b.at?.toMillis ? b.at.toMillis() : (b.ts?.toMillis ? b.ts.toMillis() : 0);
    return ta - tb;
  });
  return rows;
}

// última batida do mês (para exibir no "Último registro")
export async function listRecentPunchesRaw(limitN = 1) {
  await initApp();
  const fs   = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user = auth.currentUser; if (!user) return [];
  const period = yyyymm(new Date());
  const col = fs.collection(db,'punches', user.uid, period);
  const q   = fs.query(col, fs.orderBy('at','desc'), fs.limit(limitN));
  const s   = await fs.getDocs(q);
  return s.docs.map(d => ({ _id:d.id, ...d.data() }));
}

export function computeDailyMs(recordsAsc) {
  let total = 0, start = null;
  for (const p of recordsAsc) {
    const t = p.at?.toMillis ? p.at.toMillis() : (p.ts?.toMillis ? p.ts.toMillis() : 0);
    if (p.type === 'entrada') start = t;
    if (p.type === 'saida' && start != null) { total += (t - start); start = null; }
  }
  return total;
}
export function msToHHMM(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

/* ===== relatórios do admin (mantidos) ===== */

export async function listPunchesByDayAllUsers(dayISO) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const rolesSnap = await fs.getDocs(fs.collection(db,'roles'));
  const roles = rolesSnap.docs.map(d => ({ uid:d.id, ...d.data() }));

  const out = [];
  for (const u of roles) {
    const rows = await listPunchesByDayForUser(u.uid, dayISO);
    for (const r of rows) out.push({ ...r, uid:u.uid, name:u.name||'', email:u.email||r.email||'' });
  }
  out.sort((a,b) => {
    const ta = a.at?.toMillis ? a.at.toMillis() : 0;
    const tb = b.at?.toMillis ? b.at.toMillis() : 0;
    return ta - tb;
  });
  return out;
}

export async function listPunchesByMonthAllUsers(yyyymmStr) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const rolesSnap = await fs.getDocs(fs.collection(db,'roles'));
  const out = [];
  for (const r of rolesSnap.docs) {
    const uid = r.id, role = r.data();
    const s = await fs.getDocs(fs.query(fs.collection(db,'punches', uid, yyyymmStr), fs.orderBy('at','asc')));
    s.docs.forEach(d => out.push({ uid, name:role?.name||'', email:role?.email||'', ...d.data() }));
  }
  return out;
}

/* ===== ajustes ===== */
export async function requestAdjustment({ dateISO, timeHHMM, type, reason, action, targetPath }) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user = auth.currentUser; if (!user) throw new Error('Não autenticado');

  let tsWanted = null;
  if (!action || action === 'include') {
    const [hh, mm] = (timeHHMM||'00:00').split(':').map(x=>parseInt(x||'0',10));
    const dt = new Date(dateISO); dt.setHours(hh, mm, 0, 0);
    tsWanted = fs.Timestamp.fromDate(dt);
  }
  return fs.addDoc(fs.collection(db,'adjust_requests'),{
    uid: user.uid,
    email: user.email || '',
    type: type || null,
    reason: reason || '',
    action: action || 'include',
    targetPath: targetPath || null,
    tsWanted,
    status: 'pending',
    createdAt: fs.Timestamp.now()
  });
}

export async function listPendingAdjustments() {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const q = fs.query(fs.collection(db,'adjust_requests'), fs.where('status','==','pending'), fs.orderBy('createdAt','asc'));
  const s = await fs.getDocs(q);
  return s.docs.map(d => ({ id:d.id, ...d.data() }));
}

export async function approveAdjustment(req, adminUid) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');

  if (req.action === 'delete' && req.targetPath) {
    await fs.deleteDoc(fs.doc(db, req.targetPath));
  } else {
    const dt = req.tsWanted?.toDate ? req.tsWanted.toDate() : new Date(req.tsWanted);
    const period = yyyymm(dt);
    await fs.addDoc(fs.collection(db,'punches', req.uid, period),{
      ts: fs.Timestamp.now(),
      at: req.tsWanted,
      day: dt.toISOString().slice(0,10),
      email: req.email || '',
      uid: req.uid,
      type: req.type || 'entrada',
      note: 'Ajuste aprovado (admin)'
    });
  }
  await fs.updateDoc(fs.doc(db,'adjust_requests', req.id), {
    status:'approved', resolvedAt: fs.Timestamp.now(), resolvedBy: adminUid
  });
}

export async function rejectAdjustment(reqId, adminUid, reason) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  await fs.updateDoc(fs.doc(db,'adjust_requests', reqId), {
    status:'rejected', resolvedAt: fs.Timestamp.now(), resolvedBy: adminUid, adminNote: reason || ''
  });
}
