/* Vida Loka — carrossel de telas (arrastar com o mouse, deslizar no toque, setas, pontos, ampliar ao clicar) */
(function () {
  'use strict';
  var root = document.querySelector('[data-carousel]');
  if (!root) return;
  var track = root.querySelector('.track');
  var slides = Array.prototype.slice.call(track.children);
  var prev = root.querySelector('.prev'), next = root.querySelector('.next'), dotsBox = root.querySelector('.dots');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var posOf = function (i) { return Math.max(0, slides[i].offsetLeft - slides[0].offsetLeft); };

  var dots = slides.map(function (s, i) {
    var b = document.createElement('button'); b.type = 'button';
    b.setAttribute('aria-label', 'Ir para a tela ' + (i + 1) + ' de ' + slides.length);
    b.addEventListener('click', function () { go(i); userTouched(); });
    dotsBox.appendChild(b); return b;
  });

  function current() {
    var x = track.scrollLeft, best = 0, bd = Infinity;
    for (var i = 0; i < slides.length; i++) { var d = Math.abs(posOf(i) - x); if (d < bd) { bd = d; best = i; } }
    return best;
  }
  function update() {
    var i = current(), max = track.scrollWidth - track.clientWidth - 2;
    dots.forEach(function (d, k) { d.setAttribute('aria-current', k === i ? 'true' : 'false'); });
    prev.disabled = track.scrollLeft <= 2; next.disabled = track.scrollLeft >= max;
  }
  function go(i) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    track.scrollTo({ left: posOf(i), behavior: reduce ? 'auto' : 'smooth' });
  }
  var raf = 0;
  track.addEventListener('scroll', function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; update(); }); }, { passive: true });
  window.addEventListener('resize', update);
  prev.addEventListener('click', function () { go(current() - 1); userTouched(); });
  next.addEventListener('click', function () { go(current() + 1); userTouched(); });
  track.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(current() + 1); userTouched(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(current() - 1); userTouched(); }
  });

  // arrastar com o mouse (no toque o próprio navegador já desliza)
  var down = false, dragging = false, sx = 0, sl = 0, moved = 0, pid = null;
  track.addEventListener('pointerdown', function (e) {
    moved = 0;
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    down = true; dragging = false; sx = e.clientX; sl = track.scrollLeft; pid = e.pointerId;
  });
  track.addEventListener('pointermove', function (e) {
    if (!down) return; var dx = e.clientX - sx; moved = Math.max(moved, Math.abs(dx));
    if (!dragging && moved > 4) {      // só vira "arrastar" depois de mexer um pouco: assim o clique simples continua chegando na imagem
      dragging = true; track.classList.add('dragging');
      try { track.setPointerCapture(pid); } catch (err) { /* sem captura */ }
    }
    if (dragging) track.scrollLeft = sl - dx;
  });
  function endDrag() {
    if (!down) return; var was = dragging; down = false; dragging = false; track.classList.remove('dragging');
    if (was) { userTouched(); go(current()); }
  }
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);

  // ampliar
  var box = document.getElementById('lightbox'), big = box && box.querySelector('img');
  track.addEventListener('click', function (e) {
    if (moved > 6) { moved = 0; return; }
    var fig = e.target.closest ? e.target.closest('.slide') : null;
    if (!fig || !box || !box.showModal) return;
    var img = fig.querySelector('img'); big.src = img.currentSrc || img.src; big.alt = img.alt; box.showModal();
  });
  if (box) {
    box.addEventListener('click', function () { box.close(); });
    box.addEventListener('close', function () { big.removeAttribute('src'); });
  }

  // passa sozinho de tempos em tempos; para quando a pessoa mexe, quando a aba some ou quando prefere menos movimento
  var lastTouch = 0, visible = false, timer = null;
  function userTouched() { lastTouch = Date.now(); }
  ['pointerdown', 'wheel', 'touchstart', 'focusin'].forEach(function (ev) { root.addEventListener(ev, userTouched, { passive: true }); });
  if (!reduce && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (en) { visible = en[0].isIntersecting; }, { threshold: .5 }).observe(root);
    timer = setInterval(function () {
      if (!visible || document.hidden || down || (box && box.open) || Date.now() - lastTouch < 9000) return;
      var i = current(), last = track.scrollLeft >= track.scrollWidth - track.clientWidth - 2;
      go(last ? 0 : i + 1);
    }, 4500);
  }
  update();
})();
