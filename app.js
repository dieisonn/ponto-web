// app.js — Firebase + Firestore + Geofence + Relatórios

export let app, auth, db;
let initializingPromise = null;

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

/* ===== helpers auth/roles ===== */
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
function yyyymm(d){ const y=d.getUTCFullYear(); const m=String(d.getUTCMonth()+1).padStart(2,'0'); return y+''+m; }

/* ===== Sites (geofence) ===== */
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
export async function toggleSiteActive(siteId, active){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  await fs.updateDoc(fs.doc(db,'sites',siteId), { active: !!active });
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
  for (let i=0;i<sites.length;i++){
    const s=sites[i];
    const dxM = Math.abs(coords.longitude - s.lon) * (s.mPerDegLon || metersPerDegLon(s.lat));
    const dyM = Math.abs(coords.latitude  - s.lat) * (s.mPerDegLat || M_PER_DEG_LAT);
    const dist = Math.sqrt(dxM*dxM + dyM*dyM);
    if (dist <= (s.radiusM + (s.toleranceM||0)) && dist < bestDist) { best=s; bestDist=dist; }
  }
  if (!best) return null;
  return { id: best.id, distM: bestDist, name: best.name };
}

/* ===== Ponto (geofence obrigatório) ===== */
export async function addPunch(note='', tipo='entrada', geo, atDate, siteId, distM, place=''){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user = auth.currentUser; if(!user) throw new Error('Não autenticado');

  if (!geo || !isFinite(geo.latitude) || !isFinite(geo.longitude))
    throw new Error('Localização obrigatória.');

  if (!siteId) throw new Error('Fora das áreas válidas para batida.');

  const period = yyyymm(new Date());
  const ref = fs.doc(fs.collection(db,'punches',user.uid,period));
  await fs.setDoc(ref, {
    ts: fs.Timestamp.now(),              // carimbo do servidor (auditoria)
    at: atDate ? fs.Timestamp.fromDate(atDate) : null, // horário escolhido
    email: user.email || '',
    uid: user.uid,
    type: tipo,
    note,
    place: place || '',
    siteId, distM: distM||0, siteName: undefined, // nome será verificado no admin
    geo: { lat: geo.latitude, lon: geo.longitude, acc: geo.accuracy ?? null }
  });
}

/* ===== consultas ===== */
export async function listRecentPunchesRaw(limitN=1){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user = auth.currentUser; if(!user) return [];
  const period = yyyymm(new Date());
  const q = fs.query(fs.collection(db,'punches',user.uid,period), fs.orderBy('ts','desc'), fs.limit(limitN));
  const snap = await fs.getDocs(q);
  return snap.docs.map(d => ({ _id:d.id, _path:d.ref.path, ...d.data() }));
}
export async function listRecentPunches(limitN=10){
  const arr = await listRecentPunchesRaw(limitN); return arr.map(x=>{ const { _id,_path,...r }=x; return r; });
}

/* diárias/mensais (preferem 'at' se existir) */
export async function listPunchesByDayForUser(uid, dayISO){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const d = new Date(dayISO);
  const months = [ yyyymm(d), yyyymm(new Date(d.getFullYear(), d.getMonth()-1,1)) ];
  const rows=[];
  for (let i=0;i<months.length;i++){
    const q = fs.query(fs.collection(db,'punches',uid,months[i]), fs.orderBy('ts','asc'), fs.limit(500));
    const snap = await fs.getDocs(q);
    for (let j=0;j<snap.docs.length;j++){
      const data=snap.docs[j].data();
      const base = data.at?.toDate ? data.at.toDate() : (data.ts?.toDate ? data.ts.toDate() : new Date(data.ts));
      if (base.toISOString().slice(0,10)===dayISO) rows.push({ ...data, _id:snap.docs[j].id });
    }
  }
  return rows;
}
export function computeDailyMs(punchesAsc){
  const arr = punchesAsc.slice().sort(function(a,b){
    const ta = (a.at?.toMillis ? a.at.toMillis() : (a.ts?.toMillis ? a.ts.toMillis() : new Date(a.ts).getTime()));
    const tb = (b.at?.toMillis ? b.at.toMillis() : (b.ts?.toMillis ? b.ts.toMillis() : new Date(b.ts).getTime()));
    return ta - tb;
  });
  let total=0, start=null;
  for (let i=0;i<arr.length;i++){
    const p=arr[i];
    const t = (p.at?.toMillis ? p.at.toMillis() : (p.ts?.toMillis ? p.ts.toMillis() : new Date(p.ts).getTime()));
    if (p.type==='entrada') start=t;
    if (p.type==='saida' && start!=null){ total += (t-start); start=null; }
  }
  return total;
}
export function msToHHMM(ms){ const h=Math.floor(ms/3600000), m=Math.floor((ms%3600000)/60000); return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0'); }
export async function listPunchesByDayAllUsers(dayISO){
  await initApp();
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const rolesSnap = await fs.getDocs(fs.collection(db,'roles'));
  const rolesMap={}; rolesSnap.forEach(function(d){ rolesMap[d.id]=d.data(); });
  const base = new Date(dayISO);
  const months=[ yyyymm(base), yyyymm(new Date(base.getFullYear(), base.getMonth()-1,1)) ];
  const rows=[];
  for (const uid in rolesMap){
    for (let i=0;i<months.length;i++){
      const q = fs.query(fs.collection(db,'punches',uid,months[i]), fs.orderBy('ts','desc'), fs.limit(200));
      const snap=await fs.getDocs(q);
      for (let j=0;j<snap.docs.length;j++){
        const data = snap.docs[j].data();
        const when = data.at?.toDate ? data.at.toDate() : (data.ts?.toDate ? data.ts.toDate() : new Date(data.ts));
        if (when.toISOString().slice(0,10)===dayISO){
          rows.push({ ...data, uid, email:data.email||rolesMap[uid]?.email||'', name:rolesMap[uid]?.name||'' });
        }
      }
    }
  }
  rows.sort(function(a,b){
    const ta=(a.at?.toMillis ? a.at.toMillis() : (a.ts?.toMillis ? a.ts.toMillis() : new Date(a.ts).getTime()));
    const tb=(b.at?.toMillis ? b.at.toMillis() : (b.ts?.toMillis ? b.ts.toMillis() : new D
