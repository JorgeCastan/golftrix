// update_ratings.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Configuración de Firebase (reemplaza con la tuya si ya la tienes)
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};

// Inicializa Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// FUNCION PARA AGREGAR LOS CAMPOS
async function actualizarRatings() {
  const refCampo = doc(db, "camposGolf", "club_de_golf_las_fuentes");

  try {
    await updateDoc(refCampo, {
      rating_azules: 65.2,
      rating_blancas: 63.2,
      raiting_rojas: 65.4
    });

    console.log("Ratings actualizados correctamente 👍");
  } catch (error) {
    console.error("Error actualizando ratings:", error);
  }
}

// EJECUTA LA FUNCIÓN
actualizarRatings();
