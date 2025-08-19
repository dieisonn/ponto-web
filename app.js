// app.js — Firebase + Ponto
// Atualizado: addPunchAuto usa addDoc (sempre CREATE) + helpers presentes

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
function millisOf(x){
  if (!x) return 0;
  if (x.toMillis) return x.toMillis();
  if (x.toDate) return x.toDate().getTime();
  return new Date(x).getTime();
}

/* ===== Próximo tipo ===== */
export async function getNextTypeFor(uid, dayISO){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const d = new Date(dayISO || new Date());
  const period = yyyymm(new Date(d)); // usa UTC pro período

  // where(day==) — sem orderBy; ordena no cliente
  const q = fs.query(
    fs.collection(db, 'punches', uid, period),
    fs.where('day','==', dayISO || dayISOfromDate(new Date()))
  );
  const snap = await fs.getDocs(q);
  if (snap.empty) return 'entrada';

  const all = snap.docs.map(doc => doc.data());
  all.sort((a,b)=> millisOf(b.at || b.ts) - millisOf(a.at || a.ts)); // desc
  const last = all[0];

  // se existir uma "pausa" aberta, priorize "pausa_fim"
  const stack = all.map(x=>x.type);
  const openedBreaks = stack.filter(t=>t==='pausa_inicio').length - stack.filter(t=>t==='pausa_fim').length;
  if (openedBreaks > 0) return 'pausa_fim';

  return last.type === 'entrada' ? 'saida' : 'entrada';
}

/* ===== Criar ponto: alternância + addDoc (sempre CREATE) ===== */
export async function addPunchAuto({ at, note='' }){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user = auth.currentUser;
  if (!user) throw new Error('Não autenticado');

  const atDate = at instanceof Date ? new Date(at) : new Date();
  const dayISO = dayISOfromDate(atDate);
  const period = yyyymm(atDate);
  const nextType = await getNextTypeFor(user.uid, dayISO);

  await fs.addDoc(fs.collection(db, 'punches', user.uid, period), {
    ts: fs.Timestamp.now(),
    at: fs.Timestamp.fromDate(atDate),
    day: dayISO,
    email: user.email || '',
    uid: user.uid,
    type: nextType,
    note: note || ''
  });
}

/* ===== Pausas simples (opcional) ===== */
export async function startPause({ note='' }={}){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const u = auth.currentUser; if(!u) throw new Error('Não autenticado');
  const d = new Date();
  const period = yyyymm(d);
  await fs.addDoc(fs.collection(db,'punches',u.uid,period),{
    ts: fs.Timestamp.now(),
    at: fs.Timestamp.fromDate(d),
    day: dayISOfromDate(d),
    email: u.email||'',
    uid: u.uid,
    type: 'pausa_inicio',
    note: note||''
  });
}
export async function endPause({ note='' }={}){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const u = auth.currentUser; if(!u) throw new Error('Não autenticado');
  const d = new Date();
  const period = yyyymm(d);
  await fs.addDoc(fs.collection(db,'punches',u.uid,period),{
    ts: fs.Timestamp.now(),
    at: fs.Timestamp.fromDate(d),
    day: dayISOfromDate(d),
    email: u.email||'',
    uid: u.uid,
    type: 'pausa_fim',
    note: note||''
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
    fs.where('day','==', dayISO)
  );
  const s = await fs.getDocs(q);
  const arr = s.docs.map(doc => ({ _id:doc.id, _path:doc.ref.path, ...doc.data() }));
  arr.sort((a,b)=> millisOf(a.at || a.ts) - millisOf(b.at || b.ts));
  return arr;
}

export function computeDailyWorkMs(punchesAsc){
  const arr = punchesAsc.slice().sort((a,b)=> millisOf(a.at||a.ts) - millisOf(b.at||b.ts));
  let total=0, start=null, paused=false, pauseAt=null, pauseAcc=0;
  for (const p of arr){
    const t = millisOf(p.at || p.ts);
    if (p.type==='entrada'){ start=t; pauseAcc=0; paused=false; }
    else if (p.type==='pausa_inicio'){ if(start!=null && !paused){ paused=true; pauseAt=t; } }
    else if (p.type==='pausa_fim'){ if(paused && pauseAt!=null){ pauseAcc += (t - pauseAt); paused=false; pauseAt=null; } }
    else if (p.type==='saida' && start!=null){
      const worked = (t - start) - pauseAcc;
      total += Math.max(0, worked);
      start=null; paused=false; pauseAt=null; pauseAcc=0;
    }
  }
  return total;
}
export const computeDailyMs = computeDailyWorkMs; // compat

export function msToHHMM(ms){
  const sign = ms<0 ? '-' : '';
  const abs = Math.abs(ms);
  const h = Math.floor(abs/3600000);
  const m = Math.floor((abs%3600000)/60000);
  return `${sign}${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

export async function listPunchesByDayAllUsers(dayISO){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');

  const rolesSnap = await fs.getDocs(fs.collection(db,'roles'));
  const list = [];
  const period = yyyymm(new Date(dayISO));

  for (const r of rolesSnap.docs){
    const uid = r.id;
    const profile = r.data() || {};
    const q = fs.query(
      fs.collection(db,'punches',uid,period),
      fs.where('day','==',dayISO)
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
  list.sort((a,b)=> millisOf(a.at||a.ts) - millisOf(b.at||b.ts));
  return list;
}

/* ===== Status do dia (entrada aberta/pausa aberta) ===== */
export async function getStatus(uid, dayISO){
  const day = dayISO || dayISOfromDate(new Date());
  const arr = await listPunchesByDayForUser(uid, day);
  const stack = arr.map(x=>x.type);
  const hasOpen = (stack.filter(t=>t==='entrada').length > stack.filter(t=>t==='saida').length);
  const hasBreakOpen = (stack.filter(t=>t==='pausa_inicio').length > stack.filter(t=>t==='pausa_fim').length);
  return { hasOpen, hasBreakOpen };
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
    await fs.addDoc(fs.collection(db,'punches', req.uid, period), {
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

/* ===== Em jornada agora (admin) ===== */
export async function listOpenShiftsAllUsers(dayISO){
  const list = await listPunchesByDayAllUsers(dayISO || dayISOfromDate(new Date()));
  // agrupa por uid e encontra entradas sem saída
  const by = new Map();
  for (const p of list){
    if (!by.has(p.uid)) by.set(p.uid, []);
    by.get(p.uid).push(p);
  }
  const out=[];
  const now=Date.now();
  for (const [uid, arr] of by){
    arr.sort((a,b)=> millisOf(a.at||a.ts) - millisOf(b.at||b.ts));
    let start=null, pauseAcc=0, paused=false, pauseAt=null;
    for (const p of arr){
      const t=millisOf(p.at||p.ts);
      if (p.type==='entrada'){ start=t; pauseAcc=0; paused=false; }
      else if (p.type==='pausa_inicio'){ if(start!=null && !paused){ paused=true; pauseAt=t; } }
      else if (p.type==='pausa_fim'){ if(paused && pauseAt!=null){ pauseAcc+=(t-pauseAt); paused=false; pauseAt=null; } }
      else if (p.type==='saida'){ start=null; paused=false; pauseAt=null; pauseAcc=0; }
    }
    if (start!=null){
      const elapsedMs = (now - start) - pauseAcc;
      out.push({ uid, name: arr[0]?.name || '', elapsedMs });
    }
  }
  return out;
}

/* ===== Relatórios simples ===== */
const REQUIRED_PER_DAY_MS = 8*60*60*1000;

function isSunday(date){ return date.getDay()===0; }

export async function getMonthReportForUser(uid, monthISO /* YYYY-MM */){
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const [y,m] = monthISO.split('-').map(n=>parseInt(n,10));
  const first = new Date(y, m-1, 1);
  const last  = new Date(y, m, 0);
  const period = yyyymm(first);

  // carrega todos os dias do mês (via where(day==) por dia)
  const daily=[];
  for (let d = new Date(first); d <= last; d.setDate(d.getDate()+1)){
    const dayISO = dayISOfromDate(d);
    const q = fs.query(
      fs.collection(db,'punches',uid,period),
      fs.where('day','==', dayISO)
    );
    const s = await fs.getDocs(q);
    const arr = s.docs.map(doc => ({ _id:doc.id, ...doc.data() }))
                      .sort((a,b)=> millisOf(a.at||a.ts) - millisOf(b.at||b.ts));
    const worked = computeDailyWorkMs(arr);

    const required = (d.getDay()===0 || d.getDay()===6) ? 0 : REQUIRED_PER_DAY_MS; // domingo/sábado = 0 requerido
    const extra = Math.max(0, worked - required);
    const deficit = Math.max(0, required - worked);

    // créditos 1.5x normal; 2x domingo
    const credit = isSunday(d) ? extra*2.0 : extra*1.5;

    daily.push({ day: dayISO, workedMs: worked, requiredMs: required, creditMs: credit, deficitMs: deficit });
  }

  const sum = (k)=> daily.reduce((a,b)=>a+(b[k]||0),0);
  const totals = {
    workedMs:   sum('workedMs'),
    requiredMs: sum('requiredMs'),
    creditMs:   sum('creditMs'),
    deficitMs:  sum('deficitMs'),
    balanceMs:  sum('creditMs') - sum('deficitMs'),
    finalBalanceMs: sum('workedMs') - sum('requiredMs')
  };

  // pegar nome/e-mail
  const roleSnap = await fs.getDoc(fs.doc(db,'roles',uid));
  const name = roleSnap.exists()? (roleSnap.data().name||'') : '';
  return { uid, name, month: monthISO, daily, totals };
}

export async function getMonthReportForAllUsers(monthISO){
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const rolesSnap = await fs.getDocs(fs.collection(db,'roles'));
  const out=[];
  for (const r of rolesSnap.docs){
    const rep = await getMonthReportForUser(r.id, monthISO);
    rep.name = r.data()?.name || rep.name || r.id;
    out.push(rep);
  }
  return out;
}

export function monthReportsToCSV(reps){
  const lines = ['uid,name,month,worked,required,credit,deficit,balance,final_balance'];
  for (const r of reps){
    const t = r.totals;
    lines.push([
      r.uid, `"${(r.name||'').replace(/"/g,'""')}"`, r.month,
      msToHHMM(t.workedMs), msToHHMM(t.requiredMs), msToHHMM(t.creditMs),
      msToHHMM(t.deficitMs), msToHHMM(t.balanceMs), msToHHMM(t.finalBalanceMs)
    ].join(','));
  }
  return lines.join('\n');
}

/* ===== Export JSON simples (colaborador) ===== */
export async function exportUserDataJSON(uid, startISO, endISO){
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const start = new Date(startISO), end = new Date(endISO);
  const period = yyyymm(start);
  const q = fs.query(fs.collection(db,'punches',uid,period));
  const s = await fs.getDocs(q);
  const arr = s.docs.map(d=>({ id:d.id, ...d.data() }))
                    .filter(p=> {
                      const t = millisOf(p.at||p.ts);
                      return t >= start.getTime() && t <= end.getTime();
                    })
                    .sort((a,b)=> millisOf(a.at||a.ts) - millisOf(b.at||b.ts));
  return { uid, start: startISO, end: endISO, punches: arr };
}
