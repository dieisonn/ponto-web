// app.js — integra Firebase (Auth + Firestore) e expõe helpers usados pelo site

export let app, auth, db;
let initializingPromise = null;

/* Inicialização do Firebase (chame await initApp() antes de usar auth/db) */
export async function initApp() {
  if (auth && db) return app;
  if (initializingPromise) return initializingPromise;

  // >>>> Use seu config. Abaixo está o que você me passou. <<<<
  const firebaseConfig = {
    apiKey: "AIzaSyDst0JRbIUJMy8F7NnL15czxRYI1J1Pv7U",
    authDomain: "pontoacco.firebaseapp.com",
    projectId: "pontoacco",
    storageBucket: "pontoacco.appspot.com",
    messagingSenderId: "937835585493",
    appId: "1:937835585493:web:c58497ea4baa9a8456675c"
  };

  initializingPromise = (async () => {
    const appModule = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js');
    const authModule = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
    const fsModule   = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
    app  = appModule.initializeApp(firebaseConfig);
    auth = authModule.getAuth(app);
    db   = fsModule.getFirestore(app);
    return app;
  })();

  return initializingPromise;
}

/* Observa mudanças de login (login/logout) */
export async function onUserChanged(cb) {
  await initApp();
  const m = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
  m.onAuthStateChanged(auth, cb);
}

/* Garante que existe um doc em roles/{uid} com role:user (1º login) */
export async function ensureRoleDoc(uid) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const ref = fs.doc(db, 'roles', uid);
  const snap = await fs.getDoc(ref);
  if (!snap.exists()) await fs.setDoc(ref, { role: 'user' }, { merge: true });
}

/* Checa se uid é admin (roles/{uid}.role == 'admin') */
export async function isAdmin(uid) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const ref = fs.doc(db, 'roles', uid);
  const snap = await fs.getDoc(ref);
  return snap.exists() && snap.data() && snap.data().role === 'admin';
}

/* Formata AAAAMM para particionar a coleção por mês */
function yyyymm(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2,'0');
  return y + '' + m;
}

/* ===== CRUD de batidas ===== */

/* Add batida (com tipo, observação e geolocalização opcional) */
export async function addPunch(note = '', tipo = 'entrada', geo = null) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user = auth.currentUser;
  if (!user) throw new Error('Não autenticado');

  const period = yyyymm(new Date());
  const ref = fs.doc(fs.collection(db, 'punches', user.uid, period));

  await fs.setDoc(ref, {
    ts: fs.serverTimestamp(),
    email: user.email || '',
    uid: user.uid,
    note,            // observação (opcional)
    type: tipo,      // 'entrada' | 'saida'
    geo: geo ? {     // geolocalização (opcional)
      lat: geo.latitude, lon: geo.longitude, acc: geo.accuracy
    } : null
  });
}

/* Última batida do mês (para evitar duplicar) */
export async function getLastPunch() {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user = auth.currentUser; if (!user) return null;
  const period = yyyymm(new Date());
  const q = fs.query(fs.collection(db, 'punches', user.uid, period), fs.orderBy('ts','desc'), fs.limit(1));
  const snap = await fs.getDocs(q);
  const d = snap.docs[0];
  return d ? d.data() : null;
}

/* Add batida "esperta": bloqueia 2x seguidas do mesmo tipo (em < 1 min) */
export async function addPunchSmart(tipo, note = '', geo = null) {
  await initApp();
  const last = await getLastPunch();
  if (last && last.type === tipo) {
    const lastMs = last.ts && last.ts.toMillis ? last.ts.toMillis() : new Date(last.ts).getTime();
    if (Date.now() - lastMs < 60000) {
      throw new Error('Último registro já foi "' + tipo + '" há menos de 1 minuto.');
    }
  }
  return addPunch(note, tipo, geo);
}

/* Lista recentes (usamos com limit=1 para mostrar só o último) */
export async function listRecentPunches(limitN = 10) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user = auth.currentUser; if (!user) return [];
  const period = yyyymm(new Date());
  const q = fs.query(fs.collection(db, 'punches', user.uid, period), fs.orderBy('ts','desc'), fs.limit(limitN));
  const snap = await fs.getDocs(q);
  return snap.docs.map(d => d.data());
}

/* ===== Utilidades de relatório/total ===== */

/* Lista batidas de um usuário em um dia (procura no mês e no anterior) */
export async function listPunchesByDayForUser(uid, dayISO) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const d = new Date(dayISO);
  const months = [ yyyymm(d), yyyymm(new Date(d.getFullYear(), d.getMonth()-1, 1)) ];
  const rows = [];
  for (let i=0;i<months.length;i++){
    const period = months[i];
    const col = fs.collection(db, 'punches', uid, period);
    const q = fs.query(col, fs.orderBy('ts','asc'), fs.limit(500));
    const snap = await fs.getDocs(q);
    for (let j=0; j<snap.docs.length; j++) {
      const data = snap.docs[j].data();
      const dt = data.ts && data.ts.toDate ? data.ts.toDate() : new Date(data.ts);
      if (dt.toISOString().slice(0,10) === dayISO)
        rows.push(Object.assign({ _id: snap.docs[j].id }, data));
    }
  }
  return rows;
}

/* Soma pares entrada/saída (ignora batida aberta no final) */
export function computeDailyMs(punchesAsc) {
  const arr = punchesAsc.slice().sort(function(a,b){
    const ta = a.ts && a.ts.toMillis ? a.ts.toMillis() : new Date(a.ts).getTime();
    const tb = b.ts && b.ts.toMillis ? b.ts.toMillis() : new Date(b.ts).getTime();
    return ta - tb;
  });
  let total = 0, start = null;
  for (let i=0;i<arr.length;i++){
    const p = arr[i];
    const t = p.ts && p.ts.toMillis ? p.ts.toMillis() : new Date(p.ts).getTime();
    if (p.type === 'entrada') start = t;
    if (p.type === 'saida' && start != null) { total += (t - start); start = null; }
  }
  return total;
}

/* Formata ms -> HH:MM */
export function msToHHMM(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return (String(h).padStart(2,'0')) + ':' + (String(m).padStart(2,'0'));
}

/* Admin: lista batidas do dia de todos os users (com nome/email) */
export async function listPunchesByDayAllUsers(dayISO) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');

  // pega roles para injetar name/email
  const rolesSnap = await fs.getDocs(fs.collection(db, 'roles'));
  const rolesMap = {};
  rolesSnap.forEach(function(doc){ rolesMap[doc.id] = doc.data(); });

  const now = new Date(dayISO);
  const months = [ yyyymm(now), yyyymm(new Date(now.getFullYear(), now.getMonth()-1, 1)) ];
  const rows = [];

  for (const uid in rolesMap) {
    for (let i=0;i<months.length;i++){
      const period = months[i];
      const q = fs.query(fs.collection(db, 'punches', uid, period), fs.orderBy('ts','desc'), fs.limit(200));
      const snap = await fs.getDocs(q);
      for (let j=0;j<snap.docs.length;j++){
        const data = snap.docs[j].data();
        const dt = data.ts && data.ts.toDate ? data.ts.toDate() : new Date(data.ts);
        if (dt.toISOString().slice(0,10) === dayISO) {
          rows.push(Object.assign({}, data, {
            uid: uid,
            email: data.email || (rolesMap[uid] && rolesMap[uid].email) || '',
            name: (rolesMap[uid] && rolesMap[uid].name) || ''
          }));
        }
      }
    }
  }

  rows.sort(function(a,b){
    const ta = a.ts && a.ts.toMillis ? a.ts.toMillis() : new Date(a.ts).getTime();
    const tb = b.ts && b.ts.toMillis ? b.ts.toMillis() : new Date(b.ts).getTime();
    return ta - tb;
  });
  return rows;
}

/* Admin: lista batidas do mês de todos os users (para relatório mensal) */
export async function listPunchesByMonthAllUsers(yyyymmStr) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const rolesSnap = await fs.getDocs(fs.collection(db, 'roles'));
  const rows = [];
  for (let i=0;i<rolesSnap.docs.length;i++){
    const r = rolesSnap.docs[i];
    const uid = r.id, role = r.data();
    const q = fs.query(fs.collection(db, 'punches', uid, yyyymmStr), fs.orderBy('ts','asc'));
    const snap = await fs.getDocs(q);
    for (let j=0;j<snap.docs.length;j++){
      const d = snap.docs[j].data();
      rows.push(Object.assign({}, d, { uid: uid, name: role && role.name || '', email: role && role.email || '' }));
    }
  }
  return rows;
}

/* ===== Pedidos de ajuste ===== */

/* Colaborador cria pedido */
export async function requestAdjustment({ dateISO, timeHHMM, type, reason }) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user = auth.currentUser; if (!user) throw new Error('Não autenticado');
  const parts = (timeHHMM || '00:00').split(':');
  const hh = parseInt(parts[0]||'0',10), mm = parseInt(parts[1]||'0',10);
  const dt = new Date(dateISO); dt.setHours(hh,mm,0,0);
  return fs.addDoc(fs.collection(db, 'adjust_requests'), {
    uid: user.uid,
    email: user.email || '',
    type: type,
    reason: reason || '',
    tsWanted: fs.Timestamp.fromDate(dt),
    status: 'pending',
    createdAt: fs.Timestamp.now()
  });
}

/* Admin lista pendentes */
export async function listPendingAdjustments() {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const q = fs.query(fs.collection(db,'adjust_requests'), fs.where('status','==','pending'), fs.orderBy('createdAt','asc'));
  const snap = await fs.getDocs(q);
  return snap.docs.map(function(d){ const v = d.data(); v.id = d.id; return v; });
}

/* Admin aprova: grava ponto e finaliza pedido */
export async function approveAdjustment(req, adminUid) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const dt = req.tsWanted && req.tsWanted.toDate ? req.tsWanted.toDate() : new Date(req.tsWanted);
  const period = yyyymm(dt);
  const pRef = fs.doc(fs.collection(db, 'punches', req.uid, period));
  await fs.setDoc(pRef, {
    ts: req.tsWanted, email: req.email || '', uid: req.uid,
    note: 'Ajuste aprovado', type: req.type
  });
  await fs.updateDoc(fs.doc(db,'adjust_requests', req.id), {
    status: 'approved', resolvedAt: fs.Timestamp.now(), resolvedBy: adminUid
  });
}

/* Admin rejeita pedido */
export async function rejectAdjustment(reqId, adminUid, reason) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  await fs.updateDoc(fs.doc(db,'adjust_requests', reqId), {
    status: 'rejected', resolvedAt: fs.Timestamp.now(), resolvedBy: adminUid, adminNote: reason || ''
  });
}
