import { db } from './firebase-config.js';
import { collection, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

document.getElementById('saveBtn').addEventListener('click', async () => {
  const playerName = document.getElementById('playerName').value.trim();

  if (playerName === "") {
    alert("Por favor escribe un nombre válido.");
    return;
  }

  try {
    const docRef = await addDoc(collection(db, "players"), {
      name: playerName,
      createdAt: new Date()
    });

    console.log(`Jugador guardado con ID: ${docRef.id}`);
    alert(`Jugador "${playerName}" guardado en Firestore ✅`);
    document.getElementById('playerName').value = "";

  } catch (e) {
    console.error("Error adding document: ", e);
    alert("Hubo un error. Revisa la consola.");
  }
});
