// app.js — Ponto completo com: escalas, pausas nomeadas, projetos, compensações,
// relatório (heatmap/timeline helpers), LGPD export, PWA hooks, App Check, auditoria,
// gestor/departamentos e trava de período (balances.locked).

export let app, auth, db;
let boot;

const APP_CHECK_SITE_KEY = "<SEU_RECAPTCHA_V3_SITE_KEY>"; // opcional: App Check

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

    // App Check (se chave fornecida)
    try {
      if (APP_CHECK_SITE_KEY && APP_CHECK_SITE_KEY !== "<SEU_RECAPTCHA_V3_SITE_KEY>") {
        const appCheckModule = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-check.js');
        appCheckModule.initializeAppCheck(app, {
          provider: new appCheckModule.ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
          isTokenAutoRefreshEnabled: true
        });
      }
    } catch(e){ console.warn('App Check init falhou (seguindo sem):', e); }

    auth = authModule.getAuth(app);
    db   = fsModule.getFirestore(app);
    return app;
  })();
  return boot;
}

/* ===== Utils ===== */
function dayISOfromDate(d){ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const dd=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dd}`; }
function monthISO(d=new Date()){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
function parseLocalDateISO(dayISO){ const [y,m,d] = String(dayISO).split('-').map(Number); return new Date(y,(m||1)-1,d||1,0,0,0,0); }
function yyyymmLocal(d){ return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`; }
function monthPeriodFromISO(mISO){ const [y,m]=mISO.split('-').map(Number); return `${y}${String(m).padStart(2,'0')}`; }
function prevMonthISO(mISO){ const [y,m]=mISO.split('-').map(Number); const d=new Date(y,m-2,1); return monthISO(d); }
function millisOf(x){ if(!x) return 0; if(x.toMillis) return x.toMillis(); if(x.toDate) return x.toDate().getTime(); return new Date(x).getTime(); }
export function msToHHMM(ms){
  const sign=ms<0?-1:1; ms=Math.abs(ms);
  const h=Math.floor(ms/3600000), m=Math.floor((ms%3600000)/60000);
  const s=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  return sign<0?`-${s}`:s;
}
function hhmmToMin(s){
  const [h, m] = String(s || '0:0').split(':').map(x => parseInt(x || '0', 10));
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}
const ROUND5 = 5*60*1000;

/* ===== Auth / perfis ===== */
export async function onUserChanged(cb){ await initApp(); (await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js')).onAuthStateChanged(auth, cb); }
export async function ensureRoleDoc(uid, name, email){
  await initApp(); const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const ref=fs.doc(db,'roles',uid); const s=await fs.getDoc(ref);
  if(!s.exists()) await fs.setDoc(ref,{ role:'user', name:name||'', email:email||'', requiredDaily:'08:00', dept:null, managerUid:null },{merge:true});
  else await fs.setDoc(ref,{ name:name||'', email:email||'' },{merge:true});
}
export async function isAdmin(uid){ await initApp(); const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js'); const s=await fs.getDoc(fs.doc(db,'roles',uid)); return s.exists() && s.data()?.role==='admin'; }
export async function listAllProfiles(){ await initApp(); const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js'); const s=await fs.getDocs(fs.collection(db,'roles')); return s.docs.map(d=>({ uid:d.id, ...(d.data()||{}) })); }
export async function setRequiredDaily(uid, hhmm){ await initApp(); const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js'); await fs.setDoc(fs.doc(db,'roles',uid),{requiredDaily:hhmm},{merge:true}); }

/* ===== Status de jornada ===== */
export async function ensureStatus(uid){
  await initApp(); const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const ref=fs.doc(db,`users/${uid}/meta/status`); const s=await fs.getDoc(ref);
  if(!s.exists()) await fs.setDoc(ref,{ hasOpen:false, hasBreakOpen:false },{merge:true});
}
export async function getStatus(uid){
  await initApp(); const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const s=await fs.getDoc(fs.doc(db,`users/${uid}/meta/status`));
  return { hasOpen: !!s.data()?.hasOpen, hasBreakOpen: !!s.data()?.hasBreakOpen };
}

/* ===== Projetos ===== */
export async function listProjects(){
  await initApp(); const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const s=await fs.getDocs(fs.collection(db,'projects')); return s.docs.map(d=>({ id:d.id, ...(d.data()||{}) }));
}
export async function addProject(name){
  await initApp(); const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  await fs.addDoc(fs.collection(db,'projects'),{ name });
}

/* ===== Escalas/Turnos ===== */
// schedules/{uid}/{YYYYMM}/days/{YYYY-MM-DD} { start:"09:00", end:"18:00", breakMin:60 }
export async function getScheduleMonth(uid, monthISOParam){
  await initApp(); const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const per = monthPeriodFromISO(monthISOParam||monthISO());
  const s=await fs.getDocs(fs.collection(db,'schedules', uid, per, 'days'));
  const map=new Map(); s.forEach(d=>map.set(d.id, d.data())); return map;
}
export async function setScheduleDay(uid, dayISO, start, end, breakMin){
  await initApp(); const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const per = yyyymmLocal(parseLocalDateISO(dayISO));
  await fs.setDoc(fs.doc(db,'schedules', uid, per, 'days', dayISO), { start, end, breakMin: parseInt(breakMin||'0',10) }, { merge:true });
}
function requiredMsFromScheduleOrUser(scheduleMap, dayISO, reqDailyMin){
  const sc = scheduleMap.get(dayISO);
  if(!sc || !sc.start || !sc.end){
    return reqDailyMin*60*1000;
  }
  const [sh, sm] = sc.start.split(':').map(Number);
  const [eh, em] = sc.end.split(':').map(Number);
  const d=parseLocalDateISO(dayISO); const a=new Date(d), b=new Date(d);
  a.setHours(sh||0, sm||0, 0, 0); b.setHours(eh||0, em||0, 0, 0);
  let ms=b-a; if(sc.breakMin) ms -= (parseInt(sc.breakMin||'0',10)*60*1000);
  return Math.max(0, ms);
}

/* ===== Compensações ===== */
// compensations/{uid}/{autoId} { date:"YYYY-MM-DD", hours:"04:00", reason }
export async function addCompensation(uid, dateISO, hoursHHMM, reason){
  await initApp(); const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  await fs.addDoc(fs.collection(db,'compensations', uid), { date: dateISO, hours: hoursHHMM, reason: reason||'', createdAt: fs.Timestamp.now() });
}
export async function listCompensationsInMonth(uid, monthISOParam){
  await initApp(); const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const month=monthISOParam||monthISO(); const start=`${month}-01`; const end=`${month}-31`;
  const s=await fs.getDocs(fs.query(fs.collection(db,'compensations', uid), fs.where('date','>=',start), fs.where('date','<=',end)));
  return s.docs.map(d=>({ id:d.id, ...(d.data()||{}) }));
}

/* ===== Escrita das batidas (dupla escrita + status + auditoria) ===== */
async function writePunch({ uid, type, atDate, note, projId }){
  await initApp(); const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const dayISO = dayISOfromDate(atDate); const period = yyyymmLocal(parseLocalDateISO(dayISO));
  const data = {
    ts: fs.Timestamp.now(),
    at: fs.Timestamp.fromDate(atDate),
    day: dayISO,
    period,
    uid,
    type,
    note: note||'',
    projId: projId || null,
    ua: (typeof navigator!=='undefined' ? navigator.userAgent : '') || '',
    tzOffset: new Date().getTimezoneOffset(),
    platform: (typeof navigator!=='undefined' ? navigator.platform : '') || ''
  };
  const batch = fs.writeBatch(db);
  batch.set(fs.doc(fs.collection(db,`users/${uid}/punches`)), data);
  batch.set(fs.doc(fs.collection(db,'punches',uid,period)), data);
  const stRef = fs.doc(db,`users/${uid}/meta/status`);
  const stSnap = await fs.getDoc(stRef);
  const st = { hasOpen:false, hasBreakOpen:false, ...(stSnap.data()||{}) };

  if (type==='entrada') { st.hasOpen = true; st.hasBreakOpen=false; }
  else if (type==='saida'){ st.hasOpen = false; st.hasBreakOpen=false; }
  else if (type==='inicio_pausa'){ st.hasBreakOpen = true; }
  else if (type==='fim_pausa'){ st.hasBreakOpen = false; }

  batch.set(stRef, st, { merge:true });

  // auditoria
  batch.set(fs.doc(fs.collection(db,'audit')), {
    actorUid: uid, action: `punch:${type}`, day: dayISO, at: data.at, createdAt: fs.Timestamp.now(), meta: { projId: projId||null }
  });

  await batch.commit();
}

export async function addPunchAuto({ at, note='', projId=null }){
  await initApp();
  const user = auth.currentUser; if(!user) throw new Error('Não autenticado');
  const atDate = at instanceof Date ? at : new Date();
  await ensureStatus(user.uid);
  const st = await getStatus(user.uid);
  const type = (!st.hasOpen) ? 'entrada' : (st.hasBreakOpen ? 'fim_pausa' : 'saida');
  await writePunch({ uid:user.uid, type, atDate, note, projId });
}
export async function startPause({ at, note='' }){
  const user=auth.currentUser; if(!user) throw new Error('Não autenticado');
  await writePunch({ uid:user.uid, type:'inicio_pausa', atDate: at instanceof Date ? at : new Date(), note });
}
export async function endPause({ at, note='' }){
  const user=auth.currentUser; if(!user) throw new Error('Não autenticado');
  await writePunch({ uid:user.uid, type:'fim_pausa', atDate: at instanceof Date ? at : new Date(), note });
}
export async function addExplicit({ at, type, note='', uid, projId=null }){
  await writePunch({ uid, type, atDate: at instanceof Date ? at : new Date(), note, projId });
}

/* ===== Forçar saída (admin) ===== */
export async function forceCloseNow(uid, note='Encerrado pelo admin'){
  await writePunch({ uid, type:'saida', atDate:new Date(), note });
}

/* ===== Consultas ===== */
export async function listPunchesByDayForUser(uid, dayISO){
  await initApp(); const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const q1 = fs.query(fs.collectionGroup(db,'punches'), fs.where('uid','==',uid), fs.where('day','==',dayISO));
  const s1 = await fs.getDocs(q1);
  let arr = s1.docs.map(d=>({_id:d.id,_path:d.ref.path,...d.data()}));
  if (!arr.length){ // legado
    const period=yyyymmLocal(parseLocalDateISO(dayISO));
    const q2=fs.query(fs.collection(db,'punches',uid,period), fs.where('day','==',dayISO));
    const s2=await fs.getDocs(q2); arr=s2.docs.map(d=>({_id:d.id,_path:d.ref.path,...d.data()}));
  }
  arr.sort((a,b)=> millisOf(a.at||a.ts) - millisOf(b.at||b.ts));
  return arr;
}
export async function listPunchesByDayAllUsers(dayISO){
  await initApp(); const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const roles = await listAllProfiles(); const rmap=Object.fromEntries(roles.map(r=>[r.uid,r]));
  const q=fs.query(fs.collectionGroup(db,'punches'), fs.where('day','==',dayISO));
  const s=await fs.getDocs(q);
  let list=s.docs.map(d=>d.data());
  if(!list.length){ // legado
    list=[];
    const period=yyyymmLocal(parseLocalDateISO(dayISO));
    for(const r of roles){
      const q2=fs.query(fs.collection(db,'punches',r.uid,period), fs.where('day','==',dayISO));
      const s2=await fs.getDocs(q2); s2.forEach(d=>list.push(d.data()));
    }
  }
  list.sort((a,b)=> millisOf(a.at||a.ts) - millisOf(b.at||b.ts));
  return list.map(x=>({ ...x, name: rmap[x.uid]?.name || '' }));
}

/* ===== Em jornada agora ===== */
export async function listOpenShiftsAllUsers(dayISO){
  await initApp(); const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const roles=await listAllProfiles(); const now=Date.now(); const out=[];
  for(const r of roles){
    const st=await fs.getDoc(fs.doc(db,`users/${r.uid}/meta/status`));
    if(st.exists() && st.data()?.hasOpen){
      const arr=await listPunchesByDayForUser(r.uid, dayISO);
      const last=arr[arr.length-1];
      if(last && (last.type==='entrada' || last.type==='fim_pausa')){
        const since=millisOf(last.at||last.ts); out.push({ uid:r.uid, name:r.name||r.uid, since, elapsedMs:Math.max(0,now-since) });
      }
    }
  }
  out.sort((a,b)=> b.elapsedMs - a.elapsedMs);
  return out;
}

/* ===== Ajustes ===== */
export async function requestAdjustment({ dateISO, timeHHMM, type, reason, action, targetPath }){
  await initApp(); const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const user=auth.currentUser; if(!user) throw new Error('Não autenticado');
  let tsWanted=null;
  if(!action || action==='include'){
    const [hh,mm]=(timeHHMM||'00:00').split(':').map(x=>parseInt(x||'0',10));
    const d=parseLocalDateISO(dateISO); d.setHours(hh,mm,0,0);
    tsWanted=fs.Timestamp.fromDate(d);
  }
  const ref=await fs.addDoc(fs.collection(db,'adjust_requests'), {
    uid:user.uid, email:user.email||'', type:type||null, reason:reason||'',
    action:action||'include', targetPath:targetPath||null, tsWanted:tsWanted,
    status:'pending', createdAt:fs.Timestamp.now()
  });
  await fs.setDoc(fs.doc(fs.collection(db,'audit')), { actorUid:user.uid, action:'adjust:create', targetId:ref.id, createdAt:fs.Timestamp.now() });
}
export async function listPendingAdjustments(){
  await initApp(); const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const q=fs.query(fs.collection(db,'adjust_requests'), fs.where('status','==','pending'), fs.orderBy('createdAt','asc'));
  const s=await fs.getDocs(q); return s.docs.map(d=>({ id:d.id, ...d.data() }));
}
export async function approveAdjustment(req, adminUid){
  await initApp(); const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  if (req.action==='delete' && req.targetPath){
    const docRef = fs.doc(db, req.targetPath); const snap=await fs.getDoc(docRef); const data = snap.exists()? snap.data(): null;
    if (snap.exists()) await fs.deleteDoc(docRef);
    if (data){
      const atMs = millisOf(data.at||data.ts);
      if (req.targetPath.startsWith('users/')) {
        const period = yyyymmLocal(parseLocalDateISO(data.day));
        const q = fs.query(fs.collection(db,'punches',data.uid,period), fs.where('day','==',data.day));
        const s = await fs.getDocs(q);
        for(const d of s.docs){ const x=d.data(); if (x.type===data.type && millisOf(x.at||x.ts)===atMs) await fs.deleteDoc(d.ref); }
      } else if (req.targetPath.startsWith('punches/')) {
        const q = fs.query(fs.collectionGroup(db,'punches'), fs.where('uid','==',data.uid), fs.where('day','==',data.day));
        const s = await fs.getDocs(q);
        for(const d of s.docs){ const x=d.data(); if (x.type===data.type && millisOf(x.at||x.ts)===atMs) await fs.deleteDoc(d.ref); }
      }
    }
  } else {
    const d = req.tsWanted?.toDate ? req.tsWanted.toDate() : new Date(req.tsWanted);
    const dayISO = dayISOfromDate(d);
    const period = yyyymmLocal(parseLocalDateISO(dayISO));
    const data = { ts: fs.Timestamp.now(), at: req.tsWanted, day: dayISO, period, email: req.email || '', uid: req.uid, type: req.type || 'entrada', note: 'Ajuste aprovado (admin)' };
    await fs.setDoc(fs.doc(fs.collection(db,`users/${req.uid}/punches`)), data);
    await fs.setDoc(fs.doc(fs.collection(db,'punches',req.uid,period)), data);
  }
  await fs.updateDoc(fs.doc(db,'adjust_requests',req.id), { status:'approved', resolvedAt:fs.Timestamp.now(), resolvedBy:adminUid });
  await fs.setDoc(fs.doc(fs.collection(db,'audit')), { actorUid:adminUid, action:'adjust:approve', targetId:req.id, createdAt:fs.Timestamp.now() });
}
export async function rejectAdjustment(reqId, adminUid, reason){
  await initApp(); const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  await fs.updateDoc(fs.doc(db,'adjust_requests',reqId),{ status:'rejected', resolvedAt:fs.Timestamp.now(), resolvedBy:adminUid, adminNote:reason||'' });
  await fs.setDoc(fs.doc(fs.collection(db,'audit')), { actorUid:adminUid, action:'adjust:reject', targetId:reqId, createdAt:fs.Timestamp.now(), meta:{reason:reason||''} });
}

/* ===== Feriados ===== */
async function getHolidaySet(){
  await initApp(); const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const d=await fs.getDoc(fs.doc(db,'settings/calendar/br_feriados'));
  const days=d.exists()?(d.data().days||[]):[]; return new Set(days);
}
function isSundayOrHoliday(dayISO, holidays){
  const d=parseLocalDateISO(dayISO); return d.getDay()===0 || holidays.has(dayISO);
}

/* ===== Cálculos ===== */
export function computeDailyWorkMs(punchesAsc){
  const arr=punchesAsc.slice().sort((a,b)=> millisOf(a.at||a.ts) - millisOf(b.at||b.ts));
  let work=0, workStart=null, pauseStart=null;
  for(const p of arr){
    const t=millisOf(p.at||p.ts);
    if (p.type==='entrada'){ workStart = t; }
    else if (p.type==='inicio_pausa' && workStart!=null && pauseStart==null){ pauseStart = t; }
    else if (p.type==='fim_pausa' && workStart!=null && pauseStart!=null){ work += (t - workStart) - (t - pauseStart); pauseStart=null; workStart = t; }
    else if (p.type==='saida' && workStart!=null){
      const effectivePause = pauseStart!=null ? (t - pauseStart) : 0;
      work += (t - workStart) - effectivePause;
      workStart=null; pauseStart=null;
    }
  }
  return Math.max(0, work);
}
function computeDailyAdjustedMs(punchesAsc){
  const worked = computeDailyWorkMs(punchesAsc);
  const hasNamedPause = punchesAsc.some(p=>p.type==='inicio_pausa' || p.type==='fim_pausa');
  if (!hasNamedPause){
    const types = punchesAsc.map(p=>p.type);
    const singleBlock = types.length===2 && types[0]==='entrada' && types[1]==='saida';
    if (singleBlock){
      const dur = millisOf(punchesAsc[1].at||punchesAsc[1].ts) - millisOf(punchesAsc[0].at||punchesAsc[0].ts);
      if (dur > 6*3600000) return worked - 60*60*1000;
    }
  }
  return worked;
}

/* ===== Balances ===== */
export async function getSavedBalance(uid, monthISOParam){
  await initApp(); const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const s=await fs.getDoc(fs.doc(db,'balances',uid,monthPeriodFromISO(monthISOParam))); return s.exists()? (s.data().balanceMs||0) : 0;
}
export async function saveMonthBalance(uid, monthISOParam, balanceMs, lock=true){
  await initApp(); const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  await fs.setDoc(fs.doc(db,'balances',uid,monthPeriodFromISO(monthISOParam)),{balanceMs, locked:!!lock, savedAt:fs.Timestamp.now()},{merge:true});
  await fs.setDoc(fs.doc(fs.collection(db,'audit')), { actorUid:(auth.currentUser?.uid||'admin'), action:'balance:close', targetId:`${uid}:${monthISOParam}`, createdAt:fs.Timestamp.now(), meta:{balanceMs, lock} });
}

/* ===== Relatório mensal ===== */
export async function getMonthReportForUser(uid, monthISOParam, reqDailyMinParam){
  await initApp(); const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const role=await fs.getDoc(fs.doc(db,'roles',uid));
  const reqDailyMin = typeof reqDailyMinParam==='number' ? reqDailyMinParam : hhmmToMin(role.data()?.requiredDaily || '08:00');

  const monthISOv = monthISOParam || monthISO();
  const periodStr = monthPeriodFromISO(monthISOv);
  const holidays = await getHolidaySet();
  const scheduleMap = await getScheduleMonth(uid, monthISOv);
  const comps = await listCompensationsInMonth(uid, monthISOv);

  const cg = await fs.getDocs(fs.query(fs.collectionGroup(db,'punches'),
    fs.where('uid','==',uid),
    fs.where('day','>=', `${monthISOv}-01`),
    fs.where('day','<=', `${monthISOv}-31`)
  ));
  const byDay = new Map();
  cg.forEach(d=>{ const x=d.data(); if(!byDay.has(x.day)) byDay.set(x.day,[]); byDay.get(x.day).push(x); });

  if(byDay.size===0){
    const snap=await fs.getDocs(fs.collection(db,'punches',uid,periodStr));
    snap.forEach(d=>{ const x=d.data(); if(!byDay.has(x.day)) byDay.set(x.day,[]); byDay.get(x.day).push(x); });
  }

  let totalWorked=0, totalReq=0, creditMs=0, deficitMs=0;
  const daily=[];

  for(const [dayISOv, arr0] of byDay.entries()){
    const arr=arr0.slice().sort((a,b)=> millisOf(a.at||a.ts) - millisOf(b.at||b.ts));
    let worked = Math.round(computeDailyAdjustedMs(arr)/ROUND5)*ROUND5;
    const required = requiredMsFromScheduleOrUser(scheduleMap, dayISOv, reqDailyMin);
    totalWorked += worked; totalReq += required;

    let extra=0, debt=0, compMs=0;
    if (worked >= required){ extra = worked - required; } else { debt = required - worked; }

    const comp = comps.find(c=>c.date===dayISOv);
    if (comp){ const [h,m] = String(comp.hours||'0:0').split(':').map(Number); compMs = (h*60+m)*60*1000; extra = Math.max(0, extra - compMs); }

    if (extra>0){
      const factor = isSundayOrHoliday(dayISOv, holidays) ? 2.0 : 1.5;
      creditMs += Math.round(extra * factor);
      daily.push({ dayISO:dayISOv, workedMs:worked, requiredMs:required, extraMs:extra, extraFactor:factor, deficitMs:0, compMs, punches:arr });
    } else {
      deficitMs += debt;
      daily.push({ dayISO:dayISOv, workedMs:worked, requiredMs:required, extraMs:0, extraFactor:1.0, deficitMs:debt, compMs, punches:arr });
    }
  }
  daily.sort((a,b)=> a.dayISO.localeCompare(b.dayISO));

  const prevISO=prevMonthISO(monthISOv);
  const prevBalance=await getSavedBalance(uid, prevISO);

  const totals={
    workedMs: totalWorked,
    requiredMs: totalReq,
    creditMs,
    deficitMs,
    balanceMs: creditMs - deficitMs,
    prevBalanceMs: prevBalance,
    finalBalanceMs: prevBalance + (creditMs - deficitMs)
  };
  return { uid, name: role.data()?.name||'', email: role.data()?.email||'', monthISO:monthISOv, reqDailyMin, totals, daily };
}
export async function getMonthReportForAllUsers(monthISOParam, reqDailyMin){
  const profiles=await listAllProfiles(); const reps=[];
  for(const p of profiles){
    const rep=await getMonthReportForUser(p.uid, monthISOParam, reqDailyMin ?? null);
    if(rep.daily.length) reps.push(rep);
  }
  return reps;
}

/* ===== Export helpers ===== */
export function monthReportsToCSV(reps){
  const rows=[['Colaborador','Mês','Dias_Lançados','Trabalhado(h)','Requerido(h)','Créditos(h)*','Débito(h)','Saldo(h)','SaldoAnterior(h)','SaldoFinal(h)']];
  for(const r of reps){ const t=r.totals;
    rows.push([r.name||r.uid,r.monthISO,String(r.daily.length),msToHHMM(t.workedMs),msToHHMM(t.requiredMs),msToHHMM(t.creditMs),msToHHMM(t.deficitMs),msToHHMM(t.balanceMs),msToHHMM(t.prevBalanceMs),msToHHMM(t.finalBalanceMs)]);
  }
  return rows.map(r=>r.map(v=>String(v).replace(/"/g,'""')).map(v=>`"${v}"`).join(',')).join('\r\n');
}
export function monthReportsToAOA(reps){
  const aoa=[['Colaborador','Mês','Dias_Lançados','Trabalhado(h)','Requerido(h)','Créditos(h)*','Débito(h)','Saldo(h)','SaldoAnterior(h)','SaldoFinal(h)']];
  reps.forEach(r=>{ const t=r.totals; aoa.push([r.name||r.uid,r.monthISO,r.daily.length,msToHHMM(t.workedMs),msToHHMM(t.requiredMs),msToHHMM(t.creditMs),msToHHMM(t.deficitMs),msToHHMM(t.balanceMs),msToHHMM(t.prevBalanceMs),msToHHMM(t.finalBalanceMs)]); });
  return aoa;
}

/* ===== LGPD: exportar dados pessoais ===== */
export async function exportUserDataJSON(uid, fromISO, toISO){
  await initApp(); const fs=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const q=fs.query(fs.collectionGroup(db,'punches'), fs.where('uid','==',uid), fs.where('day','>=', fromISO), fs.where('day','<=', toISO));
  const s=await fs.getDocs(q); const punches=s.docs.map(d=>d.data());
  const adjQ=fs.query(fs.collection(db,'adjust_requests'), fs.where('uid','==',uid));
  const adjS=await fs.getDocs(adjQ); const adjustments=adjS.docs.map(d=>({ id:d.id, ...(d.data()||{}) }));
  const compsQ=fs.query(fs.collection(db,'compensations', uid), fs.where('date','>=',fromISO), fs.where('date','<=',toISO));
  const compsS=await fs.getDocs(compsQ); const compensations=compsS.docs.map(d=>({ id:d.id, ...(d.data()||{}) }));
  return { uid, range:{ fromISO, toISO }, punches, adjustments, compensations, generatedAt: new Date().toISOString() };
}

/* ===== UI helpers: Heatmap & Timeline (dados) ===== */
export function buildHeatmapGrid(reps){
  const byUser = [];
  for(const r of reps){
    const map=new Map(r.daily.map(d=>[d.dayISO, d]));
    const days=[...map.keys()].sort();
    const rows=[];
    for(const d of days){
      const day=map.get(d);
      const status = (day.workedMs>0 ? (day.workedMs < day.requiredMs ? 'late' : 'ok') : 'abs');
      rows.push({ dayISO:d, status });
    }
    byUser.push({ uid:r.uid, name:r.name||r.uid, days:rows });
  }
  return byUser;
}
export function buildTimeline(dayArr){
  const arr=dayArr.slice().sort((a,b)=> millisOf(a.at||a.ts)-millisOf(b.at||b.ts));
  const blocks=[]; let curStart=null, pauseStart=null;
  for(const p of arr){
    const t=millisOf(p.at||p.ts);
    if(p.type==='entrada'){ curStart=t; }
    else if(p.type==='inicio_pausa'){ pauseStart=t; }
    else if(p.type==='fim_pausa'){ if(curStart!=null && pauseStart!=null){ blocks.push({ startMs:curStart, endMs:pauseStart, type:'work' }); curStart=t; pauseStart=null; } }
    else if(p.type==='saida'){ if(curStart!=null){ blocks.push({ startMs:curStart, endMs:t, type:'work' }); curStart=null; pauseStart=null; } }
  }
  return blocks;
}

/* ===== Tipo seguinte (para rótulos) ===== */
export async function getNextTypeFor(uid){
  const st = await getStatus(uid);
  return !st.hasOpen ? 'entrada' : (st.hasBreakOpen ? 'fim_pausa' : 'saida');
}
