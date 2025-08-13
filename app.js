// app.js — Firebase + Firestore (sem geofence) + utilitários

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
    app = appModule.initializeApp(firebaseConfig);
    auth = authModule.getAuth(app);
    db  = fsModule.getFirestore(app);
    return app;
  })();

  return initializingPromise;
}

/* ===== helpers roles ===== */
export async function onUserChanged(cb) {
  await initApp();
  (await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js')).onAuthStateChanged(auth, cb);
}

// Salva/atualiza email/nome e garante role=user se vazio
export async function ensureRoleDoc(uid, email = null, name = null) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const ref = fs.doc(db, 'roles', uid);
  const snap = await fs.getDoc(ref);
  const base = { email: email || auth.currentUser?.email || null, name: name || auth.currentUser?.displayName || null };
  if (!snap.exists()) {
    await fs.setDoc(ref, { role: 'user', ...base }, { merge: true });
  } else {
    await fs.setDoc(ref, base, { merge: true });
  }
}
export async function isAdmin(uid) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const ref = fs.doc(db, 'roles', uid);
  const s = await fs.getDoc(ref);
  return s.exists() && s.data()?.role === 'admin';
}

function yyyymm(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}${m}`;
}

/* ===== batida ===== */
// Escreve a batida usando addDoc (id automático). 'atDate' define o sub-mês (period)
export async function addPunch(note = '', tipo = 'entrada', _geoIgnored, atDate, _siteId, _dist, _place) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user = auth.currentUser;
  if (!user) throw new Error('Não autenticado');

  const when = atDate instanceof Date ? atDate : new Date();
  const period = yyyymm(when);
  const col = fs.collection(db, 'punches', user.uid, period);

  await fs.addDoc(col, {
    ts: fs.serverTimestamp(),                  // carimbo do servidor
    at: fs.Timestamp.fromDate(when),          // horário escolhido
    email: user.email || '',
    uid: user.uid,
    type: tipo,                               // 'entrada' | 'saida'
    note: note || ''
  });
}

/* ===== consultas ===== */
function millisOf(p) {
  if (p?.at?.toMillis) return p.at.toMillis();
  if (p?.ts?.toMillis) return p.ts.toMillis();
  if (p?.ts) return new Date(p.ts).getTime();
  return 0;
}

// Últimos N do usuário (com _path)
export async function listRecentPunchesRaw(limitN = 1) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user = auth.currentUser; if (!user) return [];
  const period = yyyymm(new Date());
  const q = fs.query(fs.collection(db, 'punches', user.uid, period), fs.orderBy('ts', 'desc'), fs.limit(limitN));
  const snap = await fs.getDocs(q);
  return snap.docs.map(d => ({ _id: d.id, _path: d.ref.path, ...d.data() }));
}

// Dia por usuário (com _path) — busca mês do dia e mês anterior
export async function listPunchesByDayForUser(uid, dayISO, withRefs = false) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');

  const d = new Date(dayISO);
  const months = [yyyymm(d), yyyymm(new Date(d.getFullYear(), d.getMonth() - 1, 1))];
  const rows = [];
  for (const mm of months) {
    const q = fs.query(fs.collection(db, 'punches', uid, mm), fs.orderBy('ts', 'asc'), fs.limit(600));
    const s = await fs.getDocs(q);
    s.docs.forEach(doc => {
      const data = doc.data();
      const base = data.at?.toDate?.() || data.ts?.toDate?.() || new Date(data.ts);
      if (base.toISOString().slice(0, 10) === dayISO) {
        rows.push(withRefs ? ({ ...data, _id: doc.id, _path: doc.ref.path }) : ({ ...data, _id: doc.id }));
      }
    });
  }
  rows.sort((a, b) => millisOf(a) - millisOf(b));
  return rows;
}

export function computeDailyMs(punchesAsc) {
  const arr = punchesAsc.slice().sort((a,b) => millisOf(a) - millisOf(b));
  let total = 0, start = null;
  for (const p of arr) {
    const t = millisOf(p);
    if (p.type === 'entrada') start = t;
    if (p.type === 'saida' && start != null) { total += (t - start); start = null; }
  }
  return total;
}
export function msToHHMM(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
}

/* ===== para o Admin ===== */
export async function listPunchesByDayAllUsers(dayISO) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const rolesSnap = await fs.getDocs(fs.collection(db, 'roles'));
  const roles = {};
  rolesSnap.forEach(d => roles[d.id] = d.data());

  const base = new Date(dayISO);
  const months = [yyyymm(base), yyyymm(new Date(base.getFullYear(), base.getMonth() - 1, 1))];
  const rows = [];

  for (const uid of Object.keys(roles)) {
    for (const mm of months) {
      const q = fs.query(fs.collection(db, 'punches', uid, mm), fs.orderBy('ts', 'asc'), fs.limit(600));
      const s = await fs.getDocs(q);
      s.docs.forEach(doc => {
        const data = doc.data();
        const when = data.at?.toDate?.() || data.ts?.toDate?.() || new Date(data.ts);
        if (when.toISOString().slice(0, 10) === dayISO) {
          rows.push({ ...data, uid, email: data.email || roles[uid]?.email || '', name: roles[uid]?.name || '' });
        }
      });
    }
  }
  rows.sort((a,b) => millisOf(a) - millisOf(b));
  return rows;
}

export async function listPunchesByMonthAllUsers(yyyymmStr) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const rolesSnap = await fs.getDocs(fs.collection(db, 'roles'));
  const rows = [];
  for (const r of rolesSnap.docs) {
    const uid = r.id, role = r.data();
    const q = fs.query(fs.collection(db, 'punches', uid, yyyymmStr), fs.orderBy('ts', 'asc'));
    const s = await fs.getDocs(q);
    s.docs.forEach(d => rows.push({ ...d.data(), uid, name: role?.name || '', email: role?.email || '' }));
  }
  return rows;
}

/* ===== Ajustes ===== */
export async function requestAdjustment({ dateISO, timeHHMM, type, reason, action, targetPath }) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user = auth.currentUser; if (!user) throw new Error('Não autenticado');

  let tsWanted = null;
  if (!action || action === 'include') {
    const [hh, mm] = (timeHHMM || '00:00').split(':').map(n => parseInt(n, 10) || 0);
    const dt = new Date(dateISO); dt.setHours(hh, mm, 0, 0);
    tsWanted = fs.Timestamp.fromDate(dt);
  }

  return fs.addDoc(fs.collection(db, 'adjust_requests'), {
    uid: user.uid,
    email: user.email || '',
    type: type || null,
    reason: reason || '',
    action: action || 'include', // include | delete
    targetPath: targetPath || null,
    tsWanted: tsWanted,
    status: 'pending',
    createdAt: fs.Timestamp.now()
  });
}
export async function listPendingAdjustments() {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const q = fs.query(
    fs.collection(db, 'adjust_requests'),
    fs.where('status', '==', 'pending'),
    fs.orderBy('createdAt', 'asc')
  );
  const s = await fs.getDocs(q);
  return s.docs.map(d => ({ id: d.id, ...d.data() }));
}
export async function approveAdjustment(req, adminUid) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');

  if (req.action === 'delete' && req.targetPath) {
    await fs.deleteDoc(fs.doc(db, req.targetPath));
  } else {
    const dt = req.tsWanted?.toDate ? req.tsWanted.toDate() : new Date(req.tsWanted);
    const period = yyyymm(dt);
    const pref = fs.collection(db, 'punches', req.uid, period);
    await fs.addDoc(pref, {
      ts: fs.Timestamp.now(),
      at: req.tsWanted,
      email: req.email || '',
      uid: req.uid,
      type: req.type || 'entrada',
      note: 'Ajuste aprovado (admin)'
    });
  }
  await fs.updateDoc(fs.doc(db, 'adjust_requests', req.id), {
    status: 'approved', resolvedAt: fs.Timestamp.now(), resolvedBy: adminUid
  });
}
export async function rejectAdjustment(reqId, adminUid, reason) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  await fs.updateDoc(fs.doc(db, 'adjust_requests', reqId), {
    status: 'rejected', resolvedAt: fs.Timestamp.now(), resolvedBy: adminUid, adminNote: reason || ''
  });
}
