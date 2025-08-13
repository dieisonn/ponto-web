// app.js — Firebase + Ponto (sem geolocalização) + consultas dia/mês + ajustes

export let app, auth, db;
let boot;

export async function initApp(){
  if (boot) return boot;
  const cfg = {
    apiKey: "AIzaSyDst0JRbIUJMy8F7NnL15czxRYI1J1Pv7U",
    authDomain: "pontoacco.firebaseapp.com",
    projectId: "pontoacco",
    storageBucket: "pontoacco.appspot.com",
    messagingSenderId: "937835585493",
    appId: "1:937835585493:web:c58497ea4baa9a8456675c"
  };
  boot = (async ()=>{
    const appModule = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js');
    const authModule = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
    const fsModule   = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
    app = appModule.initializeApp(cfg);
    auth = authModule.getAuth(app);
    db   = fsModule.getFirestore(app);
    return app;
  })();
  return boot;
}

/* ===== helpers ===== */
export async function onUserChanged(cb){
  await initApp();
  (await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js')).onAuthStateChanged(auth, cb);
}

export async function ensureRoleDoc(uid, displayName, email){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const ref = fs.doc(db,'roles',uid);
  const s = await fs.getDoc(ref);
  if (!s.exists()) {
    await fs.setDoc(ref, { role:'user', name: displayName || '', email: email || '' }, { merge:true });
  } else {
    // só atualiza nome/email; regra garante que role não muda pelo user
    await fs.updateDoc(ref, { name: displayName || '', email: email || '' });
  }
}

export async function isAdmin(uid){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const s = await fs.getDoc(fs.doc(db,'roles',uid));
  return s.exists() && s.data()?.role === 'admin';
}

function yyyymm(d){
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,'0');
  return `${y}${m}`;
}
function dayISOfromDate(d){
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,'0');
  const dd=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}

/* ===== Tipo seguinte (Entrada|Saída) garantido ===== */
export async function getNextTypeFor(uid, dayISO){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');

  const d = new Date(dayISO);
  const period = yyyymm(d);

  // busca último do dia em ordem decrescente por 'at'
  const q = fs.query(
    fs.collection(db, 'punches', uid, period),
    fs.where('day','==', dayISO),
    fs.orderBy('at','desc'),
    fs.limit(1)
  );
  const snap = await fs.getDocs(q);
  if (snap.empty) return 'entrada';
  const last = snap.docs[0].data();
  return last.type === 'entrada' ? 'saida' : 'entrada';
}

/* ===== Criar ponto: força alternância ===== */
export async function addPunchAuto({ at, note='' }){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user = auth.currentUser;
  if (!user) throw new Error('Não autenticado');

  const atDate = at instanceof Date ? new Date(at) : new Date();
  const dayISO = dayISOfromDate(atDate);
  const period = yyyymm(atDate);
  const nextType = await getNextTypeFor(user.uid, dayISO); // garante alternância

  const ref = fs.doc(fs.collection(db, 'punches', user.uid, period));
  await fs.setDoc(ref, {
    ts: fs.Timestamp.now(),                  // servidor
    at: fs.Timestamp.fromDate(atDate),       // carimbo escolhido (cliente)
    day: dayISO,                             // facilita consultas do dia
    email: user.email || '',
    uid: user.uid,
    type: nextType,                          // ENFORCEMENT: sempre alternado
    note: note || ''
  });
}

/* ===== Consultas ===== */
export async function listPunchesByDayForUser(uid, dayISO){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const d = new Date(dayISO);
  const period = yyyymm(d);

  const q = fs.query(
    fs.collection(db,'punches',uid,period),
    fs.where('day','==', dayISO),
    fs.orderBy('at','asc')
  );
  const s = await fs.getDocs(q);
  return s.docs.map(doc => ({ _id:doc.id, _path:doc.ref.path, ...doc.data() }));
}

export function computeDailyMs(punchesAsc){
  const arr = punchesAsc.slice().sort((a,b)=>{
    const ta = a.at?.toMillis ? a.at.toMillis() : new Date(a.at || a.ts).getTime();
    const tb = b.at?.toMillis ? b.at.toMillis() : new Date(b.at || b.ts).getTime();
    return ta - tb;
  });
  let total=0, start=null;
  for (const p of arr){
    const t = p.at?.toMillis ? p.at.toMillis() : new Date(p.at || p.ts).getTime();
    if (p.type==='entrada') start=t;
    else if (p.type==='saida' && start!=null){ total += (t-start); start=null; }
  }
  return total;
}
export function msToHHMM(ms){
  const h = Math.floor(ms/3600000);
  const m = Math.floor((ms%3600000)/60000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

export async function listPunchesByDayAllUsers(dayISO){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');

  // pega todos usuários de roles
  const rolesSnap = await fs.getDocs(fs.collection(db,'roles'));
  const list = [];
  const period = yyyymm(new Date(dayISO));

  for (const r of rolesSnap.docs){
    const uid = r.id;
    const profile = r.data() || {};
    const q = fs.query(
      fs.collection(db,'punches',uid,period),
      fs.where('day','==',dayISO),
      fs.orderBy('at','asc')
    );
    const s = await fs.getDocs(q);
    s.forEach(d=>{
      const data = d.data();
      list.push({
        ...data,
        uid,
        email: data.email || profile.email || '',
        name: profile.name || ''
      });
    });
  }
  // já vem asc; se precisar:
  list.sort((a,b)=>{
    const ta = a.at?.toMillis ? a.at.toMillis() : new Date(a.at||a.ts).getTime();
    const tb = b.at?.toMillis ? b.at.toMillis() : new Date(b.at||b.ts).getTime();
    return ta - tb;
  });
  return list;
}

/* ===== Ajustes ===== */
export async function requestAdjustment({ dateISO, timeHHMM, type, reason, action, targetPath }){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user = auth.currentUser; if (!user) throw new Error('Não autenticado');

  let tsWanted = null;
  if (!action || action==='include'){
    const [hh,mm] = (timeHHMM||'00:00').split(':').map(x=>parseInt(x||'0',10));
    const d = new Date(dateISO); d.setHours(hh,mm,0,0);
    tsWanted = fs.Timestamp.fromDate(d);
  }

  await fs.addDoc(fs.collection(db,'adjust_requests'), {
    uid: user.uid, email: user.email||'',
    type: type || null,
    reason: reason || '',
    action: action || 'include',
    targetPath: targetPath || null,
    tsWanted: tsWanted,
    status: 'pending',
    createdAt: fs.Timestamp.now()
  });
}

export async function listPendingAdjustments(){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const q = fs.query(fs.collection(db,'adjust_requests'),
                     fs.where('status','==','pending'),
                     fs.orderBy('createdAt','asc'));
  const s = await fs.getDocs(q);
  return s.docs.map(d=>({ id:d.id, ...d.data() }));
}

export async function approveAdjustment(req, adminUid){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');

  if (req.action==='delete' && req.targetPath){
    await fs.deleteDoc(fs.doc(db, req.targetPath));
  } else {
    const d = req.tsWanted?.toDate ? req.tsWanted.toDate() : new Date(req.tsWanted);
    const period = yyyymm(d);
    await fs.setDoc(fs.doc(fs.collection(db,'punches', req.uid, period)), {
      ts: fs.Timestamp.now(),
      at: req.tsWanted,
      day: dayISOfromDate(d),
      email: req.email || '',
      uid: req.uid,
      type: req.type || 'entrada',
      note: 'Ajuste aprovado (admin)'
    });
  }

  await fs.updateDoc(fs.doc(db,'adjust_requests',req.id), {
    status:'approved', resolvedAt: fs.Timestamp.now(), resolvedBy: adminUid
  });
}

export async function rejectAdjustment(reqId, adminUid, reason){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  await fs.updateDoc(fs.doc(db,'adjust_requests',reqId),{
    status:'rejected', resolvedAt: fs.Timestamp.now(), resolvedBy: adminUid, adminNote: reason||''
  });
}
