/* Vida Loka — depois do pagamento: confirma com o servidor e inicia o download do .exe e do .apk */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var id = new URLSearchParams(location.search).get('session_id');
  var title = $('title'), sub = $('sub'), state = $('state'), stateText = $('state-text'), msg = $('dl-msg'), btns = $('dl-buttons'), tips = $('tips');
  var LABEL = { exe: '.exe', apk: '.apk' };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var url = function (kind) { return '/api/download/' + kind + '?session_id=' + encodeURIComponent(id); };

  function fail(text) {
    title.textContent = 'Não foi possível confirmar'; sub.textContent = '';
    state.className = 'state err'; stateText.textContent = text;
    btns.hidden = false; btns.innerHTML = '<a class="btn" href="index.html">Voltar para a loja</a>';
  }

  function startDownload(kind) {
    var f = document.createElement('iframe'); f.hidden = true; f.src = url(kind); document.body.appendChild(f);
    setTimeout(function () { f.remove(); }, 120000);
  }

  function manualButtons(files) {
    btns.innerHTML = ''; btns.hidden = false;
    ['exe', 'apk'].forEach(function (k) {
      if (!files[k]) return;
      var a = document.createElement('a'); a.className = 'btn'; a.href = url(k); a.textContent = 'Baixar ' + LABEL[k]; btns.appendChild(a);
    });
  }

  async function done(s) {
    var files = s.files || {}, kinds = ['exe', 'apk'].filter(function (k) { return files[k]; });
    title.textContent = 'Pagamento confirmado'; sub.textContent = 'Obrigado por comprar Vida Loka. Bem-vindo a Balakar!';
    state.className = 'state ok'; tips.hidden = false;
    if (!kinds.length) {
      stateText.textContent = 'Os arquivos do jogo ainda não estão disponíveis para download. Seu pagamento está registrado; fale com o suporte para receber os arquivos.';
      return;
    }
    manualButtons(files);
    var key = 'vl-dl-' + id, already = false;
    try { already = sessionStorage.getItem(key) === '1'; } catch (e) { /* sem storage */ }
    if (already) { stateText.textContent = 'Os downloads já foram iniciados nesta página. Se precisar, baixe de novo:'; return; }
    stateText.textContent = 'Iniciando os downloads…';
    for (var i = 0; i < kinds.length; i++) { startDownload(kinds[i]); if (i < kinds.length - 1) await sleep(1500); }
    try { sessionStorage.setItem(key, '1'); } catch (e) { /* sem storage */ }
    msg.hidden = false;
    msg.textContent = kinds.length === 2 ? 'APK E .exe iniciados.' : LABEL[kinds[0]] + ' iniciado.';
    stateText.textContent = kinds.length === 2 ? 'Se algum download não começar, use os botões abaixo.'
      : 'O arquivo ' + (kinds[0] === 'exe' ? '.apk' : '.exe') + ' ainda não está disponível. Fale com o suporte para recebê-lo.';
  }

  var tries = 0;
  async function check() {
    try {
      var r = await fetch('/api/order-status?session_id=' + encodeURIComponent(id));
      var s = await r.json().catch(function () { return {}; });
      if (!r.ok) return fail(s.error || 'Pedido não encontrado.');
      if (s.paid) return done(s);
      if (s.status === 'open') return fail('O pagamento não foi concluído. Volte para a loja e tente de novo.');
      // pago mas ainda compensando (ex.: boleto): fica verificando
      stateText.textContent = 'Pagamento recebido, aguardando a confirmação do banco. Esta página verifica sozinha.';
      if (++tries < 120) setTimeout(check, 5000); else fail('A confirmação está demorando. Guarde o link desta página e volte mais tarde.');
    } catch (e) { console.error(e); fail('Não foi possível falar com o servidor. Recarregue a página.'); }
  }

  if (!id) fail('Link inválido: faltou o código do pedido.'); else check();
})();
