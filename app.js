// app.js — Firebase + Firestore (sem geolocalização) + Fila offline + Relatórios

export let app, auth, db;
let initializingPromise = null;

/* =========================
 *  Bootstrap Firebase
 * ========================= */
export async function initApp(){
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

  initializingPromise = (async()=>{
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

/* =========================
 *  Auth helpers / Roles
 * ========================= */
export async function onUserChanged(cb){
  await initApp();
  const { onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
  onAuthStateChanged(auth, cb);
}

export async function ensureRoleDoc(uid){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const ref = fs.doc(db,'roles',uid);
  const snap = await fs.getDoc(ref);

  const user = auth.currentUser || {};
  const base = {
    email: user.email || null,
    name:  user.displayName || null
  };

  if (!snap.exists()) {
    await fs.setDoc(ref, { role: 'user', ...base }, { merge: true });
  } else {
    const d = snap.data() || {};
    if (!d.email || !d.name) {
      await fs.setDoc(ref, { ...base }, { merge: true });
    }
  }
}

export async function isAdmin(uid){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const ref = fs.doc(db,'roles',uid);
  const s   = await fs.getDoc(ref);
  return s.exists() && s.data() && s.data().role === 'admin';
}

function yyyymm(d){
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,'0');
  return y+''+m;
}

/* =========================
 *  Fila offline (sem geo)
 * ========================= */
const QKEY = 'ponto_queue';

function sanitizeQueueItem(it) {
  if (!it) return { note: '', type: 'entrada', atISO: new Date().toISOString() };
  const cleaned = {
    note: (it.note ?? ''),
    type: (it.type ?? 'entrada').toLowerCase(),
    atISO: (it.atISO ?? new Date().toISOString())
  };
  if (cleaned.type !== 'entrada' && cleaned.type !== 'saida') cleaned.type = 'entrada';
  return cleaned;
}

export function getQueue(){
  try {
    const raw = JSON.parse(localStorage.getItem(QKEY) || '[]');
    return Array.isArray(raw) ? raw.map(sanitizeQueueItem) : [];
  } catch {
    return [];
  }
}

export function clearQueue(){
  localStorage.removeItem(QKEY);
}

export function enqueuePunch(item){
  const q = getQueue();
  q.push(sanitizeQueueItem(item));
  localStorage.setItem(QKEY, JSON.stringify(q));
}

export async function trySyncQueue(){
  const original = getQueue().map(sanitizeQueueItem);
  const keep = [];
  let done = 0, fail = 0;

  for (const it of original) {
    try {
      const at = it.atISO ? new Date(it.atISO) : new Date();
      await addPunch(it.note || '', it.type || 'entrada', at); // sem geo
      done++;
    } catch (e) {
      console.error('Falha ao sincronizar item da fila:', e);
      keep.push(sanitizeQueueItem(it));
      fail++;
    }
  }
  localStorage.setItem(QKEY, JSON.stringify(keep));
  return { done, fail, left: keep.length };
}

/* =========================
 *  Ponto (sem geolocalização)
 * ========================= */
export async function addPunch(note = '', tipo = 'entrada', atDate = null){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user = auth.currentUser; 
  if (!user) throw new Error('Não autenticado');

  const period = yyyymm(atDate || new Date());
  const col = fs.collection(db,'punches', user.uid, period);
  const ref = fs.doc(col); // ID aleatório

  const payload = {
    ts: fs.Timestamp.now(),                    // auditoria
    at: atDate ? fs.Timestamp.fromDate(atDate) : null,
    email: user.email || '',
    uid: user.uid,
    type: tipo,
    note: note || ''
  };

  Object.keys(payload).forEach(k => { if (payload[k] === undefined) delete payload[k]; });

  await fs.setDoc(ref, payload);
}

/* =========================
 *  Consultas / Relatórios
 * ========================= */
export async function listRecentPunchesRaw(limitN=1){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user = auth.currentUser; if (!user) return [];
  const period = yyyymm(new Date());
  const q = fs.query(
    fs.collection(db,'punches',user.uid,period),
    fs.orderBy('ts','desc'),
    fs.limit(limitN)
  );
  const snap = await fs.getDocs(q);
  return snap.docs.map(d => ({ _id:d.id, _path:d.ref.path, ...d.data() }));
}

export async function listRecentPunches(limitN=10){
  const arr = await listRecentPunchesRaw(limitN);
  return arr.map(x => { const { _id, _path, ...r } = x; return r; });
}

// Batidas do dia (prefere 'at')
export async function listPunchesByDayForUser(uid, dayISO){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const d = new Date(dayISO);
  const months = [ yyyymm(d), yyyymm(new Date(d.getFullYear(), d.getMonth()-1, 1)) ];
  const rows = [];
  for (let i=0;i<months.length;i++){
    const q = fs.query(
      fs.collection(db,'punches',uid,months[i]),
      fs.orderBy('ts','asc'),
      fs.limit(500)
    );
    const snap = await fs.getDocs(q);
    for (let j=0;j<snap.docs.length;j++){
      const data = snap.docs[j].data();
      const base = data.at?.toDate ? data.at.toDate() : (data.ts?.toDate ? data.ts.toDate() : new Date(data.ts));
      if (base.toISOString().slice(0,10) === dayISO) rows.push({ ...data, _id: snap.docs[j].id });
    }
  }
  return rows;
}

export function computeDailyMs(punchesAsc){
  const arr = punchesAsc.slice().sort((a,b)=>{
    const ta = (a.at?.toMillis ? a.at.toMillis() : (a.ts?.toMillis ? a.ts.toMillis() : new Date(a.ts).getTime()));
    const tb = (b.at?.toMillis ? b.at.toMillis() : (b.ts?.toMillis ? b.ts.toMillis() : new Date(b.ts).getTime()));
    return ta - tb;
  });
  let total=0, start=null;
  for (let i=0;i<arr.length;i++){
    const p = arr[i];
    const t = (p.at?.toMillis ? p.at.toMillis() : (p.ts?.toMillis ? p.ts.toMillis() : new Date(p.ts).getTime()));
    if (p.type === 'entrada') start = t;
    if (p.type === 'saida' && start != null) { total += (t - start); start = null; }
  }
  return total;
}

export function msToHHMM(ms){
  const h = Math.floor(ms/3600000);
  const m = Math.floor((ms%3600000)/60000);
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
}

// Todas as batidas do dia (todos os usuários)
export async function listPunchesByDayAllUsers(dayISO){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');

  const rolesSnap = await fs.getDocs(fs.collection(db,'roles'));
  const rolesMap = {};
  rolesSnap.forEach(d => { rolesMap[d.id] = d.data(); });

  const base = new Date(dayISO);
  const months = [ yyyymm(base), yyyymm(new Date(base.getFullYear(), base.getMonth()-1, 1)) ];
  const rows = [];

  for (const uid in rolesMap){
    for (let i=0;i<months.length;i++){
      const q = fs.query(
        fs.collection(db,'punches',uid,months[i]),
        fs.orderBy('ts','desc'),
        fs.limit(200)
      );
      const snap = await fs.getDocs(q);
      for (let j=0;j<snap.docs.length;j++){
        const data = snap.docs[j].data();
        const when = data.at?.toDate ? data.at.toDate() : (data.ts?.toDate ? data.ts.toDate() : new Date(data.ts));
        if (when.toISOString().slice(0,10) === dayISO){
          rows.push({
            ...data,
            uid,
            email: data.email || rolesMap[uid]?.email || '',
            name:  rolesMap[uid]?.name  || ''
          });
        }
      }
    }
  }

  rows.sort((a,b)=>{
    const ta = (a.at?.toMillis ? a.at.toMillis() : (a.ts?.toMillis ? a.ts.toMillis() : new Date(a.ts).getTime()));
    const tb = (b.at?.toMillis ? b.at.toMillis() : (b.ts?.toMillis ? b.ts.toMillis() : new Date(b.ts).getTime()));
    return ta - tb;
  });
  return rows;
}

// Todas as batidas do mês
export async function listPunchesByMonthAllUsers(yyyymmStr){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const rolesSnap = await fs.getDocs(fs.collection(db,'roles'));
  const rows = [];

  for (let i=0;i<rolesSnap.docs.length;i++){
    const r = rolesSnap.docs[i];
    const uid = r.id, role = r.data();
    const q = fs.query(
      fs.collection(db,'punches',uid,yyyymmStr),
      fs.orderBy('ts','asc')
    );
    const s = await fs.getDocs(q);
    for (let j=0;j<s.docs.length;j++){
      const d = s.docs[j].data();
      rows.push({ ...d, uid, name: role?.name || '', email: role?.email || '' });
    }
  }
  return rows;
}

/* =========================
 *  Ajustes (incluir/excluir)
 * ========================= */
export async function requestAdjustment({ dateISO, timeHHMM, type, reason, action, targetPath }){
  await initApp();
  const fs   = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user = auth.currentUser; if(!user) throw new Error('Não autenticado');

  let tsWanted = null;
  if (!action || action === 'include') {
    const parts = (timeHHMM || '00:00').split(':');
    const hh = parseInt(parts[0] || '0', 10);
    const mm = parseInt(parts[1] || '0', 10);
    const dt = new Date(dateISO); dt.setHours(hh,mm,0,0);
    tsWanted = fs.Timestamp.fromDate(dt);
  }

  return fs.addDoc(fs.collection(db,'adjust_requests'),{
    uid: user.uid,
    email: user.email || '',
    type: type || null,
    reason: reason || '',
    action: action || 'include',     // include | delete
    targetPath: targetPath || null,  // caminho punches/... para delete
    tsWanted: tsWanted,
    status: 'pending',
    createdAt: fs.Timestamp.now()
  });
}

export async function listPendingAdjustments(){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const q  = fs.query(
    fs.collection(db,'adjust_requests'),
    fs.where('status','==','pending'),
    fs.orderBy('createdAt','asc')
  );
  const s = await fs.getDocs(q);
  return s.docs.map(d => ({ id:d.id, ...d.data() }));
}

export async function approveAdjustment(req, adminUid){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');

  if (req.action === 'delete' && req.targetPath){
    await fs.deleteDoc(fs.doc(db, req.targetPath));
  } else {
    const dt = req.tsWanted?.toDate ? req.tsWanted.toDate() : new Date(req.tsWanted);
    const period = yyyymm(dt);
    const pref = fs.doc(fs.collection(db,'punches', req.uid, period));
    await fs.setDoc(pref,{
      ts: fs.Timestamp.now(),
      at: req.tsWanted || fs.Timestamp.fromDate(dt),
      email: req.email || '',
      uid: req.uid,
      type: req.type || 'entrada',
      note: 'Ajuste aprovado (admin)'
    });
  }

  await fs.updateDoc(fs.doc(db,'adjust_requests',req.id),{
    status:'approved',
    resolvedAt: fs.Timestamp.now(),
    resolvedBy: adminUid
  });
}

export async function rejectAdjustment(reqId, adminUid, reason){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  await fs.updateDoc(fs.doc(db,'adjust_requests',reqId),{
    status:'rejected',
    resolvedAt: fs.Timestamp.now(),
    resolvedBy: adminUid,
    adminNote: reason || ''
  });
}
