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
 * Busca por ownerUid y ordered by createdAtMillis desc.
 */
async function fetchLatestCompleteCards(uid, limitCount = 10) {
  const tarjetasCol = collection(db, 'tarjetas');
  // query por ownerUid y orderBy createdAtMillis descendente
  // Nota: Si no hay createdAtMillis en algunos documentos pueden no estar ordenados,
  // pero intentamos la mejor heurística: obtenemos más documentos (limitCount*2) y filtramos.
  const q = query(
    tarjetasCol,
    where('ownerUid', '==', uid),
    orderBy('createdAtMillis', 'desc'),
    limit(limitCount * 3) // traer más por si algunas no son válidas
  );

  const snap = await getDocs(q);
  const cards = [];
  snap.forEach(docSnap => {
    const data = docSnap.data();
    if (hasComplete18(data.scores)) {
      // total y fecha
      const total = totalFromScores(data.scores);
      // try get createdAtMillis else try createdAt (timestamp) else fallback 0
      const createdAtMillis = data.createdAtMillis
        || (data.createdAt && data.createdAt.toMillis && data.createdAt.toMillis())
        || 0;
      cards.push({
        id: docSnap.id,
        total,
        createdAtMillis,
        raw: data
      });
    }
  });

  // ordenar por createdAtMillis desc (por si no estava ordenado)
  cards.sort((a, b) => b.createdAtMillis - a.createdAtMillis);

  // devolver máximo limitCount
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
    return { ok: false, handicap: null, message: `Faltan ${missing} tarjetas completas.`, missing };
  }

  // tomar totales
  const totals = cards.map(c => c.total);
  // encontrar index de max y min una sola vez (si hay empates, elimina sólo uno de cada)
  let maxIndex = 0, minIndex = 0;
  for (let i = 1; i < totals.length; i++) {
    if (totals[i] > totals[maxIndex]) maxIndex = i;
    if (totals[i] < totals[minIndex]) minIndex = i;
  }

  // construir arreglo con 8 totales restantes
  const remaining = [];
  for (let i = 0; i < totals.length; i++) {
    if (i === maxIndex) { maxIndex = -1; continue; } // skip first max
    if (i === minIndex) { minIndex = -1; continue; } // skip first min
    remaining.push(totals[i]);
  }
  // En caso raro de que algo saliera mal: asegurar que haya 8
  if (remaining.length !== 8) {
    // si por redundancia no hay 8, intentar lógica alternativa: ordenar y tomar 2..9
    const sorted = totals.slice().sort((a,b)=>a-b);
    const alt = sorted.slice(1, 9);
    const avgAlt = alt.reduce((s,x)=>s+x,0)/alt.length;
    const handicapAlt = Math.round(avgAlt);
    return { ok: true, handicap: handicapAlt, message: 'Calculado con heurística alternativa (empates).', missing: 0 };
  }

  const sum = remaining.reduce((s, x) => s + x, 0);
  const avg = sum / remaining.length;
  const rounded = Math.round(avg); // aplica reglas de redondeo solicitadas

  return { ok: true, handicap: rounded, message: 'Handicap calculado correctamente.', missing: 0 };
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
  // Guardar en users/{uid}.handicap
  try {
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
      handicap: result.handicap,
      lastHandicapUpdated: serverTimestamp()
    });
    return { ...result, saved: true };
  } catch (err) {
    // si no existe el doc users quizá haya que setearlo (usa setDoc si quieres crear)
    try {
      // crear si no existe
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, {
        handicap: result.handicap,
        lastHandicapUpdated: serverTimestamp()
      });
      return { ...result, saved: true };
    } catch (err2) {
      console.error('Error guardando handicap:', err2);
      return { ok: false, handicap: null, message: 'Error guardando handicap', error: err2 };
    }
  }
}
