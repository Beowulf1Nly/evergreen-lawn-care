/* Evergreen public site (2027 look). Follows the switch in /js/growth-flag.js; wording and behaviour flip together.
   ON: [data-flag=on] wording ("See your price"), CTAs and the address form go to /get-price.html (ad tags kept).
   OFF (as shipped): [data-flag=off] wording ("Get my free quote"); CTAs land on the address form (#price here, /#price
   elsewhere) below the sticky header with the address focused; the form opens the free-estimate form, prefilled.
   Nothing here can start a plan signup or a checkout while the switch is off. */
(function () {
  var on = window.EVG_GROWTH_FUNNEL === true;
  // ad and referral tags from the landing URL (utm_*, gclid, gbraid, wbraid, fbclid, src, ref)
  var keep = new URLSearchParams();
  try {
    new URLSearchParams(location.search).forEach(function (v, k) { if (/^(utm_[a-z_]+|gclid|gbraid|wbraid|fbclid|src|ref)$/.test(k) && v) keep.set(k, v.slice(0, 120)); });
  } catch (e) {}
  var carry = keep.toString();
  var priceUrl = '/get-price.html' + (carry ? '?' + carry : '');
  var i, el, fl = document.querySelectorAll('[data-flag]');
  for (i = 0; i < fl.length; i++) fl[i].hidden = (fl[i].getAttribute('data-flag') === 'on') !== on;
  var form = document.querySelector('form[data-addr-form]');
  if (on && form && form.getAttribute('data-aria-on')) form.setAttribute('aria-label', form.getAttribute('data-aria-on'));
  // address form fully in view below the sticky header, street address focused
  function toForm() {
    var hd = document.querySelector('.s27-hd'), top = form.getBoundingClientRect().top + window.pageYOffset - (hd ? hd.offsetHeight : 0) - 16;
    window.scrollTo(0, Math.max(0, top));
    try { form.elements.address.focus({ preventScroll: true }); } catch (e) {}
  }
  function goForm(e) { if (form) { e.preventDefault(); toForm(); } }
  function openEstimate(addr, zip) {
    if (typeof window.openQuoteModal !== 'function') return false;
    window.openQuoteModal();
    var a = document.getElementById('q-address'), z = document.getElementById('q-zip');
    if (a && addr) a.value = addr;
    if (z && zip) z.value = zip;
    var next = document.getElementById(addr && zip ? 'lq-name' : 'q-address');
    if (next && next.offsetParent) try { next.focus({ preventScroll: true }); } catch (e) {}
    return true;
  }

  // CTA links (header, closing band, footer, sticky bar, faq/about/404/free-lawn) and in-page "#price" buttons
  var ctas = document.querySelectorAll('a[data-cta="price"], a[href="#price"]');
  for (i = 0; i < ctas.length; i++) {
    el = ctas[i];
    if (el.getAttribute('data-cta') === 'price') {
      if (on) { el.href = priceUrl; el.setAttribute('data-cta-mode', 'price'); continue; }
      el.setAttribute('href', form ? '#price' : (carry ? '/?' + carry : '/') + '#price');
      el.setAttribute('data-cta-mode', 'quote');
    }
    el.addEventListener('click', goForm);
  }
  // arriving on /#price (from a page without the form): land the form below the header, focused
  if (form && location.hash === '#price') { toForm(); window.addEventListener('load', toForm); }

  // Address forms (home hero, city heroes): street address + ZIP + "Get my free quote" ("See my price" when ON)
  var forms = document.querySelectorAll('form[data-addr-form]');
  for (var j = 0; j < forms.length; j++) (function (f) {
    var hid = f.querySelector('input[name="quote"]');
    f.setAttribute('action', on ? '/get-price.html' : '/index.html');
    f.setAttribute('data-form-mode', on ? 'price' : 'estimate');
    if (hid) hid.disabled = on;
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var addr = (f.elements.address.value || '').trim().slice(0, 200);
      var zip = (f.elements.zip.value || '').replace(/\D/g, '').slice(0, 5);
      var err = f.querySelector('.s27-addr-err');
      if (err) err.textContent = '';
      if (on) {
        if (!addr || zip.length !== 5) {
          if (err) err.textContent = 'Enter your street address and 5 digit ZIP.';
          (addr ? f.elements.zip : f.elements.address).focus();
          return;
        }
        var p = new URLSearchParams();
        p.set('address', addr); p.set('zip', zip);
        keep.forEach(function (v, k) { p.set(k, v); });
        location.assign('/get-price.html?' + p.toString());
        return;
      }
      // switch OFF: today's estimate form, with what they typed already filled in
      if (openEstimate(addr, zip)) return;
      var q = new URLSearchParams();
      q.set('quote', '1');
      if (addr) q.set('prefill_address', addr);
      if (zip) q.set('prefill_zip', zip);
      keep.forEach(function (v, k) { q.set(k, v); });
      location.assign('/index.html?' + q.toString());
    });
  })(forms[j]);

  // /index.html?quote=1 (city form with the switch OFF, old links): the page opens the estimate form; prefill and focus it
  var sp = new URLSearchParams(location.search);
  if (sp.get('quote') === '1') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(function () {
        var a = document.getElementById('q-address'), z = document.getElementById('q-zip');
        if (a && sp.get('prefill_address')) a.value = sp.get('prefill_address').slice(0, 200);
        if (z && sp.get('prefill_zip')) z.value = sp.get('prefill_zip').replace(/\D/g, '').slice(0, 5);
        var n = document.getElementById(a && a.value && z && z.value ? 'lq-name' : 'q-address');
        if (n && n.offsetParent) try { n.focus({ preventScroll: true }); } catch (e) {}
      }, 0);
    });
  }

  if (typeof window.toggleMobileMenu !== 'function') {
    window.toggleMobileMenu = function () {
      var b = document.getElementById('navHamburger'), n = document.getElementById('mobileNav');
      if (!b || !n) return;
      var open = n.classList.toggle('open');
      b.setAttribute('aria-expanded', String(open));
    };
  }
  if (typeof window.closeMobileMenu !== 'function') {
    window.closeMobileMenu = function () {
      var b = document.getElementById('navHamburger'), n = document.getElementById('mobileNav');
      if (n) n.classList.remove('open');
      if (b) b.setAttribute('aria-expanded', 'false');
    };
  }
  var y = document.getElementById('s27-year');
  if (y) y.textContent = new Date().getFullYear();
})();
