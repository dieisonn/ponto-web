// app.js — Firebase + Firestore + helpers
export let app, auth, db;

// evita usar antes de inicializar
let initializingPromise = null;

export async function initApp() {
  if (auth && db) return app;           // já iniciado
  if (initializingPromise) return initializingPromise;

  // ⬇️ Use exatamente o firebaseConfig do seu console
  const firebaseConfig = {
    apiKey: "AIzaSyDst0JRbIUJMy8F7NnL15czxRYI1J1Pv7U",
    authDomain: "pontoacco.firebaseapp.com",
    projectId: "pontoacco",
    storageBucket: "pontoacco.appspot.com", // <- corrige aqui
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

export async function onUserChanged(cb) {
  await initApp();
  const { onAuthStateChanged } =
    await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
  onAuthStateChanged(auth, cb);
}

export async function ensureRoleDoc(uid) {
  await initApp();
  const { doc, getDoc, setDoc } =
    await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const ref = doc(db, 'roles', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) await setDoc(ref, { role: 'user' }, { merge: true });
}

export async function isAdmin(uid) {
  await initApp();
  const { doc, getDoc } =
    await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const ref = doc(db, 'roles', uid);
  const snap = await getDoc(ref);
  return snap.exists() && snap.data()?.role === 'admin';
}

function yyyymm(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}${m}`;
}

// Substitua sua função addPunch por esta versão com geolocalização opcional
export async function addPunch(note = '', tipo = 'entrada', geo = null) {
  await initApp();
  const { serverTimestamp, collection, doc, setDoc } =
    await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');

  const user = auth.currentUser;
  if (!user) throw new Error('Não autenticado');

  const period = yyyymm(new Date());
  const ref = doc(collection(db, 'punches', user.uid, period));

  await setDoc(ref, {
    ts: serverTimestamp(),
    email: user.email || '',
    uid: user.uid,
    note,
    type: tipo, // 'entrada' | 'saida'
    geo: geo ? {               // <- vai gravar só se você enviar coords
      lat: geo.latitude,
      lon: geo.longitude,
      acc: geo.accuracy
    } : null
  });
}

export async function listRecentPunches(limitN = 10) {
  await initApp();
  const { collection, query, orderBy, limit, getDocs } =
    await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user = auth.currentUser;
  if (!user) return [];
  const period = yyyymm(new Date());
  const col = collection(db, 'punches', user.uid, period);
  const q = query(col, orderBy('ts', 'desc'), limit(limitN));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data());
}

export async function listPunchesByDayAllUsers(dayISO) {
  await initApp();
  const { collection, getDocs, query, orderBy, limit } =
    await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');

  // pega todos os roles (admin + users)
  const { getDocs: g2, collection: c2 } =
    await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const rolesSnap = await g2(c2(db, 'roles'));
  const rolesMap = {};
  rolesSnap.forEach(doc => { rolesMap[doc.id] = doc.data(); });

  const months = [yyyymm(new Date()), yyyymm(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1))];
  const rows = [];

  for (const uid of Object.keys(rolesMap)) {
    for (const period of months) {
      const userCol = c2(db, 'punches', uid, period);
      const q = query(userCol, orderBy('ts', 'desc'), limit(200));
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        const data = d.data();
        const dt = data.ts?.toDate ? data.ts.toDate() : new Date(data.ts);
        if (dt.toISOString().slice(0,10) === dayISO) {
          rows.push({
            ...data,
            email: data.email || rolesMap[uid]?.email || '',
            name: rolesMap[uid]?.name || ''
          });
        }
      }
    }
  }

  rows.sort((a,b) => {
    const ta = a.ts?.toMillis ? a.ts.toMillis() : (new Date(a.ts)).getTime();
    const tb = b.ts?.toMillis ? b.ts.toMillis() : (new Date(b.ts)).getTime();
    return ta - tb;
  });
  return rows;
}
export async function getLastPunch() {
  await initApp();
  const { collection, query, orderBy, limit, getDocs } =
    await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user = auth.currentUser;
  if (!user) return null;
  const period = yyyymm(new Date());
  const col = collection(db, 'punches', user.uid, period);
  const q = query(col, orderBy('ts', 'desc'), limit(1));
  const snap = await getDocs(q);
  return snap.docs[0]?.data() || null;
}

export async function addPunchSmart(tipo, note = '') {
  await initApp();
  // evita duplicar (ex.: clicar 2x “Entrada”)
  const last = await getLastPunch();
  if (last && last.type === tipo) {
    // se o último for igual e tiver menos de 60s, bloqueia
    const lastMs = last.ts?.toMillis ? last.ts.toMillis() : (new Date(last.ts)).getTime();
    if (Date.now() - lastMs < 60_000) {
      throw new Error('Último registro já foi "' + tipo + '" há menos de 1 minuto.');
    }
  }
  // grava usando a função existente
  return addPunch(note, tipo);
}
export async function listPunchesByDayForUser(uid, dayISO) {
  await initApp();
  const { collection, getDocs, query, orderBy, limit } =
    await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const months = [ yyyymm(new Date(dayISO)), yyyymm(new Date(new Date(dayISO).getFullYear(), new Date(dayISO).getMonth()-1, 1)) ];
  const rows = [];
  for (const period of months) {
    const col = collection(db, 'punches', uid, period);
    const q = query(col, orderBy('ts','asc'), limit(500));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      const data = d.data();
      const dt = data.ts?.toDate ? data.ts.toDate() : new Date(data.ts);
      if (dt.toISOString().slice(0,10) === dayISO) rows.push({ ...data, _id: d.id });
    }
  }
  return rows;
}

// soma pares entrada/saída; se ficar ímpar, ignora último (aberto)
export function computeDailyMs(punchesAsc) {
  const arr = punchesAsc
    .slice()
    .sort((a,b) => (a.ts?.toMillis?.() || new Date(a.ts).getTime()) - (b.ts?.toMillis?.() || new Date(b.ts).getTime()));
  let total = 0, start = null;
  for (const p of arr) {
    const t = p.ts?.toMillis ? p.ts.toMillis() : new Date(p.ts).getTime();
    if (p.type === 'entrada') start = t;
    if (p.type === 'saida' && start != null) { total += (t - start); start = null; }
  }
  return total; // em ms
}

export function msToHHMM(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
}

// mês: retorna todos os registros do usuário (ou de todos) para um AAAAMM
export async function listPunchesByMonthAllUsers(yyyymmStr) {
  await initApp();
  const { getDocs, collection, orderBy, query } =
    await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const rolesSnap = await getDocs(collection(db, 'roles'));
  const rows = [];
  for (const r of rolesSnap.docs) {
    const uid = r.id, role = r.data();
    const col = collection(db, 'punches', uid, yyyymmStr);
    const q = query(col, orderBy('ts','asc'));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      rows.push({ ...d.data(), uid, name: role?.name || '', email: role?.email || '' });
    }
  }
  return rows;
}
// colaborador cria pedido (adicionar/corrigir um ponto)
export async function requestAdjustment({ dateISO, timeHHMM, type, reason }) {
  await initApp();
  const { addDoc, collection, Timestamp } =
    await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user = auth.currentUser; if (!user) throw new Error('Não autenticado');
  const [hh,mm] = timeHHMM.split(':').map(Number);
  const dt = new Date(dateISO); dt.setHours(hh,mm,0,0);
  return addDoc(collection(db, 'adjust_requests'), {
    uid: user.uid,
    email: user.email || '',
    type,        // 'entrada' | 'saida'
    reason,      // texto do usuário
    tsWanted: Timestamp.fromDate(dt),
    status: 'pending',
    createdAt: Timestamp.now()
  });
}

// admin lista pendentes
export async function listPendingAdjustments() {
  await initApp();
  const { collection, getDocs, query, where, orderBy } =
    await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const q = query(collection(db,'adjust_requests'), where('status','==','pending'), orderBy('createdAt','asc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// admin aprova: grava o ponto e marca request como aprovado
export async function approveAdjustment(req, adminUid) {
  await initApp();
  const { doc, updateDoc, collection, setDoc } =
    await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');

  // grava o ponto no mês correto do colaborador
  const dt = req.tsWanted?.toDate ? req.tsWanted.toDate() : new Date(req.tsWanted);
  const period = yyyymm(dt);
  const { doc: d2 } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const punchRef = d2(collection(db,'punches', req.uid, period));
  await setDoc(punchRef, {
    ts: req.tsWanted, email: req.email || '', uid: req.uid, note: 'Ajuste aprovado', type: req.type
  });

  // fecha o pedido
  await updateDoc(doc(db,'adjust_requests', req.id), {
    status: 'approved', resolvedAt: (await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js')).Timestamp.now(), resolvedBy: adminUid
  });
}

// admin rejeita
export async function rejectAdjustment(reqId, adminUid, reason='') {
  await initApp();
  const { doc, updateDoc, Timestamp } =
    await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  await updateDoc(doc(db,'adjust_requests', reqId), {
    status: 'rejected', resolvedAt: Timestamp.now(), resolvedBy: adminUid, adminNote: reason
  });
}
