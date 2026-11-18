'use strict';
// Roda antes da primeira pintura.
// 1. Tema (sem piscar): claro (padrão do manual), escuro ou automático.
(function () {
  var t = 'claro'; try { t = localStorage.getItem('meutreino:tema') || 'claro'; } catch (e) { /* modo privado */ }
  document.documentElement.dataset.tema = t;
})();
// 2. O app não abre dentro de outro site (proteção contra "clickjacking"): se estiver num quadro, sai dele.
if (window.top !== window.self) {
  try { window.top.location.replace(window.location.href); } catch (e) { document.documentElement.style.display = 'none'; }
}
