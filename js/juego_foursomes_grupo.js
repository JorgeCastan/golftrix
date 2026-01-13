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
      // ACCEDER CORRECTAMENTE a las ventajas dentro del Map 'ventajas'
const ventajasMap = cdata.ventajas || {};

const vantM = 
  Array.isArray(ventajasMap.masculino) ? ventajasMap.masculino :  // ← CORRECTO: dentro de ventajas
  Array.isArray(ventajasMap.hombres) ? ventajasMap.hombres :
  Array.isArray(ventajasMap.male) ? ventajasMap.male :
  Array.isArray(cdata.ventajasM) ? cdata.ventajasM :
  Array.isArray(cdata.ventajas_m) ? cdata.ventajas_m :
  Array.isArray(cdata.ventajasMale) ? cdata.ventajasMale :
  Array.isArray(cdata.advantagesMale) ? cdata.advantagesMale :
  Array.isArray(cdata.ventajasHombre) ? cdata.ventajasHombre :
  null;

const vantF = 
  Array.isArray(ventajasMap.femenino) ? ventajasMap.femenino :    // ← CORRECTO: dentro de ventajas
  Array.isArray(ventajasMap.mujeres) ? ventajasMap.mujeres :
  Array.isArray(ventajasMap.female) ? ventajasMap.female :
  Array.isArray(cdata.ventajasF) ? cdata.ventajasF :
  Array.isArray(cdata.ventajas_f) ? cdata.ventajas_f :
  Array.isArray(cdata.ventajasFemale) ? cdata.ventajasFemale :
  Array.isArray(cdata.advantagesFemale) ? cdata.advantagesFemale :
  Array.isArray(cdata.ventajasMujer) ? cdata.ventajasMujer :
  null;
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
    if(!u || !u.nombre) return uid;

    // Separar nombre completo
    const parts = u.nombre.trim().split(/\s+/);
    const name = parts[0];
    const lastInitial = parts.length > 1 ? parts[1][0].toUpperCase() : '';

    return lastInitial ? `${name} ${lastInitial}.` : name;
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
      <div style="font-weight: 700; color: var(--green-1); margin-bottom: 8px; font-size: 1.1rem;">
        Juego ID: ${juegoId}
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;">
        <span style="background: #e3f2fd; padding: 4px 10px; border-radius: 6px; font-size: 0.9rem;">
          Parejas: <strong>${pairs.length}</strong>
        </span>
        <span style="background: #e8f5e8; padding: 4px 10px; border-radius: 6px; font-size: 0.9rem;">
          Front9: $${prices.front9}
        </span>
        <span style="background: #f3e5f5; padding: 4px 10px; border-radius: 6px; font-size: 0.9rem;">
          Back9: $${prices.back9}
        </span>
        <span style="background: #fff3e0; padding: 4px 10px; border-radius: 6px; font-size: 0.9rem;">
          General: $${prices.general}
        </span>
      </div>
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
      
      // LÓGICA CORRECTA: aplicar ventaja si el handicap del jugador es <= a la ventaja del hoyo
      // Considerar que el handicap puede ser negativo
      if (handicap <= ventajaParaEsteHoyo) {
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

  const a1Arr = pA1 ? applyAdvantageToGolpesArray(
    buildGolpesArrFromTarjeta(pA1), 
    {
      ...getUserObj(pairA.p1Uid),  // género del usuario
      handicap: pA1.handicap || 0  // ← HANDICAP DE LA TARJETA (-9), no del usuario (-6)
    }, 
    fieldInfo
  ) : new Array(18).fill(null);

  const a2Arr = pA2 ? applyAdvantageToGolpesArray(
    buildGolpesArrFromTarjeta(pA2), 
    {
      ...getUserObj(pairA.p2Uid),
      handicap: pA2.handicap || 0  // ← HANDICAP DE LA TARJETA
    }, 
    fieldInfo
  ) : new Array(18).fill(null);

  const b1Arr = pB1 ? applyAdvantageToGolpesArray(
    buildGolpesArrFromTarjeta(pB1), 
    {
      ...getUserObj(pairB.p1Uid),
      handicap: pB1.handicap || 0  // ← HANDICAP DE LA TARJETA
    }, 
    fieldInfo
  ) : new Array(18).fill(null);

  const b2Arr = pB2 ? applyAdvantageToGolpesArray(
    buildGolpesArrFromTarjeta(pB2), 
    {
      ...getUserObj(pairB.p2Uid),
      handicap: pB2.handicap || 0  // ← HANDICAP DE LA TARJETA
    }, 
    fieldInfo
  ) : new Array(18).fill(null);

  const holes = [];
  let totalA = 0, totalB = 0;
  let front9A = 0, front9B = 0;
  let back9A = 0, back9B = 0;

  for (let h = 0; h < 18; h++) {
    // DECLARACIÓN ÚNICA de scoresA y scoresB
    const scoresA = [a1Arr[h], a2Arr[h]].filter(x=>typeof x==='number');
    const scoresB = [b1Arr[h], b2Arr[h]].filter(x=>typeof x==='number');

    // Calcular low y high ANTES de usarlos en múltiples lugares
    const lowA = scoresA.length ? Math.min(...scoresA) : null;
    const highA = scoresA.length ? Math.max(...scoresA) : null;
    const lowB = scoresB.length ? Math.min(...scoresB) : null;
    const highB = scoresB.length ? Math.max(...scoresB) : null;

    let ptsA=0, ptsB=0;
    let lowWinner = null;
    let highWinner = null;

    if (scoresA.length && scoresB.length && lowA !== null && highA !== null && lowB !== null && highB !== null) {
      // LÓGICA CORREGIDA: 1 punto al ganador, -1 al perdedor
      // MEJOR vs MEJOR (low scores)
      if (lowA < lowB) {
        ptsA += 1;
        ptsB -= 1;
        lowWinner = 'A';
      } else if (lowB < lowA) {
        ptsB += 1;
        ptsA -= 1;
        lowWinner = 'B';
      } else {
        lowWinner = 'tie';
      }

      // PEOR vs PEOR (high scores)
      if (highA < highB) {
        ptsA += 1;
        ptsB -= 1;
        highWinner = 'A';
      } else if (highB < highA) {
        ptsB += 1;
        ptsA -= 1;
        highWinner = 'B';
      } else {
        highWinner = 'tie';
      }
    }

    totalA += ptsA;
    totalB += ptsB;
    
    // Separar por segmentos
    if (h < 9) {
      front9A += ptsA;
      front9B += ptsB;
    } else {
      back9A += ptsA;
      back9B += ptsB;
    }
    
    let lowAIndex = -1, highAIndex = -1, lowBIndex = -1, highBIndex = -1;
    
    if (scoresA.length && lowA !== null && highA !== null) {
      lowAIndex = a1Arr[h] === lowA ? 0 : 1;
      highAIndex = a1Arr[h] === highA ? 0 : 1;
    }
    
    if (scoresB.length && lowB !== null && highB !== null) {
      lowBIndex = b1Arr[h] === lowB ? 2 : 3;
      highBIndex = b1Arr[h] === highB ? 2 : 3;
    }

    holes.push({
      players:[
        { 
          uid: pairA.p1Uid, 
          name:getUserName(pairA.p1Uid), 
          initials:getUserObj(pairA.p1Uid).initials, 
          adj: a1Arr[h], 
          teamColor: pairA.color,
          isLowA: 0 === lowAIndex,
          isHighA: 0 === highAIndex
        },
        { 
          uid: pairA.p2Uid, 
          name:getUserName(pairA.p2Uid), 
          initials:getUserObj(pairA.p2Uid).initials, 
          adj: a2Arr[h], 
          teamColor: pairA.color,
          isLowA: 1 === lowAIndex,
          isHighA: 1 === highAIndex
        },
        { 
          uid: pairB.p1Uid, 
          name:getUserName(pairB.p1Uid), 
          initials:getUserObj(pairB.p1Uid).initials, 
          adj: b1Arr[h], 
          teamColor: pairB.color,
          isLowB: 2 === lowBIndex,
          isHighB: 2 === highBIndex
        },
        { 
          uid: pairB.p2Uid, 
          name:getUserName(pairB.p2Uid), 
          initials:getUserObj(pairB.p2Uid).initials, 
          adj: b2Arr[h], 
          teamColor: pairB.color,
          isLowB: 3 === lowBIndex,
          isHighB: 3 === highBIndex
        },
      ],
      pointsA: ptsA,
      pointsB: ptsB,
      lowWinner: lowWinner,
      highWinner: highWinner
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
      Pts: <span style="color:${r.totalPointsA > r.totalPointsB ? 'green' : (r.totalPointsA < r.totalPointsB ? 'red' : 'black')}; font-weight:900">${r.totalPointsA}</span> | 
      Front9: <span style="color:${r.front9A > r.front9B ? 'green' : (r.front9A < r.front9B ? 'red' : 'black')}; font-weight:900">${r.front9A}</span> | 
      Back9: <span style="color:${r.back9A > r.back9B ? 'green' : (r.back9A < r.back9B ? 'red' : 'black')}; font-weight:900">${r.back9A}</span>
    </div>
  </div>
  <div style="display:flex;align-items:center;gap:8px; flex-wrap:wrap; margin-top:5px;">
    <div style="width:18px;height:18px;border-radius:50%;background:${r.pairB.color};"></div>
    <strong>Equipo B:</strong> ${getUserName(r.pairB.p1Uid)} & ${getUserName(r.pairB.p2Uid)}
    <div style="margin-left:10px; font-size:0.9em;">
      Pts: <span style="color:${r.totalPointsB > r.totalPointsA ? 'green' : (r.totalPointsB < r.totalPointsA ? 'red' : 'black')}; font-weight:900">${r.totalPointsB}</span> | 
      Front9: <span style="color:${r.front9B > r.front9A ? 'green' : (r.front9B < r.front9A ? 'red' : 'black')}; font-weight:900">${r.front9B}</span> | 
      Back9: <span style="color:${r.back9B > r.back9A ? 'green' : (r.back9B < r.back9A ? 'red' : 'black')}; font-weight:900">${r.back9B}</span>
    </div>
  </div>
  <div style="margin-top:8px; padding:8px; background:#f8f9fa; border-radius:6px; border:1px solid #dee2e6;">
    <strong style="display:block; margin-bottom:5px;">Dinero por segmento (precio completo):</strong>
    <div style="display:flex; flex-wrap:wrap; gap:10px; font-size:0.9em;">
      <span>Front9: <span style="color:${r.dineroFront9 > 0 ? 'green' : (r.dineroFront9 < 0 ? 'red' : 'black')}; font-weight:900">$${r.dineroFront9 >= 0 ? '+' : ''}${r.dineroFront9}</span></span>
      <span>Back9: <span style="color:${r.dineroBack9 > 0 ? 'green' : (r.dineroBack9 < 0 ? 'red' : 'black')}; font-weight:900">$${r.dineroBack9 >= 0 ? '+' : ''}${r.dineroBack9}</span></span>
      <span>General: <span style="color:${r.dineroGeneral > 0 ? 'green' : (r.dineroGeneral < 0 ? 'red' : 'black')}; font-weight:900">$${r.dineroGeneral >= 0 ? '+' : ''}${r.dineroGeneral}</span></span>
    </div>
    <div style="margin-top:6px; padding-top:6px; border-top:1px solid #dee2e6;">
      <strong>Total Pareja: <span style="color:${r.dineroTotalPareja > 0 ? 'green' : (r.dineroTotalPareja < 0 ? 'red' : 'black')}">$${r.dineroTotalPareja >= 0 ? '+' : ''}${r.dineroTotalPareja}</span></strong>
    </div>
  </div>
`;
    tableBlock.appendChild(header);

    // Crear contenedor con scroll
    const tableContainer = document.createElement('div');
    tableContainer.className = 'table-container';
    
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    trh.innerHTML = `<th class="nameCol">Jugador</th>` + Array.from({length:18},(_,i)=>`<th>H${i+1}</th>`).join('') + `<th>Puntaje</th>`;
    thead.appendChild(trh);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    // 4 jugadores - CON COLORES DE GANADOR/PERDEDOR
    for(let pi=0; pi<4; pi++){
      const tr = document.createElement('tr');
      const playerInfo = r.holes[0].players[pi];
      const nameTd = document.createElement('td');
      nameTd.className='nameCol';
      nameTd.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
          <div class="badge" style="background:${playerInfo.teamColor};border-color:transparent;color:#fff;">
            ${playerInfo.initials}
          </div>
          <div class="player-name-gradient">
            ${getUserName(playerInfo.uid)}
          </div>
        </div>
      `;

      tr.appendChild(nameTd);

      let pairPoints = 0;
      for(let h=0; h<18; h++){
        const td = document.createElement('td');
        const hole = r.holes[h];
        const p = hole.players[pi];
        
        // Determinar color según resultado del duelo
        let color = 'black'; // Por defecto (empate o sin datos)
        
        if (typeof p.adj === 'number') {
          if (pi < 2) { // Jugadores del equipo A
            if (p.isLowA) {
              // Es el low (mejor) del equipo A
              if (hole.lowWinner === 'A') {
                color = 'green'; // Ganó el duelo low
              } else if (hole.lowWinner === 'B') {
                color = 'red'; // Perdió el duelo low
              }
            } else if (p.isHighA) {
              // Es el high (peor) del equipo A
              if (hole.highWinner === 'A') {
                color = 'green'; // Ganó el duelo high
              } else if (hole.highWinner === 'B') {
                color = 'red'; // Perdió el duelo high
              }
            }
          } else { // Jugadores del equipo B (pi = 2 o 3)
            if (p.isLowB) {
              // Es el low (mejor) del equipo B
              if (hole.lowWinner === 'B') {
                color = 'green'; // Ganó el duelo low
              } else if (hole.lowWinner === 'A') {
                color = 'red'; // Perdió el duelo low
              }
            } else if (p.isHighB) {
              // Es el high (peor) del equipo B
              if (hole.highWinner === 'B') {
                color = 'green'; // Ganó el duelo high
              } else if (hole.highWinner === 'A') {
                color = 'red'; // Perdió el duelo high
              }
            }
          }
        }
        
        td.textContent = (typeof p.adj==='number') ? p.adj : '-';
        td.style.color = color;
        td.style.fontWeight = '900';
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

    // 🔥 NUEVA FILA DE MARCADOR DIVIDIDA
    const scoreRow = document.createElement('tr');
    const labelTd = document.createElement('td');
    labelTd.className = 'nameCol player-name-gradient';
    labelTd.style.fontWeight = '900';
    labelTd.textContent = 'Marcador';

    scoreRow.appendChild(labelTd);

    for(let h=0; h<18; h++){
      const td = document.createElement('td');
      td.className = 'score-cell';
      
      const hole = r.holes[h];
      
      // Crear división superior (puntos equipo A)
      const topDiv = document.createElement('div');
      topDiv.className = 'score-top';
      topDiv.style.background = r.pairA.color;
      topDiv.style.color = '#fff';
      topDiv.textContent = hole.pointsA > 0 ? `+${hole.pointsA}` : hole.pointsA.toString();
      
      // Crear división inferior (puntos equipo B)
      const bottomDiv = document.createElement('div');
      bottomDiv.className = 'score-bottom';
      bottomDiv.style.background = r.pairB.color;
      bottomDiv.style.color = '#fff';
      bottomDiv.textContent = hole.pointsB > 0 ? `+${hole.pointsB}` : hole.pointsB.toString();
      
      td.appendChild(topDiv);
      td.appendChild(bottomDiv);
      scoreRow.appendChild(td);
    }

    // columna final vacía para que cuadre con "Puntaje"
    const lastTd = document.createElement('td');
    scoreRow.appendChild(lastTd);

    tbody.appendChild(scoreRow);

    table.appendChild(tbody);
    tableContainer.appendChild(table);
    tableBlock.appendChild(tableContainer);

    matchupsContainer.appendChild(tableBlock);
  }

  const signoDinero = totalSaldoUserDinero >= 0 ? '+' : '';
  const signoPuntos = totalSaldoUserPuntos >= 0 ? '+' : '';

  const textoSaldo = totalSaldoUserDinero >= 0 ? 'Tiene a favor' : 'Debe';
  const signo = totalSaldoUserDinero >= 0 ? '+' : '';
  const valorAbsoluto = Math.abs(totalSaldoUserDinero).toFixed(2);
  
  miSaldoEl.innerHTML = `
    <div style="font-size: 1.4rem; font-weight: 900; margin-bottom: 5px;">
      ${signo}$${valorAbsoluto} MXN
    </div>
    <div style="font-size: 0.9rem; opacity: 0.8;">
      ${textoSaldo}
    </div>
  `;
  miSaldoEl.style.background = totalSaldoUserDinero>=0?'linear-gradient(90deg,#e6ffe6,#b3ffb3)':'linear-gradient(90deg,#ffe6e6,#ffb3b3)';
  miSaldoEl.style.color = totalSaldoUserDinero>=0?'#007f00':'#cc0000';
  miSaldoEl.style.padding='15px';
  miSaldoEl.style.border = totalSaldoUserDinero>=0?'2px solid #007f00':'2px solid #cc0000';
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
      <div style="font-weight: 700; color: var(--green-1); margin-bottom: 8px; font-size: 1.1rem;">
        Juego ID: ${juegoId}
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;">
        <span style="background: #e3f2fd; padding: 4px 10px; border-radius: 6px; font-size: 0.9rem;">
          Parejas: <strong>${pairs.length}</strong>
        </span>
        <span style="background: #e8f5e8; padding: 4px 10px; border-radius: 6px; font-size: 0.9rem;">
          Front9: $${prices.front9}
        </span>
        <span style="background: #f3e5f5; padding: 4px 10px; border-radius: 6px; font-size: 0.9rem;">
          Back9: $${prices.back9}
        </span>
        <span style="background: #fff3e0; padding: 4px 10px; border-radius: 6px; font-size: 0.9rem;">
          General: $${prices.general}
        </span>
      </div>
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
