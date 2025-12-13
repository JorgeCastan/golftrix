// handicap.js
// Módulo para calcular y guardar handicap automáticamente
// Uso: import { calculateAndSaveHandicap } from './handicap.js';
// calculateAndSaveHandicap(); // usa user actual
// o calculateAndSaveHandicap('DqtCvdK4bPTY4pwdJc04kVNHoGv1');

import { app, db } from './firebase-config.js';
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/**
 * Verifica que scores contenga los hoyos 1..18 (exactamente o al menos todos los 1..18)
 * @param {Array} scores - array de objetos {hoyo: number, golpes: number, ...}
 * @returns {boolean}
 */
function hasComplete18(scores) {
  if (!Array.isArray(scores)) return false;
  const found = new Set();
  for (const s of scores) {
    if (typeof s?.hoyo === 'number' && typeof s?.golpes === 'number') {
      found.add(s.hoyo);
    }
  }
  // exige que estén todos los hoyos del 1 al 18
  for (let i = 1; i <= 18; i++) {
    if (!found.has(i)) return false;
  }
  return true;
}

/**
 * Calcula el total de golpes de una tarjeta, sumando golpes de hoyos 1..18.
 * Asume que has validado la tarjeta con hasComplete18().
 */
function totalFromScores(scores) {
  // crear arreglo indexado por hoyo
  const map = new Map();
  for (const s of scores) {
    map.set(s.hoyo, Number(s.golpes) || 0);
  }
  let total = 0;
  for (let i = 1; i <= 18; i++) {
    total += map.get(i) || 0;
  }
  return total;
}

/**
 * Recupera las últimas tarjetas completas del usuario (máximo `limitCount`, por defecto 10).
 * Busca por ownerUid y ordena por createdAt desc (timestamp Firebase).
 */
async function fetchLatestCompleteCards(uid, limitCount = 10) {
  const tarjetasCol = collection(db, 'tarjetas');
  
  // SOLUCIÓN SIMPLE: Usar createdAt que SIEMPRE existe
  // Ordenamos por createdAt descendente (Firestore Timestamp)
  const q = query(
    tarjetasCol,
    where('ownerUid', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(limitCount * 2) // Traer un poco más por si algunas no son válidas
  );

  const snap = await getDocs(q);
  const cards = [];
  
  snap.forEach(docSnap => {
    const data = docSnap.data();
    if (hasComplete18(data.scores)) {
      // Usar createdAt siempre disponible
      let fechaMillis = 0;
      if (data.createdAt && data.createdAt.toMillis) {
        fechaMillis = data.createdAt.toMillis();
      }
      
      cards.push({
        id: docSnap.id,
        total: totalFromScores(data.scores),
        createdAtMillis: fechaMillis,
        raw: data
      });
    }
  });
  
  // Ya están ordenadas por createdAt desc, pero por seguridad ordenamos
  cards.sort((a, b) => b.createdAtMillis - a.createdAtMillis);
  
  // Devolver máximo limitCount
  return cards.slice(0, limitCount);
}

/**
 * Calcula handicap según las reglas:
 * - Tomar últimas 10 tarjetas completas
 * - Descartar la mayor y la menor por total
 * - Promediar las 8 restantes y redondear (decimales <0.5 hacia abajo, >=0.5 hacia arriba)
 * Devuelve objeto {ok: boolean, handicap: number|null, message: string, missing: number}
 */
async function computeHandicapForUid(uid) {
  const cards = await fetchLatestCompleteCards(uid, 10);

  if (cards.length < 10) {
    const missing = 10 - cards.length;
    return { ok: false, handicap: null, message: `Faltan ${missing} tarjetas completas.`, missing, openForm: true };
  }

  // -----------------------------------------------
  // NUEVA LÓGICA DEL HANDICAP (HOYO X HOYO + RATING)
  // -----------------------------------------------

  // Para cada tarjeta debemos:
  // 1. Obtener campoId → cargar documento del campo
  // 2. Aplicar máximo por hoyo = parHoyo + 2
  // 3. Sumar 18 hoyos ajustados
  // 4. Restar rating según salida ("rojas", "blancas", "azules")

  // Pre-cargar todos los campos que aparezcan en las 10 tarjetas
  const campoIdsUnicos = [...new Set(cards.map(c => c.raw.campoId))];
  const camposMap = {};

  for (const cid of campoIdsUnicos) {
    if (!cid) continue;
    const ref = doc(db, "camposGolf", cid);
    const snapCampo = await getDoc(ref);
    if (snapCampo.exists()) {
      camposMap[cid] = snapCampo.data();
    }
  }

  // Verificar que todas las tarjetas tengan campo válido con paresHoyo y ratings
  // Primero verificar todas las tarjetas
  for (const c of cards) {
    const campo = camposMap[c.raw.campoId];
    if (!campo || !Array.isArray(campo.paresHoyo) || campo.paresHoyo.length < 18) {
      return { ok: false, handicap: null, message: `El campo de la tarjeta ${c.id} no tiene información válida de pares.` };
    }
    const salida = c.raw.salida;
    const salidaLower = salida ? salida.toLowerCase() : '';
    if (!["rojas", "blancas", "azules"].includes(salidaLower)) {
      return { ok: false, handicap: null, message: `La tarjeta ${c.id} no tiene salida válida.` };
    }
    if (campo[`rating_${salidaLower}`] == null) {
      return { ok: false, handicap: null, message: `El campo para la tarjeta ${c.id} no tiene rating para la salida ${salidaLower}.` };
    }
    // Guardar salidaLower en el objeto raw para usarlo después
    c.raw.salidaLower = salidaLower;
  }
  // Calcular diferencia nueva por tarjeta
  const diffs = [];

  for (const c of cards) {
    const campo = camposMap[c.raw.campoId];
        const salidaLower = c.raw.salidaLower || (c.raw.salida ? c.raw.salida.toLowerCase() : 'blancas');
    const rating = Number(campo[`rating_${salidaLower}`]);

    // preparar mapa hoyo → golpes reales
    const mapGolpes = new Map();
    for (const h of c.raw.scores) {
      mapGolpes.set(h.hoyo, Number(h.golpes) || 0);
    }

    // sumar 18 hoyos ajustados
    let totalAjustado = 0;
    for (let h = 1; h <= 18; h++) {
      const golpes = mapGolpes.get(h) || 0;
      const par = Number(campo.paresHoyo[h - 1]) || 0;
      const maxPermitido = par + 2;
      const golpeAjustado = Math.min(golpes, maxPermitido);
      totalAjustado += golpeAjustado;
    }

    const diff = totalAjustado - rating;

    diffs.push({
      id: c.id,
      diff,
      createdAtMillis: c.createdAtMillis
    });
  }

  // ordenar por createdAtMillis desc ya se hizo en fetch; pero mantenemos orden relativo
  // construir array de solo diffs (en el mismo orden temporal)
  const diffValues = diffs.map(d => d.diff);

  // -----------------------------------------------
  // DESCARTAR 2 DIFERENCIAS MÁS ALTAS Y 2 MÁS BAJAS
  // -----------------------------------------------

  const sortedDiffs = diffs.map(d => d.diff).sort((a, b) => a - b);

  // Necesitamos exactamente 10 diferencias
  if (sortedDiffs.length !== 10) {
    return { ok: false, handicap: null, message: `Error interno: no hay 10 diferencias.` };
  }

  // descartar 2 más bajas y 2 más altas
  const remaining = sortedDiffs.slice(2, 10 - 2); // deja 6

  if (remaining.length !== 6) {
    return { ok: false, handicap: null, message: `Error interno: no quedan 6 tarjetas tras descartar.` };
  }

    const sum = remaining.reduce((s, x) => s + x, 0);
    const avg = sum / remaining.length;
    const rounded = Math.round(avg); // redondeo .5 hacia arriba

    const handicapSigned = rounded >= 0 ? `+${rounded}` : `${rounded}`;

    return { ok: true, handicap: rounded, handicapSigned, message: 'Handicap calculado correctamente.', missing: 0 };
  }

/**
 * Calcula y guarda el handicap en users/{uid}.handicap
 * Si el usuario tiene menos de 10 tarjetas, devuelve el número faltante (no guarda)
 * @param {string|null} userUid
 */
export async function calculateAndSaveHandicap(userUid = null) {
  const auth = getAuth(app);

  let uid = userUid;
  if (!uid) {
    const user = auth.currentUser;
    if (!user) {
      // Intentar esperar a que se autentique (si el llamador no paso uid, recomendamos pasar uid)
      return new Promise((resolve, reject) => {
        const unsub = onAuthStateChanged(auth, async (u) => {
          unsub();
          if (!u) return reject(new Error('No hay usuario autenticado.'));
          try {
            const res = await _calcAndSave(u.uid);
            resolve(res);
          } catch(err) {
            reject(err);
          }
        });
      });
    } else {
      uid = user.uid;
    }
  }
  return _calcAndSave(uid);
}

async function _calcAndSave(uid) {
  const result = await computeHandicapForUid(uid);
  if (!result.ok) {
    // no guarda; retorna info con missing
    return result;
  }
  // Guardar en users/{uid}.handicap y users/{uid}.handicapSigned (string con signo)
  try {
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
      handicap: result.handicap,
      handicapSigned: result.handicapSigned || (result.handicap >= 0 ? `+${result.handicap}` : `${result.handicap}`),
      lastHandicapUpdated: serverTimestamp()
    });
    return { ...result, saved: true };
  } catch (err) {
    // si algo falla al intentar update (doc no existe o permisos), reintentar el mismo update (no usamos setDoc para no sobrescribir)
    try {
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, {
        handicap: result.handicap,
        handicapSigned: result.handicapSigned || (result.handicap >= 0 ? `+${result.handicap}` : `${result.handicap}`),
        lastHandicapUpdated: serverTimestamp()
      });
      return { ...result, saved: true };
    } catch (err2) {
      console.error('Error guardando handicap:', err2);
      return { ok: false, handicap: null, message: 'Error guardando handicap', error: err2 };
    }
  }
}
