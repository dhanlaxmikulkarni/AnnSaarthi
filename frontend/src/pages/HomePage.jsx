import { memo, useEffect } from 'react';
import Sprites from '../components/Sprites.jsx';

/* Landing page — markup converted 1:1 from the original index.html.
   Static on purpose: the portal engine and Google Translate edit text nodes directly. */
function HomePage() {
  useEffect(() => {
    /* landing-page navigation behaviour (from the original inline script) */
    const header = document.querySelector('.site-header');
    const toggle = document.querySelector('.nav__toggle');
    const menu = document.getElementById('nav-menu');
    if (!header || !toggle || !menu) return undefined;
    const cleanups = [];
    const on = (target, evt, fn, opts) => { target.addEventListener(evt, fn, opts); cleanups.push(() => target.removeEventListener(evt, fn, opts)); };

    const setMenu = (open) => {
      menu.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    };
    on(toggle, 'click', () => setMenu(!menu.classList.contains('is-open')));
    on(menu, 'click', (event) => { if (event.target.closest('a')) setMenu(false); });
    on(document, 'keydown', (event) => { if (event.key === 'Escape') setMenu(false); });
    const mq = window.matchMedia('(min-width: 861px)');
    on(mq, 'change', (event) => { if (event.matches) setMenu(false); });

    const updateHeader = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
    updateHeader();
    on(window, 'scroll', updateHeader, { passive: true });

    const navLinks = [...document.querySelectorAll('.nav__link')];
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navLinks.forEach((link) => {
          if (link.getAttribute('href') === '#' + entry.target.id) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    document.querySelectorAll('main section[id]').forEach((section) => observer.observe(section));
    cleanups.push(() => observer.disconnect());

    return () => cleanups.forEach((fn) => fn());
  }, []);

  return (
    <>
      <Sprites />

        <a className="skip-link" href="#main">Skip to content</a>

        <header className="site-header">
          <nav className="container nav" aria-label="Primary">
            <a className="brand" href="#home" aria-label="AnnSaarthi home">
              <svg className="brand__mark" aria-hidden="true"><use href="#logo-mark" /></svg>
              <span>
                <span className="brand__name">AnnSaarthi<span className="brand__deva" lang="hi">अन्नसारथी</span></span>
                <span className="brand__tagline">Smart Procurement • Transparent Payments</span>
              </span>
            </a>

            <ul className="nav__links" id="nav-menu">
              <li><a className="nav__link" href="#home">Home</a></li>
              <li><a className="nav__link" href="#how-it-works">How It Works</a></li>
              <li><a className="nav__link" href="#features">Features</a></li>
              <li className="nav__menu-cta"><a className="btn btn--primary" href="#" data-route="portal">Open Portal</a></li>
            </ul>

            <div className="nav__actions">
              <span className="landing-language" aria-label="Language"><span className="landing-language__label">Language</span>
                <button className="landing-lang is-on" type="button" data-act="landing-lang" data-lang="en" aria-label="English">EN</button>
                <button className="landing-lang" type="button" data-act="landing-lang" data-lang="mr" aria-label="Marathi">मराठी</button>
                <button className="landing-lang" type="button" data-act="landing-lang" data-lang="hi" aria-label="Hindi">हिंदी</button>
              </span>
              <a className="btn btn--primary btn--sm" id="open-portal-btn" href="#" data-route="portal">Open Portal</a>
              <button className="nav__toggle" type="button" aria-expanded="false" aria-controls="nav-menu" aria-label="Open menu">
                <svg className="icon icon-menu" aria-hidden="true"><use href="#i-menu" /></svg>
                <svg className="icon icon-close" aria-hidden="true"><use href="#i-close" /></svg>
              </button>
            </div>
          </nav>
        </header>

        <main id="main">
          <section className="hero" id="home" aria-labelledby="hero-title">
            <div className="container hero__grid">
              <div className="hero__copy">
                <h1 className="hero__title" id="hero-title">Onion Procurement with Transparent Quality Assessment -- Every Step, Clear.</h1>
                <p className="hero__lead">AnnSaarthi brings farmers and procurement officials onto one digital journey, with image-based onion quality assessment, Grade A / URS estimation and an instant digital quality report.</p>
                <div className="hero__actions">
                  <a className="btn btn--primary" id="farmer-portal-btn" href="#" data-route="farmer">
                    <svg className="icon" aria-hidden="true"><use href="#i-sprout" /></svg>
                    Farmer Portal
                  </a>
                  <a className="btn btn--secondary" id="official-portal-btn" href="#" data-route="official">
                    <svg className="icon" aria-hidden="true"><use href="#i-official" /></svg>
                    Official Portal
                  </a>
                </div>
              </div>

              <figure className="hero__visual" aria-label="Demo procurement queue interface">
                <div className="console-wrap">
                  <div className="console">
                    <div className="console__bar">
                      <span className="console__title">
                        <svg className="icon" aria-hidden="true"><use href="#i-queue" /></svg>
                        Main queue
                      </span>
                      <span className="pill">Demo data</span>
                    </div>

                    <div className="console__token">
                      <div>
                        <p className="console__label">Current token</p>
                        <p className="console__token-id">PUN-017</p>
                      </div>
                      <p className="status">
                        <svg className="icon icon--sm" aria-hidden="true"><use href="#i-check" /></svg>
                        Quality report ready
                      </p>
                    </div>

                    <div className="console__serving">
                      <div>
                        <p className="console__label">Currently serving</p>
                        <p className="console__serving-id">PUN-014</p>
                      </div>
                      <span className="serving-dot" aria-hidden="true"></span>
                    </div>

                    <div className="console__queue">
                      <p className="console__label">Queue</p>
                      <ul className="queue-chips" aria-label="Queue order">
                        <li>PUN-015</li>
                        <li>PUN-016</li>
                        <li className="is-yours">PUN-017</li>
                      </ul>
                    </div>
                  </div>
                  <div className="hero__photo">
                    <img src="https://images.unsplash.com/photo-1623211270083-5743da6c67ec?auto=format&fit=crop&w=400&q=70" alt="Farmer in a rural field in India" loading="lazy" />
                  </div>
                </div>
                <figcaption className="hero__caption">Prototype interface. All values shown are demo data.</figcaption>
              </figure>
            </div>
          </section>

          <section className="section section--dark" id="how-it-works" aria-labelledby="journey-title">
            <div className="container">
              <h2 className="section__title" id="journey-title">One Journey. Every Stage Connected.</h2>
              <ol className="stages">
                <li className="stage">
                  <span className="stage__icon"><svg className="icon" aria-hidden="true"><use href="#i-calendar" /></svg></span>
                  <span className="stage__num">01</span>
                  <h3 className="stage__title">Book Slot</h3>
                  <p className="stage__text">Choose a delivery time before leaving the farm.</p>
                </li>
                <li className="stage">
                  <span className="stage__icon"><svg className="icon" aria-hidden="true"><use href="#i-pin" /></svg></span>
                  <span className="stage__num">02</span>
                  <h3 className="stage__title">Arrive at Mandi</h3>
                  <p className="stage__text">Reach the procurement centre and report your arrival.</p>
                </li>
                <li className="stage">
                  <span className="stage__icon"><svg className="icon" aria-hidden="true"><use href="#i-clipboard" /></svg></span>
                  <span className="stage__num">03</span>
                  <h3 className="stage__title">Onion Quality Assessment</h3>
                  <p className="stage__text">The officer photographs your batch; an image-based assessment estimates Grade A and URS.</p>
                </li>
                <li className="stage">
                  <span className="stage__icon"><svg className="icon" aria-hidden="true"><use href="#i-queue" /></svg></span>
                  <span className="stage__num">04</span>
                  <h3 className="stage__title">Digital Quality Report</h3>
                  <p className="stage__text">Defect findings and Grade A / URS are compiled into a report you can view.</p>
                </li>
                <li className="stage">
                  <span className="stage__icon"><svg className="icon" aria-hidden="true"><use href="#i-scale" /></svg></span>
                  <span className="stage__num">05</span>
                  <h3 className="stage__title">Weighing</h3>
                  <p className="stage__text">The crop is weighed and the payable amount is calculated.</p>
                </li>
                <li className="stage">
                  <span className="stage__icon"><svg className="icon" aria-hidden="true"><use href="#i-rupee" /></svg></span>
                  <span className="stage__num">06</span>
                  <h3 className="stage__title">Payment</h3>
                  <p className="stage__text">Track payment status and receive a digital receipt.</p>
                </li>
              </ol>
            </div>
          </section>

          <section className="section" id="features" aria-labelledby="features-title">
            <div className="container">
              <h2 className="section__title" id="features-title">Why AnnSaarthi</h2>
              <div className="audience-grid">
                <article className="audience-card">
                  <span className="audience-card__icon audience-card__icon--green"><svg className="icon" aria-hidden="true"><use href="#i-sprout" /></svg></span>
                  <h3 className="audience-card__title">Farmer</h3>
                  <p className="audience-card__text">Know when to arrive, track your queue position, and view your onion quality report.</p>
                </article>
                <article className="audience-card">
                  <span className="audience-card__icon audience-card__icon--ochre"><svg className="icon" aria-hidden="true"><use href="#i-official" /></svg></span>
                  <h3 className="audience-card__title">Official</h3>
                  <p className="audience-card__text">Capture onion images, review standardized assessments, and manage weighing and payment from one dashboard.</p>
                </article>
                <article className="audience-card">
                  <span className="audience-card__icon audience-card__icon--clay"><svg className="icon" aria-hidden="true"><use href="#i-warehouse" /></svg></span>
                  <h3 className="audience-card__title">Mandi</h3>
                  <p className="audience-card__text">Keep procurement movement organized with a live token-based queue.</p>
                  <a className="text-link" id="mandi-display-link" href="#" data-route="display">Open Mandi Display</a>
                </article>
              </div>
            </div>
          </section>

          <section className="section preview" id="journey-preview" aria-labelledby="preview-title">
            <div className="container preview__grid">
              <div>
                <h2 className="section__title" id="preview-title">Follow One Delivery from Slot to Receipt.</h2>
                <article className="token-slip" aria-label="Sample delivery details">
                  <div className="token-slip__head">
                    <p className="console__label">Token</p>
                    <span className="pill">Demo data</span>
                  </div>
                  <p className="token-slip__id">PUN-017</p>
                  <dl className="token-slip__meta">
                    <div><dt>Crop</dt><dd>Onion</dd></div>
                    <div><dt>Quantity</dt><dd>38.5 Quintals</dd></div>
                    <div><dt>Grade A / URS</dt><dd>78% / 22%</dd></div>
                  </dl>
                  <div className="journey-photo">
                    <img src="https://images.unsplash.com/photo-1633410195091-bd66114cef5f?auto=format&fit=crop&w=400&q=70" alt="Farmers working in an agricultural field in Odisha, India" loading="lazy" />
                  </div>
                </article>
              </div>

              <ol className="timeline" aria-label="Sample farmer journey">
                <li className="timeline__item timeline__item--done">
                  <span className="timeline__marker"><svg className="icon icon--sm" aria-hidden="true"><use href="#i-check" /></svg></span>
                  <p className="timeline__label">Slot Booked<span className="sr-only">, completed</span></p>
                </li>
                <li className="timeline__item timeline__item--done">
                  <span className="timeline__marker"><svg className="icon icon--sm" aria-hidden="true"><use href="#i-check" /></svg></span>
                  <p className="timeline__label">Arrived<span className="sr-only">, completed</span></p>
                </li>
                <li className="timeline__item timeline__item--done">
                  <span className="timeline__marker"><svg className="icon icon--sm" aria-hidden="true"><use href="#i-check" /></svg></span>
                  <p className="timeline__label">Images Captured<span className="sr-only">, completed</span></p>
                </li>
                <li className="timeline__item timeline__item--current">
                  <span className="timeline__marker"></span>
                  <div>
                    <p className="timeline__label">Quality Assessment <span className="pill">In progress</span></p>
                    <p className="timeline__note">Grade A / URS report is generated automatically.</p>
                  </div>
                </li>
                <li className="timeline__item timeline__item--pending">
                  <span className="timeline__marker"></span>
                  <p className="timeline__label">Weighing<span className="sr-only">, upcoming</span></p>
                </li>
                <li className="timeline__item timeline__item--pending">
                  <span className="timeline__marker"></span>
                  <p className="timeline__label">Payment<span className="sr-only">, upcoming</span></p>
                </li>
                <li className="timeline__item timeline__item--pending">
                  <span className="timeline__marker"></span>
                  <p className="timeline__label">Receipt<span className="sr-only">, upcoming</span></p>
                </li>
              </ol>
            </div>
          </section>

          <section className="section impact" id="impact" aria-labelledby="impact-title">
            <div className="container">
              <h2 className="sr-only" id="impact-title">What AnnSaarthi is designed to improve</h2>
              <ul className="impact__list">
                <li className="impact__item">
                  <svg className="icon" aria-hidden="true"><use href="#i-clock" /></svg>
                  <h3 className="impact__statement">Less uncertainty</h3>
                  <p className="impact__detail">Slot, queue position and procurement status stay visible to the farmer.</p>
                </li>
                <li className="impact__item">
                  <svg className="icon" aria-hidden="true"><use href="#i-eye" /></svg>
                  <h3 className="impact__statement">Better queue visibility</h3>
                  <p className="impact__detail">A token-based queue shows who is being served and who is next.</p>
                </li>
                <li className="impact__item">
                  <svg className="icon" aria-hidden="true"><use href="#i-tracking" /></svg>
                  <h3 className="impact__statement">Transparent quality assessment</h3>
                  <p className="impact__detail">Image-based assessment is designed to give every batch a consistent, traceable quality report.</p>
                </li>
              </ul>
              <p className="impact__label">Designed as an SIH prototype</p>
            </div>
          </section>

          <section className="section" id="get-started" aria-labelledby="cta-title">
            <div className="container">
              <div className="cta-panel">
                <div>
                  <h2 className="cta-panel__title" id="cta-title">Make Every Procurement Journey Predictable.</h2>
                  <p className="cta-panel__text">AnnSaarthi connects the steps between arrival, onion quality assessment, weighing and payment.</p>
                </div>
                <a className="btn btn--light" id="explore-btn" href="#how-it-works">Explore AnnSaarthi</a>
              </div>
            </div>
          </section>
        </main>

        <footer className="site-footer">
          <div className="container footer__grid">
            <div>
              <a className="brand" href="#home" aria-label="AnnSaarthi home">
                <svg className="brand__mark" aria-hidden="true"><use href="#logo-mark" /></svg>
                <span className="brand__name">AnnSaarthi</span>
              </a>
              <p className="footer__tagline">Smart Procurement • Transparent Payments</p>
            </div>
            <div className="footer__meta">
              <p className="footer__ps">PS Code: SIH26031</p>
              <p>Prototype for Smart India Hackathon</p>
              <p className="footer__note">Queue and token values on this page are demo data.</p>
            </div>
          </div>
        </footer>
    </>
  );
}

export default memo(HomePage);
