import { useEffect } from 'react';
import { startPortal } from '../services/portalEngine.js';
import { initGoogleTranslate } from '../services/googleTranslate.js';

/* Portal shell: React owns the two mount containers; the portal engine (role switching, farmer /
   officer / admin / display views, quality assessment, weighing, payment, receipts) renders into them. */
export default function Portal() {
  useEffect(() => {
    startPortal();
    let lang = 'en';
    try { lang = localStorage.getItem('annsaarthi_lang') || 'en'; } catch (e) { /* ignore */ }
    initGoogleTranslate(lang);
    document.querySelectorAll('.landing-lang,.pbar__lang').forEach((b) => {
      b.classList.toggle('is-on', b.dataset.lang === lang);
    });
  }, []);

  return (
    <>
      <div className="portal" id="portal" hidden></div>
      <div className="toasts" id="toasts" role="status" aria-live="polite"></div>
    </>
  );
}
