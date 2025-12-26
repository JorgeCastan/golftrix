function getQueryParam(n){ const u=new URL(location.href); return u.searchParams.get(n); }

  let myPair = null;  // <-- global para tu usuario actual

  import { app, db, auth } from '../firebase-config.js';
  import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
  import {
    doc, getDoc, setDoc, updateDoc, serverTimestamp,
    collection, query, where, getDocs, addDoc
  } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

  // --- Estado y elementos DOM ---
  const juegoId = getQueryParam('juegoId') || getQueryParam('id') || ('foursomes_' + Date.now());
  // --- Grupo relacionado al juego (se cargará desde doc 'juegos/<juegoId>')
  let grupoId = null;
  const player1Select = document.getElementById('player1Select');
  const player2Select = document.getElementById('player2Select');
  const addPairBtn = document.getElementById('addPairBtn');
  const pairsList = document.getElementById('pairsList');
  // Reemplazar esta línea:
// const priceInput = document.getElementById('priceInput');

// Con estas 3 líneas:
const priceFront9Input = document.getElementById('priceFront9');
const priceBack9Input = document.getElementById('priceBack9');
const priceGeneralInput = document.getElementById('priceGeneral');
  const startGameBtn = document.getElementById('startGameBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const gameArea = document.getElementById('gameArea');
  const gameMeta = document.getElementById('gameMeta');
  const matchupsContainer = document.getElementById('matchupsContainer');
  const miSaldoEl = document.getElementById('miSaldo');

  const authInst = auth;
  let currentUser = null;
  onAuthStateChanged(authInst, (user) => {
    if (user) {
      currentUser = user;
      console.log("Usuario logueado:", currentUser.uid);
    } else {
      console.warn("No hay usuario autenticado");
    }
  });


  // Data caches
  let allUsers = []; // { uid, nombre, initials, handicap, gender }
  let tarjetasCache = []; // tarjetas para este juego
  let camposCache = {}; // campoId -> campoData
  let pairs = []; // { id, p1Uid, p2Uid, color }

  // utils
  function randColor() {
    // palette saturada
    const palette = ['#e63946','#ff6b6b','#f97316','#f59e0b','#ffd166','#06d6a0','#118ab2','#3a86ff','#7c4dff','#9d4edd'];
    return palette[Math.floor(Math.random()*palette.length)];
  }
  function initialsFromName(name){
    if(!name) return '';
    const parts = name.split(' ').filter(Boolean);
    if(parts.length===1) return parts[0].slice(0,2).toUpperCase();
    return (parts[0][0]+ (parts[1]?.[0]||'')).toUpperCase();
  }


async function ensureGrupoId() {
  if (grupoId) return grupoId;
  try {
    const jSnap = await getDoc(doc(db, 'juegos', juegoId));
    if (jSnap.exists()) {
      grupoId = jSnap.data()?.grupoId || null;
    }
    return grupoId;
  } catch (e) {
    console.error("Error obteniendo grupoId", e);
    return null;
  }
}
await ensureGrupoId();
await loadUsers();


// ---------------------- FIRESTORE: obtener usuarios disponibles (solo del grupo si existe) ----------------------
async function loadUsers() {
  allUsers = [];
  try {
    if(!grupoId) {
      console.warn("grupoId no definido en loadUsers");
      populateUserSelects(); // vaciar selects por seguridad
      return;
    }

    const gSnap = await getDoc(doc(db, 'grupos', grupoId));
    if (!gSnap.exists()) {
      console.warn("Documento de grupo no existe");
      populateUserSelects(); // vaciar selects
      return;
    }

    const gData = gSnap.data();
    const membersArray = Array.isArray(gData.miembros) ? gData.miembros 
                  : Array.isArray(gData.grupo) ? gData.grupo 
                  : [];

    if(membersArray.length === 0){
    console.warn("No hay miembros en el grupo");
    populateUserSelects();
    return;
    }

    allUsers = await Promise.all(
    membersArray.map(async m => {
        const uid = m.uid || m.id;
        try {
        const userSnap = await getDoc(doc(db, 'users', uid));
        if (userSnap.exists()) {
            const uData = userSnap.data();
            const fullName = `${uData.name || ''} ${uData.lastname || ''}`.trim();
            return {
            id: uid,
            nombre: fullName || 'Sin Nombre',
            initials: initialsFromName(fullName),
            handicap: uData.handicap || 0,
            gender: uData.gender || 'M'
            };
        } else {
            return {
            id: uid,
            nombre: 'Sin Nombre',
            initials: 'SN',
            handicap: 0,
            gender: 'M'
            };
        }
        } catch(e){
        console.error('Error leyendo user', uid, e);
        return {
            id: uid,
            nombre: 'Sin Nombre',
            initials: 'SN',
            handicap: 0,
            gender: 'M'
        };
        }
    })
    );



    console.log("Usuarios cargados del grupo:", allUsers);
    populateUserSelects();

  } catch(e) {
    console.error("Error loadUsers", e);
    populateUserSelects(); // vaciar selects
  }
}



  function populateUserSelects(){
    [player1Select, player2Select].forEach(sel=>{
      sel.innerHTML = '<option value="">-- elegir --</option>';
      allUsers.forEach(u=>{
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = u.nombre;
        sel.appendChild(opt);
      });
    });
  }

  // ---------------------- Obtener tarjetas (reusa lógica) ----------------------
  async function obtenerTarjetasConScores() {
    try {
      const tarjetasCol = collection(db, 'tarjetas');
      const q = query(tarjetasCol, where('juegoId','==', juegoId));
      const snap = await getDocs(q);
      const tarjetas = [];
      snap.forEach(d => {
        const data = d.data();
        const scores = Array.isArray(data.scores) ? data.scores : [];
        const hasAny = scores.some(s => {
          const g = s.golpes;
          return (typeof g === 'number' && !isNaN(g)) || (typeof g === 'string' && !isNaN(Number(g)));
        });
        if (hasAny) { tarjetas.push({ id: d.id, ...data }); }
      });
      tarjetasCache = tarjetas;
      return tarjetas;
    } catch (err) {
      console.error('Error obteniendo tarjetas', err);
      tarjetasCache = [];
      return [];
    }
  }

  // ---------------------- Obtener pares por hoyo y ventajas (camposGolf) ----------------------
  async function obtenerParYVentajas(campoId) {
    if (!campoId) return { pares:null, vantM:null, vantF:null };
    if (camposCache[campoId]) return camposCache[campoId];
    try {
      const cref = doc(db, 'camposGolf', campoId);
      const csnap = await getDoc(cref);
      if (!csnap.exists()) { camposCache[campoId] = { pares:null, vantM:null, vantF:null }; return camposCache[campoId]; }
      const cdata = csnap.data();
      const pares = Array.isArray(cdata.paresHoyo) ? cdata.paresHoyo : (Array.isArray(cdata.pares_hoyo)?cdata.pares_hoyo:null);
      // detect possible keys for ventajas por genero (tolerante) - CORREGIDO
      const vantM = Array.isArray(cdata.ventajasM) ? cdata.ventajasM
                    : Array.isArray(cdata.ventajas_m) ? cdata.ventajas_m
                    : Array.isArray(cdata.ventajasMale) ? cdata.ventajasMale
                    : Array.isArray(cdata.advantagesMale) ? cdata.advantagesMale
                    : Array.isArray(cdata.ventajasHombre) ? cdata.ventajasHombre
                    : Array.isArray(cdata.masculino) ? cdata.masculino  // ← NUEVO: clave "masculino"
                    : Array.isArray(cdata.hombres) ? cdata.hombres      // ← NUEVO: clave "hombres"
                    : Array.isArray(cdata.male) ? cdata.male            // ← NUEVO: clave "male"
                    : null;
      const vantF = Array.isArray(cdata.ventajasF) ? cdata.ventajasF
                    : Array.isArray(cdata.ventajas_f) ? cdata.ventajas_f
                    : Array.isArray(cdata.ventajasFemale) ? cdata.ventajasFemale
                    : Array.isArray(cdata.advantagesFemale) ? cdata.advantagesFemale
                    : Array.isArray(cdata.ventajasMujer) ? cdata.ventajasMujer
                    : Array.isArray(cdata.femenino) ? cdata.femenino    // ← NUEVO: clave "femenino"
                    : Array.isArray(cdata.mujeres) ? cdata.mujeres      // ← NUEVO: clave "mujeres"
                    : Array.isArray(cdata.female) ? cdata.female        // ← NUEVO: clave "female"
                    : null;
      camposCache[campoId] = { pares, vantM, vantF };
      return camposCache[campoId];
    } catch (e) {
      console.error('Error obtenerParYVentajas', e);
      camposCache[campoId] = { pares:null, vantM:null, vantF:null };
      return camposCache[campoId];
    }
  }

  // ---------------------- PARES: manejo UI ----------------------
  function renderPairsList(){
    pairsList.innerHTML = '';
    pairs.forEach((p, idx) => {
      const pill = document.createElement('div');
      pill.className = 'pair-pill';
      pill.style.background = p.color;
      pill.innerHTML = `
        <div style="display:flex;gap:8px;align-items:center;">
          <div style="display:flex;flex-direction:column; margin-right:6px;">
            <div style="font-size:0.75rem; opacity:0.95">Pareja ${idx+1}</div>
            <div style="font-size:0.8rem;opacity:0.9">${getUserName(p.p1Uid)} & ${getUserName(p.p2Uid)}</div>
          </div>
        </div>
        <button data-idx="${idx}" style="margin-left:8px;background:transparent;border:0;color:#fff;cursor:pointer;font-weight:900">X</button>
      `;
      pairsList.appendChild(pill);
           pill.querySelector('button').addEventListener('click', ()=> { 
        pairs.splice(idx,1); 
        renderPairsList();
        autoSavePairs(); // ← AGREGAR ESTA LÍNEA
      });
    });
  }

  function getUserName(uid){
   const u = allUsers.find(x=>x.id===uid);
    return u ? u.nombre : uid;
  }

  function getMyPair() {
    if (!currentUser || !pairs || pairs.length === 0) return null;
    return pairs.find(
      p => p.p1Uid === currentUser.uid || p.p2Uid === currentUser.uid
    ) || null;
  }



  addPairBtn.addEventListener('click', ()=>{
    const p1 = player1Select.value;
    const p2 = player2Select.value;
    if(!p1 || !p2){ alert('Selecciona ambos jugadores'); return; }
    if(p1===p2){ if(!confirm('Has escogido el mismo usuario dos veces. Confirmar pareja igual?')) return; }
    const color = randColor();
    pairs.push({
        id: 'pair_'+Date.now()+'_'+Math.floor(Math.random()*9999),
        p1Uid: p1,
        p2Uid: p2,
        color
    });

    renderPairsList();
    autoSavePairs(); // ← AGREGAR ESTA LÍNEA
  });

  refreshBtn.addEventListener('click', async ()=>{ await initAll(); });

startGameBtn.addEventListener("click", async () => {
  try {
    if (!juegoId) { console.error("Faltan datos: juegoId"); return; }
    if (!grupoId) await ensureGrupoId();

    const foursomeRef = doc(db, "juego_foursomes", juegoId);
    const foursomeSnap = await getDoc(foursomeRef);

    const prices = {
      front9: Number(priceFront9Input.value) || 0,
      back9: Number(priceBack9Input.value) || 0,
      general: Number(priceGeneralInput.value) || 0
    };

    // Actualizar/crear documento
    if (foursomeSnap.exists()) {
      // Actualizar precios si ya existe
      await updateDoc(foursomeRef, {
        prices,
        pairs: pairs || [],
        updatedAt: serverTimestamp()
      });
    } else {
      // Crear nuevo si no existe
      await setDoc(foursomeRef, {
        juegoId,
        grupoId,
        prices,
        pairs: pairs || [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }

    // Reasignar myPair
    if(currentUser){
      myPair = pairs.find(p => p.p1Uid === currentUser.uid || p.p2Uid === currentUser.uid) || null;
    }

    // NO OCULTAR FORMULARIO - Solo mostrar área de juego
    gameArea.style.display = 'block';
    
    // Cambiar el texto del botón a "Actualizar Juego"
    startGameBtn.textContent = 'Actualizar Juego';
    
    // Actualizar metadatos
    gameMeta.innerHTML = `
      <div>Juego ${juegoId}</div>
      <div>Precios: Front9: $${prices.front9} | Back9: $${prices.back9} | General: $${prices.general}</div>
      <div>Parejas: ${pairs.length}</div>
    `;

    await computeAndRenderAllMatchups(prices, myPair);

  } catch (err) {
    console.error("Error al iniciar/actualizar juego:", err);
  }
});

// Función para actualizar precios sin recargar todo
async function updatePrices() {
  try {
    const prices = {
      front9: Number(priceFront9Input.value) || 0,
      back9: Number(priceBack9Input.value) || 0,
      general: Number(priceGeneralInput.value) || 0
    };

    const foursomeRef = doc(db, "juego_foursomes", juegoId);
    await updateDoc(foursomeRef, {
      prices,
      updatedAt: serverTimestamp()
    });

    // Recalcular y renderizar
    if (pairs.length > 0) {
      await computeAndRenderAllMatchups(prices, myPair);
    }

    console.log("Precios actualizados en tiempo real");
  } catch (err) {
    console.error("Error actualizando precios:", err);
  }
}

// Event listeners para cambios en precios
priceFront9Input.addEventListener('change', updatePrices);
priceBack9Input.addEventListener('change', updatePrices);
priceGeneralInput.addEventListener('change', updatePrices);


  // ---------------------- Lógica de cálculo de matchups ----------------------
  function findTarjetaForUser(uid) {
    // Busca por userUid en tarjetasCache
    return tarjetasCache.find(t => t.userUid === uid) || null;
  }

  function buildGolpesArrFromTarjeta(t) {
    const arr = new Array(18).fill(null);
    const scores = Array.isArray(t.scores) ? t.scores : [];
    scores.forEach(s=>{
      const hoyo = Number(s.hoyo);
      const golpesRaw = s.golpes;
      const golpes = (typeof golpesRaw === 'number') ? golpesRaw : (typeof golpesRaw === 'string' ? (isNaN(Number(golpesRaw))?null:Number(golpesRaw)) : null);
      if(!isNaN(hoyo) && hoyo>=1 && hoyo<=18 && typeof golpes === 'number') arr[hoyo-1] = golpes;
    });
    return arr;
  }

  function genderOfUser(userObj) {
    const g = (userObj?.gender||'M').toString().toLowerCase();
    if(g.startsWith('f')) return 'F';
    return 'M';
  }

  // aplica ventaja: devuelve golpes ajustados (sin alterar tarjeta)
  function applyAdvantageToGolpesArray(golpesArr, userData, fieldVentajas) {
  // fieldVentajas: { vantM, vantF } arrays or null
  const result = new Array(18).fill(null);
  
  for(let i=0;i<18;i++){
    const raw = golpesArr[i];
    if (typeof raw !== 'number') { 
      result[i] = null; 
      continue; 
    }
    
    let adj = raw;
    const gender = genderOfUser(userData);
    const handicap = userData.handicap || 0;
    
    // Obtener array de ventajas según género
    const vantArr = (gender === 'M') ? fieldVentajas.vantM : fieldVentajas.vantF;
    
    if (Array.isArray(vantArr) && i < vantArr.length) {
      const ventajaParaEsteHoyo = Number(vantArr[i]) || 0;
      
      // LÓGICA: Si el handicap del usuario es IGUAL O MAYOR a la ventaja para este hoyo
      // se le resta 1 golpe (recibe un stroke de ventaja)
      if (handicap >= ventajaParaEsteHoyo) {
        adj = adj - 1; // Restar 1 golpe (ventaja)
      }
    }
    
    result[i] = adj;
  }
  return result;
}
function getUserObj(uid) {
  return allUsers.find(u=>u.id===uid) || { handicap:0, gender:'M' };
}

  // compara 2 parejas: devuelve objeto con tabla por hoyo y suma de puntos por pareja (array [pointsA, pointsB])
async function computeMatchup(pairA, pairB, prices) {
  const pA1 = findTarjetaForUser(pairA.p1Uid);
  const pA2 = findTarjetaForUser(pairA.p2Uid);
  const pB1 = findTarjetaForUser(pairB.p1Uid);
  const pB2 = findTarjetaForUser(pairB.p2Uid);

  const campoId = (pA1?.campoId || pA2?.campoId || pB1?.campoId || pB2?.campoId) || null;
  const fieldInfo = await obtenerParYVentajas(campoId);

  const a1Arr = pA1 ? applyAdvantageToGolpesArray(buildGolpesArrFromTarjeta(pA1), getUserObj(pairA.p1Uid), fieldInfo) : new Array(18).fill(null);
  const a2Arr = pA2 ? applyAdvantageToGolpesArray(buildGolpesArrFromTarjeta(pA2), getUserObj(pairA.p2Uid), fieldInfo) : new Array(18).fill(null);
  const b1Arr = pB1 ? applyAdvantageToGolpesArray(buildGolpesArrFromTarjeta(pB1), getUserObj(pairB.p1Uid), fieldInfo) : new Array(18).fill(null);
  const b2Arr = pB2 ? applyAdvantageToGolpesArray(buildGolpesArrFromTarjeta(pB2), getUserObj(pairB.p2Uid), fieldInfo) : new Array(18).fill(null);

  const holes = [];
  let totalA = 0, totalB = 0;
  let front9A = 0, front9B = 0;
  let back9A = 0, back9B = 0;

  for (let h = 0; h < 18; h++) {
  const scoresA = [a1Arr[h], a2Arr[h]].filter(x=>typeof x==='number');
  const scoresB = [b1Arr[h], b2Arr[h]].filter(x=>typeof x==='number');

  let ptsA=0, ptsB=0;

  if (scoresA.length && scoresB.length) {
    const lowA = Math.min(...scoresA);
    const highA = Math.max(...scoresA);
    const lowB = Math.min(...scoresB);
    const highB = Math.max(...scoresB);

    // LÓGICA CORREGIDA: 1 punto al ganador, -1 al perdedor
    if (lowA < lowB) {
      ptsA += 1;  // Pareja A gana el mejor vs mejor
      ptsB -= 1;  // Pareja B pierde
    } else if (lowB < lowA) {
      ptsB += 1;  // Pareja B gana el mejor vs mejor
      ptsA -= 1;  // Pareja A pierde
    }
    // Si empatan: 0 puntos para ambos

    if (highA < highB) {
      ptsA += 1;  // Pareja A gana el peor vs peor
      ptsB -= 1;  // Pareja B pierde
    } else if (highB < highA) {
      ptsB += 1;  // Pareja B gana el peor vs peor
      ptsA -= 1;  // Pareja A pierde
    }
    // Si empatan: 0 puntos para ambos
  }

  totalA += ptsA;
  totalB += ptsB;
 
    // Separar por segmentos
    if (h < 9) { // Primeros 9 hoyos (0-8)
      front9A += ptsA;
      front9B += ptsB;
    } else { // Segundos 9 hoyos (9-17)
      back9A += ptsA;
      back9B += ptsB;
    }

    holes.push({
      players:[
        { uid: pairA.p1Uid, name:getUserName(pairA.p1Uid), initials:getUserObj(pairA.p1Uid).initials, adj: a1Arr[h], teamColor: pairA.color },
        { uid: pairA.p2Uid, name:getUserName(pairA.p2Uid), initials:getUserObj(pairA.p2Uid).initials, adj: a2Arr[h], teamColor: pairA.color },
        { uid: pairB.p1Uid, name:getUserName(pairB.p1Uid), initials:getUserObj(pairB.p1Uid).initials, adj: b1Arr[h], teamColor: pairB.color },
        { uid: pairB.p2Uid, name:getUserName(pairB.p2Uid), initials:getUserObj(pairB.p2Uid).initials, adj: b2Arr[h], teamColor: pairB.color },
      ],
      pointsA: ptsA,
      pointsB: ptsB
    });
  }

  // Calcular dinero por segmentos - CORREGIDO
  // Solo se gana/perde el precio completo, no multiplicado por diferencia
  let dineroFront9 = 0;
  let dineroBack9 = 0;
  let dineroGeneral = 0;

  if (front9A > front9B) {
    dineroFront9 = prices.front9 || 0; // Pareja A gana Front9
  } else if (front9B > front9A) {
    dineroFront9 = -(prices.front9 || 0); // Pareja A pierde Front9 (negativo)
  }
  // Si empatan: 0

  if (back9A > back9B) {
    dineroBack9 = prices.back9 || 0; // Pareja A gana Back9
  } else if (back9B > back9A) {
    dineroBack9 = -(prices.back9 || 0); // Pareja A pierde Back9 (negativo)
  }
  // Si empatan: 0

  if (totalA > totalB) {
    dineroGeneral = prices.general || 0; // Pareja A gana General
  } else if (totalB > totalA) {
    dineroGeneral = -(prices.general || 0); // Pareja A pierde General (negativo)
  }
  // Si empatan: 0

  // Dinero total por pareja (no dividido aún) - negativo si perdió
  const dineroTotalPareja = dineroFront9 + dineroBack9 + dineroGeneral;

  // Dinero por jugador (mitad para cada uno)
  const dineroPorJugador = dineroTotalPareja / 2;

  return {
    pairA, pairB, holes,
    totalPointsA: totalA,
    totalPointsB: totalB,
    front9A, front9B,
    back9A, back9B,
    dineroFront9,
    dineroBack9,
    dineroGeneral,
    dineroTotalPareja,
    dineroPorJugador,  // ← NUEVO: dinero por cada jugador
    saldo: totalA-totalB,
    prices
  };
  }

  async function computeAndRenderAllMatchups(prices, myPair) {
  matchupsContainer.innerHTML = '';

  if(!pairs || pairs.length<2) return;

  // generar matchups: si myPair existe, solo vs otros
  const matchupPairs = myPair ? pairs.filter(p => p.id !== myPair.id) : pairs;
  const matchups = [];

  for(const p of matchupPairs){
    if(myPair){
      matchups.push(await computeMatchup(myPair, p, prices)); // ← CORRECTO: usa prices
    } else {
      for(let i=0;i<pairs.length;i++){
        for(let j=i+1;j<pairs.length;j++){
          matchups.push(await computeMatchup(pairs[i], pairs[j], prices)); // ← CORRECTO: usa prices
        }
      }
      break;
    }
  }

  // Calcular saldo total estimado del usuario actual (en dinero, no puntos)
let totalSaldoUserDinero = 0;
let totalSaldoUserPuntos = 0;

matchups.forEach(r=>{
  if(currentUser){
    const uid = currentUser.uid;
    const userInA = r.pairA.p1Uid === uid || r.pairA.p2Uid === uid;
    const userInB = r.pairB.p1Uid === uid || r.pairB.p2Uid === uid;
    
    if(userInA) {
      totalSaldoUserDinero += r.dineroPorJugador; // ← Usar dineroPorJugador en vez de dividir
      totalSaldoUserPuntos += (r.totalPointsA - r.totalPointsB);
    } else if(userInB) {
      totalSaldoUserDinero -= r.dineroPorJugador; // ← Negativo (ya viene negativo si perdió)
      totalSaldoUserPuntos += (r.totalPointsB - r.totalPointsA);
    }
  }
});

  // renderizar tablas
  for(const r of matchups){
    const tableBlock = document.createElement('div');
    tableBlock.className = 'card';
    tableBlock.style.padding='8px';

    const header = document.createElement('div');
    header.className='team-header';
    header.innerHTML = `
  <div style="display:flex;align-items:center;gap:8px; flex-wrap:wrap;">
    <div style="width:18px;height:18px;border-radius:50%;background:${r.pairA.color};"></div>
    <strong>Equipo A:</strong> ${getUserName(r.pairA.p1Uid)} & ${getUserName(r.pairA.p2Uid)}
    <div style="margin-left:10px; font-size:0.9em;">
      Pts: ${r.totalPointsA} | Front9: ${r.front9A} | Back9: ${r.back9A}
    </div>
  </div>
  <div style="display:flex;align-items:center;gap:8px; flex-wrap:wrap; margin-top:5px;">
    <div style="width:18px;height:18px;border-radius:50%;background:${r.pairB.color};"></div>
    <strong>Equipo B:</strong> ${getUserName(r.pairB.p1Uid)} & ${getUserName(r.pairB.p2Uid)}
    <div style="margin-left:10px; font-size:0.9em;">
      Pts: ${r.totalPointsB} | Front9: ${r.front9B} | Back9: ${r.back9B}
    </div>
  </div>
  <div style="margin-top:5px; padding:5px; background:#f0f0f0; border-radius:5px;">
    <strong>Dinero por segmento (precio completo):</strong><br>
    Front9: $${r.dineroFront9 >= 0 ? '+' : ''}${r.dineroFront9} | 
    Back9: $${r.dineroBack9 >= 0 ? '+' : ''}${r.dineroBack9} | 
    General: $${r.dineroGeneral >= 0 ? '+' : ''}${r.dineroGeneral}<br>
    <strong>Total Pareja: $${r.dineroTotalPareja >= 0 ? '+' : ''}${r.dineroTotalPareja}</strong> 
    ($${r.dineroPorJugador >= 0 ? '+' : ''}${r.dineroPorJugador} por jugador)
  </div>
`;
    tableBlock.appendChild(header);

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    trh.innerHTML = `<th class="nameCol">Jugador</th>` + Array.from({length:18},(_,i)=>`<th>H${i+1}</th>`).join('') + `<th>Puntaje</th>`;
    thead.appendChild(trh);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    // 4 jugadores
    for(let pi=0; pi<4; pi++){
      const tr = document.createElement('tr');
      const playerInfo = r.holes[0].players[pi];
      const nameTd = document.createElement('td');
      nameTd.className='nameCol';
      nameTd.innerHTML = `<div style="display:flex;align-items:center;gap:8px;">
        <div class="badge" style="background:${playerInfo.teamColor};border-color:transparent;color:#fff;">${playerInfo.initials}</div>
        <div style="font-weight:800">${playerInfo.name}</div>
      </div>`;
      tr.appendChild(nameTd);

      let pairPoints = 0;
      for(let h=0; h<18; h++){
        const td = document.createElement('td');
        const hole = r.holes[h];
        const p = hole.players[pi];
        td.textContent = (typeof p.adj==='number') ? p.adj : '-';
        tr.appendChild(td);
        if(pi<2) pairPoints += hole.pointsA;
        else pairPoints += hole.pointsB;
      }
      const ptsCol = document.createElement('td');
      ptsCol.textContent = pairPoints;
      ptsCol.style.fontWeight='900';
      ptsCol.style.background = (pi<2)? r.pairA.color : r.pairB.color;
      ptsCol.style.color='#fff';
      tr.appendChild(ptsCol);
      tbody.appendChild(tr);
    }

    // 🔥 Fila extra de puntaje por equipo
    const scoreRow = document.createElement('tr');
    const labelTd = document.createElement('td');
    labelTd.className = 'nameCol';
    labelTd.style.fontWeight = 'bold';
    labelTd.textContent = 'Marcador';
    scoreRow.appendChild(labelTd);

    for(let h=0; h<18; h++){
      const td = document.createElement('td');
      td.style.background = `linear-gradient(90deg,${r.pairA.color} 50%,${r.pairB.color} 50%)`;
      td.style.color = '#000';
      td.style.fontWeight = 'bold';

      const hole = r.holes[h];
      let texto = '0 - 0';
      if(hole.pointsA > hole.pointsB){
        texto = `+${hole.pointsA} / -${hole.pointsB}`;
        td.style.color = 'green';
      } else if(hole.pointsB > hole.pointsA){
        texto = `-${hole.pointsA} / +${hole.pointsB}`;
        td.style.color = 'red';
      }
      td.textContent = texto;
      scoreRow.appendChild(td);
    }

    // columna final vacía para que cuadre con "Puntaje"
    const lastTd = document.createElement('td');
    scoreRow.appendChild(lastTd);

    tbody.appendChild(scoreRow);

    table.appendChild(tbody);
    tableBlock.appendChild(table);

    matchupsContainer.appendChild(tableBlock);
  }

  const signoDinero = totalSaldoUserDinero >= 0 ? '+' : '';
  const signoPuntos = totalSaldoUserPuntos >= 0 ? '+' : '';

  miSaldoEl.innerHTML = `
    <div><strong>Saldo estimado por jugador:</strong> ${signoDinero}$${totalSaldoUserDinero.toFixed(2)} MXN</div>
    <div style="font-size:0.9em; margin-top:3px;">
      Puntos netos: ${signoPuntos}${totalSaldoUserPuntos} | 
      Máximo posible: $${((prices.front9 + prices.back9 + prices.general) / 2).toFixed(2)}
    </div>
  `;
  miSaldoEl.style.background = totalSaldoUserDinero>=0?'linear-gradient(90deg,#e6ffe6,#ddffdd)':'linear-gradient(90deg,#ffe6e6,#ffdede)';
  miSaldoEl.style.color = totalSaldoUserDinero>=0?'green':'red';
  miSaldoEl.style.padding='10px';
}



  // ---------------------- INIT ----------------------
  async function initAll() {
    try {
      await ensureGrupoId();
      await loadUsers();
      await obtenerTarjetasConScores();

      const jfRef = doc(db, 'juego_foursomes', juegoId);
      const jfSnap = await getDoc(jfRef);
      if (jfSnap.exists()) {
        const jfData = jfSnap.data();
        grupoId = jfData?.grupoId || grupoId;
        pairs = Array.isArray(jfData?.pairs) ? jfData.pairs : [];
        
        // Cargar precios (nueva estructura)
        const prices = jfData?.prices || { front9: 0, back9: 0, general: 0 };
        priceFront9Input.value = prices.front9 || 0;
        priceBack9Input.value = prices.back9 || 0;
        priceGeneralInput.value = prices.general || 0;
        
        renderPairsList();

        // Asignar myPair solo si currentUser existe
        if(currentUser){
          myPair = pairs.find(p => p.p1Uid === currentUser.uid || p.p2Uid === currentUser.uid) || null;
        }

        if(pairs.length > 0) {
          gameArea.style.display = 'block';
          // NO OCULTAR FORMULARIO - Solo mostrar área de juego
          startGameBtn.textContent = 'Actualizar Juego';
          
          // Actualizar metadatos
          gameMeta.innerHTML = `
            <div>Juego ${juegoId}</div>
            <div>Precios: Front9: $${prices.front9} | Back9: $${prices.back9} | General: $${prices.general}</div>
            <div>Parejas: ${pairs.length}</div>
          `;
          
          if (myPair) {
            await computeAndRenderAllMatchups(prices, myPair);
          }
        }

      } else {
        console.warn("No existe el documento en juego_foursomes todavía");
        renderPairsList();
      }

    } catch(e){
      console.error('initAll: error al inicializar', e);
    }
  }


  onAuthStateChanged(authInst, async (user)=>{
    currentUser = user;
    if(!user){
      // still load users but show limited
      await initAll();
      return;
    }
    await initAll();
  });

// Función para guardar automáticamente cambios en parejas
function autoSavePairs() {
  if (pairs.length > 0 && juegoId) {
    const foursomeRef = doc(db, "juego_foursomes", juegoId);
    
    // Solo actualizar si el documento existe
    getDoc(foursomeRef).then(snap => {
      if (snap.exists()) {
        const prices = {
          front9: Number(priceFront9Input.value) || 0,
          back9: Number(priceBack9Input.value) || 0,
          general: Number(priceGeneralInput.value) || 0
        };
        
        updateDoc(foursomeRef, {
          pairs: pairs,
          prices: prices,
          updatedAt: serverTimestamp()
        }).then(() => {
          console.log("Parejas guardadas automáticamente");
        });
      }
    });
  }
}



// También al eliminar parejas
// Modificar el evento click en renderPairsList
// Agregar autoSavePairs() después de pairs.splice
