# Testes no navegador (Playwright) com o Stripe.js SUBSTITUÍDO por um stub e a API do Stripe por um servidor falso.
# Isto prova o fluxo do SITE (carrossel, checkout -> confirmar -> obrigado -> downloads); NÃO prova o pagamento real no Stripe.
import json, subprocess, sys, time, os, re
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SHOT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/'
RESULTS = []
def check(name, ok, detail=''):
    RESULTS.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + name + (' — ' + str(detail) if detail != '' else '')); sys.stdout.flush()
STUB = r"""
window.__calls = [];
window.Stripe = function (pk) {
  __calls.push(['Stripe', pk]);
  return { initCheckoutFormSdk: function (o) {
    __calls.push(['init', o.clientSecret, o.appearance && o.appearance.theme]);
    return {
      createForm: function (opts) { __calls.push(['createForm', JSON.stringify(opts)]); var h = {};
        return { mount: function (sel) { __calls.push(['mount', sel]); document.querySelector(sel).innerHTML = '<button id="fake-pay" type="button">Pagar R$ 8,00</button>'; document.getElementById('fake-pay').onclick = function () { h.confirm && h.confirm({ fake: true }); }; },
                 on: function (ev, fn) { h[ev] = fn; } }; },
      loadActions: function () { var cs = o.clientSecret; return Promise.resolve({ type: 'success', actions: { confirm: function () { __calls.push(['confirm']); location.href = '/obrigado.html?session_id=' + cs.split('_secret_')[0]; return Promise.resolve(); } } }); }
    }; } };
};
"""
def stack(mode):
    p = subprocess.Popen(['node', os.path.join(HERE, 'mockstack.js'), mode], stdout=subprocess.PIPE, text=True)
    port = json.loads(p.stdout.readline())['port']; return p, 'http://127.0.0.1:%d' % port
def new_page(b, base, **kw):
    ctx = b.new_context(**kw); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    ctx.route('https://js.stripe.com/**', lambda r: r.fulfill(status=200, content_type='application/javascript', body=STUB))
    return ctx, pg, errs
with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    # ---------- página inicial (desktop) ----------
    proc, base = stack('paid')
    ctx, pg, errs = new_page(b, base, viewport={'width': 1440, 'height': 900})
    pg.goto(base + '/'); pg.wait_for_load_state('networkidle')
    check('home: logo carregou', pg.evaluate("(()=>{const i=document.querySelector('.logo img'); return i.complete && i.naturalWidth>0})()"))
    check('home: preço R$ 8,00 visível', pg.locator('.hero .price').inner_text().strip() == 'R$ 8,00')
    check('home: não mostra data de lançamento', not re.search(r'\d{2}/\d{2}/\d{4}|2026', pg.inner_text('body').replace('© Vantage Games', '')))
    bad = pg.evaluate("[...document.images].filter(i=>i.getAttribute('src')&&(!i.complete||i.naturalWidth===0)).map(i=>i.getAttribute('src'))")
    check('home: todas as imagens carregaram', not bad, bad)
    yt = pg.locator('footer a.yt')
    check('rodapé: link do YouTube correto', yt.get_attribute('href') == 'https://www.youtube.com/@VantageGamesOfficial')
    check('rodapé: botão é redondo (50%)', pg.evaluate("getComputedStyle(document.querySelector('footer a.yt')).borderRadius") == '50%')
    n = pg.locator('.slide').count(); mob = pg.locator('.slide.mobile').count(); pcn = pg.locator('.slide.pc').count()
    check('carrossel: telas de celular e de PC', n == 10 and mob == 5 and pcn == 5, '%d total, %d celular, %d PC' % (n, mob, pcn))
    pg.locator('#telas').scroll_into_view_if_needed(); pg.wait_for_timeout(400)
    x0 = pg.evaluate("document.querySelector('.track').scrollLeft")
    box = pg.locator('.track').bounding_box(); cx, cy = box['x'] + box['width'] / 2, box['y'] + 150
    pg.mouse.move(cx + 300, cy); pg.mouse.down(); pg.mouse.move(cx - 150, cy, steps=8); pg.mouse.up(); pg.wait_for_timeout(1800)
    x1 = pg.evaluate("document.querySelector('.track').scrollLeft")
    check('carrossel: arrastar com o mouse rola', x1 > x0 + 100, '%d -> %d' % (x0, x1))
    snapped = pg.evaluate("(()=>{const t=document.querySelector('.track'),f=t.children[0].offsetLeft;return [...t.children].some(s=>Math.abs((s.offsetLeft-f)-t.scrollLeft)<3)})()")
    check('carrossel: termina encaixado numa tela', snapped, pg.evaluate("(()=>{const t=document.querySelector('.track'),f=t.children[0].offsetLeft;return {sl:t.scrollLeft,offs:[...t.children].map(s=>s.offsetLeft-f)}})()"))
    d0 = pg.evaluate("[...document.querySelectorAll('.dots button')].findIndex(b=>b.getAttribute('aria-current')==='true')")
    pg.click('.nav.next'); pg.wait_for_timeout(900)
    d1 = pg.evaluate("[...document.querySelectorAll('.dots button')].findIndex(b=>b.getAttribute('aria-current')==='true')")
    check('carrossel: botão próximo avança', d1 == d0 + 1, '%d -> %d' % (d0, d1))
    pg.click('.dots button:nth-child(1)'); pg.wait_for_timeout(1200)
    check('carrossel: ponto 1 volta ao início', pg.evaluate("document.querySelector('.track').scrollLeft") < 3)
    pg.click('.slide:nth-child(1) img'); pg.wait_for_timeout(300)
    check('carrossel: clicar amplia a imagem', pg.evaluate("document.getElementById('lightbox').open"))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    check('trailer: elemento de vídeo com mp4 e poster', pg.evaluate("(()=>{const v=document.querySelector('video');return v.querySelector('source').getAttribute('src')==='media/trailer.mp4' && v.getAttribute('poster')==='media/poster.jpg'})()"))
    pg.screenshot(path=SHOT + 'site_home_desktop.png', full_page=True)
    pg.evaluate("window.scrollTo(0,0)"); pg.screenshot(path=SHOT + 'site_home_topo.png')
    pg.locator('#telas').scroll_into_view_if_needed(); pg.wait_for_timeout(300); pg.screenshot(path=SHOT + 'site_carrossel.png')
    # botão comprar -> checkout
    pg.locator('#comprar .btn').scroll_into_view_if_needed(); pg.screenshot(path=SHOT + 'site_comprar.png')
    check('botão Comprar Jogo fica no fim da página', pg.locator('.btn', has_text='Comprar Jogo').count() == 1 and pg.evaluate("document.querySelector('#comprar .btn').getBoundingClientRect().top > document.querySelector('#trailer').getBoundingClientRect().top"))
    pg.click('#comprar .btn'); pg.wait_for_url('**/checkout.html'); pg.wait_for_selector('#fake-pay', timeout=8000)
    calls = pg.evaluate("window.__calls")
    check('checkout: Stripe iniciado com a chave pública', ['Stripe', 'pk_test_PUBLICA123'] in calls, calls[0])
    init = [c for c in calls if c[0] == 'init'][0]
    check('checkout: initCheckoutFormSdk com clientSecret e tema night', init[1].startswith('cs_test_flow') and init[2] == 'night', init)
    check('checkout: createForm(layout expanded) e mount em #checkout-form', ['createForm', '{"layout":"expanded"}'] in calls and ['mount', '#checkout-form'] in calls)
    check('checkout: sem texto de "carregando" depois de montar', pg.locator('#pay-loading').is_hidden())
    pg.screenshot(path=SHOT + 'site_checkout.png')
    dls = []; pg.on('download', lambda d: dls.append(d))
    pg.click('#fake-pay'); pg.wait_for_url('**/obrigado.html?session_id=cs_test_flow*')
    for _ in range(60):
        if len(dls) >= 2: break
        pg.wait_for_timeout(250)
    names = sorted([d.suggested_filename for d in dls])
    check('obrigado: os dois downloads (.exe e .apk) começam', names == ['VidaLoka-Setup.exe', 'VidaLoka.apk'], names)
    sizes = {d.suggested_filename: os.path.getsize(d.path()) for d in dls}
    check('obrigado: arquivos baixados com o tamanho certo', sizes == {'VidaLoka-Setup.exe': 70002, 'VidaLoka.apk': 50002}, sizes)
    pg.wait_for_function("document.getElementById('dl-msg') && !document.getElementById('dl-msg').hidden", timeout=8000)
    check('obrigado: mensagem "APK E .exe iniciados."', pg.locator('#dl-msg').inner_text() == 'APK E .exe iniciados.')
    pg.screenshot(path=SHOT + 'site_obrigado.png')
    # recarregar não baixa de novo
    got = []; pg.on('download', lambda d: got.append(d)); pg.reload(); pg.wait_for_timeout(2500)
    check('obrigado: recarregar a página não reinicia os downloads', len(got) == 0 and pg.locator('#dl-buttons a').count() == 2)
    check('home/checkout/obrigado: sem erros no console', not errs, errs[:2])
    ctx.close(); proc.kill()
    # ---------- celular ----------
    proc, base = stack('paid')
    ctx, pg, errs = new_page(b, base, viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    pg.goto(base + '/'); pg.wait_for_load_state('networkidle')
    check('celular: sem rolagem horizontal na página', pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), pg.evaluate("document.documentElement.scrollWidth"))
    pg.screenshot(path=SHOT + 'site_celular_topo.png'); pg.screenshot(path=SHOT + 'site_celular_full.png', full_page=True)
    pg.locator('#telas').scroll_into_view_if_needed(); pg.wait_for_timeout(300); pg.screenshot(path=SHOT + 'site_celular_carrossel.png')
    pg.goto(base + '/checkout.html'); pg.wait_for_selector('#fake-pay'); pg.screenshot(path=SHOT + 'site_celular_checkout.png')
    check('celular: checkout sem rolagem horizontal', pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
    ctx.close(); proc.kill()
    # ---------- não pago ----------
    proc, base = stack('unpaid')
    ctx, pg, errs = new_page(b, base, viewport={'width': 1200, 'height': 800}, accept_downloads=True)
    got = []; pg.on('download', lambda d: got.append(d))
    pg.goto(base + '/checkout.html'); pg.wait_for_selector('#fake-pay'); pg.click('#fake-pay'); pg.wait_for_url('**/obrigado.html*'); pg.wait_for_timeout(2500)
    check('não pago: nenhuma tela de sucesso e nenhum download', len(got) == 0 and pg.locator('#dl-msg').is_hidden() and 'não foi concluído' in pg.inner_text('#state'), pg.inner_text('#state')[:80])
    pg.goto(base + '/obrigado.html'); pg.wait_for_timeout(500)
    check('sem session_id: mostra link inválido', 'Link inválido' in pg.inner_text('#state'))
    pg.goto(base + '/obrigado.html?session_id=cs_test_inventado123456'); pg.wait_for_timeout(800)
    check('pedido inexistente: mensagem de erro', 'não encontrado' in pg.inner_text('#state').lower(), pg.inner_text('#state')[:60])
    ctx.close(); proc.kill()
    # ---------- sem .apk ----------
    proc, base = stack('noapk')
    ctx, pg, errs = new_page(b, base, viewport={'width': 1200, 'height': 800}, accept_downloads=True)
    got = []; pg.on('download', lambda d: got.append(d.suggested_filename))
    pg.goto(base + '/checkout.html'); pg.wait_for_selector('#fake-pay'); pg.click('#fake-pay'); pg.wait_for_url('**/obrigado.html*'); pg.wait_for_function("!document.getElementById('dl-msg').hidden", timeout=8000)
    check('sem .apk: baixa só o .exe e avisa com honestidade', got == ['VidaLoka-Setup.exe'] and pg.locator('#dl-msg').inner_text() == '.exe iniciado.' and '.apk ainda não está disponível' in pg.inner_text('#state'), (got, pg.inner_text('#dl-msg'), pg.inner_text('#state')))
    ctx.close(); proc.kill()
    # ---------- sem chaves ----------
    proc, base = stack('nokeys')
    ctx, pg, errs = new_page(b, base, viewport={'width': 1200, 'height': 800})
    pg.goto(base + '/checkout.html'); pg.wait_for_timeout(1200)
    check('sem chaves: o checkout mostra erro claro (não fica carregando)', pg.locator('#pay-status').is_visible() and 'não foi configurado' in pg.inner_text('#pay-status') or 'STRIPE' in pg.inner_text('#pay-status'), pg.inner_text('#pay-status')[:90])
    ctx.close(); proc.kill()
    b.close()
print('\n==== %d/%d testes passaram ====' % (sum(RESULTS), len(RESULTS)))
sys.exit(0 if all(RESULTS) else 1)
