// menu.js
const hamburger = document.getElementById('hamburger');
const sidebarMenu = document.getElementById('sidebarMenu');

if (hamburger && sidebarMenu) {
  hamburger.addEventListener('click', () => {
    sidebarMenu.classList.toggle('open');
  });

  sidebarMenu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      sidebarMenu.classList.remove('open');
    });
  });
}

// Firebase cerrar sesión
import { app } from './firebase-config.js';
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const auth = getAuth(app);
const logoutBtn = document.getElementById('logoutBtn');

if (logoutBtn) {
  logoutBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    await signOut(auth);
    window.location.href = "index.html";
  });
}
