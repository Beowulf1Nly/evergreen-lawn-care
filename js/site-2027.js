/* Evergreen Lawn Care public site, 2027 look. Shared by index.html and the city pages.
   Everything follows the growth funnel switch in /js/growth-flag.js:
     window.EVG_GROWTH_FUNNEL === true  -> address form and "See your price" go to /get-price.html
                                           (address, zip and the ad tags ride along; get-price fetches the price)
     anything else (as shipped)         -> today's free-estimate path: the estimate form on the home page
                                           (prefilled with the address and ZIP), /index.html?quote=1 elsewhere.
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

  // "See your price" links
  var ctas = document.querySelectorAll('a[data-cta="price"]');
  for (var i = 0; i < ctas.length; i++) {
    var a = ctas[i];
    if (on) { a.href = priceUrl; a.setAttribute('data-cta-mode', 'price'); continue; }
    a.href = '/index.html?quote=1';
    a.setAttribute('data-cta-mode', 'estimate');
    a.addEventListener('click', function (e) { if (openEstimate('', '')) e.preventDefault(); });
  }

  // Address forms (home hero, city heroes): street address + ZIP + "See my price"
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

  // Home page opened from a city page's form with the switch OFF: /index.html?quote=1&prefill_address=...&prefill_zip=...
  // The page's own ?quote=1 handler opens the estimate form on DOMContentLoaded; fill it right after.
  var sp = new URLSearchParams(location.search);
  if (sp.get('quote') === '1' && (sp.get('prefill_address') || sp.get('prefill_zip'))) {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(function () {
        var a = document.getElementById('q-address'), z = document.getElementById('q-zip');
        if (a && sp.get('prefill_address')) a.value = sp.get('prefill_address').slice(0, 200);
        if (z && sp.get('prefill_zip')) z.value = sp.get('prefill_zip').replace(/\D/g, '').slice(0, 5);
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
