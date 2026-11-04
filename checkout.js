/* Vida Loka — página de pagamento: Stripe Checkout, formulário embutido (ui_mode "form") */
(function () {
  'use strict';
  var statusEl = document.getElementById('pay-status');
  var loadingEl = document.getElementById('pay-loading');

  function showError(msg) {
    loadingEl.hidden = true; statusEl.hidden = false; statusEl.textContent = msg;
  }

  // visual do formulário, definido no Checkout Studio
  var appearance = {
    theme: 'night', labels: 'auto', inputs: 'spaced',
    variables: {
      borderRadius: '4px', colorBackground: '#ffffff', colorDanger: '#df1b41', colorPrimary: '#0570de',
      colorSuccess: '#00c853', colorText: '#30313d', fontFamily: 'default', fontSizeBase: '16px', spacingUnit: '4px'
    }
  };

  async function start() {
    if (typeof Stripe === 'undefined') throw new Error('Não foi possível carregar o Stripe. Verifique sua conexão e recarregue a página.');

    var cfgRes = await fetch('/api/config');
    var cfg = await cfgRes.json().catch(function () { return {}; });
    if (!cfgRes.ok || !cfg.publishableKey) throw new Error(cfg.error || 'O pagamento ainda não foi configurado nesta loja.');
    var stripe = Stripe(cfg.publishableKey);

    var res = await fetch('/api/create-checkout-session', { method: 'POST' });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || !data.client_secret) throw new Error(data.error || 'Não foi possível iniciar o pagamento. Tente de novo em instantes.');

    var checkout = stripe.initCheckoutFormSdk({ clientSecret: data.client_secret, appearance: appearance });
    var form = checkout.createForm({ layout: 'expanded' });
    form.mount('#checkout-form');
    loadingEl.hidden = true;

    var loadActionsResult = await checkout.loadActions();
    if (loadActionsResult.type !== 'success') throw new Error('O formulário de pagamento não carregou. Recarregue a página.');
    form.on('confirm', async function (event) {
      try {
        await loadActionsResult.actions.confirm({ formConfirmEvent: event });
      } catch (error) {
        console.error('Payment confirmation error:', error);
        showError('Não foi possível confirmar o pagamento. Confira os dados e tente de novo.');
      }
    });
  }

  start().catch(function (err) { console.error(err); showError(err.message || 'Algo deu errado. Recarregue a página.'); });
})();
