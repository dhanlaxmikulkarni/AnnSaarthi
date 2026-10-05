/* Google Translate (website translation widget). English is the source language.
   No API key or credentials are involved. If the script cannot load (offline, blocked), the app
   simply stays in English. */
const LANGS = ['en', 'mr', 'hi'];
const SCRIPT_URL = 'https://translate.google.com/translate_a/element.js?cb=__annsaarthiGTInit';
let ready = false;
let loading = false;
let wanted = 'en';

/* Never translate identifiers, token / receipt numbers, numerals. */
const NO_TRANSLATE = '.num,.token__num,.wall__tok,.token-slip__id,.console__token-id,.mono,code,[data-no-translate]';
export function markNoTranslate(root = document) {
  try {
    root.querySelectorAll(NO_TRANSLATE).forEach((el) => {
      if (el.getAttribute('translate') !== 'no') { el.setAttribute('translate', 'no'); el.classList.add('notranslate'); }
    });
  } catch (e) { /* ignore */ }
}

function setCookie(lang) {
  const v = lang === 'en' ? '' : `/en/${lang}`;
  const host = location.hostname;
  document.cookie = `googtrans=${v};path=/`;
  if (host && host !== 'localhost') document.cookie = `googtrans=${v};path=/;domain=${host}`;
  if (lang === 'en') {
    document.cookie = 'googtrans=;path=/;expires=Thu, 01 Jan 1970 00:00:00 GMT';
  }
}

function applyToCombo(lang) {
  const combo = document.querySelector('select.goog-te-combo');
  if (!combo) return false;
  combo.value = lang === 'en' ? '' : lang;
  combo.dispatchEvent(new Event('change'));
  if (lang === 'en') {
    /* fall back to Google's own "show original" control if the combo did not restore the page */
    setTimeout(() => {
      const frame = document.querySelector('iframe.goog-te-banner-frame');
      try {
        const btn = frame && frame.contentDocument && frame.contentDocument.querySelector('button[id$="restore"]');
        if (btn) btn.click();
      } catch (e) { /* cross-origin: ignore */ }
    }, 150);
  }
  return true;
}

/* Google's widget occasionally throws when a framework removes a node it wrapped in <font>. */
function patchDomForTranslate() {
  if (window.__annsaarthiDomPatched) return;
  window.__annsaarthiDomPatched = true;
  const rc = Node.prototype.removeChild;
  Node.prototype.removeChild = function (child) {
    if (child.parentNode !== this) { return child; }
    return rc.apply(this, arguments);
  };
  const ib = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function (newNode, ref) {
    if (ref && ref.parentNode !== this) { return newNode; }
    return ib.apply(this, arguments);
  };
}

export function initGoogleTranslate(initial = 'en') {
  wanted = LANGS.includes(initial) ? initial : 'en';
  if (loading || ready) return;
  loading = true;
  patchDomForTranslate();
  try {
    let host = document.getElementById('google_translate_element');
    if (!host) {
      host = document.createElement('div');
      host.id = 'google_translate_element';
      host.setAttribute('translate', 'no');
      document.body.appendChild(host);
    }
    window.__annsaarthiGTInit = () => {
      try {
        new window.google.translate.TranslateElement(
          { pageLanguage: 'en', includedLanguages: 'en,mr,hi', autoDisplay: false },
          'google_translate_element'
        );
        ready = true;
        /* wait for the language <select> the widget builds */
        let tries = 0;
        const t = setInterval(() => {
          tries += 1;
          if (applyToCombo(wanted) || tries > 40) clearInterval(t);
        }, 150);
        if (wanted === 'en') clearInterval(t);
      } catch (e) { console.warn('Google Translate unavailable:', e); }
    };
    const s = document.createElement('script');
    s.src = SCRIPT_URL;
    s.async = true;
    s.onerror = () => { loading = false; console.warn('Google Translate script blocked or offline — staying in English.'); };
    document.head.appendChild(s);
  } catch (e) { loading = false; console.warn('Google Translate init failed:', e); }
}

export function translatePage(lang) {
  if (!LANGS.includes(lang)) return;
  wanted = lang;
  setCookie(lang);
  document.documentElement.lang = lang;
  if (!ready) { initGoogleTranslate(lang); return; }
  applyToCombo(lang);
}
