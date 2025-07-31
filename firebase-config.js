// firebase-config.js

// ✅ Importa desde CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ✅ Tu configuración actualizada
const firebaseConfig = {
  apiKey: "AIzaSyBBNwVOf-Y8KiAQgY1Cdes2rq-wr5UgZKU",
  authDomain: "golftrix-app.firebaseapp.com",
  projectId: "golftrix-app",
  storageBucket: "golftrix-app.appspot.com", // ✅ corregido
  messagingSenderId: "624453369444",
  appId: "1:624453369444:web:8f54831449650991f32971",
  measurementId: "G-KEKYKYY6KC"
};

// ✅ Inicializa la app
const app = initializeApp(firebaseConfig);

// ✅ Exporta los módulos que tu app usa
const db = getFirestore(app);
const storage = getStorage(app);
const auth = getAuth(app);

export { app, db, storage, auth };


