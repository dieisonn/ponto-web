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

export async function addPunch(note = '') {
  await initApp();
  const { serverTimestamp, collection, doc, setDoc } =
    await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user = auth.currentUser;
  if (!user) throw new Error('Não autenticado');
  const period = yyyymm(new Date());
  const ref = doc(collection(db, 'punches', user.uid, period));
  await setDoc(ref, { ts: serverTimestamp(), email: user.email || '', uid: user.uid, note });
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
