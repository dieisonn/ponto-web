// app.js — Firebase + Banco de Horas + Jornada + Relatórios (sem geolocalização)

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
    const appModule = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js');
    const authModule = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
    const fsModule   = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
    app = appModule.initializeApp(firebaseConfig);
    auth = authModule.getAuth(app);
    db   = fsModule.getFirestore(app);
    return app;
  })();

  return initializingPromise;
}

/* ======= Helpers Firebase ======= */
export async function onUserChanged(cb) {
  await initApp();
  const { onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
  onAuthStateChanged(auth, cb);
}

export async function ensureRoleDoc(uid) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const ref = fs.doc(db, 'roles', uid);
  const snap = await fs.getDoc(ref);
  if (!snap.exists()) await fs.setDoc(ref, { role: 'user' }, { merge: true });
}

export async function isAdmin(uid) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const ref = fs.doc(db, 'roles', uid);
  const s = await fs.getDoc(ref);
  return s.exists() && s.data()?.role === 'admin';
}

export async function getUserProfile(uid) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const d = await fs.getDoc(fs.doc(db, 'roles', uid));
  return d.exists() ? d.data() : {};
}

function yyyymm(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}${m}`;
}

function ymd(d) { return d.toISOString().slice(0,10); }

/* ======= Punches ======= */
export async function addPunch(note = '', atDate = null, forcedType = null) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user = auth.currentUser; if (!user) throw new Error('Não autenticado');

  // Detecta automaticamente o tipo se não vier forçado
  let type = forcedType;
  if (!type) {
    const last = await listRecentPunchesRaw(1);
    const today = new Date().toISOString().slice(0,10);
    const lastIsTodayEntrada = (last[0] && (last[0].at?.toDate?.() || last[0].ts?.toDate?.() || new Date(last[0].ts)))
        && ymd((last[0].at?.toDate?.() || last[0].ts?.toDate?.() || new Date(last[0].ts))) === today
        && last[0].type === 'entrada';
    type = lastIsTodayEntrada ? 'saida' : 'entrada';
  }

  const period = yyyymm(new Date());
  const ref = fs.doc(fs.collection(db, 'punches', user.uid, period));
  await fs.setDoc(ref, {
    ts: fs.Timestamp.now(),
    at: atDate ? fs.Timestamp.fromDate(atDate) : null,
    email: user.email || '',
    uid: user.uid,
    type,
    note: note || ''
  });
}

export async function listRecentPunchesRaw(limitN = 1) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user = auth.currentUser; if (!user) return [];
  const period = yyyymm(new Date());
  const q = fs.query(
    fs.collection(db, 'punches', user.uid, period),
    fs.orderBy('ts', 'desc'),
    fs.limit(limitN)
  );
  const snap = await fs.getDocs(q);
  return snap.docs.map(d => ({ _id: d.id, _path: d.ref.path, ...d.data() }));
}

export async function listPunchesByDayForUser(uid, dayISO) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const d = new Date(dayISO);
  const months = [ yyyymm(d), yyyymm(new Date(d.getFullYear(), d.getMonth() - 1, 1)) ];
  const rows = [];
  for (const p of months) {
    const q = fs.query(
      fs.collection(db, 'punches', uid, p),
      fs.orderBy('ts', 'asc'),
      fs.limit(500)
    );
    const s = await fs.getDocs(q);
    for (const doc of s.docs) {
      const data = doc.data();
      const base = data.at?.toDate?.() || data.ts?.toDate?.() || new Date(data.ts);
      if (ymd(base) === dayISO) rows.push({ ...data, _id: doc.id });
    }
  }
  return rows;
}

export function computeDailyMs(punchesAsc) {
  const arr = punchesAsc.slice().sort((a, b) => {
    const ta = (a.at?.toMillis?.() || a.ts?.toMillis?.() || new Date(a.ts).getTime());
    const tb = (b.at?.toMillis?.() || b.ts?.toMillis?.() || new Date(b.ts).getTime());
    return ta - tb;
  });
  let total = 0, inicio = null;
  for (const p of arr) {
    const t = (p.at?.toMillis?.() || p.ts?.toMillis?.() || new Date(p.ts).getTime());
    if (p.type === 'entrada') inicio = t;
    if (p.type === 'saida' && inicio != null) { total += (t - inicio); inicio = null; }
  }
  return total; // ms trabalhados
}

export function msToHHMM(ms) {
  const sign = ms < 0 ? '-' : '';
  ms = Math.abs(ms);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return sign + String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
}

/* ======= Jornada (schedules) ======= */
export async function getSchedule(uid) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const s = await fs.getDoc(fs.doc(db, 'schedules', uid));
  if (s.exists()) return s.data();

  // DEFAULT: Seg-Sex 08:00-17:00 c/ 60 min; Sáb inativo; Dom inativo.
  const def = { weekly: {} };
  for (let d = 0; d < 7; d++) {
    def.weekly[d] = (d >= 1 && d <= 5)
      ? { active: true, start: '08:00', end: '17:00', breakMin: 60 }
      : { active: false, start: '00:00', end: '00:00', breakMin: 0 };
  }
  return def;
}

export async function saveSchedule(uid, weekly) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  return fs.setDoc(fs.doc(db, 'schedules', uid), { weekly }, { merge: true });
}

function parseHHMM(s) {
  if (!s || !/^\d{2}:\d{2}$/.test(s)) return 0;
  const [hh, mm] = s.split(':').map(Number);
  return hh * 60 + mm;
}

export function requiredMsForDate(schedule, dateObj) {
  const w = schedule?.weekly || {};
  const d = dateObj.getDay(); // 0=Dom
  const row = w[d];
  if (!row || !row.active) return 0;
  const start = parseHHMM(row.start);
  const end   = parseHHMM(row.end);
  const br    = Number(row.breakMin || 0);
  const min = Math.max((end - start - br), 0);
  return min * 60000;
}

/* ======= Feriados ======= */
export async function isHoliday(dayISO) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const s = await fs.getDoc(fs.doc(db, 'holidays', dayISO));
  return s.exists();
}

/* ======= Banco de horas ======= */
function overtimeRateForDate(dateObj, holidayFlag) {
  if (holidayFlag || dateObj.getDay() === 0) return 2.0; // Dom/feriado
  if (dateObj.getDay() === 6) return 1.5;               // Sáb
  return 1.5;                                           // Demais dias (extra após jornada)
}

export async function computeDailyBank(uid, dayISO) {
  const punches = await listPunchesByDayForUser(uid, dayISO);
  const workedMs = computeDailyMs(punches);
  const schedule = await getSchedule(uid);
  const reqMs = requiredMsForDate(schedule, new Date(dayISO));

  const holiday = await isHoliday(dayISO);
  const rate = overtimeRateForDate(new Date(dayISO), holiday);

  const diff = workedMs - reqMs;
  const bankMs = diff <= 0 ? diff : Math.floor(diff * rate);

  return { workedMs, reqMs, bankMs, rate, holiday, punches };
}

export async function computeMonthlyBank(uid, yyyymmStr /* 'YYYYMM' */) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');

  // Carrega punches do mês para o usuário
  const q = fs.query(
    fs.collection(db, 'punches', uid, yyyymmStr),
    fs.orderBy('ts','asc')
  );
  const snap = await fs.getDocs(q);
  const all = snap.docs.map(d => ({ ...d.data(), _id:d.id }));

  // Agrega por dia
  const byDay = {};
  for (const r of all) {
    const dt = r.at?.toDate?.() || r.ts?.toDate?.() || new Date(r.ts);
    const dayISO = ymd(dt);
    (byDay[dayISO] = byDay[dayISO] || []).push(r);
  }

  const schedule = await getSchedule(uid);
  let totalMs = 0;

  for (const dayISO of Object.keys(byDay)) {
    const punches = byDay[dayISO].sort((a,b) => {
      const ta=(a.at?.toMillis?.()||a.ts?.toMillis?.()||new Date(a.ts).getTime());
      const tb=(b.at?.toMillis?.()||b.ts?.toMillis?.()||new Date(b.ts).getTime());
      return ta-tb;
    });
    const workedMs = computeDailyMs(punches);
    const reqMs = requiredMsForDate(schedule, new Date(dayISO));
    const holiday = await isHoliday(dayISO);
    const rate = overtimeRateForDate(new Date(dayISO), holiday);
    const diff = workedMs - reqMs;
    const bankMs = diff <= 0 ? diff : Math.floor(diff * rate);
    totalMs += bankMs;
  }

  return totalMs;
}

/* ======= Status (em trabalho / em intervalo) ======= */
export function todayStatus(punchesAsc /* de hoje */) {
  if (!punchesAsc.length) return { status: 'Sem registros', since: null };
  const last = punchesAsc[punchesAsc.length-1];
  const when = last.at?.toDate?.() || last.ts?.toDate?.() || new Date(last.ts);
  if (last.type === 'entrada') return { status: 'Em trabalho', since: when };
  return { status: 'Em intervalo', since: when };
}

/* ======= Admin: Dados do dia e do mês ======= */
export async function listPunchesByDayAllUsers(dayISO) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const rolesSnap = await fs.getDocs(fs.collection(db, 'roles'));
  const rolesMap = {}; rolesSnap.forEach(d => rolesMap[d.id]=d.data());
  const base = new Date(dayISO);
  const months=[ yyyymm(base), yyyymm(new Date(base.getFullYear(), base.getMonth()-1,1)) ];
  const rows = [];
  for (const uid of Object.keys(rolesMap)) {
    for (const m of months) {
      const q = fs.query(
        fs.collection(db, 'punches', uid, m),
        fs.orderBy('ts','asc'),
        fs.limit(500)
      );
      const s = await fs.getDocs(q);
      for (const doc of s.docs) {
        const data = doc.data();
        const dt = data.at?.toDate?.() || data.ts?.toDate?.() || new Date(data.ts);
        if (ymd(dt) === dayISO) rows.push({ ...data, uid, name: rolesMap[uid]?.name||'', email: rolesMap[uid]?.email||'' });
      }
    }
  }
  rows.sort((a,b) => {
    const ta=(a.at?.toMillis?.()||a.ts?.toMillis?.()||new Date(a.ts).getTime());
    const tb=(b.at?.toMillis?.()||b.ts?.toMillis?.()||new Date(b.ts).getTime());
    return ta - tb;
  });
  return rows;
}

export async function listPunchesByMonthAllUsers(yyyymmStr) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const rolesSnap = await fs.getDocs(fs.collection(db, 'roles'));
  const rows = [];
  for (const r of rolesSnap.docs) {
    const uid = r.id, role = r.data();
    const q = fs.query(fs.collection(db, 'punches', uid, yyyymmStr), fs.orderBy('ts','asc'));
    const s = await fs.getDocs(q);
    for (const d of s.docs) rows.push({ ...d.data(), uid, name: role?.name||'', email: role?.email||'' });
  }
  return rows;
}

/* ======= Ajustes (já existentes) ======= */
export async function requestAdjustment({ dateISO, timeHHMM, type, reason, action, targetPath }) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user = auth.currentUser; if (!user) throw new Error('Não autenticado');

  let tsWanted = null;
  if (!action || action === 'include') {
    const [hh,mm] = (timeHHMM||'00:00').split(':').map(Number);
    const dt = new Date(dateISO); dt.setHours(hh||0,mm||0,0,0);
    tsWanted = fs.Timestamp.fromDate(dt);
  }
  return fs.addDoc(fs.collection(db,'adjust_requests'),{
    uid: user.uid, email: user.email||'',
    type: type || null,
    reason: reason || '',
    action: action || 'include',   // include | delete
    targetPath: targetPath || null,
    tsWanted: tsWanted,
    status: 'pending', createdAt: fs.Timestamp.now()
  });
}

export async function listPendingAdjustments() {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const q = fs.query(fs.collection(db,'adjust_requests'),
                     fs.where('status','==','pending'),
                     fs.orderBy('createdAt','asc'));
  const s = await fs.getDocs(q);
  return s.docs.map(d => ({ id:d.id, ...d.data() }));
}

export async function approveAdjustment(req, adminUid) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  if (req.action === 'delete' && req.targetPath) {
    await fs.deleteDoc(fs.doc(db, req.targetPath));
  } else {
    const dt = req.tsWanted?.toDate?.() || new Date(req.tsWanted);
    const period = yyyymm(dt);
    const pref = fs.doc(fs.collection(db,'punches',req.uid,period));
    await fs.setDoc(pref,{
      ts: fs.Timestamp.now(),
      at: req.tsWanted,
      email: req.email||'',
      uid: req.uid,
      type: req.type || 'entrada',
      note: 'Ajuste aprovado (admin)'
    });
  }
  await fs.updateDoc(fs.doc(db,'adjust_requests',req.id),{
    status:'approved', resolvedAt: fs.Timestamp.now(), resolvedBy: adminUid
  });
}

export async function rejectAdjustment(reqId, adminUid, reason) {
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  await fs.updateDoc(fs.doc(db,'adjust_requests',reqId),{
    status:'rejected', resolvedAt: fs.Timestamp.now(), resolvedBy: adminUid, adminNote: reason||''
  });
}
