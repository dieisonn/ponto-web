// app.js — Firebase + Firestore + Geofence + Relatórios + Fila offline + Totais diários

export let app, auth, db;
let initializingPromise = null;
const APP_VERSION = 'v1.4.0';

// ===== init =====
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
    const appModule = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js');
    const authModule = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
    const fsModule   = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
    app = appModule.initializeApp(firebaseConfig);
    auth = authModule.getAuth(app);
    db = fsModule.getFirestore(app);
    return app;
  })();
  return initializingPromise;
}

// ===== utils =====
function yyyymmUTC(d){ // período por MÊS em UTC
  const y=d.getUTCFullYear(); const m=String(d.getUTCMonth()+1).padStart(2,'0');
  return y+''+m;
}
function dayISOlocal(d){
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), da=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${da}`;
}
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));

// ===== auth/roles =====
export async function onUserChanged(cb){ await initApp(); (await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js')).onAuthStateChanged(auth, cb); }
export async function ensureRoleDoc(uid){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const ref = fs.doc(db,'roles',uid); const snap=await fs.getDoc(ref);
  if(!snap.exists()) await fs.setDoc(ref,{role:'user'},{merge:true});
}
export async function isAdmin(uid){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const ref=fs.doc(db,'roles',uid); const s=await fs.getDoc(ref);
  return s.exists() && s.data() && s.data().role==='admin';
}
export async function setUserAllowedSites(uid, siteIds){ // admin usa
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  await fs.setDoc(fs.doc(db,'roles',uid), { allowedSites: siteIds || [] }, { merge:true });
}
export async function getUserRole(uid){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const s = await fs.getDoc(fs.doc(db,'roles',uid));
  return s.exists()? s.data() : {};
}

// ===== sites (geofence) =====
const M_PER_DEG_LAT = 111320;
function metersPerDegLon(lat){ return 111320*Math.cos(lat*Math.PI/180); }

export async function createSite(name, lat, lon, radiusM){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  if (!name || !isFinite(lat) || !isFinite(lon) || !isFinite(radiusM)) throw new Error('Dados do local inválidos.');
  const mLon = metersPerDegLon(lat);
  return fs.addDoc(fs.collection(db,'sites'),{
    name, lat, lon, radiusM, active:true,
    mPerDegLat: M_PER_DEG_LAT, mPerDegLon: mLon, toleranceM: 30,
    createdAt: fs.Timestamp.now(), createdBy: auth.currentUser?.uid || null
  });
}
export async function listSites(onlyActive=true){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const q = onlyActive
    ? fs.query(fs.collection(db,'sites'), fs.where('active','==',true))
    : fs.collection(db,'sites');
  const snap = await fs.getDocs(q);
  return snap.docs.map(d => ({ id:d.id, ...d.data() }));
}
export async function nearestSite(coords){
  await initApp();
  const sites = await listSites(true);
  if (!sites.length) return null;
  let best=null, bestDist=Infinity;
  for (const s of sites){
    const dxM = Math.abs(coords.longitude - s.lon) * (s.mPerDegLon || metersPerDegLon(s.lat));
    const dyM = Math.abs(coords.latitude  - s.lat) * (s.mPerDegLat || M_PER_DEG_LAT);
    const dist = Math.sqrt(dxM*dxM + dyM*dyM);
    if (dist <= (s.radiusM + (s.toleranceM||0)) && dist < bestDist) { best=s; bestDist=dist; }
  }
  if (!best) return null;
  return { id: best.id, distM: bestDist, name: best.name };
}

// ===== ponto (com metadados) =====
export async function addPunch(note='', tipo='entrada', geo, atDate, siteId, distM, _unused='', siteName=null){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user = auth.currentUser; if(!user) throw new Error('Não autenticado');
  if (!geo || !isFinite(geo.latitude) || !isFinite(geo.longitude)) throw new Error('Localização obrigatória.');
  if (!siteId) throw new Error('Fora das áreas válidas para batida.');

  const base = (atDate instanceof Date) ? atDate : new Date();
  const period = yyyymmUTC(new Date(Date.UTC(base.getFullYear(), base.getMonth(), 1)));
  const device = (typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a');
  const tzOffset = (new Date()).getTimezoneOffset();

  const ref = fs.doc(fs.collection(db,'punches',user.uid,period));
  await fs.setDoc(ref, {
    ts: fs.serverTimestamp(),
    at: atDate ? fs.Timestamp.fromDate(atDate) : null,
    email: user.email || '',
    uid: user.uid,
    type: tipo,
    note: note || '',
    siteId, siteName: siteName || null, distM: distM || 0,
    geo: { lat: geo.latitude, lon: geo.longitude, acc: geo.accuracy ?? null },
    dayISO: dayISOlocal(atDate || new Date()),
    tzOffset, device, appVersion: APP_VERSION
  });

  // materializa total do dia
  await updateDailyTotalDoc(user.uid, dayISOlocal(atDate || new Date()));
}

// ===== consultas =====
export async function listRecentPunchesRaw(limitN=1){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user = auth.currentUser; if(!user) return [];
  const period = yyyymmUTC(new Date());
  const q = fs.query(fs.collection(db,'punches',user.uid,period), fs.orderBy('ts','desc'), fs.limit(limitN));
  const snap = await fs.getDocs(q);
  return snap.docs.map(d => ({ _id:d.id, _path:d.ref.path, ...d.data() }));
}
export async function listPunchesByDayForUser(uid, dayISO){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const d = new Date(dayISO);
  const months = [ yyyymmUTC(new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1))), yyyymmUTC(new Date(Date.UTC(d.getFullYear(), d.getMonth()-1, 1))) ];
  const rows=[];
  for (const m of months){
    const q = fs.query(fs.collection(db,'punches',uid,m), fs.orderBy('ts','asc'), fs.limit(2000));
    const snap = await fs.getDocs(q);
    for (const doc of snap.docs){
      const data = doc.data();
      const base = data.at?.toDate ? data.at.toDate() : (data.ts?.toDate ? data.ts.toDate() : new Date(data.ts));
      if (dayISOlocal(base) === dayISO) rows.push({ ...data, _id:doc.id, _path:doc.ref.path });
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
  for (const p of arr){
    const t = (p.at?.toMillis ? p.at.toMillis() : (p.ts?.toMillis ? p.ts.toMillis() : (new Date(p.ts)).getTime()));
    if (p.type==='entrada') start=t;
    if (p.type==='saida' && start!=null){ total += (t-start); start=null; }
  }
  return total;
}
export const msToHHMM = (ms)=> `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor((ms%3600000)/60000)).padStart(2,'0')}`;

export async function listPunchesByDayAllUsers(dayISO){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const rolesSnap = await fs.getDocs(fs.collection(db,'roles'));
  const rolesMap={}; rolesSnap.forEach(d=>rolesMap[d.id]=d.data());
  const base = new Date(dayISO);
  const months=[ yyyymmUTC(new Date(Date.UTC(base.getFullYear(), base.getMonth(), 1))),
                 yyyymmUTC(new Date(Date.UTC(base.getFullYear(), base.getMonth()-1, 1))) ];
  const rows=[];
  for (const uid in rolesMap){
    for (const m of months){
      const q = fs.query(fs.collection(db,'punches',uid,m), fs.orderBy('ts','desc'), fs.limit(2000));
      const snap=await fs.getDocs(q);
      for (const doc of snap.docs){
        const data = doc.data();
        const when = data.at?.toDate ? data.at.toDate() : (data.ts?.toDate ? data.ts.toDate() : new Date(data.ts));
        if (dayISOlocal(when)===dayISO){
          rows.push({ ...data, uid, email:data.email||rolesMap[uid]?.email||'', name:rolesMap[uid]?.name||'' });
        }
      }
    }
  }
  rows.sort((a,b)=>{
    const ta=(a.at?.toMillis ? a.at.toMillis() : (a.ts?.toMillis ? a.ts.toMillis() : new Date(a.ts).getTime()));
    const tb=(b.at?.toMillis ? b.at.toMillis() : (b.ts?.toMillis ? b.ts.toMillis() : new Date(b.ts).getTime()));
    return ta-tb;
  });
  return rows;
}
export async function listPunchesByMonthAllUsers(yyyymmStr){
  await initApp();
  const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const rolesSnap=await fs.getDocs(fs.collection(db,'roles'));
  const rows=[];
  for (const r of rolesSnap.docs){
    const uid=r.id, role=r.data();
    const q=fs.query(fs.collection(db,'punches',uid,yyyymmStr), fs.orderBy('ts','asc'));
    const s=await fs.getDocs(q);
    for (const d of s.docs){ rows.push({ ...d.data(), uid, name:role?.name||'', email:role?.email||'' }); }
  }
  return rows;
}

// ===== Totais diários materializados =====
export async function updateDailyTotalDoc(uid, dayISO){
  await initApp();
  const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const rows = await listPunchesByDayForUser(uid, dayISO);
  const ms = computeDailyMs(rows);
  await fs.setDoc(fs.doc(db,'daily_totals', uid, 'days', dayISO), {
    ms, hhmm: msToHHMM(ms), updatedAt: fs.Timestamp.now()
  }, { merge:true });
}
export async function getDailyTotalMs(uid, dayISO){
  await initApp();
  const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const s = await fs.getDoc(fs.doc(db,'daily_totals', uid, 'days', dayISO));
  return s.exists()? (s.data().ms||0) : 0;
}

// ===== Ajustes (agora com paginação e atualiza totais) =====
function parsePunchPath(path){ const p=(path||'').split('/'); return (p.length===4 && p[0]==='punches')? {uid:p[1], period:p[2], docId:p[3]} : null; }

export async function requestAdjustment({ dateISO, timeHHMM, type, reason, action, targetPath }){
  await initApp();
  const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user=auth.currentUser; if(!user) throw new Error('Não autenticado');

  let tsWanted=null;
  if (!action || action==='include' || action==='update') {
    const [hhS,mmS]=(timeHHMM||'00:00').split(':');
    const dt=new Date(dateISO); dt.setHours(parseInt(hhS||'0',10), parseInt(mmS||'0',10), 0, 0);
    tsWanted=fs.Timestamp.fromDate(dt);
  }
  return fs.addDoc(fs.collection(db,'adjust_requests'),{
    uid:user.uid, email:user.email||'',
    type: type || null,
    reason: reason || '',
    action: action || 'include',     // include | update | delete
    targetPath: targetPath || null,  // punches/... para update/delete
    tsWanted: tsWanted,
    status:'pending', createdAt: fs.Timestamp.now()
  });
}

// paginação: orderBy createdAt + __name__
export async function listPendingAdjustmentsPage(limitN=20, cursor=null){
  await initApp();
  const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const base = [
    fs.where('status','==','pending'),
    fs.orderBy('createdAt','asc'),
    fs.orderBy('__name__','asc'),
    fs.limit(limitN)
  ];
  const q = cursor
    ? fs.query(fs.collection(db,'adjust_requests'), ...base, fs.startAfter(cursor.createdAt, cursor.id))
    : fs.query(fs.collection(db,'adjust_requests'), ...base);
  const s=await fs.getDocs(q);
  const items = s.docs.map(d=>({ id:d.id, ...d.data() }));
  const last = s.docs.length? { id:s.docs[s.docs.length-1].id, createdAt: items[items.length-1].createdAt } : null;
  return { items, last };
}

export async function approveAdjustment(req, adminUid){
  await initApp();
  const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');

  let touchDays = new Set();

  if (req.action === 'delete' && req.targetPath){
    const ref = fs.doc(db, req.targetPath);
    const snap = await fs.getDoc(ref);
    if (snap.exists()){
      const d = snap.data();
      const dt = d.at?.toDate ? d.at.toDate() : (d.ts?.toDate ? d.ts.toDate() : new Date());
      touchDays.add(dayISOlocal(dt));
    }
    await fs.deleteDoc(ref);
  } else if (req.action === 'update' && req.targetPath && req.tsWanted){
    const parsed = parsePunchPath(req.targetPath);
    if (!parsed) throw new Error('Caminho inválido para update.');
    const oldSnap = await (await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js')).getDoc((await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js')).doc(db, req.targetPath));
    if (oldSnap.exists()){
      const old = oldSnap.data();
      touchDays.add(dayISOlocal(old.at?.toDate ? old.at.toDate() : (old.ts?.toDate ? old.ts.toDate() : new Date())));
    }
    const newDate = req.tsWanted?.toDate ? req.tsWanted.toDate() : new Date(req.tsWanted);
    const newPeriod = yyyymmUTC(new Date(Date.UTC(newDate.getFullYear(), newDate.getMonth(), 1)));
    touchDays.add(dayISOlocal(newDate));

    if (newPeriod === parsed.period){
      await fs.updateDoc(fs.doc(db, req.targetPath), {
        ts: fs.Timestamp.now(),
        at: req.tsWanted,
        type: req.type || 'entrada',
        note: 'Ajuste aprovado (admin)',
        siteId: 'admin_adjust', distM: 0, geo: { lat:null, lon:null, acc:null }
      });
    } else {
      const oldRef = fs.doc(db, req.targetPath);
      const old = oldSnap.exists()? oldSnap.data(): {};
      const newRef = fs.doc(fs.collection(db,'punches', parsed.uid, newPeriod));
      await fs.setDoc(newRef, {
        ts: fs.Timestamp.now(),
        at: req.tsWanted,
        email: req.email || old.email || '',
        uid: parsed.uid,
        type: req.type || old.type || 'entrada',
        note: 'Ajuste aprovado (admin)',
        siteId: 'admin_adjust', distM: 0, geo: { lat:null, lon:null, acc:null }
      });
      await fs.deleteDoc(oldRef);
    }
  } else { // include
    const dt=req.tsWanted?.toDate ? req.tsWanted.toDate() : new Date(req.tsWanted);
    touchDays.add(dayISOlocal(dt));
    const pref=fs.doc(fs.collection(db,'punches', req.uid, yyyymmUTC(new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), 1)))));
    await fs.setDoc(pref,{
      ts: fs.Timestamp.now(),
      at: req.tsWanted,
      email: req.email||'',
      uid: req.uid,
      type: req.type || 'entrada',
      note: 'Ajuste aprovado (admin)',
      siteId: 'admin_adjust', distM: 0, geo: { lat: null, lon: null, acc: null }
    });
  }

  await fs.updateDoc(fs.doc(db,'adjust_requests',req.id),{
    status:'approved', resolvedAt: fs.Timestamp.now(), resolvedBy: adminUid
  });

  // atualiza materializados
  for (const day of touchDays){ await updateDailyTotalDoc(req.uid, day); }
}

export async function rejectAdjustment(reqId, adminUid, reason){
  await initApp();
  const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  await fs.updateDoc(fs.doc(db,'adjust_requests',reqId),{
    status:'rejected', resolvedAt: fs.Timestamp.now(), resolvedBy: adminUid, adminNote: reason||''
  });
}

// ===== Fila offline (LocalStorage) =====
const QKEY = 'ponto.queue.v1';

function readQueue(){ try{ return JSON.parse(localStorage.getItem(QKEY)||'[]'); }catch(_){ return []; } }
function writeQueue(arr){ localStorage.setItem(QKEY, JSON.stringify(arr)); }
export function getQueue(){ return readQueue(); }
export function enqueuePunch(payload){
  const q = readQueue(); q.push({ ...payload, queuedAt: new Date().toISOString(), appVersion: APP_VERSION });
  writeQueue(q);
}
export function clearQueue(){ writeQueue([]); }

// tenta sincronizar a fila. Retorna {done, fail, left}
export async function trySyncQueue(progressCb){
  await initApp();
  const q = readQueue();
  if (!q.length) return { done:0, fail:0, left:0 };
  let done=0, fail=0; const left=[];
  for (const item of q){
    try{
      // revalida site no momento do sync para o mesmo ponto
      const coords = { latitude:item.lat, longitude:item.lon, accuracy:item.acc };
      const site = await nearestSite(coords);
      if (!site) throw new Error('Fora das áreas válidas no sync.');
      await addPunch(item.note||'', item.type, coords, new Date(item.atISO), site.id, site.distM, '', site.name||null);
      done++;
      if (progressCb) progressCb({done, fail, left:q.length-done-fail});
      // pequena pausa p/ não saturar
      await sleep(80);
    }catch(e){
      fail++; left.push(item);
    }
  }
  writeQueue(left);
  return { done, fail, left:left.length };
}
