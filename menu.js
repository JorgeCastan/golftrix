// menu.js
const hamburger = document.getElementById('hamburger');
const sidebarMobile = document.getElementById('sidebarMobile');

if (hamburger) {
  hamburger.addEventListener('click', () => {
    sidebarMobile.classList.toggle('open');
  });
}

if (sidebarMobile) {
  sidebarMobile.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      sidebarMobile.classList.remove('open');
    });
  });
}

// Lógica cerrar sesión Firebase
import { app } from './firebase-config.js';
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const auth = getAuth(app);

const logoutDesktop = document.getElementById('logoutDesktop');
const logoutMobile = document.getElementById('logoutMobile');

if (logoutDesktop) {
  logoutDesktop.addEventListener('click', async (e) => {
    e.preventDefault();
    await signOut(auth);
    window.location.href = "index.html";
  });
}

if (logoutMobile) {
  logoutMobile.addEventListener('click', async (e) => {
    e.preventDefault();
    await signOut(auth);
    window.location.href = "index.html";
  });
}
