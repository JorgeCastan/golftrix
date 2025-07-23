// firebase-config.js

// Importa Firebase App y Firestore desde la CDN oficial
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Tu configuración real de Golftrix
const firebaseConfig = {
  apiKey: "AIzaSyBF6hDLo2-llMoFO35IMI1yK0bjOwJzjoY",
  authDomain: "golftrix-880ec.firebaseapp.com",
  projectId: "golftrix-880ec",
  storageBucket: "golftrix-880ec.appspot.com",
  messagingSenderId: "49591102374",
  appId: "1:49591102374:web:41565ee078b090067d3d67",
  measurementId: "G-DH1Q8SDMPM"
};

// Inicializa la app
const app = initializeApp(firebaseConfig);

// Inicializa Firestore (Base de datos)
const db = getFirestore(app);

// Exporta `db` para usarlo en otros archivos
export { db };
