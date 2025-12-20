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
  const priceInput = document.getElementById('priceInput');
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
      // detect possible keys for ventajas por genero (tolerante)
      const vantM = Array.isArray(cdata.ventajasM) ? cdata.ventajasM
                    : Array.isArray(cdata.ventajas_m) ? cdata.ventajas_m
                    : Array.isArray(cdata.ventajasMale) ? cdata.ventajasMale
                    : Array.isArray(cdata.advantagesMale) ? cdata.advantagesMale
                    : Array.isArray(cdata.ventajasHombre) ? cdata.ventajasHombre
                    : null;
      const vantF = Array.isArray(cdata.ventajasF) ? cdata.ventajasF
                    : Array.isArray(cdata.ventajas_f) ? cdata.ventajas_f
                    : Array.isArray(cdata.ventajasFemale) ? cdata.ventajasFemale
                    : Array.isArray(cdata.advantagesFemale) ? cdata.advantagesFemale
                    : Array.isArray(cdata.ventajasMujer) ? cdata.ventajasMujer
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
      pill.querySelector('button').addEventListener('click', ()=> { pairs.splice(idx,1); renderPairsList(); });
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
  });

  refreshBtn.addEventListener('click', async ()=>{ await initAll(); });

startGameBtn.addEventListener("click", async () => {
  try {
    if (!juegoId) { console.error("Faltan datos: juegoId"); return; }
    if (!grupoId) await ensureGrupoId();

    const foursomeRef = doc(db, "juego_foursomes", juegoId);
    const foursomeSnap = await getDoc(foursomeRef);

    if (foursomeSnap.exists()) {
      const jfData = foursomeSnap.data();
      pairs = Array.isArray(jfData?.pairs) ? jfData.pairs : [];
      priceInput.value = jfData?.price || '';
    } else {
      await setDoc(foursomeRef, {
        juegoId,
        grupoId,
        price: priceInput.value || '',
        pairs: pairs || [],
        createdAt: serverTimestamp(),
      });
    }

    // reasignar myPair
    if(currentUser){
      myPair = pairs.find(p => p.p1Uid === currentUser.uid || p.p2Uid === currentUser.uid) || null;
    }

    gameArea.style.display = 'block';
    document.querySelector('.card').style.display = 'none';
    gameMeta.innerText = `Juego ${juegoId} — Precio por pareja ${priceInput.value} — Parejas: ${pairs.length}`;

    await computeAndRenderAllMatchups(Number(priceInput.value), myPair);

  } catch (err) {
    console.error("Error al iniciar juego:", err);
  }
});


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
      if (typeof raw !== 'number') { result[i] = null; continue; }
      let adj = raw;
      const gender = genderOfUser(userData);
      const handicap = userData.handicap || 0;
      const vantArr = (gender === 'M') ? fieldVentajas.vantM : fieldVentajas.vantF;
      const v = Array.isArray(vantArr) ? (Number(vantArr[i]) || 0) : 0;
      // si handicap >= v entonces se resta 1 punto
      if (v && handicap >= v) adj = adj - 1;
      result[i] = adj;
    }
    return result;
  }
function getUserObj(uid) {
  return allUsers.find(u=>u.id===uid) || { handicap:0, gender:'M' };
}

  // compara 2 parejas: devuelve objeto con tabla por hoyo y suma de puntos por pareja (array [pointsA, pointsB])
  async function computeMatchup(pairA, pairB, price) {
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

    for (let h = 0; h < 18; h++) {
      const scoresA = [a1Arr[h], a2Arr[h]].filter(x=>typeof x==='number');
      const scoresB = [b1Arr[h], b2Arr[h]].filter(x=>typeof x==='number');

      let ptsA=0, ptsB=0;

      if (scoresA.length && scoresB.length) {
        const lowA = Math.min(...scoresA);
        const highA = Math.max(...scoresA);
        const lowB = Math.min(...scoresB);
        const highB = Math.max(...scoresB);

        if(lowA < lowB) ptsA++; else if(lowB < lowA) ptsB++;
        if(highA < highB) ptsA++; else if(highB < highA) ptsB++;
      }

      totalA += ptsA;
      totalB += ptsB;

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

    return {
      pairA, pairB, holes,
      totalPointsA: totalA,
      totalPointsB: totalB,
      saldo: totalA-totalB,
      price
    };
  }

  async function computeAndRenderAllMatchups(price, myPair) {
  matchupsContainer.innerHTML = '';

  if(!pairs || pairs.length<2) return;

  // generar matchups: si myPair existe, solo vs otros
  const matchupPairs = myPair ? pairs.filter(p => p.id !== myPair.id) : pairs;
  const matchups = [];

  for(const p of matchupPairs){
    if(myPair){
      matchups.push(await computeMatchup(myPair, p, price));
    } else {
      for(let i=0;i<pairs.length;i++){
        for(let j=i+1;j<pairs.length;j++){
          matchups.push(await computeMatchup(pairs[i], pairs[j], price));
        }
      }
      break;
    }
  }

  // calcular saldo total estimado del usuario actual
  let totalSaldoUser = 0;
  matchups.forEach(r=>{
    if(currentUser){
      const uid = currentUser.uid;
      const userInA = r.pairA.p1Uid === uid || r.pairA.p2Uid === uid;
      const userInB = r.pairB.p1Uid === uid || r.pairB.p2Uid === uid;
      let delta = 0;
      if(userInA) delta = r.totalPointsA - r.totalPointsB;
      else if(userInB) delta = r.totalPointsB - r.totalPointsA;
      totalSaldoUser += delta;
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
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="width:18px;height:18px;border-radius:50%;background:${r.pairA.color};"></div>
        Equipo A: ${getUserName(r.pairA.p1Uid)} & ${getUserName(r.pairA.p2Uid)} (Pts: ${r.totalPointsA})
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="width:18px;height:18px;border-radius:50%;background:${r.pairB.color};"></div>
        Equipo B: ${getUserName(r.pairB.p1Uid)} & ${getUserName(r.pairB.p2Uid)} (Pts: ${r.totalPointsB})
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

  miSaldoEl.textContent = `Saldo total estimado: ${totalSaldoUser>=0?'+':''}${totalSaldoUser}`;
  miSaldoEl.style.background = totalSaldoUser>=0?'linear-gradient(90deg,#e6ffe6,#ddffdd)':'linear-gradient(90deg,#ffe6e6,#ffdede)';
  miSaldoEl.style.color = totalSaldoUser>=0?'green':'red';
  miSaldoEl.style.padding='8px';
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
        priceInput.value = jfData?.price || '';
        renderPairsList();

        // asignar myPair solo si currentUser existe
        if(currentUser){
          myPair = pairs.find(p => p.p1Uid === currentUser.uid || p.p2Uid === currentUser.uid) || null;
        }

        if(pairs.length>0 && priceInput.value && myPair){
          gameArea.style.display = 'block';
          document.querySelector('.card').style.display = 'none'; // ocultar form
          gameMeta.innerText = `Juego ${juegoId} — Precio por pareja ${priceInput.value} — Parejas: ${pairs.length}`;
          await computeAndRenderAllMatchups(Number(priceInput.value), myPair);
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

