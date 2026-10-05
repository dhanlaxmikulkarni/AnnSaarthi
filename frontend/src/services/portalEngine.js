/* AnnSaarthi portal engine — original prototype logic (booking, queue, quality, weighing, payment,
   receipts, notifications, roles, admin) carried over unchanged. It renders into the React-owned
   #portal / #toasts containers (see pages/Portal.jsx). Persistence goes through services/api.js
   (Flask + SQLite); localisation goes through services/googleTranslate.js. */
import { loadState, saveState, saveStateBeacon } from '../services/api.js';
import { translatePage, markNoTranslate } from '../services/googleTranslate.js';
import { assessOnionImages } from '../services/qualityService.js';

let started = false;
let resumePortalHook = null;   /* set by the first startPortal(); re-attaches the engine to a re-mounted #portal */
export function startPortal() {
  if (started) { if (resumePortalHook) resumePortalHook(); return; }   /* keep S; just redraw into the new container */
  started = true;

/* ===================== ANNSAARTHI PORTAL — PROTOTYPE ======================
   Demo prototype only. Fictional data. Not an official government system.
   ========================================================================= */

/* ---------- small helpers ---------- */
const $ = (sel, root) => (root || document).querySelector(sel);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n, w) => String(n).padStart(w, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const TODAY = iso(new Date());
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtDate = (s) => { if (!s) return '—'; const d = new Date(s + 'T00:00:00'); return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`; };
const fmtLongDate = (s) => { const d = new Date(s + 'T00:00:00'); return `${DOW[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const fmtTime = (h) => { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); const ap = hh >= 12 ? 'PM' : 'AM'; const h12 = hh % 12 === 0 ? 12 : hh % 12; return `${h12}:${pad(mm, 2)} ${ap}`; };
const rupee = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h; };
const maskId = (num, type) => { const s = String(num || '').replace(/\s/g, ''); if (!s) return '—'; const last = s.slice(-4); return type === 'Aadhaar' ? `XXXX XXXX ${last}` : `${'X'.repeat(Math.max(0, s.length - 4))}${last}`; };
const maskAcct = (a) => { const s = String(a || ''); return s ? 'X'.repeat(Math.max(0, s.length - 4)) + s.slice(-4) : '—'; };
const maskMobile = (m) => (m ? `+91 XXXXX ${String(m).slice(-5)}` : '—');
const nowTime = () => { const d = new Date(); return `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}`; };

/* ---------- configurable prototype settings (admin editable) ---------- */
const CFG = {
  slotDurationMin: 60,
  slotCapacity: 15,
  maxActiveBookingsPerFarmer: 1,
  limitedThresholdPct: 20,        // remaining <= 20% => LIMITED
  lateToleranceMin: 30,
  cancellationDeadlineHrs: 4,
  reschedulingAllowed: true,
  avgProcessingMin: 5,
  activeCounters: 3,
  congestionLowMax: 10,
  congestionModerateMax: 25,
  requireApprovalBeforeBooking: true,
  requireIdDocument: true,
  requireBankDocument: false,
  requireLandDocument: false,
  eligibleFarmerTypes: ['Land Owner', 'Tenant Farmer', 'Sharecropper', 'Other'],
  arrivalAdvice: 'Please arrive during your assigned slot. Arriving hours early does not move you up the queue.'
};

/* ---------- workflow stages (single source of truth) ---------- */
const STAGES = [
  ['REGISTERED', 'Registration submitted'],
  ['DOCUMENT_VERIFIED', 'Documents & KYC verified, Farmer ID issued'],
  ['SLOT_BOOKED', 'Procurement slot booked'],
  ['TOKEN_GENERATED', 'Main queue token issued'],
  ['CHECKED_IN', 'Checked in at the centre'],
  ['VERIFICATION_COMPLETE', 'Identity & booking verified at gate'],
  ['QUALITY_PENDING', 'Waiting for quality assessment'],
  ['QUALITY_ASSESSED', 'Quality assessed'],
  ['QUALITY_TOKEN_GENERATED', 'Quality token issued'],
  ['SECTION_ASSIGNED', 'Routed to a processing section'],
  ['WEIGHING_PENDING', 'Waiting at the weighbridge'],
  ['WEIGHED', 'Weighing complete'],
  ['PROCUREMENT_COMPLETE', 'Procurement recorded'],
  ['PAYMENT_PENDING', 'Payment initiated'],
  ['PAYMENT_COMPLETE', 'Payment credited']
];
const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s[0], i]));
const stageLabel = (k) => (STAGES.find((s) => s[0] === k) || [k, ''])[1];
const stageTitle = (k) => k.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/* ---------- in-memory database ---------- */
const DB = {
  seq: { app: 4820, farmer: 1841, booking: 4820, procurement: 4820, quality: 17, receipt: 900 },
  commodities: [], centres: [], schedules: [], slots: {}, farmers: [], applications: [],
  bookings: [], tokens: [], notifications: [], events: []
};

const nextApplicationId = () => `APP-2026-${pad(++DB.seq.app, 6)}`;
const nextFarmerId = () => {
  let id;
  do { id = `F-2026-${pad(++DB.seq.farmer, 6)}`; } while (DB.farmers.some((f) => f.farmerId === id));   /* never reuse a seeded/existing Farmer ID */
  return id;
};
const nextBookingId = () => `BOOK-2026-${pad(++DB.seq.booking, 6)}`;
const nextProcurementId = () => `PR-2026-${pad(++DB.seq.procurement, 6)}`;
const nextQualityToken = (grade) => `${grade}-${pad(++DB.seq.quality, 3)}`;
const nextReceipt = () => `RCPT-2026-${pad(++DB.seq.receipt, 5)}`;

/* ---------- seed ---------- */
function seed() {
  DB.commodities = [
    { id: 'ONION', name: 'Onion', emoji: '🧅', status: 'OPEN', msp: 1200, unit: 'quintal' },
    { id: 'WHEAT', name: 'Wheat', emoji: '🌾', status: 'OPEN', msp: 2425, unit: 'quintal' },
    { id: 'RICE', name: 'Rice (Paddy)', emoji: '🌾', status: 'OPEN', msp: 2320, unit: 'quintal' },
    { id: 'SOYBEAN', name: 'Soybean', emoji: '🫘', status: 'OPEN', msp: 4892, unit: 'quintal' },
    { id: 'MAIZE', name: 'Maize', emoji: '🌽', status: 'OPEN', msp: 2400, unit: 'quintal' },
    { id: 'PULSES', name: 'Pulses', emoji: '🫘', status: 'OPEN', msp: 6100, unit: 'quintal' },
    { id: 'GROUNDNUT', name: 'Groundnut', emoji: '🥜', status: 'OPEN', msp: 6783, unit: 'quintal' },
    { id: 'JOWAR', name: 'Jowar', emoji: '🌾', status: 'OPEN', msp: 3740, unit: 'quintal' },
    { id: 'BAJRA', name: 'Bajra', emoji: '🌾', status: 'OPEN', msp: 2775, unit: 'quintal' },
    { id: 'CHICKPEA', name: 'Chickpea', emoji: '🫘', status: 'OPEN', msp: 5650, unit: 'quintal' },
    { id: 'SUGARCANE', name: 'Sugarcane', emoji: '🎋', status: 'OPEN', msp: 355, unit: 'quintal' },
    { id: 'COTTON', name: 'Cotton', emoji: '🌱', status: 'CLOSED', msp: 7521, unit: 'quintal' }
  ];
  DB.centres = [
    { id: 'C1', code: 'PUN', name: 'Pune Central Procurement Centre', address: 'Market Yard Road, Gultekdi, Pune', district: 'Pune', subDistrict: 'Pune City', state: 'Maharashtra', distanceKm: 4.2, openHour: 8, closeHour: 18, days: 'Monday – Saturday', dailyCapacity: 100, status: 'ACTIVE', commodities: ['WHEAT', 'RICE', 'SOYBEAN', 'MAIZE', 'PULSES', 'GROUNDNUT', 'JOWAR', 'BAJRA', 'CHICKPEA', 'SUGARCANE'], sections: ['Section A', 'Section B', 'Section C'], counters: 3 },
    { id: 'C2', code: 'HDP', name: 'Hadapsar Procurement Centre', address: 'Sasane Nagar, Hadapsar, Pune', district: 'Pune', subDistrict: 'Haveli', state: 'Maharashtra', distanceKm: 9.6, openHour: 9, closeHour: 17, days: 'Monday – Friday', dailyCapacity: 60, status: 'ACTIVE', commodities: ['WHEAT', 'SOYBEAN', 'MAIZE', 'GROUNDNUT', 'CHICKPEA'], sections: ['Section A', 'Section B'], counters: 2 },
    { id: 'C3', code: 'BAR', name: 'Baramati Procurement Centre', address: 'MIDC Road, Baramati', district: 'Pune', subDistrict: 'Baramati', state: 'Maharashtra', distanceKm: 78.4, openHour: 8, closeHour: 16, days: 'Monday – Saturday', dailyCapacity: 80, status: 'ACTIVE', commodities: ['WHEAT', 'RICE', 'SOYBEAN', 'PULSES', 'JOWAR', 'BAJRA', 'CHICKPEA', 'SUGARCANE'], sections: ['Section A', 'Section B'], counters: 2 }
  ];
  const start = iso(addDays(new Date(), -3)), end = iso(addDays(new Date(), 21));
  DB.centres.forEach((c) => c.commodities.unshift('ONION'));
  DB.centres.forEach((c) => c.commodities.forEach((cm) => {
    DB.schedules.push({ id: `S-${c.id}-${cm}`, centreId: c.id, commodityId: cm, startDate: start, endDate: end, dailyCapacity: c.dailyCapacity, openHour: c.openHour, closeHour: c.closeHour, status: 'OPEN' });
  }));

  /* farmers */
  const mkFarmer = (o) => Object.assign({
    farmerId: null, fullName: '', mobile: '', village: '', district: 'Pune', state: 'Maharashtra',
    kycStatus: 'PENDING', bankStatus: 'PENDING', registrationStatus: 'SUBMITTED', stage: 'REGISTERED'
  }, o);

  const ramesh = mkFarmer({
    farmerId: 'F-2026-001842', applicationId: 'APP-2026-004811', fullName: 'Ramesh Patil', nameAsPerId: 'Ramesh Baburao Patil',
    relativeName: 'Baburao Patil', relativeType: 'Father', dob: '1979-06-14', gender: 'Male', email: 'ramesh.patil@example.in',
    mobile: '9822001842', mobileVerified: true, farmerCategory: 'Small', farmerType: 'Land Owner',
    state: 'Maharashtra', district: 'Pune', subDistrict: 'Haveli', block: 'Haveli', localBody: 'Wagholi Gram Panchayat',
    village: 'Wagholi', pinCode: '412207', addressLine: 'House 14, Shivaji Nagar, Wagholi, Pune',
    landStatus: 'Owned', totalLandArea: 4.5, landUnit: 'Acre', landRecords: ['123/4', '128/2'], mainCrops: ['Wheat', 'Soybean'],
    identityDocumentType: 'Aadhaar', identityDocumentNumber: '999988884821', identityDocument: 'aadhaar-demo.pdf',
    accountHolderName: 'Ramesh Baburao Patil', accountNumber: '3048291174821', ifsc: 'SBIN0001842',
    bankName: 'State Bank of India', branchName: 'Wagholi Branch', accountType: 'Savings', bankDocument: 'passbook-demo.jpg',
    kycStatus: 'VERIFIED', bankStatus: 'VERIFIED', registrationStatus: 'APPROVED', stage: 'DOCUMENT_VERIFIED',
    approvedAt: iso(addDays(new Date(), -12))
  });
  DB.farmers.push(ramesh);

  [['F-2026-001836', 'Sunita Jadhav', '9881004422', 'Urali Kanchan', 'Female'],
   ['F-2026-001839', 'Imran Shaikh', '9730114290', 'Loni Kalbhor', 'Male'],
   ['F-2026-001840', 'Kavita More', '9765441180', 'Theur', 'Female'],
   ['F-2026-001841', 'Dattatray Shinde', '9921668432', 'Kesnand', 'Male']
  ].forEach(([fid, name, mob, vill, g], i) => {
    DB.farmers.push(mkFarmer({
      farmerId: fid, applicationId: `APP-2026-0048${pad(i, 2)}`, fullName: name, nameAsPerId: name, relativeName: 'Not recorded', relativeType: 'Father',
      dob: `198${i}-0${(i % 8) + 1}-1${i}`, gender: g, mobile: mob, mobileVerified: true, farmerType: 'Land Owner', farmerCategory: 'Marginal',
      subDistrict: 'Haveli', village: vill, pinCode: '412208', addressLine: `${vill}, Pune`, landStatus: 'Owned', totalLandArea: 2 + i, landUnit: 'Acre',
      landRecords: [`${40 + i}/2`], mainCrops: ['Wheat'], identityDocumentType: 'Aadhaar', identityDocumentNumber: `9999${pad(1000 + i * 7, 4)}${pad(3100 + i, 4)}`,
      identityDocument: 'aadhaar-demo.pdf', accountHolderName: name, accountNumber: `30482${pad(90000 + i * 13, 8)}`, ifsc: 'BARB0PUNE01',
      bankName: 'Bank of Baroda', branchName: 'Pune Camp Branch', accountType: 'Savings',
      kycStatus: 'VERIFIED', bankStatus: 'VERIFIED', registrationStatus: 'APPROVED', stage: 'DOCUMENT_VERIFIED'
    }));
  });

  /* two applications awaiting admin verification */
  [['Anita Gaikwad', '9834556701', 'Koregaon Mul', 'Female'], ['Vijay Kale', '9890442213', 'Shikrapur', 'Male']].forEach(([name, mob, vill, g], i) => {
    const appId = nextApplicationId();
    const f = mkFarmer({
      applicationId: appId, fullName: name, nameAsPerId: name, relativeName: 'Namdev ' + name.split(' ')[1], relativeType: 'Father',
      dob: '1987-03-1' + i, gender: g, mobile: mob, mobileVerified: true, mobileVerifiedAt: TODAY, farmerType: i ? 'Tenant Farmer' : 'Land Owner',
      farmerCategory: 'Small', subDistrict: 'Shirur', block: 'Shirur', localBody: `${vill} Gram Panchayat`, village: vill, pinCode: '412208',
      addressLine: `Near Zilla Parishad School, ${vill}`, landStatus: i ? 'Leased' : 'Owned', totalLandArea: 3.2 + i, landUnit: 'Acre',
      landRecords: [`7${i}/3`], mainCrops: ['Wheat', 'Maize'], expectedCommodity: 'WHEAT',
      identityDocumentType: 'Aadhaar', identityDocumentNumber: `9999${pad(4400 + i, 4)}${pad(5510 + i, 4)}`, identityDocument: 'aadhaar-demo.pdf',
      accountHolderName: name, accountNumber: `6620${pad(33110 + i, 9)}`, ifsc: 'HDFC0000482', bankName: 'HDFC Bank', branchName: 'Shirur Branch',
      accountType: 'Savings', bankDocument: 'cheque-demo.jpg', registrationStatus: 'SUBMITTED', kycStatus: 'PENDING', bankStatus: 'PENDING', stage: 'REGISTERED',
      submittedAt: TODAY
    });
    DB.farmers.push(f);
    DB.applications.push({ applicationId: appId, mobile: mob, status: 'SUBMITTED', submittedAt: TODAY, checks: {} });
  });
  DB.applications.unshift({ applicationId: ramesh.applicationId, mobile: ramesh.mobile, status: 'FARMER_ID_GENERATED', submittedAt: iso(addDays(new Date(), -14)), checks: {} });

  /* today's queue at Pune Central: seeded tokens at different stages */
  const seedQueue = [
    ['F-2026-001836', 1035, 'SERVING', 'QUALITY_PENDING', 8],
    ['F-2026-001839', 1036, 'IN_QUEUE', 'VERIFICATION_COMPLETE', 9],
    ['F-2026-001840', 1038, 'IN_QUEUE', 'CHECKED_IN', 9],
    ['F-2026-001841', 1041, 'IN_QUEUE', 'CHECKED_IN', 10]
  ];
  seedQueue.forEach(([fid, n, st, stage, hour]) => {
    const f = DB.farmers.find((x) => x.farmerId === fid);
    const slotId = slotIdFor('C1', 'ONION', TODAY, hour);
    const bk = createBookingRecord(f, 'ONION', 'C1', TODAY, hour, { silent: true, seqOverride: n });
    const tk = DB.tokens.find((t) => t.bookingId === bk.bookingId);
    tk.status = st; tk.stage = stage; tk.checkInTime = '08:5' + (n % 10);
    f.stage = stage;
    if (stage !== 'CHECKED_IN') tk.verifiedAt = '09:0' + (n % 10);
    void slotId;
  });
  /* active demo procurement for Ramesh: used to demonstrate stage-aware live tracking */
  const rb = createBookingRecord(ramesh, 'ONION', 'C1', TODAY, 11, { silent: true, seqOverride: 1039 });
  const rt = DB.tokens.find((t) => t.bookingId === rb.bookingId);
  Object.assign(rt, { status: 'IN_QUEUE', stage: 'QUALITY_PENDING', checkInTime: '09:48', verifiedAt: '10:02', section: 'Quality Section Q-2', liveAlert: { title: 'Quality section Q-2 is currently experiencing a 10-minute delay.', body: 'Your queue position is safe. Please remain available near the assigned section.' } });
  ramesh.stage = 'QUALITY_PENDING';

  /* completed + paid history for Ramesh (previous cycle) */
  const past = iso(addDays(new Date(), -12));
  const pb = createBookingRecord(ramesh, 'ONION', 'C1', past, 10, { silent: true, seqOverride: 1009 });
  const pt = DB.tokens.find((t) => t.bookingId === pb.bookingId);
  Object.assign(pt, {
    status: 'COMPLETED', stage: 'PAYMENT_COMPLETE', checkInTime: '09:52', qualityGrade: 'GREEN',
    qualityLabel: 'Grade A — Fair Average Quality', qualityToken: 'GREEN-011', moisture: 10.4, foreignMatter: 0.6,
    section: 'Section A', weightQtl: 42.5, ratePerQtl: 2425, amount: 42.5 * 2425, deductions: 0,
    paymentStatus: 'PAID', paymentRef: 'UTR2026031100482', receiptNo: 'RCPT-2026-00891', completedAt: past
  });
  pb.bookingStatus = 'COMPLETED';
}

/* ---------- slot engine ---------- */
function slotIdFor(centreId, commodityId, date, hour) { return `${centreId}|${commodityId}|${date}|${hour}`; }
function scheduleFor(centreId, commodityId) { return DB.schedules.find((s) => s.centreId === centreId && s.commodityId === commodityId); }

function dateIsOpen(centreId, commodityId, date) {
  const sch = scheduleFor(centreId, commodityId);
  if (!sch || sch.status !== 'OPEN') return false;
  if (date < sch.startDate || date > sch.endDate) return false;
  if (date < TODAY) return false;
  const d = new Date(date + 'T00:00:00');
  const centre = DB.centres.find((c) => c.id === centreId);
  if (centre.status !== 'ACTIVE') return false;
  if (d.getDay() === 0) return false;                       // Sunday closed
  if (centre.days.includes('Friday') && d.getDay() === 6) return false; // Hadapsar closed Saturday
  return true;
}

function getSlots(centreId, commodityId, date) {
  const key = slotIdFor(centreId, commodityId, date, 'all');
  if (DB.slots[key]) return DB.slots[key];
  const sch = scheduleFor(centreId, commodityId);
  if (!sch || !dateIsOpen(centreId, commodityId, date)) return [];
  const list = [];
  const step = CFG.slotDurationMin / 60;
  for (let h = sch.openHour; h + step <= sch.closeHour; h += step) {
    if (h === 13) continue; // lunch break
    const id = slotIdFor(centreId, commodityId, date, h);
    const seedBooked = date >= TODAY ? (hash(id) % (CFG.slotCapacity + 1)) : CFG.slotCapacity;
    list.push({ slotId: id, scheduleId: sch.id, centreId, commodityId, date, startHour: h, endHour: h + step, capacity: CFG.slotCapacity, bookedCount: Math.min(seedBooked, CFG.slotCapacity) });
  }
  DB.slots[key] = list;
  return list;
}
function slotStatus(slot) {
  const rem = slot.capacity - slot.bookedCount;
  if (rem <= 0) return 'FULL';
  if (rem <= Math.ceil(slot.capacity * CFG.limitedThresholdPct / 100)) return 'LIMITED';
  return 'AVAILABLE';
}
function dayStats(centreId, commodityId, date) {
  const slots = getSlots(centreId, commodityId, date);
  const capacity = slots.reduce((a, s) => a + s.capacity, 0);
  const booked = slots.reduce((a, s) => a + s.bookedCount, 0);
  return { capacity, booked, available: capacity - booked, slots };
}
function dayStatus(centreId, commodityId, date) {
  if (!dateIsOpen(centreId, commodityId, date)) return 'CLOSED';
  const { capacity, available } = dayStats(centreId, commodityId, date);
  if (!capacity || available <= 0) return 'FULL';
  if (available <= Math.ceil(capacity * CFG.limitedThresholdPct / 100)) return 'LIMITED';
  return 'AVAILABLE';
}

/* ---------- queue helpers ---------- */
const activeTokens = (centreId, date) => DB.tokens.filter((t) => t.centreId === centreId && t.date === date && !['CANCELLED', 'MISSED'].includes(t.status));
function servingToken(centreId, date) { return activeTokens(centreId, date).find((t) => t.status === 'SERVING') || null; }
function farmersAhead(token) {
  return activeTokens(token.centreId, token.date)
    .filter((t) => t.seq < token.seq && !['COMPLETED'].includes(t.status)).length;
}
function etaMinutes(aheadCount, centreId) {
  const centre = DB.centres.find((c) => c.id === centreId);
  const counters = Math.max(1, Math.min(CFG.activeCounters, centre ? centre.counters : CFG.activeCounters));
  return Math.max(0, Math.round(aheadCount * CFG.avgProcessingMin / counters));
}
function clockPlusMinutes(hhmm, mins) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  const total = Math.max(0, h * 60 + m + Number(mins || 0));
  return `${pad(Math.floor((total % 1440) / 60), 2)}:${pad(total % 60, 2)}`;
}
function formatClock(hhmm) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM'; const hh = (h % 12) || 12;
  return `${hh}:${pad(m,2)} ${ap}`;
}
function congestion(centreId, date) {
  const waiting = activeTokens(centreId, date).filter((t) => ['IN_QUEUE', 'WAITING'].includes(t.status)).length;
  const level = waiting <= CFG.congestionLowMax ? 'LOW' : waiting <= CFG.congestionModerateMax ? 'MODERATE' : 'HIGH';
  return { waiting, level };
}

/* ---------- booking creation ---------- */
function createBookingRecord(farmer, commodityId, centreId, date, startHour, opts) {
  opts = opts || {};
  const centre = DB.centres.find((c) => c.id === centreId);
  const slots = getSlots(centreId, commodityId, date);
  const slot = slots.find((s) => s.startHour === startHour);
  if (slot && !opts.seqOverride) slot.bookedCount = Math.min(slot.capacity, slot.bookedCount + 1);
  const bookingId = nextBookingId();
  const procurementId = nextProcurementId();
  const booking = {
    bookingId, procurementId, farmerId: farmer.farmerId, farmerName: farmer.fullName, commodityId, centreId, date,
    startHour, endHour: startHour + CFG.slotDurationMin / 60, slotId: slot ? slot.slotId : null,
    bookingStatus: 'CONFIRMED', bookedAt: new Date().toISOString(), history: [{ at: new Date().toISOString(), event: 'Booking confirmed' }]
  };
  DB.bookings.push(booking);
  const seq = opts.seqOverride || nextSeqForCentre(centreId, date);
  const token = {
    mainTokenId: 'MT-' + bookingId, bookingId, procurementId, farmerId: farmer.farmerId, farmerName: farmer.fullName,
    centreId, centreCode: centre.code, commodityId, date, seq, token: `${centre.code}-${seq}`,
    status: 'WAITING', stage: 'TOKEN_GENERATED', startHour, endHour: booking.endHour,
    checkInTime: null, qualityGrade: null, qualityToken: null, section: null, weightQtl: null,
    ratePerQtl: null, amount: null, paymentStatus: 'NOT_STARTED', receiptNo: null
  };
  DB.tokens.push(token);
  if (!opts.silent) {
    farmer.stage = 'TOKEN_GENERATED';
    notify(farmer.farmerId, 'Your procurement slot has been confirmed.', `${commodityName(commodityId)} · ${centre.name} · ${fmtDate(date)} · ${fmtTime(startHour)}`);
    notify(farmer.farmerId, 'Main queue token issued.', `Token ${token.token}. Track your position from the token screen.`);
  }
  return booking;
}
function nextSeqForCentre(centreId, date) {
  const used = DB.tokens.filter((t) => t.centreId === centreId && t.date === date).map((t) => t.seq);
  return (used.length ? Math.max(...used) : 1000) + 1;
}
const commodityName = (id) => (DB.commodities.find((c) => c.id === id) || {}).name || id;
const centreName = (id) => (DB.centres.find((c) => c.id === id) || {}).name || id;
const farmerById = (id) => DB.farmers.find((f) => f.farmerId === id);
const tokenForBooking = (bid) => DB.tokens.find((t) => t.bookingId === bid);
const activeBookingOf = (farmerId) => DB.bookings.find((b) => b.farmerId === farmerId && ['CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'].includes(b.bookingStatus));

function notify(farmerId, title, body) {
  DB.notifications.unshift({ id: 'N' + Date.now() + Math.random(), farmerId, title, body, at: nowTime(), read: false });
}
function logEvent(text) { DB.events.unshift({ at: nowTime(), text }); }

/* ---------- safe language persistence ---------- */
function getStoredLanguage(){ try { return localStorage.getItem('annsaarthi_lang') || 'en'; } catch(e) { return 'en'; } }
function setStoredLanguage(lang){ try { localStorage.setItem('annsaarthi_lang', lang); } catch(e) {} }

/* ---------- session ---------- */
const S = {
  open: false, role: null, view: null, farmerId: null,
  auth: { mobile: '', otp: null, sent: false, secondsLeft: 0, verified: false, mode: 'login' },
  reg: null,
  book: { commodityId: 'ONION', centreId: null, date: null, startHour: null, step: 2, submitting: false, otherCropName: '' },
  officer: { centreId: 'C1', selectedToken: null, lookupToken: null },
  admin: { tab: 'overview' },
  sideOpen: false, language: 'en', uiLang: getStoredLanguage()
};
let liveRefreshTimer = null;

/* Clears every farmer-specific piece of session state so one farmer's (or the demo farmer's)
   identity, pending application, half-finished booking/reschedule or open report can never
   carry over to the next farmer. Callers assign the new identity right after this. */
function resetFarmerSessionState() {
  S.farmerId = null;
  S.pending = null;
  S.book = { commodityId: 'ONION', centreId: null, date: null, startHour: null, step: 2, submitting: false, otherCropName: '' };
  S.oqReport = null;
}

/* ---------- session persistence ----------
   S lives in memory, so a browser refresh (or the one-time reload that ensureEnglishRestored() may do when Google
   Translate will not let go) used to drop the user back on the landing page / registration. The session is mirrored
   into sessionStorage (per tab, cleared when the tab closes) on every render and restored once at startup.
   It never touches DB (that persists through the Flask backend) and is wiped by Reset Demo. */
const SESSION_KEY = 'annsaarthi_session_v1';
let restoredPendingApp = null;
function persistSession(collectTyped) {
  if (backendResetting) return;                       /* Reset Demo must come back clean */
  try {
    if (collectTyped && S.open && S.reg) { try { collectStep(); } catch (err) { /* DOM not ready */ } }
    const snap = {
      open: S.open, role: S.role, view: S.view, farmerId: S.farmerId, auth: S.auth, reg: S.reg, book: S.book,
      officer: S.officer, admin: S.admin, appId: S.appId || null,
      pendingApp: (S.pending && S.pending.applicationId) || restoredPendingApp || null
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(snap, (k, v) => (k === 'timer' ? undefined : v)));
  } catch (err) { /* storage unavailable or full: the portal still works, it just cannot survive a refresh */ }
}
function clearSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch (err) { /* ignore */ } }
function restoreSession() {
  let snap = null;
  try { snap = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (err) { snap = null; }
  if (!snap || !snap.open || !['choose', 'farmer', 'officer', 'admin', 'display'].includes(snap.role)) return false;
  const known = [].concat(...(NAV[snap.role] || []).map(([, items]) => items.map(([k]) => k)), ['appdetail', 'pending', 'choose', 'wall']);
  S.role = snap.role;
  S.view = known.includes(snap.view) ? snap.view : null;      /* render() falls back to the role's default view */
  S.farmerId = snap.farmerId || null;
  if (snap.auth) { S.auth = Object.assign({}, S.auth, snap.auth); S.auth.timer = undefined; S.auth.secondsLeft = 0; }
  S.reg = snap.reg || null;
  if (S.reg) S.reg.resendIn = 0;                               /* timers do not survive a reload: offer Resend straight away */
  if (snap.book) S.book = snap.book;
  if (snap.officer) S.officer = Object.assign({}, S.officer, snap.officer, { oqRun: null, oqStep: 0 });
  if (snap.admin) S.admin = snap.admin;
  if (snap.appId) S.appId = snap.appId;
  restoredPendingApp = snap.pendingApp || null;
  if (restoredPendingApp) S.pending = DB.farmers.find((f) => f.applicationId === restoredPendingApp) || null;
  S.open = true; S.sideOpen = false; S.screenKey = null;
  $('#portal').hidden = false; document.body.style.overflow = 'hidden';
  render();
  return true;
}
/* hydrateFromBackend() replaces DB, so any farmer object held in S.pending must be re-pointed at the loaded record. */
function relinkPending() {
  const id = (S.pending && S.pending.applicationId) || restoredPendingApp;
  if (!id) return;
  const f = DB.farmers.find((x) => x.applicationId === id);
  if (f) S.pending = f;
}

/* ---------- toast + modal ---------- */
function toast(msg, bad) {
  let wrap = $('#toasts');
  if (!wrap) { wrap = document.createElement('div'); wrap.id = 'toasts'; wrap.className = 'toasts'; wrap.setAttribute('role', 'status'); wrap.setAttribute('aria-live', 'polite'); document.body.appendChild(wrap); }
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' toast--bad' : '');
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}
let confirmCb = null;
function askConfirm(title, body, confirmLabel, cb, needReason) {
  confirmCb = cb;
  const m = $('#p-modal');
  m.innerHTML = `<div class="modal__box" role="dialog" aria-modal="true" aria-labelledby="mtitle">
    <h2 class="ptitle" id="mtitle" style="font-size:1.25rem">${esc(title)}</h2>
    <p class="muted">${body}</p>
    ${needReason ? `<label class="field"><span class="field__label">Reason / remarks <span class="field__req">Required</span></span>
      <textarea id="m-reason" placeholder="e.g. Bank account holder name does not match the submitted identity document."></textarea></label>` : ''}
    <div class="row row--end mt">
      <button class="btn btn--secondary btn--sm" data-act="modal-close">Go back</button>
      <button class="btn btn--primary btn--sm" data-act="modal-ok">${esc(confirmLabel)}</button>
    </div></div>`;
  m.hidden = false;
}
function closeModal() { $('#p-modal').hidden = true; confirmCb = null; S.oqReport = null; }

/* ---------- portal shell ---------- */
function openPortal(role, view) {
  const sameRole = S.role === (role || 'choose');
  S.open = true; S.role = role || 'choose'; S.view = view || (sameRole ? S.view : null);   /* re-opening the same role keeps its page */
  S.screenKey = null;
  $('#portal').hidden = false;
  document.body.style.overflow = 'hidden';
  render();
}
function closePortal() {
  S.oqReport = null; S.open = false; $('#portal').hidden = true; document.body.style.overflow = '';
  S.screenKey = null;
  persistSession();
}
/* #portal can be re-created by the React page (re-mount, language/translate re-render) while S says the portal is open.
   Redraw from the EXISTING S into the current container: nothing in S is reset. */
function resumePortal() {
  const el = $('#portal'); if (!el) return;
  const obs = window.__annsaarthiCoverageObserver;           /* it watches the old #portal node: point it at the new one */
  if (obs) { try { obs.disconnect(); obs.observe(el, { childList: true, subtree: true }); } catch (err) { /* ignore */ } }
  if (!S.open) return;
  el.hidden = false; document.body.style.overflow = 'hidden';
  S.screenKey = null;
  render();
}
function keepPortalOnScreen() {
  if (!S.open) return;
  const el = $('#portal');
  if (el && (el.hidden || !el.firstElementChild)) resumePortal();
}
function go(view) { S.view = view; S.sideOpen = false; render(); const pm = $('#p-main'); if (pm) pm.scrollTop = 0; }

const LANGUAGE_LABELS = {
  en: { farmer:'Farmer', officer:'Mandi officer', admin:'Admin', display:'Mandi display', choose:'Choose an interface', dashboard:'Dashboard', book:'Book a slot', token:'My token', journey:'Procurement journey', payments:'Payments & receipt', history:'History', profile:'Profile & KYC', alerts:'Notifications', help:'Help', today:"Today's bookings", checkin:'Check-in & verification', quality:'Quality check', sections:'Section queues', weighing:'Weighing & procurement', pay:'Payment updates', applications:'Farmer applications', menu:'Menu', switch:'Switch interface', signout:'Sign out', close:'Close portal', live:'Live updates', currentStage:'Current stage', nextStage:'Next stage', farmersAhead:'Farmers ahead', currentlyServing:'Currently serving', estimatedWait:'Estimated wait', nextStageTime:'Estimated time to next stage', assignedSection:'Assigned section', actionRequired:'What you need to do', alertsLabel:'Important update', noAlert:'No action required right now', noActive:'No active procurement', refresh:'Refresh status', completed:'Procurement complete', liveUpdated:'Live status', yourAccount:'Your account', records:'Records', todayGroup:'Today', registrations:'Registrations', operations:'Operations', configuration:'Configuration', verificationStatus:'Verification status', currentToken:'Current token', qualitySection:'Quality section / counter', weighingSection:'Assigned weighing section', progress:'Progress through procurement', estimatedCalling:'Estimated calling time', recommendedArrival:'Recommended arrival', documentIssue:'Document / problem notification', expectedPayment:'Expected payment / update', currentlyVerified:'Currently being verified', currentlyAssessed:'Currently being assessed', currentWeighing:'Current weighing token', paymentCompleteTitle:'Procurement complete', quantity:'Quantity', quality:'Quality', amount:'Amount', payment:'Payment', paymentProcessing:'Processing', actionRequiredShort:'Action required' },
  mr: { farmer:'शेतकरी', officer:'खरेदी अधिकारी', admin:'प्रशासक', display:'मंडी डिस्प्ले', choose:'इंटरफेस निवडा', dashboard:'डॅशबोर्ड', book:'स्लॉट बुक करा', token:'माझा टोकन', journey:'खरेदी प्रवास', payments:'पेमेंट व पावती', history:'इतिहास', profile:'प्रोफाइल व KYC', alerts:'सूचना', help:'मदत', today:'आजच्या नोंदणी', checkin:'चेक-इन व पडताळणी', quality:'गुणवत्ता तपासणी', sections:'विभाग रांगा', weighing:'वजन व खरेदी', pay:'पेमेंट अपडेट्स', applications:'शेतकरी अर्ज', menu:'मेनू', switch:'इंटरफेस बदला', signout:'साइन आउट', close:'बंद करा', live:'थेट अपडेट्स', currentStage:'सध्याचा टप्पा', nextStage:'पुढील टप्पा', farmersAhead:'पुढे असलेले शेतकरी', currentlyServing:'सध्या सेवा', estimatedWait:'अंदाजे प्रतीक्षा', nextStageTime:'पुढील टप्प्यासाठी अंदाजे वेळ', assignedSection:'नेमलेला विभाग', actionRequired:'तुम्हाला काय करायचे आहे', alertsLabel:'महत्त्वाची सूचना', noAlert:'सध्या कोणतीही कृती आवश्यक नाही', noActive:'सध्या कोणतीही सक्रिय खरेदी नाही', refresh:'स्थिती अपडेट करा', completed:'खरेदी पूर्ण', liveUpdated:'थेट स्थिती', yourAccount:'तुमचे खाते', records:'नोंदी', todayGroup:'आज', registrations:'नोंदणी', operations:'कामकाज', configuration:'सेटिंग्ज', verificationStatus:'पडताळणी स्थिती', currentToken:'सध्याचा टोकन', qualitySection:'गुणवत्ता विभाग / काउंटर', weighingSection:'नेमलेला वजन विभाग', progress:'खरेदी प्रक्रियेतील प्रगती', estimatedCalling:'अंदाजे बोलावण्याची वेळ', recommendedArrival:'शिफारस केलेली आगमन वेळ', documentIssue:'कागदपत्र / अडचणीची सूचना', expectedPayment:'अपेक्षित पेमेंट / अपडेट', currentlyVerified:'सध्या पडताळला जात आहे', currentlyAssessed:'सध्या तपासला जात आहे', currentWeighing:'सध्याचा वजन टोकन', paymentCompleteTitle:'खरेदी पूर्ण', quantity:'प्रमाण', quality:'गुणवत्ता', amount:'रक्कम', payment:'पेमेंट', paymentProcessing:'प्रक्रियेत', actionRequiredShort:'कृती आवश्यक' },
  hi: { farmer:'किसान', officer:'खरीद अधिकारी', admin:'प्रशासक', display:'मंडी डिस्प्ले', choose:'इंटरफेस चुनें', dashboard:'डैशबोर्ड', book:'स्लॉट बुक करें', token:'मेरा टोकन', journey:'खरीद यात्रा', payments:'भुगतान व रसीद', history:'इतिहास', profile:'प्रोफाइल व KYC', alerts:'सूचनाएँ', help:'मदद', today:'आज की बुकिंग', checkin:'चेक-इन व सत्यापन', quality:'गुणवत्ता जाँच', sections:'सेक्शन कतार', weighing:'वजन व खरीद', pay:'भुगतान अपडेट', applications:'किसान आवेदन', menu:'मेनू', switch:'इंटरफेस बदलें', signout:'साइन आउट', close:'बंद करें', live:'लाइव अपडेट्स', currentStage:'वर्तमान चरण', nextStage:'अगला चरण', farmersAhead:'आगे के किसान', currentlyServing:'अभी सेवा में', estimatedWait:'अनुमानित प्रतीक्षा', nextStageTime:'अगले चरण तक अनुमानित समय', assignedSection:'निर्धारित सेक्शन', actionRequired:'आपको क्या करना है', alertsLabel:'महत्वपूर्ण सूचना', noAlert:'अभी कोई कार्रवाई आवश्यक नहीं', noActive:'कोई सक्रिय खरीद नहीं', refresh:'स्थिति अपडेट करें', completed:'खरीद पूरी', liveUpdated:'लाइव स्थिति', yourAccount:'आपका खाता', records:'रिकॉर्ड', todayGroup:'आज', registrations:'पंजीकरण', operations:'संचालन', configuration:'सेटिंग्स', verificationStatus:'सत्यापन स्थिति', currentToken:'वर्तमान टोकन', qualitySection:'गुणवत्ता सेक्शन / काउंटर', weighingSection:'निर्धारित तौल सेक्शन', progress:'खरीद प्रक्रिया की प्रगति', estimatedCalling:'अनुमानित बुलाने का समय', recommendedArrival:'अनुशंसित आगमन', documentIssue:'दस्तावेज़ / समस्या सूचना', expectedPayment:'अपेक्षित भुगतान / अपडेट', currentlyVerified:'अभी सत्यापन में', currentlyAssessed:'अभी जाँच में', currentWeighing:'वर्तमान तौल टोकन', paymentCompleteTitle:'खरीद पूरी', quantity:'मात्रा', quality:'गुणवत्ता', amount:'राशि', payment:'भुगतान', paymentProcessing:'प्रक्रिया में', actionRequiredShort:'कार्रवाई आवश्यक' }
};
LANGUAGE_LABELS.en.oqNav = 'Onion quality assessment'; LANGUAGE_LABELS.mr.oqNav = 'कांदा गुणवत्ता मूल्यांकन'; LANGUAGE_LABELS.hi.oqNav = 'प्याज़ गुणवत्ता आकलन';
function tr(key, fallback) { return (LANGUAGE_LABELS[S.language] && LANGUAGE_LABELS[S.language][key]) || fallback || key; }

const STAGE_NAMES = {
  en: { REGISTERED:'Registration', DOCUMENT_VERIFIED:'Document verification', SLOT_BOOKED:'Slot booked', TOKEN_GENERATED:'Main queue', CHECKED_IN:'Check-in', VERIFICATION_COMPLETE:'Verification', QUALITY_PENDING:'Quality assessment', QUALITY_ASSESSED:'Quality assessed', QUALITY_TOKEN_GENERATED:'Quality token', SECTION_ASSIGNED:'Section assigned', WEIGHING_PENDING:'Weighing', WEIGHED:'Weighing complete', PROCUREMENT_COMPLETE:'Procurement complete', PAYMENT_PENDING:'Payment processing', PAYMENT_COMPLETE:'Payment completed' },
  mr: { REGISTERED:'नोंदणी', DOCUMENT_VERIFIED:'कागदपत्र पडताळणी', SLOT_BOOKED:'स्लॉट बुक', TOKEN_GENERATED:'मुख्य रांग', CHECKED_IN:'चेक-इन', VERIFICATION_COMPLETE:'पडताळणी', QUALITY_PENDING:'गुणवत्ता तपासणी', QUALITY_ASSESSED:'गुणवत्ता तपासली', QUALITY_TOKEN_GENERATED:'गुणवत्ता टोकन', SECTION_ASSIGNED:'विभाग नेमला', WEIGHING_PENDING:'वजन', WEIGHED:'वजन पूर्ण', PROCUREMENT_COMPLETE:'खरेदी पूर्ण', PAYMENT_PENDING:'पेमेंट प्रक्रिया', PAYMENT_COMPLETE:'पेमेंट पूर्ण' },
  hi: { REGISTERED:'पंजीकरण', DOCUMENT_VERIFIED:'दस्तावेज़ सत्यापन', SLOT_BOOKED:'स्लॉट बुक', TOKEN_GENERATED:'मुख्य कतार', CHECKED_IN:'चेक-इन', VERIFICATION_COMPLETE:'सत्यापन', QUALITY_PENDING:'गुणवत्ता जाँच', QUALITY_ASSESSED:'गुणवत्ता जाँची गई', QUALITY_TOKEN_GENERATED:'गुणवत्ता टोकन', SECTION_ASSIGNED:'सेक्शन निर्धारित', WEIGHING_PENDING:'वजन', WEIGHED:'वजन पूरा', PROCUREMENT_COMPLETE:'खरीद पूरी', PAYMENT_PENDING:'भुगतान प्रक्रिया', PAYMENT_COMPLETE:'भुगतान पूरा' }
};
function localizedStage(key) { return (STAGE_NAMES[S.language] && STAGE_NAMES[S.language][key]) || stageTitle(key); }

const LIVE_COPY = {
  en: {
    arrive:'Please arrive at the procurement centre during your assigned slot.', waitVerification:'Please wait for identity verification.', remain:'Please remain available near your assigned section.', proceed:'Please proceed to your assigned section when your token is called.', finalizing:'Your procurement amount is being finalized.', completePayment:'Procurement is complete. Check payment updates for the final amount.', processing:'Payment is being processed. No action is required right now.', paid:'Payment is complete. Open Payments & receipt to download your receipt.', noAction:'Please stay available for the next update.', verification:'Verification desk', quality:'Quality Section Q-2', weighing:'Weighing Section 3', payment:'Payment desk', tokenPayment:'Token / payment', amountLabel:'Amount', paymentStatusLabel:'Payment status', quantityLabel:'Quantity', qualityLabel:'Quality', verificationWaiting:'Waiting for verification', verificationCurrent:'Verification in progress', paidShort:'Paid', processingShort:'Processing', notStartedShort:'Not started', qualityDelayTitle:'Quality section Q-2 is currently experiencing a 10-minute delay.', qualityDelayBody:'Your queue position is safe. Please remain available near the assigned section.'
  },
  mr: {
    arrive:'तुमच्या दिलेल्या स्लॉटच्या वेळेत खरेदी केंद्रावर पोहोचा.', waitVerification:'कृपया ओळख पडताळणीसाठी प्रतीक्षा करा.', remain:'कृपया नेमलेल्या विभागाजवळ उपलब्ध राहा.', proceed:'तुमचा टोकन क्रमांक पुकारल्यावर नेमलेल्या विभागात जा.', finalizing:'तुमची खरेदीची रक्कम निश्चित केली जात आहे.', completePayment:'खरेदी पूर्ण झाली आहे. अंतिम रकमेची पेमेंट अपडेट पहा.', processing:'पेमेंट प्रक्रियेत आहे. सध्या कोणतीही कृती आवश्यक नाही.', paid:'पेमेंट पूर्ण झाले आहे. पावती डाउनलोड करण्यासाठी पेमेंट व पावती उघडा.', noAction:'पुढील अपडेटसाठी कृपया उपलब्ध राहा.', verification:'पडताळणी कक्ष', quality:'गुणवत्ता विभाग Q-2', weighing:'वजन विभाग 3', payment:'पेमेंट कक्ष', tokenPayment:'टोकन / पेमेंट', amountLabel:'रक्कम', paymentStatusLabel:'पेमेंट स्थिती', quantityLabel:'प्रमाण', qualityLabel:'गुणवत्ता', verificationWaiting:'पडताळणीची प्रतीक्षा', verificationCurrent:'पडताळणी सुरू आहे', paidShort:'पेमेंट झाले', processingShort:'प्रक्रियेत', notStartedShort:'सुरू झालेले नाही', qualityDelayTitle:'गुणवत्ता विभाग Q-2 मध्ये सध्या 10 मिनिटांचा विलंब आहे.', qualityDelayBody:'तुमची रांगेतील जागा सुरक्षित आहे. कृपया नेमलेल्या विभागाजवळ उपलब्ध राहा.'
  },
  hi: {
    arrive:'अपने निर्धारित स्लॉट के दौरान खरीद केंद्र पर पहुँचें।', waitVerification:'कृपया पहचान सत्यापन के लिए प्रतीक्षा करें।', remain:'कृपया निर्धारित सेक्शन के पास उपलब्ध रहें।', proceed:'आपका टोकन बुलाए जाने पर निर्धारित सेक्शन में जाएँ।', finalizing:'आपकी खरीद राशि अंतिम रूप दी जा रही है।', completePayment:'खरीद पूरी हो गई है। अंतिम राशि के लिए भुगतान अपडेट देखें।', processing:'भुगतान प्रक्रिया में है। अभी किसी कार्रवाई की आवश्यकता नहीं है।', paid:'भुगतान पूरा हो गया है। रसीद डाउनलोड करने के लिए भुगतान व रसीद खोलें।', noAction:'अगले अपडेट के लिए कृपया उपलब्ध रहें।', verification:'सत्यापन डेस्क', quality:'गुणवत्ता सेक्शन Q-2', weighing:'वजन सेक्शन 3', payment:'भुगतान डेस्क', tokenPayment:'टोकन / भुगतान', amountLabel:'राशि', paymentStatusLabel:'भुगतान स्थिति', quantityLabel:'मात्रा', qualityLabel:'गुणवत्ता', verificationWaiting:'सत्यापन की प्रतीक्षा', verificationCurrent:'सत्यापन जारी है', paidShort:'भुगतान हो गया', processingShort:'प्रक्रिया में', notStartedShort:'शुरू नहीं हुआ', qualityDelayTitle:'गुणवत्ता सेक्शन Q-2 में अभी 10 मिनट की देरी है।', qualityDelayBody:'आपकी कतार की स्थिति सुरक्षित है। कृपया निर्धारित सेक्शन के पास उपलब्ध रहें।'
  }
};
function liveCopy(key) { return (LIVE_COPY[S.language] && LIVE_COPY[S.language][key]) || LIVE_COPY.en[key]; }

const NAV = {
  farmer: [
    ['yourAccount', [['dash', 'Dashboard'], ['book', 'Book a slot'], ['token', 'My token'], ['journey', 'Procurement journey']]],
    ['records', [['payments', 'Payments & receipt'], ['reports', 'Quality reports'], ['history', 'History'], ['profile', 'Profile & KYC'], ['alerts', 'Notifications'], ['help', 'Help']]]
  ],
  officer: [
    ['todayGroup', [['today', "Today's bookings"], ['checkin', 'Check-in & verification'], ['quality', 'Quality check'], ['sections', 'Section queues'], ['weighing', 'Weighing & procurement'], ['pay', 'Payment updates']]],
    ['registrations', [['applications', 'Farmer applications']]]
  ],
  admin: [
    ['operations', [['overview', 'Today at a glance'], ['livequeue', 'Live queue'], ['applications', 'Applications']]],
    ['configuration', [['centres', 'Procurement centres'], ['schedules', 'Schedules & capacity'], ['slotcfg', 'Slot & booking rules'], ['farmers', 'Registered farmers']]]
  ]
};
const DEFAULT_VIEW = { farmer: 'dash', officer: 'today', admin: 'overview', display: 'wall', choose: 'choose' };


const PORTAL_PHOTOS = {
  choose: ['https://images.unsplash.com/photo-1708513519406-d073dd00783d?auto=format&fit=crop&w=1000&q=78','A field-side view of Indian farmers','A human, agricultural welcome to the AnnSaarthi prototype.'],
  dash: ['https://images.unsplash.com/photo-1623211270083-5743da6c67ec?auto=format&fit=crop&w=1000&q=78','Your procurement journey','A clear view of the people and farms behind every procurement journey.'],
  book: ['https://images.unsplash.com/photo-1709633858999-7573d9c5d40d?auto=format&fit=crop&w=1000&q=78','Plan your arrival','Choose a slot before you travel to the procurement centre.'],
  token: ['https://images.unsplash.com/photo-1708417134532-58723b020afe?auto=format&fit=crop&w=1000&q=78','Your queue, made visible','Your token keeps the procurement journey organized.'],
  journey: ['https://images.unsplash.com/photo-1633410195091-bd66114cef5f?auto=format&fit=crop&w=1000&q=78','Every stage connected','Follow quality, weighing and payment from one place.'],
  payments: ['https://images.unsplash.com/photo-1708417152710-17d9711165e9?auto=format&fit=crop&w=1000&q=78','Transparent payment','See the final amount, payment status and receipt in one place.'],
  history: ['https://images.unsplash.com/photo-1708417148451-addac93f0b67?auto=format&fit=crop&w=1000&q=78','Your procurement history','Keep completed procurement records easy to revisit.'],
  profile: ['https://images.unsplash.com/photo-1723540067157-7d7e3a757a29?auto=format&fit=crop&w=1000&q=78','Your farmer profile','Keep your registration and verification information organized.'],
  alerts: ['https://images.unsplash.com/photo-1708513519406-d073dd00783d?auto=format&fit=crop&w=1000&q=78','Important updates','Stay informed about delays, document issues and payment updates.'],
  help: ['https://images.unsplash.com/photo-1623211270083-5743da6c67ec?auto=format&fit=crop&w=1000&q=78','Help when you need it','Get simple guidance throughout the procurement process.'],
  today: ['https://images.unsplash.com/photo-1709633858999-7573d9c5d40d?auto=format&fit=crop&w=1000&q=78','Mandi operations','A live operational view of today’s procurement activity.'],
  checkin: ['https://images.unsplash.com/photo-1708417134532-58723b020afe?auto=format&fit=crop&w=1000&q=78','Check-in & verification','Move farmers through the gate and verification stage smoothly.'],
  quality: ['https://images.unsplash.com/photo-1633410195091-bd66114cef5f?auto=format&fit=crop&w=1000&q=78','Quality assessment','Record crop quality decisions with a clear workflow.'],
  sections: ['https://images.unsplash.com/photo-1708417152710-17d9711165e9?auto=format&fit=crop&w=1000&q=78','Section queues','See where each quality or weighing token needs to go.'],
  weighing: ['https://images.unsplash.com/photo-1708417148451-addac93f0b67?auto=format&fit=crop&w=1000&q=78','Weighing & procurement','Complete weighing and move the record toward payment.'],
  pay: ['https://images.unsplash.com/photo-1723540067157-7d7e3a757a29?auto=format&fit=crop&w=1000&q=78','Payment updates','Close the procurement cycle with a clear payment record.'],
  overview: ['https://images.unsplash.com/photo-1708513519406-d073dd00783d?auto=format&fit=crop&w=1000&q=78','Today at a glance','Monitor the centre from one operational view.'],
  livequeue: ['https://images.unsplash.com/photo-1623211270083-5743da6c67ec?auto=format&fit=crop&w=1000&q=78','Live queue','Watch movement across the procurement queue.'],
  applications: ['https://images.unsplash.com/photo-1709633858999-7573d9c5d40d?auto=format&fit=crop&w=1000&q=78','Farmer applications','Review registrations before farmers enter the procurement flow.'],
  centres: ['https://images.unsplash.com/photo-1708417134532-58723b020afe?auto=format&fit=crop&w=1000&q=78','Procurement centres','Keep centre information clear and accessible.'],
  schedules: ['https://images.unsplash.com/photo-1633410195091-bd66114cef5f?auto=format&fit=crop&w=1000&q=78','Schedules & capacity','Plan procurement capacity around farmer arrivals.'],
  slotcfg: ['https://images.unsplash.com/photo-1708417152710-17d9711165e9?auto=format&fit=crop&w=1000&q=78','Slot & booking rules','Keep scheduling rules consistent and transparent.'],
  farmers: ['https://images.unsplash.com/photo-1708417148451-addac93f0b67?auto=format&fit=crop&w=1000&q=78','Registered farmers','Keep farmer records organized for operations.'],
  wall: ['https://images.unsplash.com/photo-1723540067157-7d7e3a757a29?auto=format&fit=crop&w=1000&q=78','Mandi live display','A simple public view of current procurement movement.']
};
function addPortalPagePhoto(){
  if (!S.open) return;
  const host = S.role === 'display' ? document.querySelector('#portal .display-wall') : document.querySelector('#portal .pwrap');
  if (!host || host.querySelector('.portal-page-photo')) return;
  const data = PORTAL_PHOTOS[S.view] || PORTAL_PHOTOS.choose;
  const copy = S.language === 'mr'
    ? ['अन्नसारथी', 'शेतकऱ्यांसाठी स्पष्ट आणि सोपा खरेदी प्रवास.', 'प्रक्रियेतील महत्त्वाची माहिती एका ठिकाणी.']
    : S.language === 'hi'
      ? ['अन्नसारथी', 'किसानों के लिए स्पष्ट और आसान खरीद यात्रा।', 'प्रक्रिया की महत्वपूर्ण जानकारी एक ही जगह।']
      : [data[1], data[2], ''];
  const card=document.createElement('div'); card.className='portal-page-photo';
  card.innerHTML=`<div class="portal-page-photo__copy"><div class="portal-page-photo__eyebrow">${esc(copy[0])}</div><h2 class="portal-page-photo__title">${esc(copy[1])}</h2><p class="portal-page-photo__text">${esc(copy[2] || data[2])}</p></div><div class="portal-page-photo__media"><img src="${data[0]}" alt="${esc(data[1])}" loading="lazy" referrerpolicy="no-referrer"></div>`;
  if (S.role === 'display') {
    card.classList.add('portal-page-photo--compact');
    const first = host.firstElementChild;
    if (first) first.insertAdjacentElement('afterend', card); else host.prepend(card);
  } else {
    host.prepend(card);
  }
}

function render() {
  scheduleBackendSave();
  const portal = $('#portal');
  if (!S.open) return;

  // Preserve the user's position while the registration UI is re-rendered.
  // Rebuilding the portal with innerHTML otherwise makes the browser jump to the top.
  const preserveRegScroll = !!S.reg;
  const savedWindowScrollY = preserveRegScroll ? window.scrollY : 0;
  const currentMain = document.getElementById('p-main');
  const savedMainScrollTop = preserveRegScroll && currentMain ? currentMain.scrollTop : 0;

  // Preserve every registration field before replacing the portal DOM.
  // This prevents the registration form from appearing to refresh/reset.
  if (S.reg) collectStep();
  if (!S.view) S.view = DEFAULT_VIEW[S.role];
  if (!S.farmerId && S.pending && S.pending.farmerId) {   // approved while they were waiting
    const approvedId = S.pending.farmerId; resetFarmerSessionState(); S.farmerId = approvedId;
    if (!S.view || S.view === 'pending') S.view = 'dash';
  }
  const roleLabel = tr(S.role, { farmer: 'Farmer', officer: 'Mandi officer', admin: 'Admin', display: 'Mandi display', choose: 'Choose an interface' }[S.role]);
  const needsAuth = S.role === 'farmer' && !S.farmerId;
  const showSide = !['choose', 'display'].includes(S.role) && !needsAuth;

  portal.innerHTML = `
    <div class="pbar">
      <span class="pbar__brand"><svg aria-hidden="true"><use href="#logo-mark"/></svg> AnnSaarthi</span>
      <span class="pbar__role">${esc(roleLabel)}</span>
      <span class="demo-flag">Prototype · demo data</span>
      <span class="pbar__spacer"></span>
      <span class="pbar__languages" aria-label="Language"><button class="pbar__lang${S.uiLang === 'en' ? ' is-on' : ''}" data-act="lang" data-lang="en">EN</button><button class="pbar__lang${S.uiLang === 'mr' ? ' is-on' : ''}" data-act="lang" data-lang="mr">मराठी</button><button class="pbar__lang${S.uiLang === 'hi' ? ' is-on' : ''}" data-act="lang" data-lang="hi">हिंदी</button></span>
      ${showSide ? `<button class="pbar__btn pside__toggle" data-act="side">${tr('menu','Menu')}</button>` : ''}
      ${S.role !== 'choose' ? `<button class="pbar__btn" data-act="switch">${tr('switch','Switch interface')}</button>` : ''}
      ${S.role === 'farmer' && S.farmerId ? `<button class="pbar__btn" data-act="logout">${tr('signout','Sign out')}</button>` : ''}
      <button class="pbar__btn" data-act="exit">${tr('close','Close portal')}</button>
    </div>
    <div class="pshell">
      ${showSide ? renderSide() : ''}
      <div class="pmain" id="p-main">${safeRenderView(needsAuth)}</div>
    </div>
    <div class="modal" id="p-modal" hidden></div>`;

  // Restore registration scroll position after the new DOM has been painted.
  // This prevents state/district/file/OTP updates from jumping to the page top.
  if (preserveRegScroll) {
    requestAnimationFrame(() => {
      window.scrollTo({ top: savedWindowScrollY, behavior: 'auto' });
      const newMain = document.getElementById('p-main');
      if (newMain) newMain.scrollTop = savedMainScrollTop;
    });
  }

  // Automatic live-refresh disabled to prevent every portal page from
  // re-rendering/resetting itself. All pages now remain stable until the
  // user performs an action or explicitly refreshes live status.
  clearTimeout(liveRefreshTimer);
  liveRefreshTimer = null;
}

function renderSide() {
  const groups = NAV[S.role] || [];
  const badge = (key) => {
    if (S.role === 'admin' && key === 'applications') { const n = DB.applications.filter((a) => ['SUBMITTED', 'UNDER_REVIEW'].includes(a.status)).length; return n ? '<span class="dot" aria-hidden="true"></span>' : ''; }
    if (S.role === 'officer' && key === 'applications') { const n = DB.applications.filter((a) => ['SUBMITTED', 'UNDER_REVIEW'].includes(a.status)).length; return n ? '<span class="dot" aria-hidden="true"></span>' : ''; }
    if (S.role === 'farmer' && key === 'alerts') { const n = DB.notifications.filter((x) => x.farmerId === S.farmerId && !x.read).length; return n ? '<span class="dot" aria-hidden="true"></span>' : ''; }
    return '';
  };
  return `<nav class="pside${S.sideOpen ? ' is-open' : ''}" aria-label="Portal sections">
    ${groups.map(([g, items]) => `<p class="pside__group">${esc(g)}</p>${items.map(([k, label]) =>
      `<button class="pside__link${S.view === k ? ' is-active' : ''}" data-go="${k}"${S.view === k ? ' aria-current="page"' : ''}>${esc(tr((S.role === 'officer' && k === 'quality') ? 'oqNav' : k, label))}${badge(k)}</button>`).join('')}`).join('')}
    ${S.role === 'officer' ? `<p class="pside__group">Public screen</p><button class="pside__link" data-act="display">Mandi display wall</button>` : ''}
    <button class="pside__link pside__reset" data-act="reset-demo">
    ↻ Reset Demo
    </button>
  </nav>`;
}

function renderView(needsAuth) {
  if (S.role === 'choose') return viewChooser();
  if (S.role === 'display') return viewDisplayWall();
  if (S.role === 'farmer') return needsAuth ? viewFarmerAuth() : farmerViews();
  if (S.role === 'officer') return officerViews();
  if (S.role === 'admin') return adminViews();
  return '';
}

/* A view that throws (e.g. it references a token/farmer that is not loaded yet) must not leave the portal blank or
   half-drawn, and must not reset the session: show a recoverable message and keep S.role/S.view/S.farmerId as they are. */
function safeRenderView(needsAuth) {
  try { return renderView(needsAuth); }
  catch (err) {
    console.error('Portal view failed to render (' + S.role + '/' + S.view + '):', err);
    const home = DEFAULT_VIEW[S.role] || 'choose';
    return `<div class="pwrap"><h1 class="ptitle">This page could not be displayed</h1>
      <p class="plead">Your session and data are safe. Go back to the main page of this interface and try again.</p>
      <button class="btn btn--primary" data-go="${esc(home)}">Back to main page</button></div>`;
  }
}

function viewChooser() {
  const pending = DB.applications.filter((a) => ['SUBMITTED', 'UNDER_REVIEW'].includes(a.status)).length;
  return `<div class="pwrap">
    <h1 class="ptitle">Open an interface</h1>
    <p class="plead">Three roles share one procurement record. Everything below runs on fictional demo data — no real scheme, no real identity or bank information.</p>
    <div class="grid grid--3">
      <button class="pick" data-role="farmer"><p class="pick__t">Farmer</p>
        <p class="muted">Register, book a slot, get a token, track the journey, see the payment and receipt.</p>
        <p class="mt-sm"><span class="st st--ok">Demo login 9822001842</span></p></button>
      <button class="pick" data-role="officer"><p class="pick__t">Mandi officer</p>
        <p class="muted">Today's bookings, check-in, quality grading, section routing, weighing and payment updates.</p>
        <p class="mt-sm"><span class="st st--wait">⏳ ${pending} application${pending === 1 ? '' : 's'} to verify</span></p></button>
      <button class="pick" data-role="admin"><p class="pick__t">Admin dashboard</p>
        <p class="muted">Live counts, queue per counter, centres, schedules, capacity and booking rules.</p>
        <p class="mt-sm"><span class="st st--off">Can be merged into the officer interface</span></p></button>
    </div>
    <div class="card mt">
      <div class="card__head"><h2 class="card__title">Public display</h2>
        <button class="btn btn--secondary btn--sm" data-act="display">Open mandi display wall</button></div>
      <p class="muted">A full-screen board for the centre showing the token now being served at each counter.</p>
    </div>
  </div>`;
}

/* ---------- registration form safety ---------- */
// Keep registration data in memory on every keystroke so a UI re-render never loses typed details.
document.addEventListener('input', (e) => {
  if (!S.reg) return;
  const el = e.target;
  if (el.matches('input, textarea, select')) collectStep();
});

// Registration is a client-side prototype, so prevent accidental native form submission/page reloads.
document.addEventListener('submit', (e) => {
  if (S.reg) e.preventDefault();
});

/* ---------- landing-page language ---------- */
const LANDING_LANG = {
  en: {
    navHome:'Home', navHow:'How It Works', navFeatures:'Features', openPortal:'Open Portal',
    heroTitle:'From Mandi Arrival to Payment — Every Step, Clear.',
    heroLead:'AnnSaarthi brings farmers, procurement officials and mandi operations onto one transparent digital journey.',
    farmerPortal:'Farmer Portal', officialPortal:'Official Portal', greenQueue:'Green queue', demo:'Demo data', currentToken:'Current token', qualityApproved:'Quality Approved', currentlyServing:'Currently serving', queue:'Queue', heroCaption:'Prototype interface. All values shown are demo data.',
    journeyTitle:'One Journey. Every Stage Connected.',
    stages:[['Book Slot','Choose a delivery time before leaving the farm.'],['Arrive at Mandi','Reach the procurement centre and report your arrival.'],['Quality Check','An official inspects the crop at the mandi and marks it Green or Red.'],['Green Queue','Approved crops receive a token and wait in a visible queue.'],['Weighing','The crop is weighed and the payable amount is calculated.'],['Payment','Track payment status and receive a digital receipt.']],
    why:'Why AnnSaarthi', farmer:'Farmer', farmerText:'Know when to arrive, where you stand in the queue, and what happens next.', official:'Official', officialText:'Manage arrivals, quality decisions, queue movement and weighing from one dashboard.', mandi:'Mandi', mandiText:'Keep procurement movement organized with a live token-based queue.', mandiDisplay:'Open Mandi Display',
    previewTitle:'Follow One Delivery from Slot to Receipt.', crop:'Crop', quantity:'Quantity', token:'Token', timeline:['Slot Booked','Arrived','Quality Approved','Green Queue','Weighing','Payment','Receipt'], inProgress:'In progress', timelineNote:'Now serving PUN-014. Two tokens ahead.',
    less:'Less uncertainty', lessText:'Slot, queue position and procurement status stay visible to the farmer.', visibility:'Better queue visibility', visibilityText:'A token-based queue shows who is being served and who is next.', tracking:'Transparent procurement tracking', trackingText:'Every stage from arrival to payment is easy to follow.', sih:'Designed as an SIH prototype', cta:'Make Every Procurement Journey Predictable.', ctaText:'AnnSaarthi connects the steps between arrival, acceptance, weighing and payment.', explore:'Explore AnnSaarthi', footerTag:'Smart Procurement • Transparent Payments', footerProto:'Prototype for Smart India Hackathon', footerNote:'Queue and token values on this page are demo data.'
  },
  mr: {
    navHome:'मुख्यपृष्ठ', navHow:'कसे कार्य करते', navFeatures:'वैशिष्ट्ये', openPortal:'पोर्टल उघडा',
    heroTitle:'मंडीमध्ये आगमनापासून पेमेंटपर्यंत — प्रत्येक टप्पा स्पष्ट.',
    heroLead:'अन्नसारथी शेतकरी, खरेदी अधिकारी आणि मंडीचे कामकाज एका पारदर्शक डिजिटल प्रवासाशी जोडते.',
    farmerPortal:'शेतकरी पोर्टल', officialPortal:'अधिकारी पोर्टल', greenQueue:'हिरवी रांग', demo:'डेमो डेटा', currentToken:'सध्याचा टोकन', qualityApproved:'गुणवत्ता मंजूर', currentlyServing:'सध्या सेवा सुरू', queue:'रांग', heroCaption:'प्रोटोटाइप इंटरफेस. दाखवलेली सर्व माहिती डेमो डेटावर आधारित आहे.',
    journeyTitle:'एक प्रवास. प्रत्येक टप्पा जोडलेला.',
    stages:[['स्लॉट बुक करा','शेतातून निघण्यापूर्वी डिलिव्हरीची वेळ निवडा.'],['मंडीमध्ये पोहोचा','खरेदी केंद्रावर पोहोचा आणि आपल्या आगमनाची नोंद करा.'],['गुणवत्ता तपासणी','अधिकारी मंडीत पिकाची तपासणी करून हिरवा किंवा लाल दर्जा देतो.'],['हिरवी रांग','मंजूर पिकाला टोकन मिळते आणि पारदर्शक रांगेत प्रतीक्षा करावी लागते.'],['वजन','पिकाचे वजन करून देय रक्कम निश्चित केली जाते.'],['पेमेंट','पेमेंटची स्थिती पाहा आणि डिजिटल पावती मिळवा.']],
    why:'अन्नसारथी का?', farmer:'शेतकरी', farmerText:'कधी यायचे, रांगेत तुमची स्थिती काय आहे आणि पुढे काय होईल हे जाणून घ्या.', official:'अधिकारी', officialText:'आगमन, गुणवत्ता निर्णय, रांग आणि वजन एकाच डॅशबोर्डवर व्यवस्थापित करा.', mandi:'मंडी', mandiText:'थेट टोकन-आधारित रांगेने खरेदी प्रक्रिया व्यवस्थित ठेवा.', mandiDisplay:'मंडी डिस्प्ले उघडा',
    previewTitle:'स्लॉटपासून पावतीपर्यंत एका डिलिव्हरीचा प्रवास पाहा.', crop:'पीक', quantity:'प्रमाण', token:'टोकन', timeline:['स्लॉट बुक','आगमन झाले','गुणवत्ता मंजूर','हिरवी रांग','वजन','पेमेंट','पावती'], inProgress:'प्रगतीपथावर', timelineNote:'सध्या PUN-014 ची सेवा सुरू आहे. तुमच्या पुढे दोन टोकन आहेत.',
    less:'कमी अनिश्चितता', lessText:'स्लॉट, रांगेतील स्थान आणि खरेदीची स्थिती शेतकऱ्याला दिसत राहते.', visibility:'रांगेची स्पष्ट माहिती', visibilityText:'टोकन-आधारित रांगेत कोणाची सेवा सुरू आहे आणि पुढे कोण आहे हे दिसते.', tracking:'पारदर्शक खरेदी ट्रॅकिंग', trackingText:'आगमनापासून पेमेंटपर्यंत प्रत्येक टप्पा सहज पाहता येतो.', sih:'SIH प्रोटोटाइप म्हणून तयार केलेले', cta:'प्रत्येक खरेदीचा प्रवास अंदाज करता येण्यासारखा बनवा.', ctaText:'अन्नसारथी आगमन, स्वीकृती, वजन आणि पेमेंट यांना एका प्रक्रियेत जोडते.', explore:'अन्नसारथी पाहा', footerTag:'स्मार्ट खरेदी • पारदर्शक पेमेंट', footerProto:'स्मार्ट इंडिया हॅकाथॉनसाठी प्रोटोटाइप', footerNote:'या पृष्ठावरील रांग आणि टोकनची माहिती डेमो डेटावर आधारित आहे.'
  },
  hi: {
    navHome:'होम', navHow:'कैसे काम करता है', navFeatures:'विशेषताएँ', openPortal:'पोर्टल खोलें',
    heroTitle:'मंडी में आगमन से भुगतान तक — हर चरण स्पष्ट.',
    heroLead:'अन्नसारथी किसानों, खरीद अधिकारियों और मंडी संचालन को एक पारदर्शी डिजिटल यात्रा से जोड़ता है।',
    farmerPortal:'किसान पोर्टल', officialPortal:'अधिकारी पोर्टल', greenQueue:'हरी कतार', demo:'डेमो डेटा', currentToken:'वर्तमान टोकन', qualityApproved:'गुणवत्ता स्वीकृत', currentlyServing:'अभी सेवा में', queue:'कतार', heroCaption:'प्रोटोटाइप इंटरफेस। दिखाई गई सभी जानकारी डेमो डेटा है।',
    journeyTitle:'एक यात्रा। हर चरण जुड़ा हुआ।',
    stages:[['स्लॉट बुक करें','खेत से निकलने से पहले डिलीवरी का समय चुनें।'],['मंडी पहुँचें','खरीद केंद्र पर पहुँचकर अपने आगमन की सूचना दें।'],['गुणवत्ता जाँच','अधिकारी मंडी में फसल की जाँच करके हरा या लाल दर्जा देता है।'],['हरी कतार','स्वीकृत फसल को टोकन मिलता है और स्पष्ट कतार में प्रतीक्षा करनी होती है।'],['वजन','फसल का वजन करके देय राशि की गणना की जाती है।'],['भुगतान','भुगतान की स्थिति देखें और डिजिटल रसीद प्राप्त करें।']],
    why:'अन्नसारथी क्यों?', farmer:'किसान', farmerText:'कब पहुँचना है, कतार में आपकी स्थिति क्या है और आगे क्या होगा, जानें।', official:'अधिकारी', officialText:'आगमन, गुणवत्ता निर्णय, कतार और वजन को एक ही डैशबोर्ड से संभालें।', mandi:'मंडी', mandiText:'लाइव टोकन-आधारित कतार से खरीद प्रक्रिया को व्यवस्थित रखें।', mandiDisplay:'मंडी डिस्प्ले खोलें',
    previewTitle:'स्लॉट से रसीद तक एक डिलीवरी की पूरी यात्रा देखें।', crop:'फसल', quantity:'मात्रा', token:'टोकन', timeline:['स्लॉट बुक','पहुंच गए','गुणवत्ता स्वीकृत','हरी कतार','वजन','भुगतान','रसीद'], inProgress:'प्रगति में', timelineNote:'अभी PUN-014 की सेवा हो रही है। आपके आगे दो टोकन हैं।',
    less:'कम अनिश्चितता', lessText:'स्लॉट, कतार में स्थान और खरीद की स्थिति किसान को दिखाई देती रहती है।', visibility:'कतार की बेहतर जानकारी', visibilityText:'टोकन-आधारित कतार बताती है कि किसकी सेवा हो रही है और अगला कौन है।', tracking:'पारदर्शी खरीद ट्रैकिंग', trackingText:'आगमन से भुगतान तक हर चरण आसानी से देखा जा सकता है।', sih:'SIH प्रोटोटाइप के रूप में बनाया गया', cta:'हर खरीद यात्रा को अनुमानित बनाएं।', ctaText:'अन्नसारथी आगमन, स्वीकृति, वजन और भुगतान के चरणों को जोड़ता है।', explore:'अन्नसारथी देखें', footerTag:'स्मार्ट खरीद • पारदर्शी भुगतान', footerProto:'स्मार्ट इंडिया हैकाथॉन के लिए प्रोटोटाइप', footerNote:'इस पृष्ठ पर कतार और टोकन की जानकारी डेमो डेटा है।'
  }
};
/* Onion-quality wording for the landing page (replaces the old wheat / green-queue demo text). */
Object.assign(LANDING_LANG.en, {"heroTitle": "Onion Procurement with Transparent Quality Assessment -- Every Step, Clear.", "heroLead": "AnnSaarthi brings farmers and procurement officials onto one digital journey, with image-based onion quality assessment, Grade A / URS estimation and an instant digital quality report.", "greenQueue": "Main queue", "qualityApproved": "Quality report ready", "stages": [["Book Slot", "Choose a delivery time before leaving the farm."], ["Arrive at Mandi", "Reach the procurement centre and report your arrival."], ["Onion Quality Assessment", "The officer photographs your batch; an image-based assessment estimates Grade A and URS."], ["Digital Quality Report", "Defect findings and Grade A / URS are compiled into a report you can view."], ["Weighing", "The crop is weighed and the payable amount is calculated."], ["Payment", "Track payment status and receive a digital receipt."]], "farmerText": "Know when to arrive, track your queue position, and view your onion quality report.", "officialText": "Capture onion images, review standardized assessments, and manage weighing and payment from one dashboard.", "timeline": ["Slot Booked", "Arrived", "Images Captured", "Quality Assessment", "Weighing", "Payment", "Receipt"], "timelineNote": "Grade A / URS report is generated automatically.", "gradeUrs": "Grade A / URS", "tracking": "Transparent quality assessment", "trackingText": "Image-based assessment is designed to give every batch a consistent, traceable quality report.", "ctaText": "AnnSaarthi connects the steps between arrival, onion quality assessment, weighing and payment."});
Object.assign(LANDING_LANG.mr, {"heroTitle": "पारदर्शक गुणवत्ता मूल्यांकनासह कांदा खरेदी -- प्रत्येक पायरी स्पष्ट.", "heroLead": "अन्नसारथी शेतकरी आणि खरेदी अधिकाऱ्यांना एकाच डिजिटल प्रवासात आणते - प्रतिमा-आधारित कांदा गुणवत्ता मूल्यांकन, ग्रेड ए / URS अंदाज आणि तात्काळ डिजिटल गुणवत्ता अहवालासह.", "greenQueue": "मुख्य रांग", "qualityApproved": "गुणवत्ता अहवाल तयार", "stages": [["स्लॉट बुक करा", "शेतातून निघण्यापूर्वी डिलिव्हरीची वेळ निवडा."], ["मंडईत पोहोचा", "खरेदी केंद्रावर पोहोचून तुमचे आगमन नोंदवा."], ["कांदा गुणवत्ता मूल्यांकन", "अधिकारी तुमच्या मालाचे फोटो घेतात; प्रतिमा-आधारित मूल्यांकन ग्रेड ए आणि URS चा अंदाज देते."], ["डिजिटल गुणवत्ता अहवाल", "दोषांचे निष्कर्ष आणि ग्रेड ए / URS एकत्र करून तुम्हाला पाहता येईल असा अहवाल तयार होतो."], ["वजन", "माल तोलला जातो आणि देय रकमेची गणना केली जाते."], ["पेमेंट", "पेमेंटची स्थिती पहा आणि डिजिटल पावती मिळवा."]], "farmerText": "केव्हा यायचे ते जाणून घ्या, रांगेतील तुमचे स्थान पहा आणि तुमचा कांदा गुणवत्ता अहवाल पहा.", "officialText": "कांद्याच्या प्रतिमा घ्या, प्रमाणित मूल्यांकन पहा आणि वजन व पेमेंट एकाच डॅशबोर्डवरून हाताळा.", "timeline": ["स्लॉट बुक", "आगमन", "प्रतिमा घेतल्या", "गुणवत्ता मूल्यांकन", "वजन", "पेमेंट", "पावती"], "timelineNote": "ग्रेड ए / URS अहवाल आपोआप तयार होतो.", "gradeUrs": "ग्रेड ए / URS", "tracking": "पारदर्शक गुणवत्ता मूल्यांकन", "trackingText": "प्रतिमा-आधारित मूल्यांकन प्रत्येक बॅचसाठी सुसंगत, शोधण्यायोग्य गुणवत्ता अहवाल देण्यासाठी तयार केले आहे.", "ctaText": "अन्नसारथी आगमन, कांदा गुणवत्ता मूल्यांकन, वजन आणि पेमेंट यामधील पायऱ्या जोडते."});
Object.assign(LANDING_LANG.hi, {"heroTitle": "पारदर्शी गुणवत्ता मूल्यांकन के साथ प्याज खरीद -- हर कदम स्पष्ट।", "heroLead": "अन्नसारथी किसानों और खरीद अधिकारियों को एक डिजिटल यात्रा पर लाता है - छवि-आधारित प्याज गुणवत्ता मूल्यांकन, ग्रेड ए / URS अनुमान और तुरंत डिजिटल गुणवत्ता रिपोर्ट के साथ।", "greenQueue": "मुख्य कतार", "qualityApproved": "गुणवत्ता रिपोर्ट तैयार", "stages": [["स्लॉट बुक करें", "खेत से निकलने से पहले डिलीवरी का समय चुनें।"], ["मंडी पहुंचें", "खरीद केंद्र पहुंचकर अपनी उपस्थिति दर्ज करें।"], ["प्याज गुणवत्ता मूल्यांकन", "अधिकारी आपके माल की तस्वीरें लेते हैं; छवि-आधारित मूल्यांकन ग्रेड ए और URS का अनुमान देता है।"], ["डिजिटल गुणवत्ता रिपोर्ट", "दोषों के निष्कर्ष और ग्रेड ए / URS को मिलाकर एक रिपोर्ट बनती है जिसे आप देख सकते हैं।"], ["तौल", "माल तौला जाता है और देय राशि की गणना की जाती है।"], ["भुगतान", "भुगतान की स्थिति देखें और डिजिटल रसीद पाएं।"]], "farmerText": "जानें कब पहुंचना है, कतार में अपनी स्थिति देखें और अपनी प्याज गुणवत्ता रिपोर्ट देखें।", "officialText": "प्याज की तस्वीरें लें, मानकीकृत मूल्यांकन देखें और तौल व भुगतान एक ही डैशबोर्ड से संभालें।", "timeline": ["स्लॉट बुक", "पहुंचे", "तस्वीरें ली गईं", "गुणवत्ता मूल्यांकन", "तौल", "भुगतान", "रसीद"], "timelineNote": "ग्रेड ए / URS रिपोर्ट अपने आप बन जाती है।", "gradeUrs": "ग्रेड ए / URS", "tracking": "पारदर्शी गुणवत्ता मूल्यांकन", "trackingText": "छवि-आधारित मूल्यांकन हर बैच के लिए एकसमान, ट्रेस करने योग्य गुणवत्ता रिपोर्ट देने के लिए बनाया गया है।", "ctaText": "अन्नसारथी आगमन, प्याज गुणवत्ता मूल्यांकन, तौल और भुगतान के चरणों को जोड़ता है।"});

function applyLandingLanguage() {
  const t = LANDING_LANG[S.language] || LANDING_LANG.en;
  const set = (sel, val) => { const el = document.querySelector(sel); if (el) el.textContent = val; };
  const setAttr = (sel, attr, val) => { const el = document.querySelector(sel); if (el) el.setAttribute(attr, val); };
  set('.landing-language__label', S.language === 'mr' ? 'भाषा' : S.language === 'hi' ? 'भाषा' : 'Language');
  set('.brand__tagline', S.language === 'mr' ? 'स्मार्ट खरेदी • पारदर्शक पेमेंट' : S.language === 'hi' ? 'स्मार्ट खरीद • पारदर्शी भुगतान' : 'Smart Procurement • Transparent Payments');
  setAttr('.site-header nav','aria-label',S.language === 'mr' ? 'मुख्य नेव्हिगेशन' : S.language === 'hi' ? 'मुख्य नेविगेशन' : 'Primary');
  setAttr('.brand','aria-label',S.language === 'mr' ? 'अन्नसारथी मुख्यपृष्ठ' : S.language === 'hi' ? 'अन्नसारथी होम' : 'AnnSaarthi home');
  setAttr('.nav__toggle','aria-label',S.language === 'mr' ? 'मेनू उघडा' : S.language === 'hi' ? 'मेनू खोलें' : 'Open menu');
  set('.nav__link[href="#home"]', t.navHome); set('.nav__link[href="#how-it-works"]', t.navHow); set('.nav__link[href="#features"]', t.navFeatures);
  set('#open-portal-btn', t.openPortal); set('.nav__menu-cta .btn', t.openPortal);
  set('#hero-title', t.heroTitle); set('.hero__lead', t.heroLead); set('#farmer-portal-btn', t.farmerPortal); set('#official-portal-btn', t.officialPortal);
  set('.console__title', t.greenQueue); set('.console__bar .pill', t.demo); set('.console__label:nth-of-type(1)', t.currentToken);
  const labels = document.querySelectorAll('.console__label'); if (labels[0]) labels[0].textContent=t.currentToken; if(labels[1]) labels[1].textContent=t.currentlyServing; if(labels[2]) labels[2].textContent=t.queue;
  set('.status', t.qualityApproved); set('.hero__caption', t.heroCaption); set('#journey-title', t.journeyTitle);
  document.querySelectorAll('.stage').forEach((el,i)=>{if(t.stages[i]){setWithin(el,'.stage__title',t.stages[i][0]);setWithin(el,'.stage__text',t.stages[i][1]);}});
  set('#features-title', t.why); const cards=document.querySelectorAll('.audience-card'); if(cards[0]){setWithin(cards[0],'.audience-card__title',t.farmer);setWithin(cards[0],'.audience-card__text',t.farmerText);} if(cards[1]){setWithin(cards[1],'.audience-card__title',t.official);setWithin(cards[1],'.audience-card__text',t.officialText);} if(cards[2]){setWithin(cards[2],'.audience-card__title',t.mandi);setWithin(cards[2],'.audience-card__text',t.mandiText);setWithin(cards[2],'.text-link',t.mandiDisplay);}
  set('#preview-title', t.previewTitle); set('.token-slip__head .console__label',t.token); const meta=document.querySelectorAll('.token-slip__meta dt'); if(meta[0])meta[0].textContent=t.crop;if(meta[1])meta[1].textContent=t.quantity;if(meta[2])meta[2].textContent=t.gradeUrs;
  const tl=document.querySelectorAll('.timeline__item'); tl.forEach((el,i)=>{if(t.timeline[i]){const label=el.querySelector('.timeline__label'); if(label){if(i===3) label.innerHTML=`${t.timeline[i]} <span class="pill">${t.inProgress}</span>`; else label.textContent=t.timeline[i];}}});
  set('.timeline__note',t.timelineNote); const impact=document.querySelectorAll('.impact__item'); if(impact[0]){setWithin(impact[0],'.impact__statement',t.less);setWithin(impact[0],'.impact__detail',t.lessText);} if(impact[1]){setWithin(impact[1],'.impact__statement',t.visibility);setWithin(impact[1],'.impact__detail',t.visibilityText);} if(impact[2]){setWithin(impact[2],'.impact__statement',t.tracking);setWithin(impact[2],'.impact__detail',t.trackingText);}
  set('.impact__label',t.sih); set('#cta-title',t.cta); set('.cta-panel__text',t.ctaText); set('#explore-btn',t.explore); set('.footer__tagline',t.footerTag); set('.footer__meta p:nth-child(2)',t.footerProto); set('.footer__note',t.footerNote);
  document.querySelectorAll('.landing-lang').forEach(b=>b.classList.toggle('is-on',b.dataset.lang===S.language));
}
function setWithin(root,sel,val){const el=root.querySelector(sel);if(el)el.textContent=val;}

const PORTAL_T = {
"Farmer":"शेतकरी","Mandi officer":"मंडी अधिकारी","Admin":"प्रशासक","Mandi display":"मंडी डिस्प्ले","Choose an interface":"इंटरफेस निवडा",
"Dashboard":"डॅशबोर्ड","Book a slot":"स्लॉट बुक करा","My token":"माझा टोकन","Procurement journey":"खरेदी प्रवास","Payments & receipt":"पेमेंट आणि पावती","History":"इतिहास","Profile & KYC":"प्रोफाइल आणि KYC","Notifications":"सूचना","Help":"मदत",
"Today's bookings":"आजची बुकिंग","Check-in & verification":"चेक-इन आणि पडताळणी","Quality check":"गुणवत्ता तपासणी","Section queues":"विभाग रांगा","Weighing & procurement":"वजन आणि खरेदी","Payment updates":"पेमेंट अपडेट्स","Farmer applications":"शेतकरी अर्ज",
"Today at a glance":"आजचा आढावा","Live queue":"लाइव्ह रांग","Applications":"अर्ज","Procurement centres":"खरेदी केंद्रे","Schedules & capacity":"वेळापत्रक आणि क्षमता","Slot & booking rules":"स्लॉट आणि बुकिंग नियम","Registered farmers":"नोंदणीकृत शेतकरी",
"Menu":"मेनू","Switch interface":"इंटरफेस बदलें","Sign out":"साइन आउट","Close portal":"पोर्टल बंद करें",
"Sign in or register":"साइन इन किंवा नोंदणी करा","Mobile number":"मोबाईल क्रमांक","Required":"आवश्यक","10-digit number":"१० अंकी क्रमांक","Send OTP":"OTP पाठवा","Enter OTP":"OTP प्रविष्ट करा","6-digit code":"६ अंकी कोड","Verify OTP":"OTP पडताळा","Resend OTP":"OTP पुन्हा पाठवा","Change number":"क्रमांक बदला",
"Demo farmer":"डेमो शेतकरी","Ramesh Patil · approved farmer · booking available":"रमेश पाटील · मंजूर शेतकरी · बुकिंग उपलब्ध","Ready for demo":"डेमोसाठी तयार","Use demo farmer":"डेमो शेतकरी वापरा","Prototype only. OTP is simulated in the browser.":"फक्त प्रोटोटाइप. OTP ब्राउझरमध्ये सिम्युलेट केला आहे.",
"Demo accounts":"डेमो खाती","Farmer registration":"शेतकरी नोंदणी","Farmer details":"शेतकरी तपशील","Name":"नाव","Full name":"पूर्ण नाव","Date of birth":"जन्मतारीख","Relationship":"नाते","Father":"वडील","Mother":"आई","Spouse":"जोडीदार","Other":"इतर",
"Crop":"पीक","Crops":"पिके","Procurement centre":"खरेदी केंद्र","Available slots":"उपलब्ध स्लॉट","Select slot":"स्लॉट निवडा","Book":"बुक करा","Cancel":"रद्द करा","Confirm":"पुष्टी करा","Continue":"पुढे जा","Back":"मागे","Submit":"सबमिट करा","Save":"जतन करा",
"Payment":"पेमेंट","Payment status":"पेमेंट स्थिती","Completed":"पूर्ण","Pending":"प्रलंबित","Receipt":"पावती","Download Receipt":"पावती डाउनलोड करा","Quality token":"गुणवत्ता टोकन","Main token":"मुख्य टोकन","Token":"टोकन",
"Live updates":"लाइव्ह अपडेट्स","Status":"स्थिती","Check in":"चेक-इन","Weighing":"वजन","Amount":"रक्कम","Bank details":"बँक तपशील","Account number":"खाते क्रमांक","Confirm account number":"खाते क्रमांकाची पुष्टी करा","Show":"दाखवा","Hide":"लपवा","Upload":"अपलोड करा","Optional":"पर्यायी",
"Queue empty.":"रांग रिकामी आहे.","Still stuck?":"अजूनही अडचण आहे?","Help & Support":"मदत आणि सहाय्य"
};
const PORTAL_T_HI = {
"Farmer":"किसान","Mandi officer":"मंडी अधिकारी","Admin":"प्रशासक","Mandi display":"मंडी डिस्प्ले","Choose an interface":"इंटरफेस चुनें",
"Dashboard":"डैशबोर्ड","Book a slot":"स्लॉट बुक करें","My token":"मेरा टोकन","Procurement journey":"खरीद यात्रा","Payments & receipt":"भुगतान और रसीद","History":"इतिहास","Profile & KYC":"प्रोफ़ाइल और KYC","Notifications":"सूचनाएँ","Help":"मदद",
"Today's bookings":"आज की बुकिंग","Check-in & verification":"चेक-इन और सत्यापन","Quality check":"गुणवत्ता जाँच","Section queues":"सेक्शन कतारें","Weighing & procurement":"तौल और खरीद","Payment updates":"भुगतान अपडेट","Farmer applications":"किसान आवेदन",
"Today at a glance":"आज का अवलोकन","Live queue":"लाइव कतार","Applications":"आवेदन","Procurement centres":"खरीद केंद्र","Schedules & capacity":"समय-सारणी और क्षमता","Slot & booking rules":"स्लॉट और बुकिंग नियम","Registered farmers":"पंजीकृत किसान",
"Menu":"मेनू","Switch interface":"इंटरफेस बदलें","Sign out":"साइन आउट","Close portal":"पोर्टल बंद करें",
"Sign in or register":"साइन इन या पंजीकरण करें","Mobile number":"मोबाइल नंबर","Required":"आवश्यक","10-digit number":"10 अंकों का नंबर","Send OTP":"OTP भेजें","Enter OTP":"OTP दर्ज करें","6-digit code":"6 अंकों का कोड","Verify OTP":"OTP सत्यापित करें","Resend OTP":"OTP फिर भेजें","Change number":"नंबर बदलें",
"Demo farmer":"डेमो किसान","Ramesh Patil · approved farmer · booking available":"रमेश पाटील · स्वीकृत किसान · बुकिंग उपलब्ध","Ready for demo":"डेमो के लिए तैयार","Use demo farmer":"डेमो किसान इस्तेमाल करें","Prototype only. OTP is simulated in the browser.":"केवल प्रोटोटाइप। OTP ब्राउज़र में सिम्युलेट किया गया है।",
"Demo accounts":"डेमो खाते","Farmer registration":"किसान पंजीकरण","Farmer details":"किसान विवरण","Name":"नाम","Full name":"पूरा नाम","Date of birth":"जन्म तिथि","Relationship":"रिश्ता","Father":"पिता","Mother":"माता","Spouse":"पति/पत्नी","Other":"अन्य",
"Crop":"फसल","Crops":"फसलें","Procurement centre":"खरीद केंद्र","Available slots":"उपलब्ध स्लॉट","Select slot":"स्लॉट चुनें","Book":"बुक करें","Cancel":"रद्द करें","Confirm":"पुष्टि करें","Continue":"जारी रखें","Back":"वापस","Submit":"जमा करें","Save":"सहेजें",
"Payment":"भुगतान","Payment status":"भुगतान स्थिति","Completed":"पूर्ण","Pending":"लंबित","Receipt":"रसीद","Download Receipt":"रसीद डाउनलोड करें","Quality token":"गुणवत्ता टोकन","Main token":"मुख्य टोकन","Token":"टोकन",
"Live updates":"लाइव अपडेट","Status":"स्थिति","Check in":"चेक-इन","Weighing":"तौल","Amount":"राशि","Bank details":"बैंक विवरण","Account number":"खाता नंबर","Confirm account number":"खाता नंबर की पुष्टि करें","Show":"दिखाएँ","Hide":"छिपाएँ","Upload":"अपलोड करें","Optional":"वैकल्पिक",
"Queue empty.":"कतार खाली है.","Still stuck?":"अभी भी परेशानी है?","Help & Support":"मदद और सहायता"
};
const GLOBAL_T_MR = {
  "Home":"मुख्यपृष्ठ","How It Works":"हे कसे काम करते","Features":"वैशिष्ट्ये","Open Portal":"पोर्टल उघडा",
  "From Mandi Arrival to Payment — Every Step, Clear.":"मंडीमध्ये आगमनापासून पेमेंटपर्यंत — प्रत्येक टप्पा स्पष्ट.",
  "AnnSaarthi brings farmers, procurement officials and mandi operations onto one transparent digital journey.":"अन्नसारथी शेतकरी, खरेदी अधिकारी आणि मंडीची संपूर्ण प्रक्रिया एका पारदर्शक डिजिटल प्रवासात जोडते.",
  "Farmer Portal":"शेतकरी पोर्टल","Official Portal":"अधिकारी पोर्टल","Demo procurement queue interface":"डेमो खरेदी रांग इंटरफेस",
  "Green queue":"ग्रीन रांग","Demo data":"डेमो माहिती","Current token":"सध्याचा टोकन","Quality Approved":"गुणवत्ता मंजूर",
  "Currently serving":"सध्या सेवा दिली जात आहे","Queue":"रांग","Prototype interface. All values shown are demo data.":"प्रोटोटाइप इंटरफेस. येथे दाखवलेली सर्व माहिती डेमो आहे.",
  "One Journey. Every Stage Connected.":"एक प्रवास. प्रत्येक टप्पा जोडलेला.","Book Slot":"स्लॉट बुक करा","Choose a delivery time before leaving the farm.":"शेतातून निघण्यापूर्वी येण्याची वेळ निवडा.",
  "Arrive at Mandi":"मंडीत पोहोचा","Reach the procurement centre and report your arrival.":"खरेदी केंद्रावर पोहोचा आणि आपल्या आगमनाची नोंद करा.",
  "Quality Check":"गुणवत्ता तपासणी","An official inspects the crop at the mandi and marks it Green or Red.":"मंडीमध्ये अधिकारी पिकाची तपासणी करून ते ग्रीन किंवा रेड म्हणून नोंदवतो.",
  "Green Queue":"ग्रीन रांग","Approved crops receive a token and wait in a visible queue.":"मंजूर पिकांना टोकन मिळते आणि त्या टोकननुसार रांगेत प्रतीक्षा करावी लागते.",
  "Weighing":"वजन मोजणी","The crop is weighed and the payable amount is calculated.":"पिकाचे वजन केले जाते आणि देय रक्कम मोजली जाते.",
  "Payment":"पेमेंट","Track payment status and receive a digital receipt.":"पेमेंटची स्थिती पाहा आणि डिजिटल पावती मिळवा.",
  "Why AnnSaarthi":"अन्नसारथी का?","Farmer":"शेतकरी","Know when to arrive, where you stand in the queue, and what happens next.":"कधी यायचे, रांगेत तुमचा क्रमांक कोणता आहे आणि पुढे काय होईल हे जाणून घ्या.",
  "Official":"अधिकारी","Manage arrivals, quality decisions, queue movement and weighing from one dashboard.":"आगमन, गुणवत्ता निर्णय, रांगेची हालचाल आणि वजन मोजणी एका डॅशबोर्डवरून व्यवस्थापित करा.",
  "Mandi":"मंडी","Keep procurement movement organized with a live token-based queue.":"थेट टोकन-आधारित रांगेमुळे खरेदी प्रक्रिया व्यवस्थित ठेवा.",
  "Open Mandi Display":"मंडी डिस्प्ले उघडा","Follow One Delivery from Slot to Receipt.":"स्लॉटपासून पावतीपर्यंत एका शेतमालाच्या प्रवासाचा मागोवा घ्या.",
  "Token":"टोकन","Crop":"पीक","Wheat":"गहू","Quantity":"प्रमाण","25 Quintals":"२५ क्विंटल","Slot Booked":"स्लॉट बुक झाला","Arrived":"आगमन झाले","Quality Approved":"गुणवत्ता मंजूर",
  "In progress":"प्रगतीपथावर","Now serving PUN-014. Two tokens ahead.":"सध्या PUN-014 वर सेवा सुरू आहे. तुमच्या पुढे दोन टोकन आहेत.","Weighing":"वजन मोजणी","Payment":"पेमेंट","Receipt":"पावती",
  "What AnnSaarthi is designed to improve":"अन्नसारथीमध्ये काय सुधारण्याचा उद्देश आहे","Less uncertainty":"कमी अनिश्चितता","Slot, queue position and procurement status stay visible to the farmer.":"स्लॉट, रांगेतील क्रमांक आणि खरेदीची स्थिती शेतकऱ्याला दिसत राहते.",
  "Better queue visibility":"रांगेची अधिक स्पष्ट माहिती","A token-based queue shows who is being served and who is next.":"टोकन-आधारित रांग सध्या कोणाची सेवा सुरू आहे आणि पुढचा कोण आहे हे दाखवते.",
  "Transparent procurement tracking":"पारदर्शक खरेदीचा मागोवा","Every stage from arrival to payment is easy to follow.":"आगमनापासून पेमेंटपर्यंत प्रत्येक टप्प्याचा मागोवा घेणे सोपे आहे.",
  "Designed as an SIH prototype":"SIH प्रोटोटाइप म्हणून तयार केलेले","Make Every Procurement Journey Predictable.":"प्रत्येक खरेदीचा प्रवास अंदाजे आणि व्यवस्थित करा.",
  "AnnSaarthi connects the steps between arrival, acceptance, weighing and payment.":"अन्नसारथी आगमन, स्वीकृती, वजन मोजणी आणि पेमेंट यांमधील सर्व टप्पे जोडते.",
  "Explore AnnSaarthi":"अन्नसारथी पाहा","Smart Procurement • Transparent Payments":"स्मार्ट खरेदी • पारदर्शक पेमेंट","Prototype for Smart India Hackathon":"स्मार्ट इंडिया हॅकाथॉनसाठी प्रोटोटाइप","Queue and token values on this page are demo data.":"या पृष्ठावरील रांग आणि टोकनची माहिती डेमो आहे.",
  "Open menu":"मेनू उघडा","Close menu":"मेनू बंद करा","Skip to content":"सामग्रीकडे जा",
  "Mandi display":"मंडी डिस्प्ले","Mandi Display":"मंडी डिस्प्ले","SIH prototype":"SIH प्रोटोटाइप"
};
const GLOBAL_T_HI = {
  "Home":"होम","How It Works":"यह कैसे काम करता है","Features":"विशेषताएँ","Open Portal":"पोर्टल खोलें",
  "From Mandi Arrival to Payment — Every Step, Clear.":"मंडी में पहुँचने से भुगतान तक — हर कदम स्पष्ट।",
  "AnnSaarthi brings farmers, procurement officials and mandi operations onto one transparent digital journey.":"अन्नसारथी किसानों, खरीद अधिकारियों और मंडी की पूरी प्रक्रिया को एक पारदर्शी डिजिटल यात्रा में जोड़ता है।",
  "Farmer Portal":"किसान पोर्टल","Official Portal":"अधिकारी पोर्टल","Demo procurement queue interface":"डेमो खरीद कतार इंटरफेस",
  "Green queue":"ग्रीन कतार","Demo data":"डेमो जानकारी","Current token":"वर्तमान टोकन","Quality Approved":"गुणवत्ता स्वीकृत",
  "Currently serving":"अभी सेवा में","Queue":"कतार","Prototype interface. All values shown are demo data.":"प्रोटोटाइप इंटरफेस। यहाँ दिखाई गई सभी जानकारी डेमो है।",
  "One Journey. Every Stage Connected.":"एक यात्रा। हर चरण जुड़ा हुआ।","Book Slot":"स्लॉट बुक करें","Choose a delivery time before leaving the farm.":"खेत से निकलने से पहले पहुँचने का समय चुनें।",
  "Arrive at Mandi":"मंडी पहुँचें","Reach the procurement centre and report your arrival.":"खरीद केंद्र पहुँचें और अपने आगमन की सूचना दें।",
  "Quality Check":"गुणवत्ता जाँच","An official inspects the crop at the mandi and marks it Green or Red.":"मंडी में अधिकारी फसल की जाँच करता है और उसे ग्रीन या रेड के रूप में दर्ज करता है।",
  "Green Queue":"ग्रीन कतार","Approved crops receive a token and wait in a visible queue.":"स्वीकृत फसल को टोकन मिलता है और वह दिखाई देने वाली कतार में प्रतीक्षा करती है।",
  "Weighing":"तौल","The crop is weighed and the payable amount is calculated.":"फसल का वजन किया जाता है और देय राशि की गणना की जाती है।",
  "Payment":"भुगतान","Track payment status and receive a digital receipt.":"भुगतान की स्थिति देखें और डिजिटल रसीद प्राप्त करें।",
  "Why AnnSaarthi":"अन्नसारथी क्यों?","Farmer":"किसान","Know when to arrive, where you stand in the queue, and what happens next.":"कब पहुँचना है, कतार में आपका नंबर क्या है और आगे क्या होगा, यह जानें।",
  "Official":"अधिकारी","Manage arrivals, quality decisions, queue movement and weighing from one dashboard.":"आगमन, गुणवत्ता निर्णय, कतार और तौल को एक डैशबोर्ड से प्रबंधित करें।",
  "Mandi":"मंडी","Keep procurement movement organized with a live token-based queue.":"लाइव टोकन-आधारित कतार से खरीद प्रक्रिया व्यवस्थित रखें।",
  "Open Mandi Display":"मंडी डिस्प्ले खोलें","Follow One Delivery from Slot to Receipt.":"स्लॉट से रसीद तक एक डिलीवरी की पूरी यात्रा देखें।",
  "Token":"टोकन","Crop":"फसल","Wheat":"गेहूँ","Quantity":"मात्रा","25 Quintals":"२५ क्विंटल","Slot Booked":"स्लॉट बुक हुआ","Arrived":"पहुँच गए","Quality Approved":"गुणवत्ता स्वीकृत",
  "In progress":"प्रगति में","Now serving PUN-014. Two tokens ahead.":"अभी PUN-014 की सेवा चल रही है। आपके आगे दो टोकन हैं।","Receipt":"रसीद",
  "What AnnSaarthi is designed to improve":"अन्नसारथी में क्या सुधार लाना है","Less uncertainty":"कम अनिश्चितता","Slot, queue position and procurement status stay visible to the farmer.":"स्लॉट, कतार में स्थान और खरीद की स्थिति किसान को दिखाई देती रहती है।",
  "Better queue visibility":"कतार की बेहतर जानकारी","A token-based queue shows who is being served and who is next.":"टोकन-आधारित कतार बताती है कि किसकी सेवा हो रही है और अगला कौन है।",
  "Transparent procurement tracking":"पारदर्शी खरीद ट्रैकिंग","Every stage from arrival to payment is easy to follow.":"आगमन से भुगतान तक हर चरण को आसानी से देखा जा सकता है।",
  "Designed as an SIH prototype":"SIH प्रोटोटाइप के रूप में तैयार","Make Every Procurement Journey Predictable.":"हर खरीद यात्रा को व्यवस्थित और आसान बनाएं।",
  "AnnSaarthi connects the steps between arrival, acceptance, weighing and payment.":"अन्नसारथी आगमन, स्वीकृति, तौल और भुगतान के सभी चरणों को जोड़ता है।",
  "Explore AnnSaarthi":"अन्नसारथी देखें","Smart Procurement • Transparent Payments":"स्मार्ट खरीद • पारदर्शी भुगतान","Prototype for Smart India Hackathon":"स्मार्ट इंडिया हैकाथॉन के लिए प्रोटोटाइप","Queue and token values on this page are demo data.":"इस पृष्ठ पर कतार और टोकन की जानकारी डेमो है.",
  "Open menu":"मेनू खोलें","Close menu":"मेनू बंद करें","Skip to content":"मुख्य सामग्री पर जाएँ",
  "Mandi display":"मंडी डिस्प्ले","Mandi Display":"मंडी डिस्प्ले","SIH prototype":"SIH प्रोटोटाइप"
};
const EXTRA_MR = {
"Account":"खाते","Action":"कृती","Address":"पत्ता","Admin dashboard":"प्रशासक डॅशबोर्ड","All three confirmations are needed before submitting.":"सबमिट करण्यापूर्वी तिन्ही पुष्टी आवश्यक आहेत.",
"Allow farmers to reschedule a confirmed booking":"मंजूर बुकिंगची वेळ शेतकऱ्यांना बदलू द्या","Amount":"रक्कम","Amount payable":"देय रक्कम","Amount payable = weight × rate − deductions.":"देय रक्कम = वजन × दर − कपात.",
"Application":"अर्ज","Application ID":"अर्ज आयडी","Application not found.":"अर्ज सापडला नाही.","Applications to verify":"पडताळणीसाठी अर्ज","Approve":"मंजूर करा","Approved farmer with a booking:":"बुकिंग असलेला मंजूर शेतकरी:",
"Arrival & changes":"आगमन आणि बदल","Assess":"तपासा","Assessment result":"तपासणीचा निकाल","At quality check":"गुणवत्ता तपासणीत","At weighing":"वजन मोजणीत","Available":"उपलब्ध","Back":"मागे","Back to list":"यादीकडे परत जा","Bank":"बँक","Bank check":"बँक तपासणी","Bank proof":"बँक पुरावा","Bank proof required (passbook or cancelled cheque)":"बँक पुरावा आवश्यक (पासबुक किंवा रद्द केलेला चेक)","Bank state / district":"बँकेचे राज्य / जिल्हा",
"Book a procurement slot":"खरेदी स्लॉट बुक करा","Book a slot to receive a main queue token and an arrival window for your centre.":"मुख्य रांगेचे टोकन आणि केंद्रासाठी आगमनाची वेळ मिळवण्यासाठी स्लॉट बुक करा.","Booked":"बुक झाले","Booked today":"आज बुक केले","Booking":"बुकिंग","Booking ID":"बुकिंग आयडी","Booking history":"बुकिंग इतिहास","Bookings made":"केलेली बुकिंग","Branch name":"शाखेचे नाव","Cancel booking":"बुकिंग रद्द करा","Capacity":"क्षमता","Capacity per slot is set by the admin (currently ${CFG.slotCapacity})":"प्रत्येक स्लॉटची क्षमता प्रशासक ठरवतो.","Centre":"केंद्र","Change centre":"केंद्र बदला","Change date":"तारीख बदला","Change slot":"स्लॉट बदला","Check in this token":"या टोकनचा चेक-इन करा","Checked in":"चेक-इन झाले","Choose a time slot":"वेळेचा स्लॉट निवडा","Close":"बंद करा","Closes at (hour)":"बंद होण्याची वेळ","Commodities":"पिके","Commodity":"पीक","Consent":"संमती","Correct the highlighted information and submit again.":"ठळक केलेली माहिती दुरुस्त करून पुन्हा सबमिट करा.","Counters open":"काउंटर सुरू","Credited to":"यांना जमा","Current bookings":"सध्याची बुकिंग","Current queue":"सध्याची रांग","Current stage":"सध्याचा टप्पा","Current status":"सध्याची स्थिती","Daily capacity":"दैनिक क्षमता","Date":"तारीख","Decision":"निर्णय","Deductions":"कपात","Demo OTP:":"डेमो OTP:","Demo accounts":"डेमो खाती","Demo login 9822001842":"डेमो लॉगिन 9822001842","Document":"कागदपत्र","Documents":"कागदपत्रे","Edit":"संपादित करा","Enter a valid 10-digit Indian mobile number starting with 6–9.":"6–9 ने सुरू होणारा वैध 10 अंकी भारतीय मोबाईल क्रमांक द्या.","Estimated queue":"अंदाजे रांग","Estimated wait":"अंदाजे प्रतीक्षा","Everyone booked for today has arrived.":"आज बुक केलेले सर्व शेतकरी आले आहेत.","Farm & crop details":"शेतजमीन आणि पीक तपशील","Farmer ID":"शेतकरी आयडी","Farmer profile":"शेतकरी प्रोफाइल","Farmer type":"शेतकरी प्रकार","Farmers ahead":"पुढे असलेले शेतकरी","Gender":"लिंग","Go back":"मागे जा","Go to my dashboard":"माझ्या डॅशबोर्डवर जा","Help":"मदत","IFSC":"IFSC","Identity":"ओळख","Identity check":"ओळख तपासणी","Identity verification":"ओळख पडताळणी","In progress":"प्रगतीपथावर","In weighing":"वजन मोजणीत","Initiate payment":"पेमेंट सुरू करा","Issued by the system after approval":"मंजुरीनंतर प्रणालीकडून जारी केले जाते","Land":"जमीन","Land or eligibility proof required":"जमीन किंवा पात्रतेचा पुरावा आवश्यक","Limited means":"मर्यादा","Live counts, queue per counter, centres, schedules, capacity and booking rules.":"थेट संख्या, प्रत्येक काउंटरची रांग, केंद्रे, वेळापत्रक, क्षमता आणि बुकिंगचे नियम.","Look up bank":"बँक तपशील शोधा","Main crops":"मुख्य पिके","Manage arrivals, quality decisions, queue movement and weighing from one dashboard.":"आगमन, गुणवत्ता निर्णय, रांगेची हालचाल आणि वजन मोजणी एका डॅशबोर्डवरून व्यवस्थापित करा.","Mark credited":"जमा झाले म्हणून नोंदवा","Mark missed":"चुकले म्हणून नोंदवा","Mark verified":"पडताळले म्हणून नोंदवा","Mobile":"मोबाईल","Moisture":"आर्द्रता","Moisture (%)":"आर्द्रता (%)","Name":"नाव","Net weight":"निव्वळ वजन","Net weight (quintal)":"निव्वळ वजन (क्विंटल)","Next in the main queue":"मुख्य रांगेतील पुढचा","No active booking":"सध्या कोणतेही सक्रिय बुकिंग नाही","No bookings yet.":"अद्याप कोणतीही बुकिंग नाही.","No completed procurement yet.":"अद्याप कोणतीही पूर्ण खरेदी नाही.","No farmer is waiting for a quality check.":"गुणवत्ता तपासणीसाठी कोणताही शेतकरी प्रतीक्षेत नाही.","No procurement records yet.":"अद्याप कोणतेही खरेदी रेकॉर्ड नाही.","No token yet":"अद्याप टोकन नाही","No tokens in the queue today.":"आज रांगेत कोणतेही टोकन नाही.","Nobody at weighing right now.":"सध्या वजन मोजणीवर कोणी नाही.","None yet today.":"आज अद्याप काहीही नाही.","Nothing recorded yet.":"अद्याप काहीही नोंदलेले नाही.","Nothing waiting at the gate.":"गेटवर कोणीही प्रतीक्षेत नाही.","Nothing yet.":"अद्याप काहीही नाही.","Notifications":"सूचना","Now serving":"सध्या सेवा सुरू","Officer's remarks:":"अधिकाऱ्यांच्या नोंदी:","Open":"उघडा","Open an interface":"इंटरफेस उघडा","Open mandi display wall":"मंडी डिस्प्ले उघडा","Opens at (hour)":"उघडण्याची वेळ","Operating hours":"कामकाजाची वेळ","Payment account details":"पेमेंट खात्याचे तपशील","Payment reference":"पेमेंट संदर्भ","Payments":"पेमेंट","Payments completed":"पूर्ण झालेले पेमेंट","Payments pending":"प्रलंबित पेमेंट","Payments received":"प्राप्त पेमेंट","Prices are fictional demo figures, not official support prices.":"दर हे काल्पनिक डेमो आकडे आहेत; हे अधिकृत समर्थन दर नाहीत.","Print or save receipt":"पावती प्रिंट किंवा जतन करा","Procurement":"खरेदी","Procurement ID":"खरेदी आयडी","Procurement calendar":"खरेदी दिनदर्शिका","Procurement days":"खरेदीचे दिवस","Public display":"सार्वजनिक डिस्प्ले","Public screen":"सार्वजनिक स्क्रीन","Quality":"गुणवत्ता","Quality tokens in the sections":"विभागातील गुणवत्ता टोकन","Queue at each counter":"प्रत्येक काउंटरवरील रांग","Queue empty":"रांग रिकामी","Queue empty.":"रांग रिकामी आहे.","Rate":"दर","Rate per quintal":"प्रति क्विंटल दर","Recent activity":"अलीकडील हालचाल","Record procurement":"खरेदी नोंदवा","Registered farmers":"नोंदणीकृत शेतकरी","Registration status":"नोंदणी स्थिती","Reject":"नाकारावे","Remove":"काढा","Reopen and resubmit":"पुन्हा उघडा आणि सबमिट करा","Request resubmission":"पुन्हा सबमिट करण्याची विनंती","Required documents":"आवश्यक कागदपत्रे","Requirement":"आवश्यकता","Reschedule":"वेळ बदला","Resend OTP":"OTP पुन्हा पाठवा","Residential address":"निवासी पत्ता","Result":"निकाल","Review your registration":"तुमच्या नोंदणीचे पुनरावलोकन करा","Schedule":"वेळापत्रक","Schedule window":"वेळेची विंडो","Section":"विभाग","Section queues":"विभागाच्या रांगा","Sections":"विभाग","Select a procurement centre":"खरेदी केंद्र निवडा","Select commodity":"पीक निवडा","Send to quality":"गुणवत्ता तपासणीकडे पाठवा","Send to weighing":"वजन मोजणीकडे पाठवा","Submitted":"सबमिट केले","Support price (demo)":"समर्थन दर (डेमो)","Survey / Gat / Khasra number":"सर्वे / गट / खसरा क्रमांक","Time":"वेळ","Time slot":"वेळेचा स्लॉट","Today":"आज","Today's capacity":"आजची क्षमता","Total farmers today":"आजचे एकूण शेतकरी","Track payment status and receive a digital receipt.":"पेमेंटची स्थिती पाहा आणि डिजिटल पावती मिळवा.","Type":"प्रकार","Unread notifications":"न वाचलेल्या सूचना","Upcoming procurement":"आगामी खरेदी","Verification checklist":"पडताळणी यादी","Verification method":"पडताळणी पद्धत","Verify your mobile number":"तुमचा मोबाईल क्रमांक पडताळा","View journey":"प्रवास पाहा","View procurement journey":"खरेदीचा प्रवास पाहा","View token":"टोकन पाहा","Village":"गाव","Waiting":"प्रतीक्षेत","Waiting / in queue":"प्रतीक्षेत / रांगेत","Waiting in queue":"रांगेत प्रतीक्षेत","Weight":"वजन","When":"कधी","Window":"विंडो","Your procurement token":"तुमचे खरेदी टोकन","Your selected slot":"तुमचा निवडलेला स्लॉट","Your verification":"तुमची पडताळणी"
};
const EXTRA_HI = {
"Account":"खाता","Action":"कार्रवाई","Address":"पता","Admin dashboard":"प्रशासक डैशबोर्ड","All three confirmations are needed before submitting.":"जमा करने से पहले तीनों पुष्टियाँ आवश्यक हैं।","Allow farmers to reschedule a confirmed booking":"किसानों को पक्की बुकिंग का समय बदलने दें","Amount":"राशि","Amount payable":"देय राशि","Amount payable = weight × rate − deductions.":"देय राशि = वजन × दर − कटौती।","Application":"आवेदन","Application ID":"आवेदन आईडी","Application not found.":"आवेदन नहीं मिला।","Applications to verify":"सत्यापन के लिए आवेदन","Approve":"स्वीकृत करें","Approved farmer with a booking:":"बुकिंग वाला स्वीकृत किसान:","Arrival & changes":"आगमन और बदलाव","Assess":"जाँच करें","Assessment result":"जाँच परिणाम","At quality check":"गुणवत्ता जाँच में","At weighing":"तौल में","Available":"उपलब्ध","Back":"वापस","Back to list":"सूची पर वापस जाएँ","Bank":"बैंक","Bank check":"बैंक जाँच","Bank proof":"बैंक प्रमाण","Bank proof required (passbook or cancelled cheque)":"बैंक प्रमाण आवश्यक (पासबुक या रद्द चेक)","Bank state / district":"बैंक राज्य / जिला","Book a procurement slot":"खरीद स्लॉट बुक करें","Book a slot to receive a main queue token and an arrival window for your centre.":"मुख्य कतार टोकन और केंद्र के लिए आगमन समय पाने हेतु स्लॉट बुक करें।","Booked":"बुक हुआ","Booked today":"आज बुक हुआ","Booking":"बुकिंग","Booking ID":"बुकिंग आईडी","Booking history":"बुकिंग इतिहास","Bookings made":"की गई बुकिंग","Branch name":"शाखा का नाम","Cancel booking":"बुकिंग रद्द करें","Capacity":"क्षमता","Centre":"केंद्र","Change centre":"केंद्र बदलें","Change date":"तारीख बदलें","Change slot":"स्लॉट बदलें","Check in this token":"इस टोकन का चेक-इन करें","Checked in":"चेक-इन हुआ","Choose a time slot":"समय स्लॉट चुनें","Close":"बंद करें","Closes at (hour)":"बंद होने का समय","Commodities":"फसलें","Commodity":"फसल","Consent":"सहमति","Correct the highlighted information and submit again.":"चिह्नित जानकारी ठीक करके फिर जमा करें।","Counters open":"काउंटर खुले हैं","Credited to":"जमा किया गया","Current bookings":"वर्तमान बुकिंग","Current queue":"वर्तमान कतार","Current stage":"वर्तमान चरण","Current status":"वर्तमान स्थिति","Daily capacity":"दैनिक क्षमता","Date":"तारीख","Decision":"निर्णय","Deductions":"कटौती","Demo OTP:":"डेमो OTP:","Document":"दस्तावेज़","Documents":"दस्तावेज़","Edit":"संपादित करें","Enter a valid 10-digit Indian mobile number starting with 6–9.":"6–9 से शुरू होने वाला वैध 10 अंकों का भारतीय मोबाइल नंबर डालें।","Estimated queue":"अनुमानित कतार","Estimated wait":"अनुमानित प्रतीक्षा","Everyone booked for today has arrived.":"आज बुक किए गए सभी किसान आ गए हैं।","Farm & crop details":"खेत और फसल विवरण","Farmer ID":"किसान आईडी","Farmer profile":"किसान प्रोफ़ाइल","Farmer type":"किसान प्रकार","Farmers ahead":"आगे के किसान","Gender":"लिंग","Go back":"वापस जाएँ","Go to my dashboard":"मेरे डैशबोर्ड पर जाएँ","IFSC":"IFSC","Identity":"पहचान","Identity check":"पहचान जाँच","Identity verification":"पहचान सत्यापन","Initiate payment":"भुगतान शुरू करें","Issued by the system after approval":"मंजूरी के बाद सिस्टम द्वारा जारी","Land":"भूमि","Land or eligibility proof required":"भूमि या पात्रता प्रमाण आवश्यक","Live counts, queue per counter, centres, schedules, capacity and booking rules.":"लाइव संख्या, हर काउंटर की कतार, केंद्र, समय-सारणी, क्षमता और बुकिंग नियम।","Look up bank":"बैंक विवरण खोजें","Main crops":"मुख्य फसलें","Mark credited":"जमा हुआ चिह्नित करें","Mark missed":"छूटा हुआ चिह्नित करें","Mark verified":"सत्यापित चिह्नित करें","Mobile":"मोबाइल","Moisture":"नमी","Moisture (%)":"नमी (%)","Name":"नाम","Net weight":"शुद्ध वजन","Net weight (quintal)":"शुद्ध वजन (क्विंटल)","Next in the main queue":"मुख्य कतार में अगला","No active booking":"कोई सक्रिय बुकिंग नहीं","No bookings yet.":"अभी कोई बुकिंग नहीं है।","No completed procurement yet.":"अभी कोई खरीद पूरी नहीं हुई है।","No farmer is waiting for a quality check.":"गुणवत्ता जाँच के लिए कोई किसान प्रतीक्षा में नहीं है।","No procurement records yet.":"अभी कोई खरीद रिकॉर्ड नहीं है।","No token yet":"अभी कोई टोकन नहीं","No tokens in the queue today.":"आज कतार में कोई टोकन नहीं है।","Nobody at weighing right now.":"अभी तौल पर कोई नहीं है।","None yet today.":"आज अभी कुछ नहीं","Nothing recorded yet.":"अभी कुछ दर्ज नहीं हुआ है।","Nothing waiting at the gate.":"गेट पर कोई प्रतीक्षा नहीं कर रहा है।","Nothing yet.":"अभी कुछ नहीं","Notifications":"सूचनाएँ","Now serving":"अभी सेवा में","Officer's remarks:":"अधिकारी की टिप्पणी:","Open":"खोलें","Open an interface":"इंटरफेस खोलें","Open mandi display wall":"मंडी डिस्प्ले खोलें","Opens at (hour)":"खुलने का समय","Operating hours":"कामकाज का समय","Payment account details":"भुगतान खाते का विवरण","Payment reference":"भुगतान संदर्भ","Payments":"भुगतान","Payments completed":"पूर्ण भुगतान","Payments pending":"लंबित भुगतान","Payments received":"प्राप्त भुगतान","Prices are fictional demo figures, not official support prices.":"दर काल्पनिक डेमो आँकड़े हैं, आधिकारिक समर्थन मूल्य नहीं।","Print or save receipt":"रसीद प्रिंट या सहेजें","Procurement":"खरीद","Procurement ID":"खरीद आईडी","Procurement calendar":"खरीद कैलेंडर","Procurement days":"खरीद के दिन","Public display":"सार्वजनिक डिस्प्ले","Public screen":"सार्वजनिक स्क्रीन","Quality":"गुणवत्ता","Quality tokens in the sections":"विभागों में गुणवत्ता टोकन","Queue at each counter":"हर काउंटर की कतार","Queue empty":"कतार खाली","Queue empty.":"कतार खाली है।","Rate":"दर","Rate per quintal":"प्रति क्विंटल दर","Recent activity":"हाल की गतिविधि","Record procurement":"खरीद दर्ज करें","Registered farmers":"पंजीकृत किसान","Registration status":"पंजीकरण स्थिति","Reject":"अस्वीकार करें","Remove":"हटाएँ","Reopen and resubmit":"फिर खोलें और जमा करें","Request resubmission":"पुनः जमा करने का अनुरोध","Required documents":"आवश्यक दस्तावेज़","Requirement":"आवश्यकता","Reschedule":"समय बदलें","Residential address":"आवासीय पता","Result":"परिणाम","Review your registration":"अपने पंजीकरण की समीक्षा करें","Schedule":"समय-सारणी","Schedule window":"समय विंडो","Section":"विभाग","Section queues":"विभाग की कतारें","Sections":"विभाग","Select a procurement centre":"खरीद केंद्र चुनें","Select commodity":"फसल चुनें","Send to quality":"गुणवत्ता जाँच के लिए भेजें","Send to weighing":"तौल के लिए भेजें","Submitted":"जमा किया गया","Support price (demo)":"समर्थन मूल्य (डेमो)","Survey / Gat / Khasra number":"सर्वे / गट / खसरा नंबर","Time":"समय","Time slot":"समय स्लॉट","Today":"आज","Today's capacity":"आज की क्षमता","Total farmers today":"आज के कुल किसान","Type":"प्रकार","Unread notifications":"अनपढ़ी सूचनाएँ","Upcoming procurement":"आगामी खरीद","Verification checklist":"सत्यापन सूची","Verification method":"सत्यापन विधि","Verify your mobile number":"अपना मोबाइल नंबर सत्यापित करें","View journey":"यात्रा देखें","View procurement journey":"खरीद यात्रा देखें","View token":"टोकन देखें","Village":"गाँव","Waiting":"प्रतीक्षा","Waiting / in queue":"प्रतीक्षा / कतार में","Waiting in queue":"कतार में प्रतीक्षा","Weight":"वजन","When":"कब","Window":"विंडो","Your procurement token":"आपका खरीद टोकन","Your selected slot":"आपका चुना हुआ स्लॉट","Your verification":"आपका सत्यापन"
};
Object.assign(GLOBAL_T_MR, EXTRA_MR);
Object.assign(GLOBAL_T_HI, EXTRA_HI);
const GLOBAL_T = {en:{},mr:{...PORTAL_T,...GLOBAL_T_MR},hi:{...PORTAL_T_HI,...GLOBAL_T_HI}};

/* Onion quality assessment / digital quality report labels (Marathi + Hindi).
   Merged into GLOBAL_T (exact text) and, inside the language module below, into FALLBACK (phrases within sentences). */
const OQ_T = { mr: {"Digital Quality Report": "डिजिटल गुणवत्ता अहवाल", "Onion Quality Assessment": "कांदा गुणवत्ता मूल्यांकन", "Standardized image-based assessment of onion quality for transparent procurement.": "पारदर्शक खरेदीसाठी कांद्याच्या गुणवत्तेचे प्रमाणित, प्रतिमा-आधारित मूल्यांकन.", "View Report": "अहवाल पहा", "Download Report": "अहवाल डाउनलोड करा", "Print / Save as PDF": "प्रिंट / PDF म्हणून जतन करा", "Report": "अहवाल", "Report ID": "अहवाल क्रमांक", "Farmer ID": "शेतकरी ओळख क्रमांक", "Batch ID": "बॅच क्रमांक", "Batch / Lot ID": "बॅच / लॉट क्रमांक", "Procurement centre": "खरेदी केंद्र", "Date & time": "दिनांक आणि वेळ", "GPS location": "जीपीएस स्थान", "Report generated": "अहवाल तयार केला", "Images captured": "घेतलेल्या प्रतिमा", "Onions assessed": "मूल्यांकन केलेले कांदे", "Quality report": "गुणवत्ता अहवाल", "Grade A": "ग्रेड ए", "Grade summary": "ग्रेड सारांश", "Damaged": "खराब झालेले", "Rotten": "सडलेले", "Sprouted": "कोंब आलेले", "Undersized": "लहान आकाराचे", "Defect findings": "दोषांचे निष्कर्ष", "Produce photographs": "मालाची छायाचित्रे", "Overall assessment": "एकूण मूल्यांकन", "Assessment status": "मूल्यांकन स्थिती", "Assessment recorded": "मूल्यांकन नोंदवले", "Awaiting officer confirmation": "अधिकाऱ्याच्या पुष्टीची प्रतीक्षा", "Flagged for manual review": "मॅन्युअल पुनरावलोकनासाठी चिन्हांकित", "Flag for Manual Review": "मॅन्युअल पुनरावलोकनासाठी चिन्हांकित करा", "Assessment in progress": "मूल्यांकन सुरू आहे", "Starts after document verification": "कागदपत्र पडताळणीनंतर सुरू होईल", "Waiting for assessment": "मूल्यांकनाची प्रतीक्षा", "The onion quality assessment begins once your documents are verified at the centre.": "केंद्रावर तुमची कागदपत्रे पडताळल्यानंतर कांदा गुणवत्ता मूल्यांकन सुरू होते.", "Your batch is in the queue for the onion quality assessment.": "तुमचा माल कांदा गुणवत्ता मूल्यांकनाच्या रांगेत आहे.", "Your onion images are being assessed.": "तुमच्या कांद्याच्या प्रतिमांचे मूल्यांकन सुरू आहे.", "Your onions have been assessed. The result appears here once the officer confirms it.": "तुमच्या कांद्याचे मूल्यांकन झाले आहे. अधिकाऱ्याने पुष्टी केल्यावर निकाल येथे दिसेल.", "The officer is reviewing this batch. Your result will appear here once the review is complete.": "अधिकारी या मालाचे पुनरावलोकन करत आहेत. पुनरावलोकन पूर्ण झाल्यावर निकाल येथे दिसेल.", "Photographs of your batch have been captured. The assessment will start shortly.": "तुमच्या मालाची छायाचित्रे घेतली आहेत. मूल्यांकन लवकरच सुरू होईल.", "Main findings": "मुख्य निष्कर्ष", "onions assessed": "कांद्यांचे मूल्यांकन", "Demo values for the prototype.": "प्रोटोटाइपसाठी डेमो मूल्ये.", "Today's batches": "आजचे बॅच", "Pending assessments": "प्रलंबित मूल्यांकने", "Completed assessments": "पूर्ण झालेली मूल्यांकने", "Flagged for review": "पुनरावलोकनासाठी चिन्हांकित", "Flagged batches": "चिन्हांकित बॅच", "Open assessments": "मूल्यांकने उघडा", "Average Grade A": "सरासरी ग्रेड ए", "Average URS": "सरासरी URS", "No batches assessed yet today.": "आज अद्याप कोणत्याही बॅचचे मूल्यांकन झालेले नाही.", "View Assessment": "मूल्यांकन पहा", "Onion Batch Details": "कांदा बॅच तपशील", "Capture Onion Images": "कांद्याच्या प्रतिमा घ्या", "Take photo": "फोटो काढा", "Upload images": "प्रतिमा अपलोड करा", "Clear all": "सर्व काढा", "Start Quality Assessment": "गुणवत्ता मूल्यांकन सुरू करा", "Quality Assessment Results": "गुणवत्ता मूल्यांकन निकाल", "AI Quality Assessment": "एआय गुणवत्ता मूल्यांकन", "Analyzing onion images...": "कांद्याच्या प्रतिमांचे विश्लेषण सुरू आहे...", "Images received": "प्रतिमा प्राप्त", "Onion detection": "कांदा ओळख", "Defect assessment": "दोष मूल्यांकन", "Size assessment": "आकार मूल्यांकन", "Grade calculation": "ग्रेड गणना", "How was this assessment determined?": "हे मूल्यांकन कसे ठरवले गेले?", "Visible damage": "दिसणारे नुकसान", "Rot / decay indicators": "सड / कुजण्याची चिन्हे", "Sprouting": "कोंब फुटणे", "Size classification": "आकार वर्गीकरण", "Grade A / URS classification": "ग्रेड ए / URS वर्गीकरण", "Detected Defects": "आढळलेले दोष", "Assessed images": "मूल्यांकन केलेल्या प्रतिमा", "Confirm & Record Assessment": "मूल्यांकन पुष्टी करा आणि नोंदवा"},
  hi: {"Digital Quality Report": "डिजिटल गुणवत्ता रिपोर्ट", "Onion Quality Assessment": "प्याज गुणवत्ता मूल्यांकन", "Standardized image-based assessment of onion quality for transparent procurement.": "पारदर्शी खरीद के लिए प्याज की गुणवत्ता का मानकीकृत, छवि-आधारित मूल्यांकन।", "View Report": "रिपोर्ट देखें", "Download Report": "रिपोर्ट डाउनलोड करें", "Print / Save as PDF": "प्रिंट / PDF के रूप में सहेजें", "Report": "रिपोर्ट", "Report ID": "रिपोर्ट आईडी", "Farmer ID": "किसान आईडी", "Batch ID": "बैच आईडी", "Batch / Lot ID": "बैच / लॉट आईडी", "Procurement centre": "खरीद केंद्र", "Date & time": "दिनांक और समय", "GPS location": "जीपीएस स्थान", "Report generated": "रिपोर्ट तैयार की गई", "Images captured": "ली गई छवियां", "Onions assessed": "मूल्यांकित प्याज", "Quality report": "गुणवत्ता रिपोर्ट", "Grade A": "ग्रेड ए", "Grade summary": "ग्रेड सारांश", "Damaged": "क्षतिग्रस्त", "Rotten": "सड़े हुए", "Sprouted": "अंकुरित", "Undersized": "छोटे आकार के", "Defect findings": "दोषों के निष्कर्ष", "Produce photographs": "उपज की तस्वीरें", "Overall assessment": "समग्र मूल्यांकन", "Assessment status": "मूल्यांकन स्थिति", "Assessment recorded": "मूल्यांकन दर्ज किया गया", "Awaiting officer confirmation": "अधिकारी की पुष्टि की प्रतीक्षा", "Flagged for manual review": "मैन्युअल समीक्षा के लिए चिह्नित", "Flag for Manual Review": "मैन्युअल समीक्षा के लिए चिह्नित करें", "Assessment in progress": "मूल्यांकन जारी है", "Starts after document verification": "दस्तावेज़ सत्यापन के बाद शुरू होगा", "Waiting for assessment": "मूल्यांकन की प्रतीक्षा", "The onion quality assessment begins once your documents are verified at the centre.": "केंद्र पर आपके दस्तावेज़ सत्यापित होने के बाद प्याज गुणवत्ता मूल्यांकन शुरू होता है।", "Your batch is in the queue for the onion quality assessment.": "आपका माल प्याज गुणवत्ता मूल्यांकन की कतार में है।", "Your onion images are being assessed.": "आपके प्याज की छवियों का मूल्यांकन हो रहा है।", "Your onions have been assessed. The result appears here once the officer confirms it.": "आपके प्याज का मूल्यांकन हो चुका है। अधिकारी की पुष्टि के बाद परिणाम यहां दिखेगा।", "The officer is reviewing this batch. Your result will appear here once the review is complete.": "अधिकारी इस माल की समीक्षा कर रहे हैं। समीक्षा पूरी होने पर परिणाम यहां दिखेगा।", "Photographs of your batch have been captured. The assessment will start shortly.": "आपके माल की तस्वीरें ली जा चुकी हैं। मूल्यांकन जल्द शुरू होगा।", "Main findings": "मुख्य निष्कर्ष", "onions assessed": "प्याज का मूल्यांकन", "Demo values for the prototype.": "प्रोटोटाइप के लिए डेमो मान।", "Today's batches": "आज के बैच", "Pending assessments": "लंबित मूल्यांकन", "Completed assessments": "पूर्ण मूल्यांकन", "Flagged for review": "समीक्षा के लिए चिह्नित", "Flagged batches": "चिह्नित बैच", "Open assessments": "मूल्यांकन खोलें", "Average Grade A": "औसत ग्रेड ए", "Average URS": "औसत URS", "No batches assessed yet today.": "आज अभी तक किसी बैच का मूल्यांकन नहीं हुआ है।", "View Assessment": "मूल्यांकन देखें", "Onion Batch Details": "प्याज बैच विवरण", "Capture Onion Images": "प्याज की तस्वीरें लें", "Take photo": "फोटो लें", "Upload images": "छवियां अपलोड करें", "Clear all": "सभी हटाएं", "Start Quality Assessment": "गुणवत्ता मूल्यांकन शुरू करें", "Quality Assessment Results": "गुणवत्ता मूल्यांकन परिणाम", "AI Quality Assessment": "एआई गुणवत्ता मूल्यांकन", "Analyzing onion images...": "प्याज की छवियों का विश्लेषण हो रहा है...", "Images received": "छवियां प्राप्त", "Onion detection": "प्याज की पहचान", "Defect assessment": "दोष मूल्यांकन", "Size assessment": "आकार मूल्यांकन", "Grade calculation": "ग्रेड गणना", "How was this assessment determined?": "यह मूल्यांकन कैसे निर्धारित किया गया?", "Visible damage": "दिखाई देने वाली क्षति", "Rot / decay indicators": "सड़न / क्षय के संकेत", "Sprouting": "अंकुरण", "Size classification": "आकार वर्गीकरण", "Grade A / URS classification": "ग्रेड ए / URS वर्गीकरण", "Detected Defects": "पाए गए दोष", "Assessed images": "मूल्यांकित छवियां", "Confirm & Record Assessment": "मूल्यांकन की पुष्टि करें और दर्ज करें"} };
Object.assign(OQ_T.mr, {"Quality reports":"गुणवत्ता अहवाल","All quality reports":"सर्व गुणवत्ता अहवाल","Report generated":"अहवाल तयार","Digital Quality Report ready":"डिजिटल गुणवत्ता अहवाल तयार","Quality assessment recorded":"गुणवत्ता मूल्यांकन नोंदवले","Batch flagged for manual review":"बॅच मॅन्युअल पुनरावलोकनासाठी चिन्हांकित","Your digital quality reports. Each report appears here as soon as the officer's onion quality assessment generates it - the same report the officer sees.":"तुमचे डिजिटल गुणवत्ता अहवाल. अधिकाऱ्याच्या कांदा गुणवत्ता मूल्यांकनातून अहवाल तयार होताच तो येथे दिसतो - अधिकारी पाहतो तोच अहवाल.","No quality reports yet. Your report appears here automatically once the officer completes the onion quality assessment for your batch.":"अद्याप गुणवत्ता अहवाल नाहीत. अधिकाऱ्याने तुमच्या मालाचे कांदा गुणवत्ता मूल्यांकन पूर्ण केल्यावर अहवाल येथे आपोआप दिसेल."});
Object.assign(OQ_T.hi, {"Quality reports":"गुणवत्ता रिपोर्ट","All quality reports":"सभी गुणवत्ता रिपोर्ट","Report generated":"रिपोर्ट तैयार","Digital Quality Report ready":"डिजिटल गुणवत्ता रिपोर्ट तैयार","Quality assessment recorded":"गुणवत्ता मूल्यांकन दर्ज किया गया","Batch flagged for manual review":"बैच मैन्युअल समीक्षा के लिए चिह्नित","Your digital quality reports. Each report appears here as soon as the officer's onion quality assessment generates it - the same report the officer sees.":"आपकी डिजिटल गुणवत्ता रिपोर्ट। अधिकारी के प्याज गुणवत्ता मूल्यांकन से रिपोर्ट बनते ही यहां दिखती है - वही रिपोर्ट जो अधिकारी देखता है।","No quality reports yet. Your report appears here automatically once the officer completes the onion quality assessment for your batch.":"अभी तक कोई गुणवत्ता रिपोर्ट नहीं। अधिकारी द्वारा आपके माल का प्याज गुणवत्ता मूल्यांकन पूरा करते ही रिपोर्ट यहां अपने आप दिखेगी।"});
Object.assign(GLOBAL_T.mr, OQ_T.mr); Object.assign(GLOBAL_T.hi, OQ_T.hi);

(() => {
const globalLangOriginal = new WeakMap();
let __annsaarthiTranslating = false;
const FALLBACK = {
    mr: {
      "Sign in or register":"साइन इन करा किंवा नोंदणी करा",
      "Your mobile number is your login.":"तुमचा मोबाईल क्रमांक हाच तुमचा लॉगिन आहे.",
      "New farmers register once":"नवीन शेतकऱ्यांनी एकदाच नोंदणी करावी",
      "booking available":"बुकिंग उपलब्ध आहे",
      "approved farmer":"मंजूर शेतकरी",
      "Use demo farmer":"डेमो शेतकरी वापरा",
      "Ready for demo":"डेमोसाठी तयार",
      "Prototype only. OTP is simulated in the browser.":"फक्त प्रोटोटाइप. OTP ब्राउझरमध्ये सिम्युलेट केला आहे.",
      "Mobile number":"मोबाईल क्रमांक",
      "10-digit number":"१० अंकी क्रमांक",
      "Send OTP":"OTP पाठवा",
      "Verify OTP":"OTP पडताळा",
      "Change number":"क्रमांक बदला",
      "Resend OTP":"OTP पुन्हा पाठवा",
      "Enter OTP":"OTP प्रविष्ट करा",
      "Register as a new farmer":"नवीन शेतकरी म्हणून नोंदणी करा",
      "Your mobile number is verified":"तुमचा मोबाईल क्रमांक पडताळला गेला आहे",
      "Personal details":"वैयक्तिक माहिती",
      "Address details":"पत्त्याची माहिती",
      "Farm details":"शेतीची माहिती",
      "Identity verification":"ओळख पडताळणी",
      "Bank details":"बँक तपशील",
      "Documents":"कागदपत्रे",
      "Review":"पुनरावलोकन",
      "Submit registration":"नोंदणी सबमिट करा",
      "Registration submitted":"नोंदणी सबमिट झाली",
      "Select crop":"पीक निवडा",
      "Select crop(s)":"पीक निवडा",
      "Other crop":"इतर पीक",
      "Enter crop name":"पिकाचे नाव प्रविष्ट करा",
      "Select procurement centre":"खरेदी केंद्र निवडा",
      "Nearest procurement centre":"जवळचे खरेदी केंद्र",
      "Available slots":"उपलब्ध स्लॉट",
      "Select a slot":"स्लॉट निवडा",
      "Book slot":"स्लॉट बुक करा",
      "Confirm booking":"बुकिंगची पुष्टी करा",
      "Booking confirmed":"बुकिंग निश्चित झाले",
      "Track status":"स्थिती तपासा",
      "Current status":"सध्याची स्थिती",
      "Payment status":"पेमेंटची स्थिती",
      "Final amount":"अंतिम रक्कम",
      "Download receipt":"पावती डाउनलोड करा",
      "Receipt":"पावती",
      "Payment completed":"पेमेंट पूर्ण झाले",
      "Payment pending":"पेमेंट प्रलंबित",
      "Quality check":"गुणवत्ता तपासणी",
      "Check-in":"चेक-इन",
      "Weighing":"वजन मोजणी",
      "Procurement centre":"खरेदी केंद्र",
      "Token number":"टोकन क्रमांक",
      "Queue":"रांग",
      "Live updates":"थेट अपडेट्स",
      "Today's bookings":"आजची बुकिंग",
      "Farmer applications":"शेतकरी अर्ज",
      "Registered farmers":"नोंदणीकृत शेतकरी",
      "Procurement centres":"खरेदी केंद्रे",
      "Schedules & capacity":"वेळापत्रक आणि क्षमता",
      "Slot & booking rules":"स्लॉट आणि बुकिंग नियम",
      "Today at a glance":"आजचा आढावा",
      "Live queue":"थेट रांग",
      "Check-in & verification":"चेक-इन आणि पडताळणी",
      "Section queues":"विभागाच्या रांगा",
      "Weighing & procurement":"वजन मोजणी आणि खरेदी",
      "Payment updates":"पेमेंट अपडेट्स",
      "Applications":"अर्ज",
      "Public screen":"सार्वजनिक स्क्रीन",
      "Mandi display wall":"मंडी डिस्प्ले स्क्रीन",
      "Open mandi display wall":"मंडी डिस्प्ले स्क्रीन खोलें",
      "Switch interface":"इंटरफेस बदलें",
      "Sign out":"लॉग आउट",
      "Close portal":"पोर्टल बंद करें",
      "Menu":"मेनू",
      "Help & support":"मदत आणि सहाय्य",
      "Need more help?":"अधिक मदत हवी आहे?",
      "Search":"शोधा",
      "Submit":"सबमिट करा",
      "Save":"जतन करा",
      "Cancel":"रद्द करा",
      "Confirm":"पुष्टी करा",
      "Back":"मागे",
      "Next":"पुढे",
      "Continue":"पुढे जा",
      "Required":"आवश्यक",
      "Optional":"पर्यायी",
      "Upload":"अपलोड करा",
      "Upload document":"कागदपत्र अपलोड करा",
      "Show":"दाखवा",
      "Hide":"लपवा",
      "Account number":"खाते क्रमांक",
      "Confirm account number":"खाते क्रमांकाची पुष्टी करा",
      "Account holder name":"खातेदाराचे नाव",
      "IFSC code":"IFSC कोड",
      "Bank name":"बँकेचे नाव",
      "Land area":"जमिनीचे क्षेत्रफळ",
      "Crop name":"पिकाचे नाव",
      "State":"राज्य",
      "District":"जिल्हा",
      "Taluka":"तालुका",
      "Village":"गाव",
      "Address":"पत्ता",
      "Gender":"लिंग",
      "Date of birth":"जन्मतारीख",
      "Farmer category":"शेतकरी वर्ग",
      "Farmer type":"शेतकरी प्रकार",
      "Father":"वडील",
      "Mother":"आई",
      "Husband":"पती",
      "Wife":"पत्नी",
      "Male":"पुरुष",
      "Female":"महिला",
      "Other":"इतर",
      "Savings":"बचत",
      "Current":"चालू",
      "Wheat":"गहू",
      "Rice":"तांदूळ",
      "Paddy":"भात",
      "Cotton":"कापूस",
      "Soybean":"सोयाबीन",
      "Maize":"मका",
      "Pulses":"डाळी",
      "Sugarcane":"ऊस",
      "Groundnut":"भुईमूग",
      "Bajra":"बाजरी",
      "Jowar":"ज्वारी",
      "Ragi":"नाचणी",
      "Barley":"जव",
      "Chickpea":"हरभरा",
      "Tur":"तूर",
      "Moong":"मूग",
      "Urad":"उडीद",
      "Mustard":"मोहरी",
      "Sunflower":"सूर्यफूल",
      "Sesame":"तीळ",
      "Onion":"कांदा",
      "Potato":"बटाटा",
      "Tomato":"टोमॅटो",
      "approved":"मंजूर",
      "pending":"प्रलंबित",
      "completed":"पूर्ण",
      "upcoming":"आगामी",
      "available":"उपलब्ध",
      "unavailable":"उपलब्ध नाही",
      "No data available":"माहिती उपलब्ध नाही",
      "No slots available":"स्लॉट उपलब्ध नाहीत",
      "Loading":"लोड होत आहे",
      "Please wait":"कृपया प्रतीक्षा करा",
      "Welcome":"स्वागत आहे",
      "Welcome back":"पुन्हा स्वागत आहे",
      "Farmer":"शेतकरी",
      "Mandi officer":"मंडी अधिकारी",
      "Admin":"प्रशासक",
      "Mandi display":"मंडी डिस्प्ले",
      "Choose an interface":"इंटरफेस निवडा"
    },
    hi: {
      "Sign in or register":"साइन इन करें या पंजीकरण करें",
      "Your mobile number is your login.":"आपका मोबाइल नंबर ही आपका लॉगिन है।",
      "New farmers register once":"नए किसानों को एक बार पंजीकरण करना होगा",
      "booking available":"बुकिंग उपलब्ध है",
      "approved farmer":"स्वीकृत किसान",
      "Use demo farmer":"डेमो किसान का उपयोग करें",
      "Ready for demo":"डेमो के लिए तैयार",
      "Prototype only. OTP is simulated in the browser.":"केवल प्रोटोटाइप। OTP ब्राउज़र में सिम्युलेट किया गया है।",
      "Mobile number":"मोबाइल नंबर",
      "10-digit number":"10 अंकों का नंबर",
      "Send OTP":"OTP भेजें",
      "Verify OTP":"OTP सत्यापित करें",
      "Change number":"नंबर बदलें",
      "Resend OTP":"OTP फिर भेजें",
      "Enter OTP":"OTP दर्ज करें",
      "Register as a new farmer":"नए किसान के रूप में पंजीकरण करें",
      "Your mobile number is verified":"आपका मोबाइल नंबर सत्यापित है",
      "Personal details":"व्यक्तिगत जानकारी",
      "Address details":"पते की जानकारी",
      "Farm details":"खेत की जानकारी",
      "Identity verification":"पहचान सत्यापन",
      "Bank details":"बैंक विवरण",
      "Documents":"दस्तावेज़",
      "Review":"समीक्षा",
      "Submit registration":"पंजीकरण जमा करें",
      "Registration submitted":"पंजीकरण जमा हो गया",
      "Select crop":"फसल चुनें",
      "Select crop(s)":"फसल चुनें",
      "Other crop":"अन्य फसल",
      "Enter crop name":"फसल का नाम दर्ज करें",
      "Select procurement centre":"खरीद केंद्र चुनें",
      "Nearest procurement centre":"निकटतम खरीद केंद्र",
      "Available slots":"उपलब्ध स्लॉट",
      "Select a slot":"स्लॉट चुनें",
      "Book slot":"स्लॉट बुक करें",
      "Confirm booking":"बुकिंग की पुष्टि करें",
      "Booking confirmed":"बुकिंग की पुष्टि हो गई",
      "Track status":"स्थिति देखें",
      "Current status":"वर्तमान स्थिति",
      "Payment status":"भुगतान की स्थिति",
      "Final amount":"अंतिम राशि",
      "Download receipt":"रसीद डाउनलोड करें",
      "Receipt":"रसीद",
      "Payment completed":"भुगतान पूरा हुआ",
      "Payment pending":"भुगतान लंबित",
      "Quality check":"गुणवत्ता जांच",
      "Check-in":"चेक-इन",
      "Weighing":"वजन",
      "Procurement centre":"खरीद केंद्र",
      "Token number":"टोकन नंबर",
      "Queue":"कतार",
      "Live updates":"लाइव अपडेट्स",
      "Today's bookings":"आज की बुकिंग",
      "Farmer applications":"किसान आवेदन",
      "Registered farmers":"पंजीकृत किसान",
      "Procurement centres":"खरीद केंद्र",
      "Schedules & capacity":"समय-सारणी और क्षमता",
      "Slot & booking rules":"स्लॉट और बुकिंग नियम",
      "Today at a glance":"आज का अवलोकन",
      "Live queue":"लाइव कतार",
      "Check-in & verification":"चेक-इन और सत्यापन",
      "Section queues":"विभाग की कतारें",
      "Weighing & procurement":"वजन और खरीद",
      "Payment updates":"भुगतान अपडेट्स",
      "Applications":"आवेदन",
      "Public screen":"सार्वजनिक स्क्रीन",
      "Mandi display wall":"मंडी डिस्प्ले स्क्रीन",
      "Open mandi display wall":"मंडी डिस्प्ले स्क्रीन खोलें",
      "Switch interface":"इंटरफेस बदलें",
      "Sign out":"लॉग आउट",
      "Close portal":"पोर्टल बंद करें",
      "Menu":"मेनू",
      "Help & support":"मदद और सहायता",
      "Need more help?":"और मदद चाहिए?",
      "Search":"खोजें",
      "Submit":"जमा करें",
      "Save":"सहेजें",
      "Cancel":"रद्द करें",
      "Confirm":"पुष्टि करें",
      "Back":"पीछे",
      "Next":"आगे",
      "Continue":"जारी रखें",
      "Required":"आवश्यक",
      "Optional":"वैकल्पिक",
      "Upload":"अपलोड करें",
      "Upload document":"दस्तावेज़ अपलोड करें",
      "Show":"दिखाएँ",
      "Hide":"छिपाएँ",
      "Account number":"खाता नंबर",
      "Confirm account number":"खाता नंबर की पुष्टि करें",
      "Account holder name":"खाताधारक का नाम",
      "IFSC code":"IFSC कोड",
      "Bank name":"बैंक का नाम",
      "Land area":"भूमि क्षेत्रफल",
      "Crop name":"फसल का नाम",
      "State":"राज्य",
      "District":"जिला",
      "Taluka":"तालुका",
      "Village":"गाँव",
      "Address":"पता",
      "Gender":"लिंग",
      "Date of birth":"जन्म तिथि",
      "Farmer category":"किसान वर्ग",
      "Farmer type":"किसान प्रकार",
      "Father":"पिता",
      "Mother":"माता",
      "Husband":"पति",
      "Wife":"पत्नी",
      "Male":"पुरुष",
      "Female":"महिला",
      "Other":"अन्य",
      "Savings":"बचत",
      "Current":"चालू",
      "Wheat":"गेहूँ",
      "Rice":"चावल",
      "Paddy":"धान",
      "Cotton":"कपास",
      "Soybean":"सोयाबीन",
      "Maize":"मक्का",
      "Pulses":"दालें",
      "Sugarcane":"गन्ना",
      "Groundnut":"मूंगफली",
      "Bajra":"बाजरा",
      "Jowar":"ज्वार",
      "Ragi":"रागी",
      "Barley":"जौ",
      "Chickpea":"चना",
      "Tur":"अरहर",
      "Moong":"मूंग",
      "Urad":"उड़द",
      "Mustard":"सरसों",
      "Sunflower":"सूरजमुखी",
      "Sesame":"तिल",
      "Onion":"प्याज़",
      "Potato":"आलू",
      "Tomato":"टमाटर",
      "approved":"स्वीकृत",
      "pending":"लंबित",
      "completed":"पूरा",
      "upcoming":"आगामी",
      "available":"उपलब्ध",
      "unavailable":"उपलब्ध नहीं",
      "No data available":"जानकारी उपलब्ध नहीं",
      "No slots available":"कोई स्लॉट उपलब्ध नहीं",
      "Loading":"लोड हो रहा है",
      "Please wait":"कृपया प्रतीक्षा करें",
      "Welcome":"स्वागत है",
      "Welcome back":"वापसी पर स्वागत है",
      "Farmer":"किसान",
      "Mandi officer":"मंडी अधिकारी",
      "Admin":"प्रशासक",
      "Mandi display":"मंडी डिस्प्ले",
      "Choose an interface":"इंटरफेस चुनें"
    }
  };
  Object.assign(FALLBACK.mr, OQ_T.mr); Object.assign(FALLBACK.hi, OQ_T.hi);

  const WORD_T = {
    mr: {Your:'तुमचा',your:'तुमचा',you:'तुम्ही',need:'गरज',to:'करण्यासाठी',do:'करायचे',current:'सध्याचा',currently:'सध्या',next:'पुढील',stage:'टप्पा',farmers:'शेतकरी',farmer:'शेतकरी',ahead:'पुढे',estimated:'अंदाजे',waiting:'प्रतीक्षा',wait:'प्रतीक्षा',time:'वेळ',assigned:'नेमलेला',section:'विभाग',quality:'गुणवत्ता',payment:'पेमेंट',status:'स्थिती',completed:'पूर्ण',processing:'प्रक्रियेत',amount:'रक्कम',quantity:'प्रमाण',crop:'पीक',booking:'बुकिंग',book:'बुक',slot:'स्लॉट',centre:'केंद्र',today:'आज',identity:'ओळख',verification:'पडताळणी',document:'कागदपत्र',problem:'अडचण',notification:'सूचना',update:'अपडेट',updates:'अपडेट्स',progress:'प्रगती',procurement:'खरेदी',journey:'प्रवास',token:'टोकन',number:'क्रमांक',serving:'सेवा',being:'असलेला',assessed:'तपासला',weighing:'वजन',recommended:'शिफारस केलेली',arrival:'आगमन',calling:'बोलावण्याची',expected:'अपेक्षित',receipt:'पावती',download:'डाउनलोड',action:'कृती',required:'आवश्यक',open:'उघडा',close:'बंद',save:'जतन',cancel:'रद्द',confirm:'पुष्टी',back:'मागे',continue:'पुढे',select:'निवडा',enter:'प्रविष्ट करा',name:'नाव',details:'तपशील',mobile:'मोबाईल',village:'गाव',records:'नोंदी',account:'खाते',farmerId:'शेतकरी आयडी'},
    hi: {Your:'आपका',your:'आपका',you:'आप',need:'जरूरत',to:'करने के लिए',do:'करना है',current:'वर्तमान',currently:'अभी',next:'अगला',stage:'चरण',farmers:'किसान',farmer:'किसान',ahead:'आगे',estimated:'अनुमानित',waiting:'प्रतीक्षा',wait:'प्रतीक्षा',time:'समय',assigned:'निर्धारित',section:'सेक्शन',quality:'गुणवत्ता',payment:'भुगतान',status:'स्थिति',completed:'पूरा',processing:'प्रक्रिया में',amount:'राशि',quantity:'मात्रा',crop:'फसल',booking:'बुकिंग',book:'बुक',slot:'स्लॉट',centre:'केंद्र',today:'आज',identity:'पहचान',verification:'सत्यापन',document:'दस्तावेज़',problem:'समस्या',notification:'सूचना',update:'अपडेट',updates:'अपडेट्स',progress:'प्रगति',procurement:'खरीद',journey:'यात्रा',token:'टोकन',number:'नंबर',serving:'सेवा में',being:'हो रहा',assessed:'जाँचा',weighing:'तौल',recommended:'अनुशंसित',arrival:'आगमन',calling:'बुलाने का',expected:'अपेक्षित',receipt:'रसीद',download:'डाउनलोड',action:'कार्रवाई',required:'आवश्यक',open:'खोलें',close:'बंद करें',save:'सहेजें',cancel:'रद्द करें',confirm:'पुष्टि',back:'पीछे',continue:'आगे',select:'चुनें',enter:'दर्ज करें',name:'नाम',details:'विवरण',mobile:'मोबाइल',village:'गाँव',records:'रिकॉर्ड',account:'खाता',farmerId:'किसान आईडी'}
  };
  // Final word coverage for short UI fragments that are dynamically composed.
Object.assign(WORD_T.mr, {the:'',The:'',a:'एक',an:'एक',and:'आणि',or:'किंवा',is:'आहे',are:'आहेत',was:'होते',were:'होते',be:'असणे',been:'झालेले',being:'असलेले',of:'चा',in:'मध्ये',on:'वर',at:'येथे',for:'साठी',from:'पासून',with:'सोबत',by:'द्वारे',as:'म्हणून',this:'हे',that:'ते',these:'हे',those:'ते',your:'तुमचा',Your:'तुमचा',you:'तुम्ही',You:'तुम्ही',please:'कृपया',Please:'कृपया',now:'आता',Now:'आता',today:'आज',Today:'आज',current:'सध्याचा',Current:'सध्याचा',next:'पुढील',Next:'पुढील',select:'निवडा',Select:'निवडा',enter:'प्रविष्ट करा',Enter:'प्रविष्ट करा',choose:'निवडा',Choose:'निवडा',view:'पाहा',View:'पाहा',details:'तपशील',Details:'तपशील',information:'माहिती',Information:'माहिती',available:'उपलब्ध',Available:'उपलब्ध',not:'नाही',Not:'नाही',no:'नाही',No:'नाही',yes:'होय',Yes:'होय',completed:'पूर्ण',Completed:'पूर्ण',pending:'प्रलंबित',Pending:'प्रलंबित',approved:'मंजूर',Approved:'मंजूर',required:'आवश्यक',Required:'आवश्यक',optional:'पर्यायी',Optional:'पर्यायी',open:'उघडा',Open:'उघडा',close:'बंद',Close:'बंद',back:'मागे',Back:'मागे',next:'पुढे',Next:'पुढे',continue:'पुढे जा',Continue:'पुढे जा',submit:'सबमिट करा',Submit:'सबमिट करा',save:'जतन करा',Save:'जतन करा',cancel:'रद्द करा',Cancel:'रद्द करा',confirm:'पुष्टी करा',Confirm:'पुष्टी करा',change:'बदला',Change:'बदला',add:'जोडा',Add:'जोडा',remove:'काढा',Remove:'काढा',edit:'संपादित करा',Edit:'संपादित करा',search:'शोधा',Search:'शोधा',upload:'अपलोड करा',Upload:'अपलोड करा',replace:'बदला',Replace:'बदला',name:'नाव',Name:'नाव',number:'क्रमांक',Number:'क्रमांक',date:'तारीख',Date:'तारीख',time:'वेळ',Time:'वेळ',status:'स्थिती',Status:'स्थिती',type:'प्रकार',Type:'प्रकार',details:'तपशील',Details:'तपशील',record:'नोंद',Record:'नोंद',records:'नोंदी',Records:'नोंदी',today:'आज',Today:'आज',tomorrow:'उद्या',Tomorrow:'उद्या'});
Object.assign(WORD_T.hi, {the:'',The:'',a:'एक',an:'एक',and:'और',or:'या',is:'है',are:'हैं',was:'था',were:'थे',be:'होना',been:'रहा',being:'हो रहा',of:'का',in:'में',on:'पर',at:'पर',for:'के लिए',from:'से',with:'के साथ',by:'द्वारा',as:'के रूप में',this:'यह',that:'वह',these:'ये',those:'वे',your:'आपका',Your:'आपका',you:'आप',You:'आप',please:'कृपया',Please:'कृपया',now:'अभी',Now:'अभी',today:'आज',Today:'आज',current:'वर्तमान',Current:'वर्तमान',next:'अगला',Next:'अगला',select:'चुनें',Select:'चुनें',enter:'दर्ज करें',Enter:'दर्ज करें',choose:'चुनें',Choose:'चुनें',view:'देखें',View:'देखें',details:'विवरण',Details:'विवरण',information:'जानकारी',Information:'जानकारी',available:'उपलब्ध',Available:'उपलब्ध',not:'नहीं',Not:'नहीं',no:'कोई नहीं',No:'कोई नहीं',yes:'हाँ',Yes:'हाँ',completed:'पूरा',Completed:'पूरा',pending:'लंबित',Pending:'लंबित',approved:'स्वीकृत',Approved:'स्वीकृत',required:'आवश्यक',Required:'आवश्यक',optional:'वैकल्पिक',Optional:'वैकल्पिक',open:'खोलें',Open:'खोलें',close:'बंद करें',Close:'बंद करें',back:'वापस',Back:'वापस',continue:'आगे बढ़ें',Continue:'आगे बढ़ें',submit:'जमा करें',Submit:'जमा करें',save:'सहेजें',Save:'सहेजें',cancel:'रद्द करें',Cancel:'रद्द करें',confirm:'पुष्टि करें',Confirm:'पुष्टि करें',change:'बदलें',Change:'बदलें',add:'जोड़ें',Add:'जोड़ें',remove:'हटाएँ',Remove:'हटाएँ',edit:'संपादित करें',Edit:'संपादित करें',search:'खोजें',Search:'खोजें',upload:'अपलोड करें',Upload:'अपलोड करें',replace:'बदलें',Replace:'बदलें',name:'नाम',Name:'नाम',number:'नंबर',Number:'नंबर',date:'तारीख',Date:'तारीख',time:'समय',Time:'समय',status:'स्थिति',Status:'स्थिति',type:'प्रकार',Type:'प्रकार',details:'विवरण',Details:'विवरण',record:'रिकॉर्ड',Record:'रिकॉर्ड',records:'रिकॉर्ड',Records:'रिकॉर्ड',tomorrow:'कल',Tomorrow:'कल'});

const phraseTranslate = (text, lang) => {
    if (!text || lang === 'en') return text;
    const dict = FALLBACK[lang] || {};
    if (dict[text]) return dict[text];

    /* Longest phrase first. */
    let out = text;
    const entries = Object.entries(dict).sort((a,b)=>b[0].length-a[0].length);
    for (const [en, tr] of entries) { if (out.includes(en)) out = out.split(en).join(tr); }
    /* Final coverage layer for UI words that are not yet in a phrase dictionary.
       IDs, numbers, URLs, names and punctuation remain untouched. */
    const words = WORD_T[lang] || {};
    return text.replace(/[A-Za-z][A-Za-z'-]*/g, (w) => words[w] || w);
  };

  function applyCoverageLanguage() {
    if (typeof S === 'undefined' || typeof globalLangOriginal === 'undefined') return;
    return; /* localisation is handled by Google Translate (services/googleTranslate.js) */
    const lang = S.language || getStoredLanguage() || 'en';
    const root = document.getElementById('portal');
    if (!root || !S.open) return;

    __annsaarthiTranslating = true;
    try {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);

      nodes.forEach(node => {
        const parent = node.parentElement;
        if (!parent || ['SCRIPT','STYLE','NOSCRIPT'].includes(parent.tagName)) return;
        if (parent.closest('[data-no-translate]')) return;

        if (!globalLangOriginal.has(node)) globalLangOriginal.set(node, node.nodeValue);
        const original = globalLangOriginal.get(node);
        if (!original || !original.trim()) return;

        const lead = (original.match(/^\s*/)||[''])[0];
        const trail = (original.match(/\s*$/)||[''])[0];
        const base = original.trim();

        if (lang === 'en') {
          node.nodeValue = original;
        } else {
          let translated = (GLOBAL_T[lang] && GLOBAL_T[lang][base]) || null;
          if (!translated) translated = phraseTranslate(base, lang);
          node.nodeValue = lead + (translated || base) + trail;
        }
      });

      root.querySelectorAll('input[placeholder], textarea[placeholder]').forEach(el => {
        if (!el.dataset.asOriginalPlaceholder) el.dataset.asOriginalPlaceholder = el.placeholder;
        const base = el.dataset.asOriginalPlaceholder;
        el.placeholder = lang === 'en' ? base : phraseTranslate(base, lang);
      });

      root.querySelectorAll('[title]').forEach(el => {
        if (!el.dataset.asOriginalTitle) el.dataset.asOriginalTitle = el.getAttribute('title');
        const base = el.dataset.asOriginalTitle;
        el.setAttribute('title', lang === 'en' ? base : phraseTranslate(base, lang));
      });

      root.querySelectorAll('[aria-label]').forEach(el => {
        if (!el.dataset.asOriginalAria2) el.dataset.asOriginalAria2 = el.getAttribute('aria-label');
        const base = el.dataset.asOriginalAria2;
        el.setAttribute('aria-label', lang === 'en' ? base : phraseTranslate(base, lang));
      });

      updateLanguageButtons();
    } finally {
      __annsaarthiTranslating = false;
    }
  }

  /* Make every subsequent render inherit the selected language. */
  const portal = document.getElementById('portal');
  if (portal && !window.__annsaarthiCoverageObserver) {
    window.__annsaarthiCoverageObserver = new MutationObserver(() => {
      if (!__annsaarthiTranslating) requestAnimationFrame(applyCoverageLanguage);
    });
    window.__annsaarthiCoverageObserver.observe(portal, {childList:true, subtree:true});
  }

  window.annsaarthiApplyCompleteLanguage = applyCoverageLanguage;
  requestAnimationFrame(applyCoverageLanguage);
})()
const applyCoverageLanguage = window.annsaarthiApplyCompleteLanguage;

// Keep the existing file's S.language API and persist the selection across every view.
Object.defineProperty(S, 'lang', { configurable:true, get(){ return S.language; }, set(v){ S.language=v; } });
const __origSetLanguage = typeof setLanguage === 'function' ? setLanguage : null;
function applyPortalLanguage(){
  if (typeof applyCoverageLanguage === 'function') applyCoverageLanguage();
  if (typeof applyLandingLanguage === 'function') applyLandingLanguage();
}
function setLanguage(lang){
  if (!['en','mr','hi'].includes(lang)) return;
  S.uiLang = lang;            /* S.language stays 'en': English is the source language */
  setStoredLanguage(lang);
  persistSession(true);       /* exact portal/role/page/farmer saved BEFORE the translator touches the page */
  try { translatePage(lang); } catch (err) { console.warn('translatePage failed:', err); }   /* Google Translate */
  updateLanguageButtons();
  if (lang === 'en') ensureEnglishRestored();   /* safety net: Google Translate must really let go */
  keepPortalOnScreen(); setTimeout(keepPortalOnScreen, 400); setTimeout(keepPortalOnScreen, 1500);   /* same page stays visible */
}

/* ---- Google Translate helpers (no second translation system; they only verify/repair the existing one) ---- */
let __gtEnTimer = null, __gtRenderTimer = null;
const GT_NODE = 'font[style*="vertical-align"]';        /* wrappers Google puts around every translated text node */
function gtIsTranslated() {
  const h = document.documentElement;
  return h.classList.contains('translated-ltr') || h.classList.contains('translated-rtl') || !!document.querySelector(GT_NODE);
}
function gtClearCookie() {
  try {
    const host = location.hostname, parts = host.split('.');
    const doms = ['', host, '.' + host]; if (parts.length > 2) doms.push('.' + parts.slice(-2).join('.'));
    doms.forEach((d) => { document.cookie = 'googtrans=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + (d ? '; domain=' + d : ''); });
  } catch (err) { /* cookies unavailable */ }
}
function gtSelectCombo(value) {
  const combo = document.querySelector('select.goog-te-combo');
  if (!combo) return false;
  const has = [...combo.options].some((o) => o.value === value);
  combo.value = has ? value : '';                       /* '' = "show original" when the widget has no explicit English entry */
  combo.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}
/* Hindi/Marathi -> English: if translatePage('en') left the page translated (stale googtrans cookie, widget not
   restoring dynamically inserted nodes ...), clear the cookie, ask the widget to show the original, and as a last
   resort reload once (annsaarthi_lang is already 'en', so the reload comes back in English). */
function ensureEnglishRestored() {
  clearTimeout(__gtEnTimer);
  __gtEnTimer = setTimeout(() => {
    if (S.uiLang !== 'en' || !gtIsTranslated()) return;
    gtClearCookie(); gtSelectCombo('en');
    __gtEnTimer = setTimeout(() => {
      if (S.uiLang !== 'en' || !gtIsTranslated()) return;
      try {
        if (Date.now() - Number(sessionStorage.getItem('annsaarthi_en_reload') || 0) < 15000) return;   /* never loop */
        sessionStorage.setItem('annsaarthi_en_reload', String(Date.now()));
      } catch (err) { return; }                     /* no sessionStorage -> cannot guard against loops, so do not reload */
      persistSession(true); gtClearCookie(); location.reload();   /* session is restored on the other side: same portal, role and page */
    }, 1200);
  }, 700);
}
/* portal.innerHTML is rebuilt on every render(): make the fresh English DOM follow the selected language. */
function reapplyTranslationAfterRender() {
  clearTimeout(__gtRenderTimer);
  __gtRenderTimer = setTimeout(() => {
    if (!S.open || S.uiLang === 'en') return;
    const root = document.getElementById('portal');
    if (root && !root.hidden && !root.querySelector(GT_NODE)) translatePage(S.uiLang);
  }, 500);
}
/* Startup consistency: the page must match annsaarthi_lang (stale googtrans cookie / missed initial translate). */
setTimeout(() => {
  if (S.uiLang === 'en') ensureEnglishRestored();
  else if (!gtIsTranslated()) translatePage(S.uiLang);
}, 2500);
function updateLanguageButtons(){
  document.querySelectorAll('.landing-lang,.lang-btn,.pbar__lang').forEach(b=>{
    const active=b.dataset.lang===S.uiLang;
    b.classList.toggle('is-on', active); b.classList.toggle('is-active', active);
  });
  markNoTranslate();
}
// Extend the proven dictionaries with the live-status wording added in the latest prototype.
const CURRENT_LIVE_T = {
  mr:{
    'Language':'भाषा','Live Procurement Status':'थेट खरेदी स्थिती','Your procurement':'तुमची खरेदी','Currently serving':'सध्या सेवा सुरू','Estimated wait':'अंदाजे प्रतीक्षा','Estimated time to next stage':'पुढील टप्प्यासाठी अंदाजे वेळ','Assigned section':'नेमलेला विभाग','What you need to do':'तुम्हाला काय करायचे आहे','Important update':'महत्त्वाची सूचना','No action required right now':'सध्या कोणतीही कृती आवश्यक नाही','Farmers ahead':'पुढे असलेले शेतकरी','Next stage':'पुढील टप्पा','Current stage':'सध्याचा टप्पा','Procurement complete':'खरेदी पूर्ण','Payment status':'पेमेंट स्थिती','Payment completed':'पेमेंट पूर्ण','Payment processing':'पेमेंट प्रक्रिया','Final amount':'अंतिम रक्कम','Download receipt':'पावती डाउनलोड करा','Your turn is approaching':'तुमची वेळ जवळ आली आहे','Action required':'कृती आवश्यक','Please proceed to your assigned section when your token is called.':'तुमचा टोकन क्रमांक पुकारल्यावर नेमलेल्या विभागात जा.','Please remain available near your assigned section.':'कृपया नेमलेल्या विभागाजवळ उपलब्ध राहा.','Quality section Q-2 is currently experiencing a 10-minute delay.':'गुणवत्ता विभाग Q-2 मध्ये सध्या १० मिनिटांचा विलंब आहे.'
  },
  hi:{
    'Language':'भाषा','Live Procurement Status':'लाइव खरीद स्थिति','Your procurement':'आपकी खरीद','Currently serving':'अभी सेवा में','Estimated wait':'अनुमानित प्रतीक्षा','Estimated time to next stage':'अगले चरण तक अनुमानित समय','Assigned section':'निर्धारित सेक्शन','What you need to do':'आपको क्या करना है','Important update':'महत्वपूर्ण सूचना','No action required right now':'अभी कोई कार्रवाई आवश्यक नहीं','Farmers ahead':'आगे के किसान','Next stage':'अगला चरण','Current stage':'वर्तमान चरण','Procurement complete':'खरीद पूरी','Payment status':'भुगतान की स्थिति','Payment completed':'भुगतान पूरा','Payment processing':'भुगतान प्रक्रिया','Final amount':'अंतिम राशि','Download receipt':'रसीद डाउनलोड करें','Your turn is approaching':'आपकी बारी पास आ रही है','Action required':'कार्रवाई आवश्यक','Please proceed to your assigned section when your token is called.':'टोकन नंबर पुकारे जाने पर निर्धारित सेक्शन में जाएँ।','Please remain available near your assigned section.':'कृपया निर्धारित सेक्शन के पास उपलब्ध रहें।','Quality section Q-2 is currently experiencing a 10-minute delay.':'गुणवत्ता सेक्शन Q-2 में अभी 10 मिनट की देरी है।'
  }
};

// Extra coverage for newly introduced and frequently rendered phrases.
Object.assign(GLOBAL_T.mr, {
  'Live status':'थेट स्थिती','Live procurement status':'थेट खरेदी स्थिती','No active procurement':'सध्या कोणतीही सक्रिय खरेदी नाही','Book a procurement slot to start live queue tracking.':'थेट रांग ट्रॅकिंग सुरू करण्यासाठी खरेदीचा स्लॉट बुक करा.',
  'Your turn is approaching':'तुमची वेळ जवळ आली आहे','Waiting for weighing':'वजनासाठी प्रतीक्षा','Action required':'कृती आवश्यक','Important update':'महत्त्वाची सूचना','Current stage':'सध्याचा टप्पा','Next stage':'पुढील टप्पा','Assigned section':'नेमलेला विभाग','What you need to do':'तुम्हाला काय करायचे आहे','Estimated wait':'अंदाजे प्रतीक्षा','Estimated time to next stage':'पुढील टप्प्यासाठी अंदाजे वेळ','Currently serving':'सध्या सेवा सुरू','Farmers ahead':'पुढे असलेले शेतकरी','Payment status':'पेमेंट स्थिती','Payment completed':'पेमेंट पूर्ण','Payment processing':'पेमेंट प्रक्रिया','Final amount':'अंतिम रक्कम','Download receipt':'पावती डाउनलोड करा','Refresh status':'स्थिती अपडेट करा','No action required right now':'सध्या कोणतीही कृती आवश्यक नाही'
});
Object.assign(GLOBAL_T.hi, {
  'Live status':'लाइव स्थिति','Live procurement status':'लाइव खरीद स्थिति','No active procurement':'कोई सक्रिय खरीद नहीं','Book a procurement slot to start live queue tracking.':'लाइव कतार ट्रैकिंग शुरू करने के लिए खरीद स्लॉट बुक करें।',
  'Your turn is approaching':'आपकी बारी पास आ रही है','Waiting for weighing':'तौल की प्रतीक्षा','Action required':'कार्रवाई आवश्यक','Important update':'महत्वपूर्ण सूचना','Current stage':'वर्तमान चरण','Next stage':'अगला चरण','Assigned section':'निर्धारित सेक्शन','What you need to do':'आपको क्या करना है','Estimated wait':'अनुमानित प्रतीक्षा','Estimated time to next stage':'अगले चरण तक अनुमानित समय','Currently serving':'अभी सेवा में','Farmers ahead':'आगे के किसान','Payment status':'भुगतान की स्थिति','Payment completed':'भुगतान पूरा','Payment processing':'भुगतान प्रक्रिया','Final amount':'अंतिम राशि','Download receipt':'रसीद डाउनलोड करें','Refresh status':'स्थिति अपडेट करें','No action required right now':'अभी कोई कार्रवाई आवश्यक नहीं'
});

Object.assign(GLOBAL_T.mr, CURRENT_LIVE_T.mr); Object.assign(GLOBAL_T.hi, CURRENT_LIVE_T.hi);
Object.assign(GLOBAL_T.mr, {
  "Sign in or register":"साइन इन करा किंवा नोंदणी करा","Mobile number":"मोबाईल क्रमांक","10-digit number":"१० अंकी क्रमांक","Send OTP":"OTP पाठवा","Enter OTP":"OTP प्रविष्ट करा","6-digit code":"६ अंकी कोड","Verify OTP":"OTP पडताळा","Resend OTP":"OTP पुन्हा पाठवा","Change number":"क्रमांक बदला","Demo farmer":"डेमो शेतकरी","Ready for demo":"डेमोसाठी तयार","Use demo farmer":"डेमो शेतकरी वापरा","Demo accounts":"डेमो खाती","Farmer registration":"शेतकरी नोंदणी","Farmer details":"शेतकरी तपशील","Full name":"पूर्ण नाव","Date of birth":"जन्मतारीख","Procurement centre":"खरेदी केंद्र","Available slots":"उपलब्ध स्लॉट","Select slot":"स्लॉट निवडा","Download Receipt":"पावती डाउनलोड करा","Main token":"मुख्य टोकन","Check in":"चेक-इन","Bank details":"बँक तपशील","Account number":"खाते क्रमांक","Confirm account number":"खाते क्रमांकाची पुष्टी करा","Queue empty.":"रांग रिकामी आहे.","Still stuck?":"अजूनही अडचण आहे का?","Help & Support":"मदत आणि सहाय्य","Book a slot":"स्लॉट बुक करा","My token":"माझा टोकन","Procurement journey":"खरेदीचा प्रवास","Payments & receipt":"पेमेंट आणि पावती","Profile & KYC":"प्रोफाइल आणि KYC","Today's bookings":"आजच्या बुकिंग","Check-in & verification":"चेक-इन आणि पडताळणी","Quality check":"गुणवत्ता तपासणी","Section queues":"विभागांच्या रांगा","Weighing & procurement":"वजन मोजणी आणि खरेदी","Payment updates":"पेमेंट अपडेट्स","Farmer applications":"शेतकरी अर्ज","Today at a glance":"आजचा आढावा","Live queue":"थेट रांग","Applications":"अर्ज","Schedules & capacity":"वेळापत्रक आणि क्षमता","Slot & booking rules":"स्लॉट आणि बुकिंगचे नियम","Registered farmers":"नोंदणीकृत शेतकरी","Sign out":"लॉग आउट","Close portal":"पोर्टल बंद करा","Live updates":"थेट अपडेट्स","Current stage":"सध्याचा टप्पा","Next stage":"पुढील टप्पा","Farmers ahead":"पुढे असलेले शेतकरी","Currently serving":"सध्या सेवा सुरू","Estimated wait":"अंदाजे प्रतीक्षा","Estimated time to next stage":"पुढील टप्प्यासाठी अंदाजे वेळ","Assigned section":"नेमलेला विभाग","What you need to do":"तुम्हाला काय करायचे आहे","Important update":"महत्त्वाची सूचना","No action required right now":"सध्या कोणतीही कृती आवश्यक नाही","No active procurement":"सध्या कोणतीही सक्रिय खरेदी नाही","Refresh status":"स्थिती अपडेट करा","Procurement complete":"खरेदी पूर्ण","Live status":"थेट स्थिती","Verification status":"पडताळणी स्थिती","Current token":"सध्याचा टोकन","Quality section / counter":"गुणवत्ता विभाग / काउंटर","Assigned weighing section":"नेमलेला वजन विभाग","Progress through procurement":"खरेदी प्रक्रियेतील प्रगती","Estimated calling time":"अंदाजे बोलावण्याची वेळ","Recommended arrival":"शिफारस केलेली आगमन वेळ","Document / problem notification":"कागदपत्र / अडचणीची सूचना","Expected payment / update":"अपेक्षित पेमेंट / अपडेट","Currently being verified":"सध्या पडताळणी सुरू आहे","Currently being assessed":"सध्या तपासणी सुरू आहे","Current weighing token":"सध्याचा वजन टोकन","Action required":"कृती आवश्यक","Document verification":"कागदपत्र पडताळणी","Slot booked":"स्लॉट बुक झाला","Main queue":"मुख्य रांग","Quality assessment":"गुणवत्ता तपासणी","Quality token":"गुणवत्ता टोकन","Section assigned":"विभाग नेमला","Payment processing":"पेमेंट प्रक्रिया सुरू आहे","Payment completed":"पेमेंट पूर्ण झाले","Please arrive during your assigned slot.":"तुमच्या नेमून दिलेल्या स्लॉटच्या वेळेत खरेदी केंद्रावर पोहोचा.","Please wait for identity verification.":"कृपया ओळख पडताळणीसाठी प्रतीक्षा करा.","Please remain available near your assigned section.":"कृपया नेमलेल्या विभागाजवळ उपलब्ध राहा.","Please proceed to your assigned section when your token is called.":"तुमचा टोकन क्रमांक पुकारल्यावर नेमलेल्या विभागात जा.","Your procurement amount is being finalized.":"तुमची खरेदीची रक्कम निश्चित केली जात आहे.","Procurement is complete. Check payment updates for the final amount.":"खरेदी पूर्ण झाली आहे. अंतिम रकमेची पेमेंट अपडेट पाहा.","Payment is being processed. No action is required right now.":"पेमेंट प्रक्रियेत आहे. सध्या कोणतीही कृती आवश्यक नाही.","Payment is complete. Open Payments & receipt to download your receipt.":"पेमेंट पूर्ण झाले आहे. पावती डाउनलोड करण्यासाठी पेमेंट आणि पावती उघडा.","Please stay available for the next update.":"पुढील अपडेटसाठी कृपया उपलब्ध राहा.","Verification desk":"पडताळणी कक्ष","Quality Section Q-2":"गुणवत्ता विभाग Q-2","Weighing Section 3":"वजन विभाग ३","Payment desk":"पेमेंट कक्ष","Token / payment":"टोकन / पेमेंट","Payment status":"पेमेंट स्थिती","Waiting for verification":"पडताळणीची प्रतीक्षा","Verification in progress":"पडताळणी सुरू आहे","Not started":"अद्याप सुरू झालेले नाही","Today at a glance":"आजचा आढावा","Live queue":"थेट रांग","Procurement centres":"खरेदी केंद्रे","Schedules & capacity":"वेळापत्रक आणि क्षमता","Slot & booking rules":"स्लॉट आणि बुकिंगचे नियम","Registered farmers":"नोंदणीकृत शेतकरी",
  "Booking confirmed":"बुकिंग निश्चित झाले","Your procurement slot has been confirmed.":"तुमचा खरेदी स्लॉट निश्चित झाला आहे.","Main queue token issued.":"मुख्य रांगेचे टोकन जारी झाले आहे.","Payment status changes after the officer initiates and completes the simulated payment.":"अधिकारी डेमो पेमेंट सुरू करून पूर्ण केल्यानंतर पेमेंटची स्थिती बदलेल.","After payment is completed, open Payments & receipt and select Download receipt.":"पेमेंट पूर्ण झाल्यानंतर पेमेंट आणि पावती उघडा आणि पावती डाउनलोड करा निवडा.","Live status refreshed.":"थेट स्थिती अपडेट झाली आहे.","Language: English":"भाषा: इंग्रजी",
  "Add a reason before continuing.":"पुढे जाण्यापूर्वी कारण द्या.","Enter the crop name to continue.":"पुढे जाण्यासाठी पिकाचे नाव प्रविष्ट करा.","Cancel this procurement slot?":"हा खरेदी स्लॉट रद्द करायचा आहे का?","Are you sure you want to cancel this procurement slot? The slot goes back into the pool and your main token is removed from the queue.":"तुम्हाला हा खरेदी स्लॉट नक्की रद्द करायचा आहे का? स्लॉट पुन्हा उपलब्ध होईल आणि तुमचा मुख्य टोकन रांगेतून काढला जाईल.","Rescheduling is switched off in the current configuration.":"सध्याच्या सेटिंगमध्ये वेळ बदलण्याची सुविधा बंद आहे.","Demo farmer loaded. Use OTP 123456.":"डेमो शेतकरी लोड झाला. OTP 123456 वापरा.","Your current token and procurement stage are shown under My token and Procurement journey.":"तुमचा सध्याचा टोकन आणि खरेदीचा टप्पा माझा टोकन आणि खरेदीचा प्रवास या विभागांत दिसतो.","Receipt becomes available after payment is completed.":"पेमेंट पूर्ण झाल्यानंतर पावती उपलब्ध होते.","Receipt downloaded.":"पावती डाउनलोड झाली.","Booking needs an approved registration.":"बुकिंगसाठी मंजूर नोंदणी आवश्यक आहे.","Procurement for this commodity is closed.":"या पिकासाठी खरेदी बंद आहे.","That centre is not operating right now.":"ते खरेदी केंद्र सध्या सुरू नाही.","That date is no longer open for procurement.":"त्या तारखेला आता खरेदी उपलब्ध नाही.","That slot no longer exists. Pick another one.":"तो स्लॉट आता उपलब्ध नाही. दुसरा स्लॉट निवडा.","That slot filled up. Choose another time.":"तो स्लॉट भरला आहे. दुसरी वेळ निवडा.","You already have an active booking for this procurement cycle.":"या खरेदी चक्रासाठी तुमचे सक्रिय बुकिंग आधीच आहे.","Your booking has been cancelled.":"तुमचे बुकिंग रद्द झाले आहे.","Booking cancelled and the slot released.":"बुकिंग रद्द झाले आणि स्लॉट पुन्हा उपलब्ध झाला.","That file is larger than 5 MB. Upload a smaller scan.":"ही फाइल ५ MB पेक्षा मोठी आहे. छोटी स्कॅन फाइल अपलोड करा.","Farmer ID issued":"शेतकरी आयडी जारी झाला","Name verified against the identity document":"ओळख कागदपत्रानुसार नाव पडताळले","Date of birth verified":"जन्मतारीख पडताळली","Mobile verified by OTP":"OTP द्वारे मोबाईल क्रमांक पडताळला","Identity document reviewed":"ओळख कागदपत्र तपासले","Identity information matched":"ओळख माहिती जुळली","Address reviewed":"पत्ता तपासला","Bank account details reviewed":"बँक खाते तपशील तपासले","Bank document reviewed":"बँक कागदपत्र तपासले","Bank account marked verified":"बँक खाते पडताळले म्हणून नोंदवले","Farmer type verified":"शेतकरी प्रकार पडताळला","Eligibility documents reviewed":"पात्रतेची कागदपत्रे तपासली","No Farmer ID yet":"अद्याप शेतकरी आयडी नाही","OTP verified":"OTP पडताळला","Agricultural details":"शेतीची माहिती","Identity & bank":"ओळख आणि बँक","Mobile verified":"मोबाईल पडताळला","KYC verified":"KYC पडताळले","KYC pending":"KYC प्रलंबित","Bank verified":"बँक पडताळली","Bank pending":"बँक पडताळणी प्रलंबित","Registration approved":"नोंदणी मंजूर","Being served now":"सध्या सेवा सुरू आहे","Slot confirmed":"स्लॉट निश्चित झाला","Reschedule your slot":"तुमचा स्लॉट बदलावा","Procurement open":"खरेदी सुरू आहे","Procurement closed":"खरेदी बंद आहे","Closed today":"आज बंद आहे","Waiting for your slot":"तुमच्या स्लॉटची प्रतीक्षा","In the main queue":"मुख्य रांगेत","At the counter now":"सध्या काउंटरवर","Slot missed":"स्लॉट चुकला","Counter idle":"काउंटर सध्या रिकामा आहे","Not issued yet":"अद्याप जारी झालेले नाही","Issued with payment":"पेमेंटसोबत जारी केले","Awaiting approval":"मंजुरीची प्रतीक्षा","Issued after approval":"मंजुरीनंतर जारी केले",
  "How do I get a Farmer ID?":"मला शेतकरी आयडी कसा मिळेल?","Finish registration and submit it. An officer verifies your identity, bank and documents, and the system generates the Farmer ID on approval. You never type it in yourself.":"नोंदणी पूर्ण करून ती सबमिट करा. अधिकारी तुमची ओळख, बँक तपशील आणि कागदपत्रे पडताळतो. मंजुरीनंतर प्रणाली शेतकरी आयडी तयार करते. तो तुम्हाला स्वतः टाइप करायचा नाही.","Why can I not book a slot?":"मी स्लॉट का बुक करू शकत नाही?","Booking opens only after your registration is approved and the scheme requirements for your commodity are met. Your registration status page shows what is still pending.":"तुमची नोंदणी मंजूर झाल्यानंतर आणि तुमच्या पिकासाठी योजनेच्या अटी पूर्ण झाल्यानंतरच बुकिंग सुरू होते. नोंदणीच्या स्थितीच्या पृष्ठावर काय प्रलंबित आहे ते दिसते.","What is the difference between my two tokens?":"माझ्या दोन टोकनमध्ये काय फरक आहे?","The main token, like PUN-1042, is your place in the arrival queue. The quality token, like GREEN-018, is issued after the quality check and decides which section you go to.":"PUN-1042 सारखा मुख्य टोकन आगमनाच्या रांगेतील तुमचा क्रमांक आहे. GREEN-018 सारखा गुणवत्ता टोकन गुणवत्ता तपासणीनंतर दिला जातो आणि तुम्ही कोणत्या विभागात जाल ते ठरवतो.","Can I change my slot?":"मी माझा स्लॉट बदलू शकतो का?","What if I miss my slot?":"माझा स्लॉट चुकला तर काय होईल?","Is my Aadhaar or account number safe?":"माझा आधार किंवा खाते क्रमांक सुरक्षित आहे का?","Both are masked everywhere in the interface, never put in a page address, and never printed to the browser console. This prototype uses fictional numbers only.":"हे दोन्ही क्रमांक इंटरफेसमध्ये सर्वत्र लपवलेले असतात, पृष्ठाच्या पत्त्यात कधीही ठेवले जात नाहीत आणि ब्राउझर कन्सोलमध्ये दाखवले जात नाहीत. या प्रोटोटाइपमध्ये फक्त काल्पनिक क्रमांक वापरले आहेत.","Please visit the procurement centre help desk for assistance.":"मदतीसाठी कृपया खरेदी केंद्राच्या मदत कक्षाला भेट द्या.","Prices are fictional demo figures, not official support prices.":"दर हे काल्पनिक डेमो आकडे आहेत; हे अधिकृत समर्थन दर नाहीत.","Print or save receipt":"पावती प्रिंट करा किंवा जतन करा","Payment account details":"पेमेंट खात्याचे तपशील","Payment reference":"पेमेंट संदर्भ","Recent activity":"अलीकडील हालचाल","Record procurement":"खरेदी नोंदवा","Registration status":"नोंदणी स्थिती","Required documents":"आवश्यक कागदपत्रे","Review your registration":"तुमच्या नोंदणीचे पुनरावलोकन करा","Verification checklist":"पडताळणी यादी","Verification method":"पडताळणी पद्धत","Verify your mobile number":"तुमचा मोबाईल क्रमांक पडताळा","View procurement journey":"खरेदीचा प्रवास पाहा","Your procurement token":"तुमचा खरेदी टोकन","Your selected slot":"तुमचा निवडलेला स्लॉट","Your verification":"तुमची पडताळणी",
  "This field is required.":"हे फील्ड आवश्यक आहे.","Mobile number verified":"मोबाईल क्रमांक पडताळला गेला आहे","Name as per identity document":"ओळख कागदपत्रानुसार नाव","Used to match against your KYC document.":"तुमच्या KYC कागदपत्राशी जुळवण्यासाठी वापरले जाते.","Father's / mother's / spouse's name":"वडिलांचे / आईचे / जोडीदाराचे नाव","Age is calculated automatically.":"वय आपोआप मोजले जाते.","Prefer not to say":"सांगू इच्छित नाही","Email address":"ईमेल पत्ता","Optional. Registration is never blocked if you do not have email.":"पर्यायी. ईमेल नसल्यामुळे नोंदणी कधीही थांबवली जाणार नाही.","Not specified":"नमूद केलेले नाही","Continue to address":"पत्त्याच्या माहितीकडे पुढे जा","Search or select a state":"राज्य शोधा किंवा निवडा","Select district":"जिल्हा निवडा","Choose a state first":"प्रथम राज्य निवडा","Sub-district / taluka / tehsil":"उपजिल्हा / तालुका / तहसील","Select taluka":"तालुका निवडा","Choose a district first":"प्रथम जिल्हा निवडा","Depends on local administration.":"स्थानिक प्रशासनावर अवलंबून.","Gram panchayat / municipality":"ग्रामपंचायत / नगरपालिका","Village / town":"गाव / शहर","Select village":"गाव निवडा","Choose a taluka first":"प्रथम तालुका निवडा","PIN code":"पिन कोड","Exactly 6 digits.":"अगदी ६ अंक.","Full residential address":"पूर्ण निवासी पत्ता","House number, street, landmark":"घर क्रमांक, रस्ता, जवळची खूण","Continue to farm details":"शेतीच्या माहितीकडे पुढे जा","Land ownership / cultivation type":"जमिनीची मालकी / लागवडीचा प्रकार","Total agricultural land area":"एकूण शेतीचे क्षेत्रफळ","Land unit":"जमिनीचे एकक","Required only when you enter a land area.":"जमिनीचे क्षेत्रफळ भरल्यासच आवश्यक.","Write the crop name if it is not listed above.":"वरील यादीत नसल्यास पिकाचे नाव लिहा.","Commodity you expect to sell":"तुम्ही विकणार असलेले पीक","Continue to identity":"ओळख माहितीकडे पुढे जा","Voter ID":"मतदार ओळखपत्र","Driving Licence":"वाहनचालक परवाना","Identity document type":"ओळख कागदपत्राचा प्रकार","Other government-approved ID":"इतर सरकारी मान्य ओळखपत्र","Identity document number":"ओळख कागदपत्र क्रमांक","Pending admin verification":"प्रशासकीय पडताळणी प्रलंबित","Document uploaded:":"कागदपत्र अपलोड झाले:","PDF, JPG, JPEG or PNG · up to 5 MB":"PDF, JPG, JPEG किंवा PNG · कमाल ५ MB","Replace file":"फाइल बदला","Choose file":"फाइल निवडा","Continue to bank details":"बँक तपशीलांकडे पुढे जा","Pre-filled from your name — edit it if the bank record differs.":"तुमच्या नावावरून आधी भरलेले आहे — बँकेच्या नोंदीपेक्षा वेगळे असल्यास बदला.","Bank account number":"बँक खाते क्रमांक","Digits only":"फक्त अंक","Masked while typing. Stored and displayed later as":"टाइप करताना क्रमांक लपवला आहे. नंतर तो असा जतन व दाखवला जाईल:","Both entries must match.":"दोन्ही नोंदी जुळल्या पाहिजेत.","Filled after IFSC lookup":"IFSC शोधल्यानंतर आपोआप भरले जाईल","Account type":"खात्याचा प्रकार","Account verification: pending":"खाते पडताळणी: प्रलंबित","Required by the current scheme":"सध्याच्या योजनेनुसार आवश्यक","Passbook first page or cancelled cheque":"पासबुकचे पहिले पान किंवा रद्द केलेला चेक","Continue to documents":"कागदपत्रांकडे पुढे जा","Identity proof":"ओळख पुरावा","Land / eligibility proof":"जमीन / पात्रता पुरावा","Other scheme document":"योजनेचे इतर कागदपत्र","Not required":"आवश्यक नाही","Personal information":"वैयक्तिक माहिती","Name as per ID":"आयडीवरील नाव","Not provided":"दिलेली नाही","Agricultural information":"शेतीची माहिती","Land status":"जमिनीची स्थिती","Land records":"जमिनीच्या नोंदी","Expected commodity":"अपेक्षित पीक","Decided at booking":"बुकिंगच्या वेळी ठरवले जाते","ID type":"आयडी प्रकार","ID number":"आयडी क्रमांक","Account holder":"खातेदार","Application submitted":"अर्ज सबमिट झाला","Enter your full name — at least 3 characters, not only numbers.":"तुमचे पूर्ण नाव द्या — किमान ३ अक्षरे असावीत, फक्त अंक नसावेत.","Select your date of birth.":"तुमची जन्मतारीख निवडा.","The applicant must be at least 18 years old.":"अर्जदाराचे वय किमान १८ वर्षे असावे.","Enter a valid email address or leave it blank.":"वैध ईमेल पत्ता द्या किंवा रिक्त ठेवा.","Enter a land area greater than zero or leave it blank.":"शून्यापेक्षा जास्त जमिनीचे क्षेत्रफळ द्या किंवा रिक्त ठेवा.","Choose the unit for the land area you entered.":"तुम्ही दिलेल्या जमिनीच्या क्षेत्रफळासाठी एकक निवडा.","Aadhaar numbers are 12 digits. Use a fictional number for this demo.":"आधार क्रमांक १२ अंकी असतो. या डेमोसाठी काल्पनिक क्रमांक वापरा.","PAN format is five letters, four digits and one letter.":"PAN चा नमुना पाच अक्षरे, चार अंक आणि एक अक्षर असा असतो.","Voter ID format is three letters followed by seven digits.":"मतदार ओळखपत्राचा नमुना तीन अक्षरांनंतर सात अंक असा असतो.","Upload your identity document to continue.":"पुढे जाण्यासाठी तुमचे ओळख कागदपत्र अपलोड करा.","The two account numbers do not match.":"दोन्ही खाते क्रमांक जुळत नाहीत.","Run the bank lookup so the bank and branch are filled in.":"बँक आणि शाखेची माहिती भरण्यासाठी बँक शोध चालवा.","Bank proof is required by the current scheme configuration.":"सध्याच्या योजनेच्या सेटिंगनुसार बँक पुरावा आवश्यक आहे.","Identity proof is still missing.":"ओळख पुरावा अजून उपलब्ध नाही.","Land proof is required by the current scheme configuration.":"सध्याच्या योजनेच्या सेटिंगनुसार जमीन पुरावा आवश्यक आहे.","Resubmission required":"पुन्हा सबमिट करणे आवश्यक","Under review":"तपासणीखाली","Enter the crop name to continue.":"पुढे जाण्यासाठी पिकाचे नाव प्रविष्ट करा.","Mobile number is your login":"मोबाईल क्रमांक हाच तुमचा लॉगिन आहे"
});
Object.assign(GLOBAL_T.hi, {
  "Sign in or register":"साइन इन करें या पंजीकरण करें","Mobile number":"मोबाइल नंबर","10-digit number":"10 अंकों का नंबर","Send OTP":"OTP भेजें","Enter OTP":"OTP दर्ज करें","6-digit code":"6 अंकों का कोड","Verify OTP":"OTP सत्यापित करें","Resend OTP":"OTP फिर भेजें","Change number":"नंबर बदलें","Demo farmer":"डेमो किसान","Ready for demo":"डेमो के लिए तैयार","Use demo farmer":"डेमो किसान का उपयोग करें","Demo accounts":"डेमो खाते","Farmer registration":"किसान पंजीकरण","Farmer details":"किसान विवरण","Full name":"पूरा नाम","Date of birth":"जन्मतिथि","Procurement centre":"खरीद केंद्र","Available slots":"उपलब्ध स्लॉट","Select slot":"स्लॉट चुनें","Download Receipt":"रसीद डाउनलोड करें","Main token":"मुख्य टोकन","Check in":"चेक-इन","Bank details":"बैंक विवरण","Account number":"खाता नंबर","Confirm account number":"खाता नंबर की पुष्टि करें","Queue empty.":"कतार खाली है।","Still stuck?":"अभी भी परेशानी है?","Help & Support":"मदद और सहायता","Book a slot":"स्लॉट बुक करें","My token":"मेरा टोकन","Procurement journey":"खरीद यात्रा","Payments & receipt":"भुगतान और रसीद","Profile & KYC":"प्रोफाइल और KYC","Today's bookings":"आज की बुकिंग","Check-in & verification":"चेक-इन और सत्यापन","Quality check":"गुणवत्ता जाँच","Section queues":"सेक्शन कतारें","Weighing & procurement":"तौल और खरीद","Payment updates":"भुगतान अपडेट","Farmer applications":"किसान आवेदन","Today at a glance":"आज का अवलोकन","Live queue":"लाइव कतार","Applications":"आवेदन","Schedules & capacity":"समय-सारणी और क्षमता","Slot & booking rules":"स्लॉट और बुकिंग नियम","Registered farmers":"पंजीकृत किसान","Sign out":"लॉग आउट","Close portal":"पोर्टल बंद करें","Live updates":"लाइव अपडेट","Current stage":"वर्तमान चरण","Next stage":"अगला चरण","Farmers ahead":"आगे के किसान","Currently serving":"अभी सेवा में","Estimated wait":"अनुमानित प्रतीक्षा","Estimated time to next stage":"अगले चरण तक अनुमानित समय","Assigned section":"निर्धारित सेक्शन","What you need to do":"आपको क्या करना है","Important update":"महत्वपूर्ण सूचना","No action required right now":"अभी कोई कार्रवाई आवश्यक नहीं","No active procurement":"कोई सक्रिय खरीद नहीं","Refresh status":"स्थिति अपडेट करें","Procurement complete":"खरीद पूरी","Live status":"लाइव स्थिति","Verification status":"सत्यापन स्थिति","Current token":"वर्तमान टोकन","Quality section / counter":"गुणवत्ता सेक्शन / काउंटर","Assigned weighing section":"निर्धारित तौल सेक्शन","Progress through procurement":"खरीद प्रक्रिया की प्रगति","Estimated calling time":"अनुमानित बुलाने का समय","Recommended arrival":"अनुशंसित आगमन","Document / problem notification":"दस्तावेज़ / समस्या सूचना","Expected payment / update":"अपेक्षित भुगतान / अपडेट","Currently being verified":"अभी सत्यापन में","Currently being assessed":"अभी जाँच में","Current weighing token":"वर्तमान तौल टोकन","Action required":"कार्रवाई आवश्यक","Document verification":"दस्तावेज़ सत्यापन","Slot booked":"स्लॉट बुक हुआ","Main queue":"मुख्य कतार","Quality assessment":"गुणवत्ता जाँच","Quality token":"गुणवत्ता टोकन","Section assigned":"सेक्शन निर्धारित","Payment processing":"भुगतान प्रक्रिया जारी है","Payment completed":"भुगतान पूरा","Please arrive during your assigned slot.":"अपने निर्धारित स्लॉट के दौरान खरीद केंद्र पर पहुँचें।","Please wait for identity verification.":"कृपया पहचान सत्यापन की प्रतीक्षा करें।","Please remain available near your assigned section.":"कृपया निर्धारित सेक्शन के पास उपलब्ध रहें।","Please proceed to your assigned section when your token is called.":"आपका टोकन नंबर पुकारे जाने पर निर्धारित सेक्शन में जाएँ।","Your procurement amount is being finalized.":"आपकी खरीद की राशि तय की जा रही है।","Procurement is complete. Check payment updates for the final amount.":"खरीद पूरी हो गई है। अंतिम राशि के लिए भुगतान अपडेट देखें।","Payment is being processed. No action is required right now.":"भुगतान प्रक्रिया में है। अभी कोई कार्रवाई आवश्यक नहीं है।","Payment is complete. Open Payments & receipt to download your receipt.":"भुगतान पूरा हो गया है। रसीद डाउनलोड करने के लिए भुगतान और रसीद खोलें।","Please stay available for the next update.":"अगले अपडेट के लिए कृपया उपलब्ध रहें।","Verification desk":"सत्यापन कक्ष","Quality Section Q-2":"गुणवत्ता सेक्शन Q-2","Weighing Section 3":"तौल सेक्शन 3","Payment desk":"भुगतान कक्ष","Token / payment":"टोकन / भुगतान","Payment status":"भुगतान स्थिति","Waiting for verification":"सत्यापन की प्रतीक्षा","Verification in progress":"सत्यापन जारी है","Not started":"अभी शुरू नहीं हुआ","Booking confirmed":"बुकिंग की पुष्टि हो गई","Your procurement slot has been confirmed.":"आपका खरीद स्लॉट तय हो गया है।","Main queue token issued.":"मुख्य कतार टोकन जारी हो गया है।","Payment status changes after the officer initiates and completes the simulated payment.":"अधिकारी डेमो भुगतान शुरू और पूरा करने के बाद भुगतान स्थिति बदलेगा।","After payment is completed, open Payments & receipt and select Download receipt.":"भुगतान पूरा होने के बाद भुगतान और रसीद खोलें और रसीद डाउनलोड करें चुनें।","Live status refreshed.":"लाइव स्थिति अपडेट हो गई है।","Language: English":"भाषा: अंग्रेज़ी","Add a reason before continuing.":"आगे बढ़ने से पहले कारण दर्ज करें।","Enter the crop name to continue.":"आगे बढ़ने के लिए फसल का नाम दर्ज करें।","Cancel this procurement slot?":"क्या यह खरीद स्लॉट रद्द करना है?","Are you sure you want to cancel this procurement slot? The slot goes back into the pool and your main token is removed from the queue.":"क्या आप यह खरीद स्लॉट रद्द करना चाहते हैं? स्लॉट फिर से उपलब्ध होगा और आपका मुख्य टोकन कतार से हटा दिया जाएगा।","Rescheduling is switched off in the current configuration.":"वर्तमान सेटिंग में समय बदलने की सुविधा बंद है।","Demo farmer loaded. Use OTP 123456.":"डेमो किसान लोड हो गया है। OTP 123456 का उपयोग करें।","Your current token and procurement stage are shown under My token and Procurement journey.":"आपका वर्तमान टोकन और खरीद चरण मेरा टोकन और खरीद यात्रा में दिखाई देता है।","Receipt becomes available after payment is completed.":"भुगतान पूरा होने के बाद रसीद उपलब्ध होगी।","Receipt downloaded.":"रसीद डाउनलोड हो गई।","Booking needs an approved registration.":"बुकिंग के लिए स्वीकृत पंजीकरण आवश्यक है।","Procurement for this commodity is closed.":"इस फसल की खरीद बंद है।","That centre is not operating right now.":"वह खरीद केंद्र अभी चालू नहीं है।","That date is no longer open for procurement.":"उस तारीख को अब खरीद उपलब्ध नहीं है।","That slot no longer exists. Pick another one.":"वह स्लॉट अब उपलब्ध नहीं है। दूसरा स्लॉट चुनें।","That slot filled up. Choose another time.":"वह स्लॉट भर गया है। दूसरी समय चुनें।","You already have an active booking for this procurement cycle.":"इस खरीद चक्र के लिए आपकी सक्रिय बुकिंग पहले से है।","Your booking has been cancelled.":"आपकी बुकिंग रद्द हो गई है।","Booking cancelled and the slot released.":"बुकिंग रद्द कर दी गई है और स्लॉट फिर से उपलब्ध है।","That file is larger than 5 MB. Upload a smaller scan.":"यह फाइल 5 MB से बड़ी है। छोटी स्कैन फाइल अपलोड करें।","Farmer ID issued":"किसान आईडी जारी हुई","Name verified against the identity document":"पहचान दस्तावेज़ के अनुसार नाम सत्यापित हुआ","Date of birth verified":"जन्मतिथि सत्यापित हुई","Mobile verified by OTP":"OTP से मोबाइल नंबर सत्यापित हुआ","Identity document reviewed":"पहचान दस्तावेज़ की जाँच हुई","Identity information matched":"पहचान की जानकारी मेल खाती है","Address reviewed":"पते की जाँच हुई","Bank account details reviewed":"बैंक खाते के विवरण की जाँच हुई","Bank document reviewed":"बैंक दस्तावेज़ की जाँच हुई","Bank account marked verified":"बैंक खाता सत्यापित के रूप में दर्ज हुआ","Farmer type verified":"किसान प्रकार सत्यापित हुआ","Eligibility documents reviewed":"पात्रता दस्तावेज़ों की जाँच हुई","No Farmer ID yet":"अभी किसान आईडी नहीं है","OTP verified":"OTP सत्यापित हुआ","Agricultural details":"कृषि जानकारी","Identity & bank":"पहचान और बैंक","Mobile verified":"मोबाइल सत्यापित","KYC verified":"KYC सत्यापित","KYC pending":"KYC लंबित","Bank verified":"बैंक सत्यापित","Bank pending":"बैंक सत्यापन लंबित","Registration approved":"पंजीकरण स्वीकृत","Being served now":"अभी सेवा में","Slot confirmed":"स्लॉट तय है","Reschedule your slot":"अपना स्लॉट बदलें","Procurement open":"खरीद खुली है","Procurement closed":"खरीद बंद है","Closed today":"आज बंद है","Waiting for your slot":"अपने स्लॉट की प्रतीक्षा","In the main queue":"मुख्य कतार में","At the counter now":"अभी काउंटर पर","Slot missed":"स्लॉट छूट गया","Counter idle":"काउंटर अभी खाली है","Not issued yet":"अभी जारी नहीं हुआ","Issued with payment":"भुगतान के साथ जारी","Awaiting approval":"मंजूरी की प्रतीक्षा","Issued after approval":"मंजूरी के बाद जारी","How do I get a Farmer ID?":"मुझे किसान आईडी कैसे मिलेगी?","Finish registration and submit it. An officer verifies your identity, bank and documents, and the system generates the Farmer ID on approval. You never type it in yourself.":"पंजीकरण पूरा करके जमा करें। अधिकारी आपकी पहचान, बैंक और दस्तावेज़ सत्यापित करता है। मंजूरी के बाद सिस्टम किसान आईडी बनाता है। आपको इसे खुद टाइप नहीं करना है।","Why can I not book a slot?":"मैं स्लॉट बुक क्यों नहीं कर सकता?","Booking opens only after your registration is approved and the scheme requirements for your commodity are met. Your registration status page shows what is still pending.":"बुकिंग आपकी पंजीकरण मंजूरी और फसल की योजना संबंधी शर्तें पूरी होने के बाद ही खुलती है। पंजीकरण स्थिति पृष्ठ पर लंबित जानकारी दिखाई देती है।","What is the difference between my two tokens?":"मेरे दो टोकन में क्या अंतर है?","The main token, like PUN-1042, is your place in the arrival queue. The quality token, like GREEN-018, is issued after the quality check and decides which section you go to.":"PUN-1042 जैसा मुख्य टोकन आगमन कतार में आपका स्थान है। GREEN-018 जैसा गुणवत्ता टोकन गुणवत्ता जाँच के बाद मिलता है और बताता है कि आपको किस सेक्शन में जाना है।","Can I change my slot?":"क्या मैं अपना स्लॉट बदल सकता हूँ?","What if I miss my slot?":"अगर मेरा स्लॉट छूट जाए तो क्या होगा?","Is my Aadhaar or account number safe?":"क्या मेरा आधार या खाता नंबर सुरक्षित है?","Both are masked everywhere in the interface, never put in a page address, and never printed to the browser console. This prototype uses fictional numbers only.":"दोनों नंबर पूरे इंटरफेस में छिपे रहते हैं, पेज के पते में कभी नहीं रखे जाते और ब्राउज़र कंसोल में नहीं दिखाए जाते। इस प्रोटोटाइप में केवल काल्पनिक नंबर हैं।","Please visit the procurement centre help desk for assistance.":"मदद के लिए कृपया खरीद केंद्र के सहायता कक्ष पर जाएँ।","Print or save receipt":"रसीद प्रिंट करें या सहेजें","Payment account details":"भुगतान खाते का विवरण","Payment reference":"भुगतान संदर्भ","Recent activity":"हाल की गतिविधि","Record procurement":"खरीद दर्ज करें","Registration status":"पंजीकरण स्थिति","Required documents":"आवश्यक दस्तावेज़","Review your registration":"अपने पंजीकरण की समीक्षा करें","Verification checklist":"सत्यापन सूची","Verification method":"सत्यापन विधि","Verify your mobile number":"अपना मोबाइल नंबर सत्यापित करें","View procurement journey":"खरीद यात्रा देखें","Your procurement token":"आपका खरीद टोकन","Your selected slot":"आपका चुना हुआ स्लॉट","Your verification":"आपका सत्यापन","This field is required.":"यह फ़ील्ड आवश्यक है।","Mobile number verified":"मोबाइल नंबर सत्यापित हुआ","Name as per identity document":"पहचान दस्तावेज़ के अनुसार नाम","Used to match against your KYC document.":"आपके KYC दस्तावेज़ से मिलान करने के लिए उपयोग किया जाता है।","Father's / mother's / spouse's name":"पिता / माता / पति / पत्नी का नाम","Age is calculated automatically.":"उम्र अपने आप निकाली जाती है।","Prefer not to say":"बताना नहीं चाहते","Email address":"ईमेल पता","Optional. Registration is never blocked if you do not have email.":"वैकल्पिक। ईमेल न होने पर पंजीकरण नहीं रुकेगा।","Not specified":"निर्दिष्ट नहीं","Continue to address":"पते की जानकारी पर जाएँ","Search or select a state":"राज्य खोजें या चुनें","Select district":"जिला चुनें","Choose a state first":"पहले राज्य चुनें","Sub-district / taluka / tehsil":"उप-जिला / तालुका / तहसील","Select taluka":"तालुका चुनें","Choose a district first":"पहले जिला चुनें","Depends on local administration.":"स्थानीय प्रशासन पर निर्भर है।","Gram panchayat / municipality":"ग्राम पंचायत / नगरपालिका","Village / town":"गाँव / शहर","Select village":"गाँव चुनें","Choose a taluka first":"पहले तालुका चुनें","PIN code":"पिन कोड","Exactly 6 digits.":"ठीक 6 अंक।","Full residential address":"पूरा आवासीय पता","House number, street, landmark":"घर नंबर, सड़क, पहचान स्थान","Continue to farm details":"खेत की जानकारी पर जाएँ","Land ownership / cultivation type":"भूमि स्वामित्व / खेती का प्रकार","Total agricultural land area":"कुल कृषि भूमि क्षेत्रफल","Land unit":"भूमि की इकाई","Required only when you enter a land area.":"भूमि क्षेत्रफल दर्ज करने पर ही आवश्यक है।","Write the crop name if it is not listed above.":"यदि ऊपर सूची में नहीं है तो फसल का नाम लिखें।","Commodity you expect to sell":"वह फसल जिसे आप बेचने की उम्मीद रखते हैं","Continue to identity":"पहचान जानकारी पर जाएँ","Voter ID":"मतदाता पहचान पत्र","Driving Licence":"ड्राइविंग लाइसेंस","Identity document type":"पहचान दस्तावेज़ का प्रकार","Other government-approved ID":"अन्य सरकारी मान्य पहचान पत्र","Identity document number":"पहचान दस्तावेज़ नंबर","Pending admin verification":"प्रशासकीय सत्यापन लंबित","Document uploaded:":"दस्तावेज़ अपलोड हुआ:","PDF, JPG, JPEG or PNG · up to 5 MB":"PDF, JPG, JPEG या PNG · अधिकतम 5 MB","Replace file":"फाइल बदलें","Choose file":"फाइल चुनें","Continue to bank details":"बैंक विवरण पर जाएँ","Pre-filled from your name — edit it if the bank record differs.":"आपके नाम से पहले से भरा है — बैंक रिकॉर्ड अलग होने पर बदलें।","Bank account number":"बैंक खाता नंबर","Digits only":"केवल अंक","Masked while typing. Stored and displayed later as":"टाइप करते समय छिपा रहेगा। बाद में इसे इस रूप में दिखाया जाएगा:","Both entries must match.":"दोनों प्रविष्टियाँ समान होनी चाहिए।","Filled after IFSC lookup":"IFSC खोज के बाद भरा जाएगा","Account type":"खाते का प्रकार","Account verification: pending":"खाता सत्यापन: लंबित","Required by the current scheme":"वर्तमान योजना के अनुसार आवश्यक","Passbook first page or cancelled cheque":"पासबुक का पहला पृष्ठ या रद्द चेक","Continue to documents":"दस्तावेज़ों पर जाएँ","Identity proof":"पहचान प्रमाण","Land / eligibility proof":"भूमि / पात्रता प्रमाण","Other scheme document":"योजना का अन्य दस्तावेज़","Not required":"आवश्यक नहीं","Personal information":"व्यक्तिगत जानकारी","Name as per ID":"आईडी के अनुसार नाम","Not provided":"नहीं दिया गया","Agricultural information":"कृषि जानकारी","Land status":"भूमि स्थिति","Land records":"भूमि रिकॉर्ड","Expected commodity":"अपेक्षित फसल","Decided at booking":"बुकिंग के समय तय होता है","ID type":"आईडी प्रकार","ID number":"आईडी नंबर","Account holder":"खाताधारक","Application submitted":"आवेदन जमा हुआ","Enter your full name — at least 3 characters, not only numbers.":"अपना पूरा नाम दर्ज करें — कम से कम 3 अक्षर हों, केवल अंक नहीं।","Select your date of birth.":"अपनी जन्मतिथि चुनें।","The applicant must be at least 18 years old.":"आवेदक की आयु कम से कम 18 वर्ष होनी चाहिए।","Enter a valid email address or leave it blank.":"मान्य ईमेल पता दर्ज करें या खाली छोड़ें।","Enter a land area greater than zero or leave it blank.":"शून्य से अधिक भूमि क्षेत्रफल दर्ज करें या खाली छोड़ें।","Choose the unit for the land area you entered.":"दर्ज किए गए भूमि क्षेत्रफल की इकाई चुनें।","Aadhaar numbers are 12 digits. Use a fictional number for this demo.":"आधार नंबर 12 अंकों का होता है। इस डेमो के लिए काल्पनिक नंबर का उपयोग करें।","PAN format is five letters, four digits and one letter.":"PAN का प्रारूप पाँच अक्षर, चार अंक और एक अक्षर है।","Voter ID format is three letters followed by seven digits.":"मतदाता पहचान पत्र का प्रारूप तीन अक्षरों के बाद सात अंक है।","Upload your identity document to continue.":"आगे बढ़ने के लिए अपना पहचान दस्तावेज़ अपलोड करें।","The two account numbers do not match.":"दोनों खाता नंबर मेल नहीं खाते।","Run the bank lookup so the bank and branch are filled in.":"बैंक और शाखा भरने के लिए बैंक खोज चलाएँ।","Bank proof is required by the current scheme configuration.":"वर्तमान योजना सेटिंग के अनुसार बैंक प्रमाण आवश्यक है।","Identity proof is still missing.":"पहचान प्रमाण अभी भी नहीं है।","Land proof is required by the current scheme configuration.":"वर्तमान योजना सेटिंग के अनुसार भूमि प्रमाण आवश्यक है।","Resubmission required":"फिर से जमा करना आवश्यक है","Under review":"समीक्षा में","Help":"मदद","Mobile":"मोबाइल","Type":"प्रकार","Village":"गाँव","Name":"नाम","State":"राज्य","District":"जिला","Taluka":"तालुका","Address":"पता","Crop name":"फसल का नाम","Other crop":"अन्य फसल","Select crop":"फसल चुनें","Select crop(s)":"फसलें चुनें","Enter crop name":"फसल का नाम दर्ज करें","Nearest procurement centre":"निकटतम खरीद केंद्र","Select procurement centre":"खरीद केंद्र चुनें","Available slots":"उपलब्ध स्लॉट","Select a slot":"स्लॉट चुनें","Book slot":"स्लॉट बुक करें","Confirm booking":"बुकिंग की पुष्टि करें","Track status":"स्थिति देखें","Current status":"वर्तमान स्थिति","Final amount":"अंतिम राशि","Receipt":"रसीद","Payment completed":"भुगतान पूरा","Payment pending":"भुगतान लंबित","Quality check":"गुणवत्ता जाँच","Check-in":"चेक-इन","Weighing":"तौल","Procurement centre":"खरीद केंद्र","Token number":"टोकन नंबर","Queue":"कतार","Registered farmers":"पंजीकृत किसान","Procurement centres":"खरीद केंद्र","Schedules & capacity":"समय-सारणी और क्षमता","Slot & booking rules":"स्लॉट और बुकिंग नियम","Today at a glance":"आज का अवलोकन","Applications":"आवेदन","Public screen":"सार्वजनिक स्क्रीन","Mandi display wall":"मंडी डिस्प्ले स्क्रीन","Open mandi display wall":"मंडी डिस्प्ले स्क्रीन खोलें","Switch interface":"इंटरफेस बदलें","Sign out":"लॉग आउट","Close portal":"पोर्टल बंद करें","Menu":"मेनू","Help & support":"मदद और सहायता","Need more help?":"अधिक मदद चाहिए?","Search":"खोजें","Submit":"जमा करें","Save":"सहेजें","Cancel":"रद्द करें","Confirm":"पुष्टि करें","Back":"वापस","Next":"आगे","Continue":"जारी रखें","Required":"आवश्यक","Optional":"वैकल्पिक","Upload":"अपलोड करें","Upload document":"दस्तावेज़ अपलोड करें","Show":"दिखाएँ","Hide":"छिपाएँ","Account holder name":"खाताधारक का नाम","IFSC code":"IFSC कोड","Bank name":"बैंक का नाम","Land area":"भूमि क्षेत्रफल","Farmer category":"किसान वर्ग","No data available":"जानकारी उपलब्ध नहीं","No slots available":"कोई स्लॉट उपलब्ध नहीं","Please wait":"कृपया प्रतीक्षा करें","Welcome back":"फिर से स्वागत है"
});

// Re-run coverage after each dynamic portal render without touching application state or scroll position.
const __oldRender = render;
const screenKeyNow = () => [S.role, S.view || DEFAULT_VIEW[S.role] || '', S.farmerId || ''].join('|');
render = function(){
  /* Re-rendering the SAME screen (an action, a centre change ...) keeps the scroll position; navigating to a
     different role/view starts at the top. Registration keeps its own scroll handling inside render(). */
  const pm = document.getElementById('p-main'), host = document.getElementById('portal');
  const keep = !!(S.open && pm && !S.reg && S.screenKey === screenKeyNow());
  const top = keep ? pm.scrollTop : 0, hostTop = keep && host ? host.scrollTop : 0, winTop = keep ? window.scrollY : 0;
  const r=__oldRender.apply(this, arguments);
  if (S.open) S.screenKey = screenKeyNow();
  persistSession();
  oqRestoreReport();
  addPortalPagePhoto();                       /* synchronous, so the page height is final before scroll is restored */
  if (keep) {
    const nm = document.getElementById('p-main'), nh = document.getElementById('portal');
    if (nm) nm.scrollTop = top;
    if (nh) nh.scrollTop = hostTop;
    if (winTop) window.scrollTo({ top: winTop, behavior: 'auto' });
  }
  requestAnimationFrame(()=>{ if(typeof applyCoverageLanguage==='function') applyCoverageLanguage(); updateLanguageButtons(); addPortalPagePhoto(); });
  reapplyTranslationAfterRender();
  return r;
};
// Make landing language controls explicit and persistent.
document.addEventListener('click', (e)=>{
  const b=e.target.closest('.landing-lang,.lang-btn,.pbar__lang');
  if(!b || !b.dataset.lang) return;
  e.preventDefault(); e.stopPropagation(); setLanguage(b.dataset.lang);
}, true);
requestAnimationFrame(()=>{
  document.documentElement.lang=S.uiLang;
  if(typeof applyLandingLanguage==='function') applyLandingLanguage();
  if(typeof applyCoverageLanguage==='function') applyCoverageLanguage();
  updateLanguageButtons();
});

/* ---------- event delegation ---------- */
document.addEventListener('click', (e) => {
  const roleBtn = e.target.closest('[data-role]');
  if (roleBtn && S.open) { e.preventDefault(); S.role = roleBtn.dataset.role; S.view = DEFAULT_VIEW[S.role]; render(); return; }
  const goBtn = e.target.closest('[data-go]');
  if (goBtn && S.open) { e.preventDefault(); go(goBtn.dataset.go); return; }
  const act = e.target.closest('[data-act]');
  if (!act) return;
  const a = act.dataset.act;
  if (a === 'landing-lang') {
    e.preventDefault();
    setLanguage(act.dataset.lang || 'en');
    return;
  }
  if (['portal', 'farmer', 'official', 'display'].includes(a) === false && !S.open && !act.dataset.route) { /* fallthrough */ }
  if (a === 'exit') { e.preventDefault(); closePortal(); return; }
  if (a === 'switch') { e.preventDefault(); S.role = 'choose'; S.view = 'choose'; render(); return; }
  if (a === 'side') { e.preventDefault(); S.sideOpen = !S.sideOpen; render(); return; }
  if (a === 'logout') { e.preventDefault(); resetFarmerSessionState(); S.reg = null; S.auth = { mobile: '', otp: null, sent: false, secondsLeft: 0, verified: false, mode: 'login' }; S.view = null; render(); return; }
  if (a === 'display') { e.preventDefault(); S.role = 'display'; S.view = 'wall'; render(); return; }
  if (a === 'reset-demo') {
    e.preventDefault();
    if (!confirm('Reset the demo? All demo farmers, bookings, tokens, quality assessments, payments and other demo progress will be restored to the original demo state.')) return;
    clearSession();
    resetDemoData();
    return;
  }
  if (a === 'modal-close') { e.preventDefault(); closeModal(); return; }
  if (a === 'modal-ok') {
    e.preventDefault();
    const reasonEl = $('#m-reason');
    if (reasonEl && !reasonEl.value.trim()) { toast('Add a reason before continuing.', true); reasonEl.focus(); return; }
    const cb = confirmCb; const reason = reasonEl ? reasonEl.value.trim() : '';
    closeModal(); if (cb) cb(reason);
    return;
  }
  if (handleOqReportAction(a, act, e)) return;
  if (handleFarmerAction(a, act, e)) return;
  if (handleOfficerAction(a, act, e)) return;
  if (handleAdminAction(a, act, e)) return;
});

{ const __savedLang = S.language; S.language = 'en'; applyLandingLanguage(); S.language = __savedLang; }

/* landing-page portal buttons */
(() => {
  document.querySelectorAll('[data-route]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const r = el.dataset.route;
      if (r === 'portal') openPortal('choose', 'choose');
      else if (r === 'farmer') openPortal('farmer');
      else if (r === 'official') openPortal('officer');
      else if (r === 'display') openPortal('display', 'wall');
    });
  });
})();
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.open) { const m = $('#p-modal'); if (m && !m.hidden) closeModal(); }
});

/* queue clock — advances nothing automatically, only refreshes relative times */
// Live farmer dashboard updates are handled by the status-card refresh timer; avoid full portal renders that can move the user's scroll position.


/* ===================== FLASK + JSON BACKEND BRIDGE =====================
   The original portal UI remains client-side. This bridge makes its DB and
   admin configuration persistent through the Flask backend in data.json.
   ====================================================================== */
let backendSaveTimer = null;
let backendHydrating = true;      // true until the first successful load from the backend
let backendResetting = false;     // true while / after a demo reset: NO saves are allowed
let backendSaving = null;         // promise of the save currently in flight (serialises saves)
let backendLastSavedJson = '';    // last payload known to be in the backend (skips redundant saves)
let backendAutoSaveInterval = null;
let backendSettled = false;       // true once hydrateFromBackend() has finished (loaded OR unreachable): DB content is final

const backendSaveBlocked = () => backendHydrating || backendResetting;

async function saveBackendNow() {
  if (backendSaveBlocked()) return false;
  if (backendSaving) return false;                      // a save is already running; the next tick retries
  let json;
  try { json = JSON.stringify({ db: DB, cfg: CFG }); } catch (err) { console.warn('Backend save skipped:', err); return false; }
  if (json === backendLastSavedJson) return true;       // nothing changed
  backendSaving = (async () => {
    try {
      await saveState({ db: DB, cfg: CFG });
      if (!backendResetting) backendLastSavedJson = json;
      return true;
    } catch (err) {
      console.warn('Backend save failed:', err);
      return false;
    } finally {
      backendSaving = null;
    }
  })();
  return backendSaving;
}

function scheduleBackendSave() {
  if (backendSaveBlocked()) return;
  clearTimeout(backendSaveTimer);
  backendSaveTimer = setTimeout(() => { backendSaveTimer = null; saveBackendNow(); }, 350);
}

/* Safety net: even if an existing frontend handler changes DB without calling
   render(), the latest DB/config is still written to the backend. */
function startBackendAutoSave() {
  clearInterval(backendAutoSaveInterval);
  backendAutoSaveInterval = setInterval(() => {
    if (!backendSaveBlocked()) saveBackendNow();
  }, 1000);
}

function stopBackendAutoSave() {
  clearTimeout(backendSaveTimer); backendSaveTimer = null;
  clearInterval(backendAutoSaveInterval); backendAutoSaveInterval = null;
}

/* The ONE reset implementation (Reset Demo button -> data-act="reset-demo").
   Calls POST /api/demo/reset, never saves the old in-memory DB, then reloads so the
   fresh backend state is hydrated. Autosave stays disabled until the page reloads. */
async function resetDemoData() {
  if (backendResetting) return;
  backendResetting = true;                 // blocks scheduleBackendSave / saveBackendNow / beforeunload beacon
  stopBackendAutoSave();                   // cancels pending + periodic autosave
  try {
    if (backendSaving) { try { await backendSaving; } catch (err) { /* ignore */ } }   // let an in-flight save finish BEFORE the reset
    const res = await fetch('/api/demo/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    let body = {};
    try { body = await res.json(); } catch (err) { body = {}; }
    if (!res.ok || body.ok === false) throw new Error(body.error || 'Reset failed.');
    toast((body && body.message) || 'Demo data has been restored successfully.');
    setTimeout(() => { window.location.reload(); }, 500);   // saves remain blocked; the fresh DB is hydrated on reload
  } catch (err) {
    console.error('Demo reset error:', err);
    toast('Could not reset the demo data. Please make sure the backend is running and try again.', true);
    backendResetting = false;              // reset failed: nothing changed in the backend, resume normal autosave
    if (!backendHydrating) startBackendAutoSave();
  }
}

async function hydrateFromBackend() {
  let payload = null, loaded = false;
  for (let attempt = 0; attempt < 3 && !loaded; attempt++) {
    try {
      payload = await loadState();
      loaded = true;
    } catch (err) {
      console.warn('Backend load failed (attempt ' + (attempt + 1) + '):', err);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1200));
    }
  }

  if (!loaded) {
    /* Backend unreachable: keep the seeded demo data locally but NEVER write it to the backend,
       otherwise it could overwrite real saved data once the backend comes back. */
    console.warn('Backend unavailable; using seeded demo data (saving disabled until reload).');
    backendSettled = true;
    if (S.open) render();
    return;
  }

  /* If the backend has real saved data, use it. If it is empty (fresh/reset), keep the frontend seed(). */
  const hasBackendData = !!(payload && payload.db && payload.db.seq && Object.keys(payload.db.seq).length > 0);
  if (hasBackendData) {
    const fallback = Object.assign({}, DB);                 // seeded defaults for any key the backend lacks
    Object.keys(DB).forEach((key) => delete DB[key]);
    Object.assign(DB, fallback, payload.db);
    DB.seq = Object.assign({}, fallback.seq, payload.db.seq);
    if (payload.cfg) Object.assign(CFG, payload.cfg);
    try { backendLastSavedJson = JSON.stringify({ db: DB, cfg: CFG }); } catch (err) { backendLastSavedJson = ''; }
  } else {
    console.log('Backend is empty — keeping seeded demo data.');
    backendLastSavedJson = '';                               // force the first save so SQLite gets the seed
  }

  backendHydrating = false;
  backendSettled = true;
  relinkPending();
  if (S.open) render();
  if (!hasBackendData) await saveBackendNow();               // only an EMPTY backend receives the seed
  if (!backendResetting) startBackendAutoSave();
}

/* Save immediately before leaving/reloading when possible (never during hydrate or reset). */
window.addEventListener('pagehide', () => { persistSession(true); });
window.addEventListener('beforeunload', () => {
  persistSession(true);                      /* session first: it must survive even while the backend is still loading */
  if (backendSaveBlocked()) return;
  try {
    saveStateBeacon({ db: DB, cfg: CFG });
  } catch (err) {}
});

seed();
/* Pristine copy of the seeded demo bookings/tokens, used ONLY by resolveTokenInput() to recover a seeded farmer whose
   booking is missing from loaded backend data. Never written to DB unless that farmer has no booking record at all. */
const SEED_SNAPSHOT = JSON.parse(JSON.stringify({ bookings: DB.bookings, tokens: DB.tokens }));
hydrateFromBackend();

/* ===================== FARMER INTERFACE ===================== */

const GEO = {
  'Maharashtra': {
    'Pune': { 'Haveli': ['Wagholi', 'Loni Kalbhor', 'Theur', 'Urali Kanchan', 'Kesnand'], 'Shirur': ['Shikrapur', 'Koregaon Mul', 'Ranjangaon', 'Talegaon Dhamdhere'], 'Baramati': ['Malegaon', 'Supe', 'Undavadi'], 'Pune City': ['Kothrud', 'Hadapsar', 'Katraj'] },
    'Ahmednagar': { 'Rahuri': ['Rahuri Khurd', 'Deolali Pravara'], 'Shrirampur': ['Belapur', 'Ukkadgaon'] },
    'Nashik': { 'Niphad': ['Lasalgaon', 'Pimpalgaon'], 'Sinnar': ['Shah', 'Nandur'] }
  },
  'Madhya Pradesh': { 'Indore': { 'Depalpur': ['Betma', 'Hatod'], 'Sanwer': ['Sanwer', 'Kudana'] }, 'Bhopal': { 'Berasia': ['Berasia', 'Parwalia'] } },
  'Punjab': { 'Ludhiana': { 'Khanna': ['Samrala', 'Machhiwara'], 'Payal': ['Payal', 'Doraha'] }, 'Patiala': { 'Rajpura': ['Rajpura', 'Ghanaur'] } }
};
const IFSC_BANKS = {
  SBIN: ['State Bank of India', 'Wagholi Branch'], HDFC: ['HDFC Bank', 'Shirur Branch'], BARB: ['Bank of Baroda', 'Pune Camp Branch'],
  PUNB: ['Punjab National Bank', 'Hadapsar Branch'], ICIC: ['ICICI Bank', 'Kharadi Branch'], MAHB: ['Bank of Maharashtra', 'Market Yard Branch'],
  CNRB: ['Canara Bank', 'Baramati Branch'], IDIB: ['Indian Bank', 'Shivajinagar Branch']
};
const REG_STEPS = ['Mobile', 'Personal', 'Address', 'Farm', 'KYC', 'Bank', 'Documents', 'Review', 'Submitted'];
const CROPS = ['Wheat', 'Rice', 'Soybean', 'Maize', 'Pulses', 'Sugarcane', 'Groundnut', 'Jowar', 'Bajra', 'Ragi', 'Chickpea', 'Tur', 'Moong', 'Urad', 'Mustard', 'Sunflower', 'Sesame', 'Onion', 'Potato', 'Tomato', 'Cotton', 'Other'];

function newReg(mobile) {
  return {
    step: 1, mobileVerified: false, otp: null, otpSentAt: 0, resendIn: 0,
    data: { mobile: mobile || '', relativeType: 'Father', gender: '', farmerCategory: 'Not specified', farmerType: '', landUnit: 'Acre', accountType: 'Savings', identityDocumentType: 'Aadhaar', landRecords: [''], mainCrops: [] },
    docs: { identity: null, bank: null, land: null },
    consents: { accuracy: false, verification: false, dataUse: false },
    errors: {}, touched: false
  };
}

/* ---------- status pill helper ---------- */
function pill(kind, text) {
  const map = { ok: ['st--ok', '✓'], wait: ['st--wait', '⏳'], warn: ['st--warn', '⚠'], bad: ['st--bad', '✕'], off: ['st--off', '○'] };
  const [cls, mark] = map[kind] || map.off;
  return `<span class="st ${cls}">${mark} ${esc(text)}</span>`;
}

/* ---------- auth ---------- */
function viewFarmerAuth() {
  const a = S.auth;
  if (S.reg) return viewRegister();
  if (S.pending) return viewPendingStatus(S.pending);
  return `<div class="pwrap" style="max-width:560px">
    <h1 class="ptitle">Sign in or register</h1>
    <p class="plead">Your mobile number is your login. New farmers register once; the Farmer ID is issued by the system after verification — you never choose it yourself.</p>
    <div class="card">
      <label class="field${a.err === 'mobile' ? ' is-invalid' : ''}">
        <span class="field__label">Mobile number <span class="field__req">Required</span></span>
        <div class="row" style="flex-wrap:nowrap">
          <span style="padding:.68rem .7rem;border:1.5px solid var(--line);border-radius:12px;background:var(--green-50);font-weight:600">+91</span>
          <input id="auth-mobile" type="tel" inputmode="numeric" maxlength="10" value="${esc(a.mobile)}" placeholder="10-digit number" ${a.sent ? 'readonly' : ''} autocomplete="tel-national">
        </div>
        <span class="field__err">Enter a valid 10-digit Indian mobile number starting with 6–9.</span>
      </label>
      ${!a.sent ? `<button class="btn btn--primary" data-act="auth-send">Send OTP</button>` : `
        <label class="field${a.err === 'otp' ? ' is-invalid' : ''}">
          <span class="field__label">Enter OTP <span class="field__req">Required</span></span>
          <input id="auth-otp" type="text" inputmode="numeric" maxlength="6" placeholder="6-digit code" autocomplete="one-time-code">
          <span class="field__err">That code does not match. Check the demo code shown below.</span>
        </label>
        <div class="note">Demo OTP: <strong>${esc(a.otp)}</strong>. No SMS is sent in this prototype and the code is never stored in plain text in a real build.</div>
        <div class="row mt">
          <button class="btn btn--primary" data-act="auth-verify">Verify OTP</button>
          <span id="auth-resend-slot">${a.secondsLeft > 0 ? `<span class="muted">Resend available in <span id="auth-countdown">${a.secondsLeft}</span>s</span>` : `<button class="btn btn--secondary btn--sm" data-act="auth-resend">Resend OTP</button>`}</span>
          <button class="btn btn--secondary btn--sm" data-act="auth-change">Change number</button>
        </div>`}
    </div>
    <div class="card demo-login-card">
      <div class="card__head"><h2 class="card__title">Demo farmer</h2><span class="st st--ok">Ready for demo</span></div>
      <p class="muted">Ramesh Patil · approved farmer · booking available</p>
      <p class="muted mt-sm">Mobile: <strong>98••••1842</strong> · Farmer ID is shown after verification.</p>
      <button class="btn btn--secondary btn--sm mt" data-act="demo-login">Use demo farmer</button>
      <p class="field__hint mt-sm">Prototype only. OTP is simulated in the browser.</p>
    </div>
  </div>`;
}

function startResendTimer() {
  S.auth.secondsLeft = 30;
  clearInterval(S.auth.timer);
  S.auth.timer = setInterval(() => {
    S.auth.secondsLeft--;
    const onAuthScreen = S.open && S.role === 'farmer' && !S.farmerId && !S.reg && !S.pending;
    if (S.auth.secondsLeft <= 0) {
      clearInterval(S.auth.timer);
      if (onAuthScreen) render();               // swap countdown for the Resend button
      return;
    }
    const el = $('#auth-countdown');
    if (onAuthScreen && el) el.textContent = String(S.auth.secondsLeft);
    else if (onAuthScreen) render();             // element missing for some reason — fall back once
  }, 1000);
}
const makeOtp = () => String(Math.floor(100000 + Math.random() * 900000));
const validMobile = (m) => /^[6-9]\d{9}$/.test(m);

/* ---------- registration wizard ---------- */
function viewRegister() {
  const r = S.reg;
  const pct = Math.round(((r.step - 1) / 8) * 100);
  const header = `
    <h1 class="ptitle">Farmer registration</h1>
    <p class="plead">A proposed prototype registration workflow inspired by common procurement and farmer-registration requirements. It is not the official form of e-NAM, PM-KISAN or any government scheme.</p>
    <div class="card no-print" style="padding:1rem">
      <div class="steps">${REG_STEPS.map((s, i) => {
        const n = i + 1;
        const cls = n < r.step ? 'is-done' : n === r.step ? 'is-current' : '';
        return `<span class="steps__item ${cls}">${n < r.step ? '' : n + '. '}${esc(s)}</span>`;
      }).join('')}</div>
      <div class="meter" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Registration progress"><span style="width:${pct}%"></span></div>
      <p class="muted mt-sm">Registration ${pct}% complete · saved as a draft as you move between steps</p>
    </div>`;
  return `<div class="pwrap">${header}${[regStep1, regStep2, regStep3, regStep4, regStep5, regStep6, regStep7, regStep8, regStep9][r.step - 1]()}</div>`;
}

function navRow(backLabel, nextLabel, nextAct) {
  return `<div class="row row--between mt">
    ${backLabel ? `<button class="btn btn--secondary" data-act="reg-back">${esc(backLabel)}</button>` : '<span></span>'}
    <button class="btn btn--primary" data-act="${nextAct || 'reg-next'}">${esc(nextLabel)}</button>
  </div>`;
}
function fieldWrap(id, label, required, inner, hint, err) {
  const r = S.reg;
  const bad = r && r.errors[id];
  return `<div class="field${bad ? ' is-invalid' : ''}">
    <label class="field__label" for="${id}">${esc(label)} ${required ? '<span class="field__req">Required</span>' : '<span class="field__opt">Optional</span>'}</label>
    ${inner}${hint ? `<span class="field__hint">${hint}</span>` : ''}
    <span class="field__err">${esc(bad || err || 'This field is required.')}</span></div>`;
}
function textField(id, label, required, opts) {
  opts = opts || {};
  const v = S.reg.data[id] == null ? '' : S.reg.data[id];
  return fieldWrap(id, label, required, `<input id="${id}" type="${opts.type || 'text'}" ${opts.attrs || ''} value="${esc(v)}" placeholder="${esc(opts.ph || '')}">`, opts.hint);
}
function selectField(id, label, required, options, opts) {
  opts = opts || {};
  const v = S.reg.data[id] || '';
  return fieldWrap(id, label, required, `<select id="${id}">
    <option value="">${esc(opts.ph || 'Select')}</option>
    ${options.map((o) => `<option value="${esc(o)}"${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`, opts.hint);
}

/* Step 1 — mobile */
function regStep1() {
  const r = S.reg;
  return `<div class="card">
    <h2 class="card__title">Verify your mobile number</h2>
    <p class="muted mt-sm mb">We use this number for your login, slot reminders and queue updates.</p>
    ${r.mobileVerified ? `
      <p>${pill('ok', 'Mobile number verified')}</p>
      <div class="field"><span class="field__label">Mobile number</span><input type="tel" value="+91 ${esc(r.data.mobile)}" readonly></div>
      <p class="muted">Verified at ${esc(r.data.mobileVerifiedAt || nowTime())}. This number stays locked unless you choose to change it.</p>
      <div class="row mt"><button class="btn btn--secondary btn--sm" data-act="reg-change-mobile">Change number</button></div>
      ${navRow('', 'Continue to farmer details')}` : `
      <div class="field"><label class="field__label" for="reg-mobile">Mobile number <span class="field__req">Required</span></label>
        <div class="row" style="flex-wrap:nowrap">
          <span style="padding:.68rem .7rem;border:1.5px solid var(--line);border-radius:12px;background:var(--green-50);font-weight:600">+91</span>
          <input id="reg-mobile" type="tel" inputmode="numeric" maxlength="10" value="${esc(r.data.mobile)}" ${r.otp ? 'readonly' : ''}></div>
      </div>
      ${!r.otp ? `<button class="btn btn--primary" data-act="reg-send-otp">Send OTP</button>` : `
        <div class="field"><label class="field__label" for="reg-otp">Enter OTP <span class="field__req">Required</span></label>
          <input id="reg-otp" type="text" inputmode="numeric" maxlength="6" placeholder="6-digit code"></div>
        <div class="note">Demo OTP: <strong>${esc(r.otp)}</strong>. A real build sends this by SMS and stores only a hashed value.</div>
        <div class="row mt"><button class="btn btn--primary" data-act="reg-verify-otp">Verify OTP</button>
        <span id="reg-resend-slot">${r.resendIn > 0 ? `<span class="muted">Resend in <span id="reg-countdown">${r.resendIn}s</span></span>` : `<button class="btn btn--secondary btn--sm" data-act="reg-resend-otp">Resend OTP</button>`}</span></div>`}`}
  </div>`;
}

/* Step 2 — personal */
function regStep2() {
  const d = S.reg.data;
  const age = d.dateOfBirth ? Math.floor((Date.now() - new Date(d.dateOfBirth)) / 31557600000) : null;
  return `<div class="card">
    <h2 class="card__title">Farmer details</h2>
    <p class="muted mt-sm mb">Enter your name exactly as it appears on the identity document you plan to submit.</p>
    <div class="grid grid--2">
      <div>${textField('fullName', 'Full name', true, { ph: 'e.g. Ramesh Baburao Patil' })}</div>
      <div>${textField('nameAsPerId', 'Name as per identity document', true, { hint: 'Used to match against your KYC document.' })}</div>
      <div>${textField('relativeName', "Father's / mother's / spouse's name", true)}</div>
      <div>${selectField('relativeType', 'Relationship', true, ['Father', 'Mother', 'Spouse', 'Other'])}</div>
      <div>${fieldWrap('dateOfBirth', 'Date of birth', true, `<input id="dateOfBirth" type="date" max="${iso(addDays(new Date(), -365 * 18))}" value="${esc(d.dateOfBirth || '')}">`, age != null ? `Age ${age} years — calculated from your date of birth.` : 'Age is calculated automatically.')}</div>
      <div>${selectField('gender', 'Gender', true, ['Male', 'Female', 'Other', 'Prefer not to say'])}</div>
      <div>${textField('email', 'Email address', false, { type: 'email', hint: 'Optional. Registration is never blocked if you do not have email.' })}</div>
      <div>${selectField('farmerCategory', 'Farmer category', false, ['Small', 'Marginal', 'Other', 'Not specified'], { hint: 'Scheme dependent. No eligibility rule is hard-coded on this field.' })}</div>
      <div>${selectField('farmerType', 'Farmer type', true, ['Land Owner', 'Tenant Farmer', 'Sharecropper', 'Other'], { hint: 'The admin decides which types a scheme accepts.' })}</div>
    </div>
    ${navRow('Back', 'Continue to address')}</div>`;
}

/* Step 3 — address */
function regStep3() {
  const d = S.reg.data;
  const states = Object.keys(GEO);
  const districts = d.state ? Object.keys(GEO[d.state]) : [];
  const subs = d.state && d.district && GEO[d.state][d.district] ? Object.keys(GEO[d.state][d.district]) : [];
  const villages = subs.length && d.subDistrict && GEO[d.state][d.district][d.subDistrict] ? GEO[d.state][d.district][d.subDistrict] : [];
  return `<div class="card">
    <h2 class="card__title">Residential address</h2>
    <p class="muted mt-sm mb">District, taluka and village lists narrow down as you choose.</p>
    <div class="grid grid--2">
      <div>${selectField('state', 'State', true, states, { ph: 'Search or select a state' })}</div>
      <div>${selectField('district', 'District', true, districts, { ph: d.state ? 'Select district' : 'Choose a state first' })}</div>
      <div>${selectField('subDistrict', 'Sub-district / taluka / tehsil', true, subs, { ph: d.district ? 'Select taluka' : 'Choose a district first' })}</div>
      <div>${textField('block', 'Block', false, { hint: 'Depends on local administration.' })}</div>
      <div>${textField('localBody', 'Gram panchayat / municipality', false)}</div>
      <div>${selectField('village', 'Village / town', true, villages.length ? villages : (d.village ? [d.village] : []), { ph: d.subDistrict ? 'Select village' : 'Choose a taluka first' })}</div>
      <div>${textField('pinCode', 'PIN code', true, { attrs: 'inputmode="numeric" maxlength="6"', hint: 'Exactly 6 digits.' })}</div>
    </div>
    ${fieldWrap('addressLine', 'Full residential address', true, `<textarea id="addressLine" placeholder="House number, street, landmark">${esc(d.addressLine || '')}</textarea>`)}
    ${navRow('Back', 'Continue to farm details')}</div>`;
}

/* Step 4 — farm */
function regStep4() {
  const d = S.reg.data;
  return `<div class="card">
    <h2 class="card__title">Farm & crop details</h2>
    <p class="muted mt-sm mb">Most of this is optional at registration. You can add the rest when you book a procurement slot.</p>
    <div class="grid grid--2">
      <div>${selectField('landStatus', 'Land ownership / cultivation type', false, ['Owned', 'Leased', 'Tenant', 'Sharecropped', 'Other'])}</div>
      <div>${textField('totalLandArea', 'Total agricultural land area', false, { type: 'number', attrs: 'step="0.01" min="0"' })}</div>
      <div>${selectField('landUnit', 'Land unit', !!d.totalLandArea, ['Acre', 'Hectare', 'Guntha', 'Other'], { hint: 'Required only when you enter a land area.' })}</div>
    </div>
    <fieldset><legend>Survey / Gat / Khasra number <span class="field__opt">Optional</span></legend>
      <div id="land-records">${(d.landRecords || ['']).map((v, i) => `<div class="row mt-sm" style="flex-wrap:nowrap">
        <input type="text" class="land-rec" value="${esc(v)}" placeholder="e.g. 123/4" aria-label="Land record ${i + 1}">
        ${i > 0 ? `<button class="btn btn--secondary btn--sm" data-act="reg-del-land" data-i="${i}">Remove</button>` : ''}</div>`).join('')}</div>
      <button class="btn btn--secondary btn--sm mt-sm" data-act="reg-add-land">+ Add another land record</button>
    </fieldset>
    <fieldset><legend>Main crops <span class="field__opt">Optional</span></legend>
      <div class="chips">${CROPS.map((c) => `<button type="button" class="chip${(d.mainCrops || []).includes(c) ? ' is-on' : ''}" data-act="reg-crop" data-crop="${esc(c)}" aria-pressed="${(d.mainCrops || []).includes(c)}">${esc(c)}</button>`).join('')}</div>
      ${(d.mainCrops || []).includes('Other') ? `<div class="mt-sm">${textField('otherCropName', 'Enter crop name', true, { hint: 'Write the crop name if it is not listed above.', attrs: 'maxlength="60"' })}</div>` : ''}
    </fieldset>
    ${selectField('expectedCommodity', 'Commodity you expect to sell', false, DB.commodities.map((c) => c.name).concat((d.otherCropName || '').trim() ? [d.otherCropName.trim()] : []), { hint: 'Not permanent — you choose the commodity again at each booking.' })}
    ${navRow('Back', 'Continue to identity')}</div>`;
}

/* Step 5 — KYC */
function regStep5() {
  const d = S.reg.data, docs = S.reg.docs;
  const rules = { Aadhaar: '12 digits', 'Voter ID': '3 letters followed by 7 digits', PAN: '10 characters, e.g. ABCDE1234F', 'Driving Licence': 'State code and 13–15 characters', Other: 'As printed on the document' };
  return `<div class="card">
    <h2 class="card__title">Identity verification</h2>
    <p class="muted mt-sm mb">Your identity is collected so the procurement authority can confirm the seller is the person being paid. The number is masked everywhere after submission, and the document is never shown publicly.</p>
    ${selectField('identityDocumentType', 'Identity document type', true, ['Aadhaar', 'Voter ID', 'PAN', 'Driving Licence', 'Other government-approved ID'], { hint: 'The accepted list is configurable per scheme — not every document is accepted by every scheme.' })}
    ${textField('identityDocumentNumber', 'Identity document number', true, { hint: `Format: ${esc(rules[d.identityDocumentType] || 'As printed on the document')}. Shown as ${esc(maskId('XXXXXXXX4821', d.identityDocumentType))} after submission.` })}
    <div class="field"><span class="field__label">Verification method</span>
      <input type="text" value="Pending admin verification" readonly>
      <span class="field__hint">No external KYC service is connected in this prototype, so an officer checks the document manually.</span></div>
    <fieldset><legend>Identity document upload ${CFG.requireIdDocument ? '<span class="field__req">Required</span>' : '<span class="field__opt">Optional</span>'}</legend>
      <div class="uploader">
        <span>${docs.identity ? pill('ok', 'Document uploaded: ' + docs.identity) : 'PDF, JPG, JPEG or PNG · up to 5 MB'}</span>
        <label class="btn btn--secondary btn--sm">${docs.identity ? 'Replace file' : 'Choose file'}
          <input type="file" accept=".pdf,.jpg,.jpeg,.png" data-upload="identity" style="display:none"></label>
      </div>
      ${S.reg.errors.identityDoc ? `<p class="field__err" style="display:block">${esc(S.reg.errors.identityDoc)}</p>` : ''}
    </fieldset>
    ${navRow('Back', 'Continue to bank details')}</div>`;
}

/* Step 6 — bank */
function regStep6() {
  const d = S.reg.data, docs = S.reg.docs;
  const looked = !!d.bankName;
  return `<div class="card">
    <h2 class="card__title">Payment account details</h2>
    <p class="muted mt-sm mb">Procurement payment is credited to this account, so the account holder name must match your identity document.</p>
    ${textField('accountHolderName', 'Account holder name', true, { hint: 'Pre-filled from your name — edit it if the bank record differs.' })}
    ${fieldWrap('accountNumber', 'Bank account number', true, `<input id="accountNumber" type="password" inputmode="numeric" autocomplete="off" value="${esc(d.accountNumber || '')}" placeholder="Digits only">`, 'Masked while typing. Stored and displayed later as ' + maskAcct('XXXXXX4821') + '.')}
    ${fieldWrap('confirmAccountNumber', 'Confirm bank account number', true, `<input id="confirmAccountNumber" type="text" inputmode="numeric" autocomplete="off" value="${esc(d.confirmAccountNumber || '')}">`, 'Both entries must match.')}
    <div class="row" style="align-items:flex-end;gap:.7rem">
      <div style="flex:1;min-width:200px">${textField('ifsc', 'IFSC code', true, { attrs: 'maxlength="11" style="text-transform:uppercase"', ph: 'e.g. SBIN0001842' })}</div>
      <button class="btn btn--secondary" data-act="reg-ifsc" style="margin-bottom:1rem">Look up bank</button>
    </div>
    <div class="grid grid--2">
      <div class="field"><span class="field__label">Bank name ${looked ? '' : '<span class="field__req">Required</span>'}</span>
        <input type="text" value="${esc(d.bankName || '')}" readonly placeholder="Filled after IFSC lookup"></div>
      <div class="field"><span class="field__label">Branch name</span>
        <input type="text" value="${esc(d.branchName || '')}" readonly placeholder="Filled after IFSC lookup"></div>
      <div class="field"><span class="field__label">Bank state / district</span>
        <input type="text" value="${esc(d.bankState || '')}" readonly placeholder="Filled after IFSC lookup"></div>
      <div>${selectField('accountType', 'Account type', true, ['Savings', 'Current', 'Other'])}</div>
    </div>
    <p>${pill('wait', 'Account verification: pending')} <span class="muted">No penny-drop or bank API runs in this prototype — an officer marks the account verified.</span></p>
    <fieldset class="mt"><legend>Bank proof <span class="field__opt">${CFG.requireBankDocument ? 'Required by the current scheme' : 'Optional'}</span></legend>
      <div class="uploader"><span>${docs.bank ? pill('ok', 'Uploaded: ' + docs.bank) : 'Passbook first page or cancelled cheque'}</span>
        <label class="btn btn--secondary btn--sm">${docs.bank ? 'Replace file' : 'Choose file'}<input type="file" accept=".pdf,.jpg,.jpeg,.png" data-upload="bank" style="display:none"></label></div>
    </fieldset>
    ${navRow('Back', 'Continue to documents')}</div>`;
}

/* Step 7 — documents */
function regStep7() {
  const docs = S.reg.docs;
  const rows = [
    ['identity', 'Identity proof', CFG.requireIdDocument ? 'REQUIRED' : 'OPTIONAL'],
    ['bank', 'Bank proof', CFG.requireBankDocument ? 'REQUIRED' : 'OPTIONAL'],
    ['land', 'Land / eligibility proof', CFG.requireLandDocument ? 'REQUIRED' : 'OPTIONAL'],
    ['other', 'Other scheme document', 'NOT_REQUIRED']
  ];
  return `<div class="card">
    <h2 class="card__title">Required documents</h2>
    <p class="muted mt-sm mb">This list comes from the scheme configuration, so it changes when the admin changes the scheme requirements.</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Document</th><th>Requirement</th><th>Status</th><th>Action</th></tr></thead><tbody>
    ${rows.map(([k, label, req]) => {
      const f = docs[k];
      const status = req === 'NOT_REQUIRED' ? pill('off', 'Not required') : f ? pill('ok', 'Uploaded') : req === 'REQUIRED' ? pill('warn', 'Action required') : pill('wait', 'Pending');
      return `<tr><td><strong>${esc(label)}</strong>${f ? `<br><span class="muted">${esc(f)}</span>` : ''}</td>
        <td>${req === 'REQUIRED' ? 'Required' : req === 'OPTIONAL' ? 'Optional' : 'Not required'}</td><td>${status}</td>
        <td>${req === 'NOT_REQUIRED' ? '<span class="muted">—</span>' : `<label class="btn btn--secondary btn--sm">${f ? 'Replace' : 'Upload'}<input type="file" accept=".pdf,.jpg,.jpeg,.png" data-upload="${k}" style="display:none"></label>`}</td></tr>`;
    }).join('')}
    </tbody></table></div>
    <p class="muted mt">Every upload is tracked with a document ID, type, file name, upload time and a verification status of not uploaded, uploaded, under review, verified, rejected or resubmission required.</p>
    ${navRow('Back', 'Review your registration')}</div>`;
}

/* Step 8 — review + consent */
function regStep8() {
  const d = S.reg.data, c = S.reg.consents, docs = S.reg.docs;
  const sec = (title, pairs, step) => `<div class="card"><div class="card__head"><h2 class="card__title">${esc(title)}</h2>
    <button class="btn btn--secondary btn--sm" data-act="reg-goto" data-step="${step}">Edit</button></div>
    <dl class="kv">${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl></div>`;
  return `<h2 class="ptitle" style="font-size:1.3rem">Review your registration</h2>
  ${sec('Personal information', [
    ['Name', esc(d.fullName)], ['Name as per ID', esc(d.nameAsPerId)], ['Relation', `${esc(d.relativeName)} (${esc(d.relativeType)})`],
    ['Mobile', `${maskMobile(d.mobile)} ${pill('ok', 'Verified')}`], ['Date of birth', fmtDate(d.dateOfBirth)], ['Gender', esc(d.gender)],
    ['Email', esc(d.email || 'Not provided')], ['Farmer type', esc(d.farmerType)], ['Category', esc(d.farmerCategory)]], 2)}
  ${sec('Address', [['State', esc(d.state)], ['District', esc(d.district)], ['Taluka', esc(d.subDistrict)], ['Village', esc(d.village)], ['PIN', esc(d.pinCode)], ['Address', esc(d.addressLine)]], 3)}
  ${sec('Agricultural information', [['Land status', esc(d.landStatus || 'Not provided')], ['Land area', d.totalLandArea ? `${esc(d.totalLandArea)} ${esc(d.landUnit)}` : 'Not provided'],
    ['Land records', esc((d.landRecords || []).filter(Boolean).join(', ') || 'Not provided')], ['Main crops', esc((d.mainCrops || []).join(', ') || 'Not provided')],
    ['Expected commodity', esc(d.expectedCommodity || 'Decided at booking')]], 4)}
  ${sec('Identity', [['ID type', esc(d.identityDocumentType)], ['ID number', maskId(d.identityDocumentNumber, d.identityDocumentType)],
    ['Document', docs.identity ? pill('ok', 'Uploaded') : pill('off', 'Not uploaded')], ['Status', pill('wait', 'Pending verification')]], 5)}
  ${sec('Bank', [['Bank', esc(d.bankName)], ['Branch', esc(d.branchName)], ['Account holder', esc(d.accountHolderName)],
    ['Account', maskAcct(d.accountNumber)], ['IFSC', esc(d.ifsc)], ['Type', esc(d.accountType)], ['Verification', pill('wait', 'Pending')]], 6)}
  <div class="card"><h2 class="card__title">Consent</h2>
    <p class="muted mt-sm mb">All three confirmations are needed before submitting.</p>
    <label class="checkline"><input type="checkbox" data-consent="accuracy" ${c.accuracy ? 'checked' : ''}><span>I confirm that the information provided by me is accurate to the best of my knowledge.</span></label>
    <label class="checkline"><input type="checkbox" data-consent="verification" ${c.verification ? 'checked' : ''}><span>I understand that the information and documents provided may be verified by the authorised procurement or mandi authority.</span></label>
    <label class="checkline"><input type="checkbox" data-consent="dataUse" ${c.dataUse ? 'checked' : ''}><span>I understand that my information will be used for farmer registration, procurement management, verification, payment processing and related services, in line with the applicable scheme and the <a href="#" data-act="privacy" style="text-decoration:underline">privacy policy</a>.</span></label>
    ${S.reg.errors.consent ? `<p class="field__err" style="display:block">${esc(S.reg.errors.consent)}</p>` : ''}
    ${S.reg.errors.submit ? `<div class="note mt">${esc(S.reg.errors.submit)}</div>` : ''}
    <div class="row row--between mt">
      <button class="btn btn--secondary" data-act="reg-back">Back</button>
      <button class="btn btn--primary" data-act="reg-submit">Submit registration</button></div>
  </div>`;
}

/* Step 9 — submitted */
function regStep9() {
  const d = S.reg.data;
  return `<div class="card" style="text-align:center">
    <p>${pill('ok', 'Application submitted')}</p>
    <h2 class="ptitle mt-sm">Thank you, ${esc(d.fullName.split(' ')[0])}</h2>
    <p class="muted">Your application is with the procurement office for verification.</p>
    <div class="token mt"><p class="token__meta">Application ID</p><p class="token__num" style="font-size:2.2rem">${esc(d.applicationId)}</p>
      <p class="token__meta">Status: under verification</p></div>
    <p class="muted mt">Your Farmer ID is generated by the system only after approval — you never choose it. Slot booking unlocks at the same time.</p>
    <div class="row mt" style="justify-content:center">
      <button class="btn btn--primary" data-act="reg-done">Go to my dashboard</button></div>
  </div>
  <div class="note note--info mt">Demo shortcut: open the <strong>Mandi officer</strong> or <strong>Admin</strong> interface, find ${esc(d.applicationId)} under applications, and approve it to watch the Farmer ID appear here.</div>`;
}

/* ---------- validation ---------- */
function collectStep() {
  const r = S.reg; if (!r) return;
  const ids = ['fullName', 'nameAsPerId', 'relativeName', 'relativeType', 'dateOfBirth', 'gender', 'email', 'farmerCategory', 'farmerType',
    'state', 'district', 'subDistrict', 'block', 'localBody', 'village', 'pinCode', 'addressLine',
    'landStatus', 'totalLandArea', 'landUnit', 'expectedCommodity',
    'identityDocumentType', 'identityDocumentNumber',
    'accountHolderName', 'accountNumber', 'confirmAccountNumber', 'ifsc', 'accountType'];
  ids.forEach((id) => { const el = $('#' + id); if (el) r.data[id] = id === 'ifsc' ? el.value.toUpperCase().trim() : el.value.trim(); });
  const recs = [...document.querySelectorAll('.land-rec')];
  if (recs.length) r.data.landRecords = recs.map((el) => el.value.trim());
}
function validateStep() {
  const r = S.reg, d = r.data; r.errors = {};
  const need = (k, msg) => { if (!d[k]) r.errors[k] = msg || 'This field is required.'; };
  if (r.step === 2) {
    need('fullName'); if (d.fullName && (d.fullName.length < 3 || /^\d+$/.test(d.fullName))) r.errors.fullName = 'Enter your full name — at least 3 characters, not only numbers.';
    need('nameAsPerId'); need('relativeName'); need('relativeType'); need('gender'); need('farmerType');
    if (!d.dateOfBirth) r.errors.dateOfBirth = 'Select your date of birth.';
    else if (new Date(d.dateOfBirth) > addDays(new Date(), -365 * 18)) r.errors.dateOfBirth = 'The applicant must be at least 18 years old.';
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) r.errors.email = 'Enter a valid email address or leave it blank.';
  }
  if (r.step === 3) {
    ['state', 'district', 'subDistrict', 'village', 'addressLine'].forEach((k) => need(k));
    if (!/^\d{6}$/.test(d.pinCode || '')) r.errors.pinCode = 'PIN code must be exactly 6 digits.';
  }
  if (r.step === 4) {
    if (d.totalLandArea && Number(d.totalLandArea) <= 0) r.errors.totalLandArea = 'Enter a land area greater than zero or leave it blank.';
    if (d.totalLandArea && !d.landUnit) r.errors.landUnit = 'Choose the unit for the land area you entered.';
  }
  if (r.step === 5) {
    need('identityDocumentType'); need('identityDocumentNumber');
    const n = (d.identityDocumentNumber || '').replace(/\s/g, '');
    if (n) {
      if (d.identityDocumentType === 'Aadhaar' && !/^\d{12}$/.test(n)) r.errors.identityDocumentNumber = 'Aadhaar numbers are 12 digits. Use a fictional number for this demo.';
      if (d.identityDocumentType === 'PAN' && !/^[A-Za-z]{5}\d{4}[A-Za-z]$/.test(n)) r.errors.identityDocumentNumber = 'PAN format is five letters, four digits and one letter.';
      if (d.identityDocumentType === 'Voter ID' && !/^[A-Za-z]{3}\d{7}$/.test(n)) r.errors.identityDocumentNumber = 'Voter ID format is three letters followed by seven digits.';
    }
    if (CFG.requireIdDocument && !r.docs.identity) r.errors.identityDoc = 'Upload your identity document to continue.';
  }
  if (r.step === 6) {
    need('accountHolderName'); need('accountType');
    if (!/^\d{9,18}$/.test(d.accountNumber || '')) r.errors.accountNumber = 'Enter an account number of 9 to 18 digits.';
    if (d.accountNumber !== d.confirmAccountNumber) r.errors.confirmAccountNumber = 'The two account numbers do not match.';
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(d.ifsc || '')) r.errors.ifsc = 'IFSC is 4 letters, a zero, then 6 characters — e.g. SBIN0001842.';
    else if (!d.bankName) r.errors.ifsc = 'Run the bank lookup so the bank and branch are filled in.';
    if (CFG.requireBankDocument && !r.docs.bank) r.errors.bankDoc = 'Bank proof is required by the current scheme configuration.';
  }
  if (r.step === 7) {
    if (CFG.requireIdDocument && !r.docs.identity) r.errors.identityDoc = 'Identity proof is still missing.';
    if (CFG.requireLandDocument && !r.docs.land) r.errors.land = 'Land proof is required by the current scheme configuration.';
  }
  return Object.keys(r.errors).length === 0;
}

/* ---------- farmer main views ---------- */
function farmerViews() {
  const f = farmerById(S.farmerId);
  if (!f) {
    if (!backendSettled) return '<div class="pwrap"><p class="muted">Loading your records…</p></div>';   /* DB not loaded yet: keep the session */
    S.farmerId = null; return viewFarmerAuth();
  }
  if (f.registrationStatus !== 'APPROVED' && !['profile', 'help', 'alerts'].includes(S.view)) return viewPendingStatus(f);
  switch (S.view) {
    case 'book': return viewBooking(f);
    case 'token': return viewToken(f);
    case 'journey': return viewJourney(f);
    case 'payments': return viewPayments(f);
    case 'history': return viewHistory(f);
    case 'reports': return viewQualityReports(f);
    case 'profile': return viewProfile(f);
    case 'alerts': return viewAlerts(f);
    case 'help': return viewHelp();
    default: return viewFarmerDash(f);
  }
}

function viewPendingStatus(f) {
  const app = DB.applications.find((a) => a.applicationId === f.applicationId) || { status: f.registrationStatus };
  const rejected = app.status === 'REJECTED' || app.status === 'RESUBMISSION_REQUIRED';
  return `<div class="pwrap">
    <h1 class="ptitle">Registration status</h1>
    <p class="plead">Slot booking opens once your registration is approved. Nothing else is locked — you can review your details any time.</p>
    <div class="card">
      <dl class="kv">
        <dt>Application ID</dt><dd>${esc(f.applicationId)}</dd>
        <dt>Submitted</dt><dd>${fmtDate(f.submittedAt || TODAY)}</dd>
        <dt>Current status</dt><dd>${app.status === 'REJECTED' ? pill('bad', 'Rejected') : app.status === 'RESUBMISSION_REQUIRED' ? pill('warn', 'Resubmission required') : app.status === 'UNDER_REVIEW' ? pill('wait', 'Under review') : pill('wait', 'Submitted')}</dd>
        <dt>Identity check</dt><dd>${f.kycStatus === 'VERIFIED' ? pill('ok', 'Verified') : pill('wait', 'Pending')}</dd>
        <dt>Bank check</dt><dd>${f.bankStatus === 'VERIFIED' ? pill('ok', 'Verified') : pill('wait', 'Pending')}</dd>
        <dt>Farmer ID</dt><dd>${f.farmerId ? esc(f.farmerId) : '<span class="muted">Issued by the system after approval</span>'}</dd>
      </dl>
      ${rejected ? `<div class="note mt"><strong>Officer's remarks:</strong> ${esc(app.reason || 'Not recorded')}<br>
        <span class="muted">Correct the highlighted information and submit again.</span></div>
        <button class="btn btn--primary mt" data-act="resubmit">Reopen and resubmit</button>` : `
        <p class="muted mt">Your registration is still under verification. Slot booking will become available after approval.</p>`}
    </div>
    <div class="note note--info">Demo shortcut: open the officer or admin interface and approve ${esc(f.applicationId)}.</div>
  </div>`;
}


function liveStatusModel(f, bk, tk) {
  if (!bk || !tk) return { active:false };
  const currentKey = tk.stage || f.stage || 'REGISTERED';
  const idx = STAGE_INDEX[currentKey] ?? 0;
  const next = STAGES[idx + 1] || null;
  const servingGlobal = servingToken(tk.centreId, tk.date);
  const sameStage = activeTokens(tk.centreId, tk.date).find((x) => x.status === 'SERVING' && x.stage === currentKey);
  const serving = sameStage || servingGlobal;
  const ahead = ['PAYMENT_COMPLETE','PROCUREMENT_COMPLETE'].includes(currentKey) ? 0 : farmersAhead(tk);
  const eta = ['PAYMENT_COMPLETE','PROCUREMENT_COMPLETE'].includes(currentKey) ? 0 : etaMinutes(ahead, tk.centreId);
  const nextEta = next ? (eta || (currentKey === 'TOKEN_GENERATED' ? etaMinutes(ahead, tk.centreId) : Math.max(5, eta))) : 0;
  const slotBase = Math.round((tk.startHour || new Date().getHours()) * 60);
  const estimatedCalling = formatClock(clockPlusMinutes(`${pad(Math.floor(slotBase / 60) % 24, 2)}:${pad(slotBase % 60, 2)}`, eta));
  const recommendedArrival = formatClock(clockPlusMinutes(`${pad(Math.floor(slotBase / 60) % 24, 2)}:${pad(slotBase % 60, 2)}`, Math.max(0, eta - 15)));
  const progressTotal = STAGES.length;
  const progressCurrent = Math.min(progressTotal, idx + 1);
  let section = tk.section || '—';
  if (section === 'Quality Section Q-2') section = liveCopy('quality');
  if (section === '—') {
    if (currentKey === 'VERIFICATION_COMPLETE' || currentKey === 'CHECKED_IN') section = liveCopy('verification');
    else if (currentKey === 'QUALITY_PENDING' || currentKey === 'QUALITY_ASSESSED' || currentKey === 'QUALITY_TOKEN_GENERATED') section = liveCopy('quality');
    else if (currentKey === 'WEIGHING_PENDING' || currentKey === 'WEIGHED') section = liveCopy('weighing');
    else if (currentKey === 'PAYMENT_PENDING' || currentKey === 'PAYMENT_COMPLETE') section = liveCopy('payment');
  }
  let action = liveCopy('noAction');
  if (currentKey === 'TOKEN_GENERATED') action = liveCopy('arrive');
  else if (currentKey === 'CHECKED_IN') action = liveCopy('waitVerification');
  else if (currentKey === 'VERIFICATION_COMPLETE' || currentKey === 'QUALITY_PENDING') action = `${liveCopy('remain')} ${section}.`;
  else if (currentKey === 'QUALITY_ASSESSED' || currentKey === 'QUALITY_TOKEN_GENERATED' || currentKey === 'SECTION_ASSIGNED') action = liveCopy('proceed');
  else if (currentKey === 'WEIGHING_PENDING') action = `${liveCopy('remain')} ${section}.`;
  else if (currentKey === 'WEIGHED') action = liveCopy('finalizing');
  else if (currentKey === 'PROCUREMENT_COMPLETE') action = liveCopy('completePayment');
  else if (currentKey === 'PAYMENT_PENDING') action = liveCopy('processing');
  else if (currentKey === 'PAYMENT_COMPLETE') action = liveCopy('paid');
  const liveAlert = tk.liveAlert
    ? { title: liveCopy('qualityDelayTitle'), body: liveCopy('qualityDelayBody') }
    : (DB.notifications.find((n) => n.farmerId === f.farmerId && !n.read) || null);
  return { active:true, currentKey, current:localizedStage(currentKey), next:next ? localizedStage(next[0]) : tr('completed','Procurement complete'), nextKey:next ? next[0] : null, ahead, eta, nextEta, serving, section, action, alert:liveAlert, estimatedCalling, recommendedArrival, progressCurrent, progressTotal };
}

function renderFarmerLiveStatus(f, bk, tk) {
  const m = liveStatusModel(f, bk, tk);
  if (!m.active) return `<div class="card live-status mt" id="farmer-live-status"><div class="live-status__top"><div><p class="live-status__eyebrow">${esc(tr('liveUpdated','Live status'))}</p><h2 class="live-status__stage">${esc(tr('noActive','No active procurement'))}</h2></div><span class="live-status__live">LIVE</span></div><p class="muted mt-sm">Book a procurement slot to start live queue tracking.</p></div>`;
  const payment = tk.paymentStatus === 'PAID' ? liveCopy('paidShort') : tk.paymentStatus === 'INITIATED' ? liveCopy('processingShort') : liveCopy('notStartedShort');
  const isComplete = ['PAYMENT_COMPLETE','PROCUREMENT_COMPLETE'].includes(m.currentKey);
  const isPaymentStage = ['PROCUREMENT_COMPLETE','PAYMENT_PENDING','PAYMENT_COMPLETE'].includes(m.currentKey);
  const isVerification = ['CHECKED_IN','VERIFICATION_COMPLETE'].includes(m.currentKey);
  const isQueueStage = ['TOKEN_GENERATED','QUALITY_PENDING','QUALITY_ASSESSED','QUALITY_TOKEN_GENERATED','SECTION_ASSIGNED','WEIGHING_PENDING','WEIGHED'].includes(m.currentKey);
  const metric = (value, label) => `<div class="live-status__metric"><strong>${esc(String(value ?? '—'))}</strong><span>${esc(label)}</span></div>`;
  let metrics = '';
  if (isPaymentStage) {
    const amount = tk.amount != null ? rupee(tk.amount) : '—';
    const weight = tk.weightQtl != null ? `${tk.weightQtl} qtl` : '—';
    const quality = tk.qualityLabel || tk.qualityGrade || '—';
    metrics = metric(amount, liveCopy('amountLabel')) + metric(payment, liveCopy('paymentStatusLabel')) + metric(weight, liveCopy('quantityLabel')) + metric(quality, liveCopy('qualityLabel'));
  } else if (isVerification) {
    const verificationStatus = m.currentKey === 'CHECKED_IN' ? liveCopy('verificationWaiting') : liveCopy('verificationCurrent');
    metrics = metric(m.serving ? m.serving.token : '—', tr('currentToken','Current token')) + metric(m.ahead, liveCopy('farmersAhead')) + metric(`${m.eta} min`, liveCopy('estimatedWait')) + metric(verificationStatus, tr('verificationStatus','Verification status'));
  } else if (['QUALITY_PENDING','QUALITY_ASSESSED','QUALITY_TOKEN_GENERATED','SECTION_ASSIGNED'].includes(m.currentKey)) {
    metrics = metric(m.serving ? m.serving.token : '—', tr('currentToken','Current token')) + metric(m.ahead, liveCopy('farmersAhead')) + metric(`${m.eta} min`, liveCopy('estimatedWait')) + metric(m.section, tr('qualitySection','Quality section / counter'));
  } else if (m.currentKey === 'WEIGHING_PENDING' || m.currentKey === 'WEIGHED') {
    metrics = metric(m.serving ? m.serving.token : '—', tr('currentWeighing','Current weighing token')) + metric(m.ahead, liveCopy('farmersAhead')) + metric(`${m.eta} min`, liveCopy('estimatedWait')) + metric(m.section, tr('weighingSection','Assigned weighing section'));
  } else if (isQueueStage) {
    metrics = metric(m.ahead, liveCopy('farmersAhead')) + metric(m.serving ? m.serving.token : '—', liveCopy('currentlyServing')) + metric(`${m.eta} min`, liveCopy('estimatedWait')) + metric(m.nextKey ? `${m.nextEta} min` : '—', liveCopy('nextStageTime'));
  } else {
    metrics = metric(m.ahead, liveCopy('farmersAhead')) + metric(m.serving ? m.serving.token : '—', liveCopy('currentlyServing')) + metric(`${m.eta} min`, liveCopy('estimatedWait')) + metric(m.nextKey ? `${m.nextEta} min` : '—', liveCopy('nextStageTime'));
  }
  const alertHtml = m.alert ? `<div class="live-status__alert"><span class="live-status__alert-icon">🔔</span><div><strong>${esc(m.alert.title || tr('alertsLabel','Important update'))}</strong><div>${esc(m.alert.body || '')}</div></div></div>` : `<div class="live-status__alert is-clear"><span class="live-status__alert-icon">✓</span><div><strong>${esc(tr('noAlert','No action required right now'))}</strong></div></div>`;
  const actionButton = isComplete ? `<button class="btn btn--secondary btn--sm" data-go="payments">${esc(tr('payments','Payments & receipt'))}</button>` : '';
  return `<div class="card live-status mt" id="farmer-live-status">
    <div class="live-status__top"><div><p class="live-status__eyebrow">${esc(tr('liveUpdated','Live status'))}</p><h2 class="live-status__stage">${esc(m.current)}</h2></div><span class="live-status__live">LIVE</span></div>
    <div class="live-status__grid">${metrics}</div>
    <div class="live-status__progress"><div class="live-status__progress-top"><strong>${esc(tr('progress','Progress through procurement'))}</strong><span>${m.progressCurrent}/${m.progressTotal}</span></div><div class="live-status__progress-track"><span style="width:${Math.round((m.progressCurrent/m.progressTotal)*100)}%"></span></div></div>
    <div class="live-status__details">
      <div class="live-status__detail"><strong>${esc(tr('currentStage','Current stage'))}</strong><span>${esc(m.current)}</span></div>
      <div class="live-status__detail"><strong>${esc(tr('nextStage','Next stage'))}</strong><span>${esc(m.next)}</span></div>
      <div class="live-status__detail"><strong>${esc(tr('assignedSection','Assigned section'))}</strong><span>${esc(m.section)}</span></div>
      <div class="live-status__detail"><strong>${esc(tr('estimatedCalling','Estimated calling time'))}</strong><span>${esc(m.estimatedCalling)}</span></div>
      <div class="live-status__detail"><strong>${esc(tr('recommendedArrival','Recommended arrival'))}</strong><span>${esc(m.recommendedArrival)}</span></div>
      <div class="live-status__detail"><strong>${esc(liveCopy('tokenPayment'))}</strong><span>${esc(tk.token)} · ${esc(payment)}</span></div>
    </div>
    <div class="live-status__action"><div><strong>${esc(tr('actionRequired','What you need to do'))}</strong><p>${esc(m.action)}</p></div>${actionButton}</div>
    ${alertHtml}
    <div class="live-status__footer"><span class="muted" style="font-size:.72rem">${esc(centreName(tk.centreId))} · Token ${esc(tk.token)}</span><button class="btn btn--secondary btn--sm" data-act="refresh-live">${esc(tr('refresh','Refresh status'))}</button></div>
  </div>`;
}

function refreshFarmerLiveStatus() {
  if (!S.open || S.role !== 'farmer' || !S.farmerId) return;
  const host = document.getElementById('farmer-live-status');
  if (!host) return;
  const f = farmerById(S.farmerId); if (!f) return;
  const bk = activeBookingOf(f.farmerId);
  const tk = bk ? tokenForBooking(bk.bookingId) : null;
  const wrap = document.createElement('div');
  wrap.innerHTML = renderFarmerLiveStatus(f, bk, tk);
  const next = wrap.firstElementChild;
  if (next) {
    host.replaceWith(next);
    requestAnimationFrame(() => { if (typeof applyCoverageLanguage === 'function') applyCoverageLanguage(); });
  }
}

function viewFarmerDash(f) {
  const bk = activeBookingOf(f.farmerId);
  const tk = bk ? tokenForBooking(bk.bookingId) : null;
  const ahead = tk ? farmersAhead(tk) : 0;
  const serving = tk ? servingToken(tk.centreId, tk.date) : null;
  const unread = DB.notifications.filter((n) => n.farmerId === f.farmerId && !n.read).length;
  return `<div class="pwrap">
    <h1 class="ptitle">Namaskar, ${esc(f.fullName.split(' ')[0])}</h1>
    <p class="plead">Farmer ID ${esc(f.farmerId)} · ${esc(f.village)}, ${esc(f.district)}</p>
    ${bk ? `
    <div class="card">
      <div class="card__head"><h2 class="card__title">Upcoming procurement</h2>${pill(tk.status === 'COMPLETED' ? 'ok' : 'ok', bookingStatusLabel(bk, tk))}</div>
      <div class="grid grid--2">
        <div><dl class="kv">
          <dt>Commodity</dt><dd>${esc(commodityName(bk.commodityId))}</dd>
          <dt>Centre</dt><dd>${esc(centreName(bk.centreId))}</dd>
          <dt>Date</dt><dd>${fmtDate(bk.date)}</dd>
          <dt>Time slot</dt><dd>${fmtTime(bk.startHour)} – ${fmtTime(bk.endHour)}</dd>
          <dt>Booking ID</dt><dd>${esc(bk.bookingId)}</dd>
        </dl></div>
        <div class="token">
          <p class="token__meta">Main queue token</p>
          <p class="token__num">${esc(tk.token)}</p>
          <p class="token__meta">Now serving ${serving ? esc(serving.token) : '—'} · ${ahead} ahead of you</p>
          <p class="token__meta">Estimated waiting time ${etaMinutes(ahead, tk.centreId)} minutes</p>
        </div>
      </div>
      <div class="row mt">
        <button class="btn btn--primary btn--sm" data-go="token">View token</button>
        <button class="btn btn--secondary btn--sm" data-go="journey">View journey</button>
        ${CFG.reschedulingAllowed && bk.bookingStatus === 'CONFIRMED' ? `<button class="btn btn--secondary btn--sm" data-act="resched">Reschedule</button>` : ''}
        ${bk.bookingStatus === 'CONFIRMED' ? `<button class="btn btn--secondary btn--sm" data-act="cancel-booking">Cancel booking</button>` : ''}
      </div>
    </div>` : `
    <div class="card">
      <h2 class="card__title">No active booking</h2>
      <p class="muted mt-sm">Book a slot to receive a main queue token and an arrival window for your centre.</p>
      <button class="btn btn--primary mt" data-go="book">Book a procurement slot</button>
    </div>`}
    ${renderFarmerLiveStatus(f, bk, tk)}
    ${oqFarmerCard(oqTkFor(f, tk))}
    ${tk && (tk.amount != null || tk.paymentStatus !== 'NOT_STARTED') ? `<div class="card mt"><div class="card__head"><h2 class="card__title">${esc(tr('payment','Payment'))}</h2><span class="st st--${tk.paymentStatus === 'PAID' ? 'ok' : 'wait'}">${esc(tk.paymentStatus === 'PAID' ? tr('completed','Completed') : liveCopy('processingShort'))}</span></div><div class="grid grid--2"><dl class="kv"><dt>${esc(tr('quantity','Quantity'))}</dt><dd>${esc(tk.weightQtl != null ? `${tk.weightQtl} qtl` : '—')}</dd><dt>${esc(tr('quality','Quality'))}</dt><dd>${esc(tk.qualityLabel || tk.qualityGrade || '—')}</dd></dl><dl class="kv"><dt>${esc(tr('amount','Amount'))}</dt><dd>${esc(tk.amount != null ? rupee(tk.amount) : '—')}</dd><dt>${esc(tr('expectedPayment','Expected payment / update'))}</dt><dd>${esc(tk.paymentStatus === 'PAID' ? (tk.paymentRef || 'Credited') : tk.paymentStatus === 'INITIATED' ? 'Payment processing' : 'Awaiting payment initiation')}</dd></dl></div><button class="btn btn--secondary btn--sm mt" data-go="payments">${esc(tr('payments','Payments & receipt'))}</button></div>` : ''}
    <div class="grid grid--3 mt">
      <div class="stat"><p class="stat__n">${DB.bookings.filter((b) => b.farmerId === f.farmerId).length}</p><p class="stat__l">Bookings made</p></div>
      <div class="stat"><p class="stat__n">${DB.tokens.filter((t) => t.farmerId === f.farmerId && t.paymentStatus === 'PAID').length}</p><p class="stat__l">Payments received</p></div>
      <div class="stat"><p class="stat__n">${unread}</p><p class="stat__l">Unread notifications</p></div>
    </div>
    <div class="card mt">
      <h2 class="card__title">Your verification</h2>
      <div class="row mt-sm">${pill('ok', 'Mobile verified')} ${f.kycStatus === 'VERIFIED' ? pill('ok', 'KYC verified') : pill('wait', 'KYC pending')}
      ${f.bankStatus === 'VERIFIED' ? pill('ok', 'Bank verified') : pill('wait', 'Bank pending')} ${pill('ok', 'Registration approved')}</div>
    </div>
  </div>`;
}
function bookingStatusLabel(bk, tk) {
  if (bk.bookingStatus === 'CANCELLED') return 'Cancelled';
  if (tk && tk.status === 'COMPLETED') return 'Completed';
  if (tk && tk.status === 'SERVING') return 'Being served now';
  if (tk && tk.checkInTime) return 'Checked in';
  return 'Slot confirmed';
}

/* ---------- booking flow ---------- */
function viewBooking(f) {
  if (CFG.requireApprovalBeforeBooking && f.registrationStatus !== 'APPROVED') return viewPendingStatus(f);
  const existing = activeBookingOf(f.farmerId);
  if (existing && !S.book.rescheduleOf) {
    return `<div class="pwrap"><h1 class="ptitle">You already have an active booking</h1>
      <p class="plead">The current rules allow ${CFG.maxActiveBookingsPerFarmer} active booking per procurement cycle. Cancel or reschedule the existing one to choose a different slot.</p>
      <div class="card"><dl class="kv">
        <dt>Booking</dt><dd>${esc(existing.bookingId)}</dd><dt>Commodity</dt><dd>${esc(commodityName(existing.commodityId))}</dd>
        <dt>Centre</dt><dd>${esc(centreName(existing.centreId))}</dd><dt>When</dt><dd>${fmtDate(existing.date)}, ${fmtTime(existing.startHour)} – ${fmtTime(existing.endHour)}</dd></dl>
        <div class="row mt"><button class="btn btn--primary btn--sm" data-go="token">View token</button>
        ${CFG.reschedulingAllowed ? '<button class="btn btn--secondary btn--sm" data-act="resched">Reschedule</button>' : ''}
        <button class="btn btn--secondary btn--sm" data-act="cancel-booking">Cancel booking</button></div></div></div>`;
  }
  const b = S.book;
  b.commodityId = 'ONION'; if (b.step < 2) b.step = 2; /* onion-only procurement: commodity step skipped */
  const stepNames = ['Centre', 'Date', 'Slot', 'Confirm'];
  const head = `<h1 class="ptitle">${b.rescheduleOf ? 'Reschedule your slot' : 'Book a procurement slot'}</h1>
    <div class="steps">${stepNames.map((s, i) => `<span class="steps__item ${i + 2 < b.step ? 'is-done' : i + 2 === b.step ? 'is-current' : ''}">${i + 2 < b.step ? '' : (i + 1) + '. '}${esc(s)}</span>`).join('')}</div>`;
  const body = [bookStep1, bookStep2, bookStep3, bookStep4, bookStep5][b.step - 1](f);
  return `<div class="pwrap">${head}${body}</div>`;
}

function bookStep1() {
  return `<div class="card"><h2 class="card__title">Select commodity</h2>
    <p class="muted mt-sm mb">Choose from the listed crops, or select Other and type the crop name. Only open procurement windows can be booked.</p>
    <div class="grid grid--3">${DB.commodities.map((c) => {
      const open = c.status === 'OPEN';
      const centres = DB.centres.filter((ct) => ct.commodities.includes(c.id) && ct.status === 'ACTIVE').length;
      return `<button class="pick${S.book.commodityId === c.id ? ' is-on' : ''}" ${open ? `data-act="book-commodity" data-id="${c.id}"` : 'disabled'}>
        <p class="pick__t">${c.emoji} ${esc(c.name)}</p>
        <p>${open ? pill('ok', 'Procurement open') : pill('off', 'Procurement closed')}</p>
        <p class="muted mt-sm">${open ? `${centres} centre${centres === 1 ? '' : 's'} accepting this commodity · support price ${rupee(c.msp)} per quintal (demo figure)` : 'Window closed. Watch for the next schedule announcement.'}</p>
      </button>`;
    }).join('')}
      <button class="pick${S.book.commodityId === 'OTHER' ? ' is-on' : ''}" data-act="book-other">
        <p class="pick__t">🌿 Other crop</p>
        <p>${pill('ok', 'Enter crop name')}</p>
        <p class="muted mt-sm">Use this when your crop is not listed. The officer can see the entered crop name with the booking.</p>
      </button>
    </div>
    ${S.book.commodityId === 'OTHER' ? `<div class="card mt" style="background:var(--paper-2, #fffdfb)"><label class="field"><span class="field__label">Crop name</span><input id="book-other-crop" maxlength="60" value="${esc(S.book.otherCropName || '')}" placeholder="e.g. Ragi, Onion, Turmeric" autocomplete="off"></label><button class="btn btn--primary" data-act="book-other-confirm">Continue with this crop</button></div>` : ''}
  </div>`;
}

function bookStep2() {
  const cid = S.book.commodityId;
  const centres = DB.centres.filter((c) => c.commodities.includes(cid) && c.status === 'ACTIVE');
  return `<div class="card"><div class="card__head"><h2 class="card__title">Select a procurement centre</h2>
    <span class="muted">🧅 Onion procurement</span></div>
    <div class="grid grid--2">${centres.map((c) => {
      const st = dayStats(c.id, cid, TODAY);
      const con = congestion(c.id, TODAY);
      const open = dateIsOpen(c.id, cid, TODAY);
      return `<button class="pick${S.book.centreId === c.id ? ' is-on' : ''}" data-act="book-centre" data-id="${c.id}">
        <p class="pick__t">${esc(c.name)}</p>
        <p class="muted">${esc(c.address)} · ${c.distanceKm} km away</p>
        <dl class="kv mt-sm" style="font-size:.86rem">
          <dt>Today</dt><dd>${open ? pill('ok', 'Open ' + fmtTime(c.openHour) + ' – ' + fmtTime(c.closeHour)) : pill('off', 'Closed today')}</dd>
          <dt>Slots today</dt><dd>${open ? st.available + ' available of ' + st.capacity : '—'}</dd>
          <dt>Current queue</dt><dd>${con.waiting} farmer${con.waiting === 1 ? '' : 's'} waiting · ${esc(con.level)} congestion</dd>
          <dt>Estimated wait</dt><dd>${etaMinutes(con.waiting, c.id)} minutes</dd>
        </dl></button>`;
    }).join('')}</div></div>`;
}

function bookStep3() {
  const { commodityId: cid, centreId: ctid } = S.book;
  const centre = DB.centres.find((c) => c.id === ctid);
  const sch = scheduleFor(ctid, cid);
  const first = new Date(TODAY + 'T00:00:00');
  const days = [];
  for (let i = -first.getDay(); i < 21; i++) days.push(iso(addDays(first, i)));
  const st = dayStats(ctid, cid, TODAY);
  const con = congestion(ctid, TODAY);
  return `<div class="card"><div class="card__head"><h2 class="card__title">${esc(centre.name)}</h2>
    <button class="btn btn--secondary btn--sm" data-act="book-step" data-step="2">Change centre</button></div>
    <dl class="kv">
      <dt>Address</dt><dd>${esc(centre.address)}</dd>
      <dt>Operating hours</dt><dd>${fmtTime(centre.openHour)} – ${fmtTime(centre.closeHour)}</dd>
      <dt>Procurement days</dt><dd>${esc(centre.days)}</dd>
      <dt>Commodity</dt><dd>${esc(commodityName(cid))}</dd>
      <dt>Today's capacity</dt><dd>${st.capacity} · booked ${st.booked} · remaining ${st.available}</dd>
      <dt>Current queue</dt><dd>${con.waiting} waiting · ${esc(con.level)} congestion</dd>
      <dt>Schedule window</dt><dd>${fmtDate(sch.startDate)} – ${fmtDate(sch.endDate)}</dd>
    </dl>
  </div>
  <div class="card"><h2 class="card__title">Procurement calendar</h2>
    <p class="muted mt-sm mb">Each date shows its status in words as well as a symbol, so colour is never the only signal.</p>
    <div class="cal">${DOW.map((d) => `<span class="cal__dow">${d}</span>`).join('')}
    ${days.map((dt) => {
      const status = dayStatus(ctid, cid, dt);
      const d = new Date(dt + 'T00:00:00');
      const marks = { AVAILABLE: '●', LIMITED: '◐', FULL: '■', CLOSED: '—' };
      const words = { AVAILABLE: 'Available', LIMITED: 'Limited', FULL: 'Full', CLOSED: 'Closed' };
      const disabled = status === 'CLOSED' || status === 'FULL';
      return `<button class="cal__day${S.book.date === dt ? ' is-on' : ''}" ${disabled ? 'disabled' : `data-act="book-date" data-id="${dt}"`}
        aria-label="${fmtLongDate(dt)} — ${words[status]}">
        <span class="cal__n">${d.getDate()}</span><span class="cal__mark" aria-hidden="true">${marks[status]}</span>
        <span class="cal__s">${words[status]}</span></button>`;
    }).join('')}</div>
    <p class="legend"><span>● Available</span><span>◐ Limited</span><span>■ Fully booked</span><span>— Procurement closed</span></p>
  </div>`;
}

function bookStep4() {
  const { commodityId: cid, centreId: ctid, date } = S.book;
  const st = dayStats(ctid, cid, date);
  const open = st.slots.filter((s) => slotStatus(s) !== 'FULL');
  const rec = open.slice().sort((a, b) => (a.bookedCount - b.bookedCount) || (a.startHour - b.startHour))[0];
  return `<div class="card"><div class="card__head"><h2 class="card__title">${fmtLongDate(date)}</h2>
    <button class="btn btn--secondary btn--sm" data-act="book-step" data-step="3">Change date</button></div>
    <dl class="kv"><dt>Centre</dt><dd>${esc(centreName(ctid))}</dd><dt>Commodity</dt><dd>${esc(commodityName(cid))}</dd>
      <dt>Daily capacity</dt><dd>${st.capacity} · booked ${st.booked} · available ${st.available}</dd></dl>
  </div>
  <div class="card"><h2 class="card__title">Choose a time slot</h2>
    <p class="muted mt-sm mb">Recommended based on current availability and expected queue. This is a transparent rule — the slot with the fewest bookings wins — not an AI prediction.</p>
    <div class="grid grid--2">${st.slots.map((s) => {
      const status = slotStatus(s);
      const rem = s.capacity - s.bookedCount;
      const ahead = Math.max(0, s.bookedCount);
      const isRec = rec && s.slotId === rec.slotId;
      return `<button class="pick${S.book.startHour === s.startHour ? ' is-on' : ''}" ${status === 'FULL' ? 'disabled' : `data-act="book-slot" data-id="${s.startHour}"`}>
        ${isRec ? '<span class="pick__rec">★ Recommended</span>' : ''}
        <p class="pick__t">${fmtTime(s.startHour)} – ${fmtTime(s.endHour)}</p>
        <p>${status === 'FULL' ? pill('bad', 'Full') : status === 'LIMITED' ? pill('warn', 'Limited — ' + rem + ' left') : pill('ok', 'Available — ' + rem + ' left')}</p>
        <p class="muted mt-sm">${s.bookedCount} of ${s.capacity} booked · estimated waiting time ${etaMinutes(ahead, ctid)} minutes</p>
      </button>`;
    }).join('')}</div>
    <p class="legend"><span>Capacity per slot is set by the admin (currently ${CFG.slotCapacity})</span><span>Limited means ${CFG.limitedThresholdPct}% or less remaining</span></p>
  </div>`;
}

function bookStep5(f) {
  const b = S.book;
  const slot = getSlots(b.centreId, b.commodityId, b.date).find((s) => s.startHour === b.startHour);
  const ahead = slot ? slot.bookedCount : 0;
  return `<div class="card"><h2 class="card__title">Your selected slot</h2>
    <dl class="kv mt">
      <dt>Farmer</dt><dd>${esc(f.fullName)} · ${esc(f.farmerId)}</dd>
      <dt>Commodity</dt><dd>${esc(commodityName(b.commodityId))}</dd>
      <dt>Centre</dt><dd>${esc(centreName(b.centreId))}</dd>
      <dt>Date</dt><dd>${fmtLongDate(b.date)}</dd>
      <dt>Time</dt><dd>${fmtTime(b.startHour)} – ${fmtTime(b.startHour + CFG.slotDurationMin / 60)}</dd>
      <dt>Current bookings</dt><dd>${ahead} / ${slot ? slot.capacity : CFG.slotCapacity}</dd>
      <dt>Estimated queue</dt><dd>about ${etaMinutes(ahead, b.centreId)} minutes</dd>
    </dl>
    <div class="note mt">${esc(CFG.arrivalAdvice)}</div>
    <p class="muted mt">Estimated waiting time is an estimate based on the current queue. It is not a guarantee.</p>
    <div class="row row--between mt">
      <button class="btn btn--secondary" data-act="book-step" data-step="4">Change slot</button>
      <button class="btn btn--primary" data-act="book-confirm" ${b.submitting ? 'disabled' : ''}>${b.submitting ? 'Confirming your slot…' : 'Confirm slot'}</button>
    </div></div>`;
}

/* ---------- token / journey / payments ---------- */
function viewToken(f) {
  const bk = activeBookingOf(f.farmerId) || DB.bookings.filter((b) => b.farmerId === f.farmerId).slice(-1)[0];
  if (!bk) return `<div class="pwrap"><h1 class="ptitle">No token yet</h1><p class="plead">A main queue token is created the moment a slot booking is confirmed.</p>
    <button class="btn btn--primary" data-go="book">Book a procurement slot</button></div>`;
  const tk = tokenForBooking(bk.bookingId);
  const serving = servingToken(tk.centreId, tk.date);
  const ahead = farmersAhead(tk);
  const eta = etaMinutes(ahead, tk.centreId);
  const statusText = { WAITING: 'Waiting for your slot', IN_QUEUE: 'In the main queue', SERVING: 'At the counter now', COMPLETED: 'Procurement complete', CANCELLED: 'Cancelled', MISSED: 'Slot missed' }[tk.status];
  return `<div class="pwrap" style="max-width:640px">
    <h1 class="ptitle">Your procurement token</h1>
    <div class="card">
      <div class="token">
        <p class="token__meta">Main queue token</p>
        <p class="token__num">${esc(tk.token)}</p>
        <p class="token__meta">${esc(commodityName(tk.commodityId))} procurement</p>
        <p class="token__meta">${esc(centreName(tk.centreId))}</p>
        <p class="token__meta">${fmtDate(tk.date)} · ${fmtTime(tk.startHour)} – ${fmtTime(tk.endHour)}</p>
      </div>
      <dl class="kv mt">
        <dt>Now serving</dt><dd>${serving ? esc(serving.token) : 'Counter idle'}</dd>
        <dt>Farmers ahead</dt><dd>${ahead}</dd>
        <dt>Estimated waiting time</dt><dd>${eta} minutes <span class="muted">(estimate, not a guarantee)</span></dd>
        <dt>Status</dt><dd>${pill(tk.status === 'COMPLETED' ? 'ok' : tk.status === 'MISSED' || tk.status === 'CANCELLED' ? 'bad' : 'wait', statusText)}</dd>
        <dt>Booking ID</dt><dd>${esc(bk.bookingId)}</dd>
        <dt>Procurement ID</dt><dd>${esc(bk.procurementId)}</dd>
        ${tk.qualityToken ? `<dt>Quality token</dt><dd>${esc(tk.qualityToken)} · ${esc(tk.section || '')}</dd>` : ''}
      </dl>
      <div class="note mt">${esc(CFG.arrivalAdvice)}</div>
      <div class="row mt no-print">
        <button class="btn btn--secondary btn--sm" data-go="journey">View procurement journey</button>
        ${bk.bookingStatus === 'CONFIRMED' && CFG.reschedulingAllowed ? '<button class="btn btn--secondary btn--sm" data-act="resched">Reschedule</button>' : ''}
        ${bk.bookingStatus === 'CONFIRMED' ? '<button class="btn btn--secondary btn--sm" data-act="cancel-booking">Cancel booking</button>' : ''}
      </div>
    </div>
    ${bk.history && bk.history.length > 1 ? `<div class="card"><h2 class="card__title">Booking history</h2>
      <ul class="mt-sm">${bk.history.map((h) => `<li class="muted">• ${esc(h.event)}</li>`).join('')}</ul></div>` : ''}
  </div>`;
}

function viewJourney(f) {
  const bk = activeBookingOf(f.farmerId) || DB.bookings.filter((b) => b.farmerId === f.farmerId).slice(-1)[0];
  const tk = bk ? tokenForBooking(bk.bookingId) : null;
  const current = tk ? tk.stage : f.stage;
  const idx = STAGE_INDEX[current] ?? 0;
  const detail = {
    DOCUMENT_VERIFIED: f.farmerId ? `Farmer ID ${f.farmerId}` : '',
    SLOT_BOOKED: bk ? `${fmtDate(bk.date)} · ${fmtTime(bk.startHour)}` : '',
    TOKEN_GENERATED: tk ? `Token ${tk.token}` : '',
    CHECKED_IN: tk && tk.checkInTime ? `at ${tk.checkInTime}` : '',
    QUALITY_ASSESSED: tk && tk.qualityLabel ? tk.qualityLabel : '',
    QUALITY_TOKEN_GENERATED: tk && tk.qualityToken ? tk.qualityToken : '',
    SECTION_ASSIGNED: tk && tk.section ? tk.section : '',
    WEIGHED: tk && tk.weightQtl ? `${tk.weightQtl} quintal` : '',
    PROCUREMENT_COMPLETE: tk && tk.amount ? rupee(tk.amount) : '',
    PAYMENT_COMPLETE: tk && tk.paymentRef ? `UTR ${tk.paymentRef}` : ''
  };
  return `<div class="pwrap" style="max-width:640px">
    <h1 class="ptitle">Procurement journey</h1>
    <p class="plead">Fifteen states, one record. Each step is set by the officer handling that stage, so you always know where you are.</p>
    <div class="card"><ul class="journey">${STAGES.map(([key, label], i) => {
      const done = i < idx, now = i === idx;
      return `<li class="${done ? 'is-done' : now ? 'is-now' : ''}">
        <span class="journey__mark" aria-hidden="true">${done ? '✓' : now ? '●' : '○'}</span>
        <span><span class="journey__t">${esc(stageTitle(key))}</span>
        <span class="journey__s">${esc(label)}${detail[key] ? ' · ' + esc(detail[key]) : ''}${now ? ' — current step' : done ? ' — done' : ' — pending'}</span></span></li>`;
    }).join('')}</ul></div>
  </div>`;
}

function viewPayments(f) {
  const rows = DB.tokens.filter((t) => t.farmerId === f.farmerId && t.weightQtl);
  if (!rows.length) return `<div class="pwrap"><h1 class="ptitle">Payments</h1>
    <p class="plead">The final amount appears here after weighing, and the receipt unlocks once payment is recorded.</p>
    <div class="card"><p class="muted">No completed procurement yet.</p></div></div>`;
  const latest = rows[rows.length - 1];
  return `<div class="pwrap">
    <h1 class="ptitle">Payments & receipt</h1>
    <div class="card" id="receipt">
      <div class="card__head"><h2 class="card__title">Procurement ${esc(latest.procurementId)}</h2>
        ${latest.paymentStatus === 'PAID' ? pill('ok', 'Payment credited') : latest.paymentStatus === 'INITIATED' ? pill('wait', 'Payment pending') : pill('off', 'Not started')}</div>
      <dl class="kv">
        <dt>Farmer</dt><dd>${esc(f.fullName)} · ${esc(f.farmerId)}</dd>
        <dt>Commodity</dt><dd>${esc(commodityName(latest.commodityId))}</dd>
        <dt>Centre</dt><dd>${esc(centreName(latest.centreId))} · ${fmtDate(latest.date)}</dd>
        <dt>Main token</dt><dd>${esc(latest.token)}</dd>
        <dt>Quality token</dt><dd>${esc(latest.qualityToken || '—')} ${latest.qualityLabel ? '· ' + esc(latest.qualityLabel) : ''}</dd>
        ${latest.oq && latest.oq.batchId ? `<dt>Batch ID</dt><dd>${esc(latest.oq.batchId)}</dd><dt>Quality report</dt><dd>${esc(latest.oq.reportId || '--')}${oqReportReady(latest) ? ` <a href="#" data-act="oq-report-view" data-id="${esc(latest.token)}">View</a>` : ''}</dd>` : ''}
        <dt>Net weight</dt><dd>${esc(latest.weightQtl)} quintal</dd>
        <dt>Rate</dt><dd>${rupee(latest.ratePerQtl)} per quintal</dd>
        <dt>Deductions</dt><dd>${rupee(latest.deductions || 0)}</dd>
        <dt>Amount payable</dt><dd style="font-size:1.15rem">${rupee(latest.amount)}</dd>
        <dt>Credited to</dt><dd>${esc(f.bankName)} ${maskAcct(f.accountNumber)}</dd>
        <dt>Payment reference</dt><dd>${esc(latest.paymentRef || 'Not issued yet')}</dd>
        <dt>Receipt number</dt><dd>${esc(latest.receiptNo || 'Issued with payment')}</dd>
      </dl>
      <p class="muted mt">Demo figures only. This is a prototype receipt, not a government payment advice.</p>
    </div>
    <div class="row mt no-print">
      <button class="btn btn--primary btn--sm" data-act="download-receipt" data-id="${esc(latest.token)}" ${latest.paymentStatus === 'PAID' ? '' : 'disabled'}>Download receipt</button>
      <button class="btn btn--secondary btn--sm" data-act="print-receipt" ${latest.paymentStatus === 'PAID' ? '' : 'disabled'}>Print / save</button>
      ${latest.paymentStatus !== 'PAID' ? '<span class="muted">The receipt unlocks once the officer records the payment.</span>' : ''}
    </div>
  </div>`;
}

function viewHistory(f) {
  const rows = DB.bookings.filter((b) => b.farmerId === f.farmerId).slice().reverse();
  return `<div class="pwrap pwrap--wide">
    <h1 class="ptitle">History</h1>
    <p class="plead">Every booking you have made, with its token, outcome and amount.</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Commodity</th><th>Centre</th><th>Booking</th><th>Token</th><th>Quality</th><th>Weight</th><th>Amount</th><th>Status</th></tr></thead><tbody>
      ${rows.length ? rows.map((b) => { const t = tokenForBooking(b.bookingId) || {};
        return `<tr><td>${fmtDate(b.date)}</td><td>${esc(commodityName(b.commodityId))}</td><td>${esc(centreName(b.centreId))}</td>
        <td>${esc(b.bookingId)}</td><td>${esc(t.token || '—')}</td><td>${esc(t.qualityToken || '—')}${oqHistoryBits(t)}</td>
        <td class="num">${t.weightQtl ? t.weightQtl + ' qtl' : '—'}</td><td class="num">${t.amount ? rupee(t.amount) : '—'}</td>
        <td>${b.bookingStatus === 'CANCELLED' ? pill('bad', 'Cancelled') : t.paymentStatus === 'PAID' ? pill('ok', 'Paid') : pill('wait', stageTitle(t.stage || 'SLOT_BOOKED'))}</td></tr>`;
      }).join('') : '<tr><td colspan="9" class="muted">No bookings yet.</td></tr>'}
    </tbody></table></div></div>`;
}

function viewProfile(f) {
  return `<div class="pwrap">
    <h1 class="ptitle">Profile & KYC</h1>
    <p class="plead">Identity and bank numbers are always masked here. Full values are never shown on a dashboard or placed in a page address.</p>
    <div class="card"><div class="card__head"><h2 class="card__title">Farmer profile</h2>${f.farmerId ? pill('ok', 'Registration approved') : pill('wait', 'Awaiting approval')}</div>
      <dl class="kv">
        <dt>Farmer ID</dt><dd>${esc(f.farmerId || 'Issued after approval')}</dd>
        <dt>Name</dt><dd>${esc(f.fullName)}</dd>
        <dt>Mobile</dt><dd>${maskMobile(f.mobile)} ${pill('ok', 'Verified')}</dd>
        <dt>Date of birth</dt><dd>${fmtDate(f.dob || f.dateOfBirth)}</dd>
        <dt>Gender</dt><dd>${esc(f.gender)}</dd>
        <dt>Village</dt><dd>${esc(f.village)}, ${esc(f.subDistrict || '')}, ${esc(f.district)}</dd>
        <dt>Farmer type</dt><dd>${esc(f.farmerType)} · ${esc(f.farmerCategory || 'Not specified')}</dd>
        <dt>Land</dt><dd>${f.totalLandArea ? esc(f.totalLandArea + ' ' + f.landUnit) : 'Not provided'} ${(f.landRecords || []).length ? '· records ' + esc(f.landRecords.join(', ')) : ''}</dd>
        <dt>Identity</dt><dd>${esc(f.identityDocumentType)} ${maskId(f.identityDocumentNumber, f.identityDocumentType)} ${f.kycStatus === 'VERIFIED' ? pill('ok', 'KYC verified') : pill('wait', 'Pending')}</dd>
        <dt>Bank</dt><dd>${esc(f.bankName || '—')} · ${maskAcct(f.accountNumber)} ${f.bankStatus === 'VERIFIED' ? pill('ok', 'Verified') : pill('wait', 'Pending')}</dd>
        <dt>IFSC</dt><dd>${esc(f.ifsc || '—')}</dd>
      </dl>
    </div></div>`;
}

function viewAlerts(f) {
  const list = DB.notifications.filter((n) => n.farmerId === f.farmerId);
  list.forEach((n) => { n.read = true; });
  return `<div class="pwrap"><h1 class="ptitle">Notifications</h1>
    <p class="plead">In-app only in this prototype. SMS, WhatsApp and email would be wired to real gateways in a production build.</p>
    <div class="card">${list.length ? list.map((n) => `<div style="padding:.6rem 0;border-bottom:1px solid var(--line)">
      <p style="font-weight:600">${esc(n.title)}</p><p class="muted">${esc(n.body)} · ${esc(n.at)}</p>${n.reportToken && oqReportReady(findToken(n.reportToken)) ? `<p class="mt-sm"><button class="btn btn--secondary btn--sm" data-act="oq-report-view" data-id="${esc(n.reportToken)}">View Report</button></p>` : ''}</div>`).join('') : '<p class="muted">Nothing yet.</p>'}</div></div>`;
}

function viewHelp() {
  const qa = [
    ['How do I get a Farmer ID?', 'Finish registration and submit it. An officer verifies your identity, bank and documents, and the system generates the Farmer ID on approval. You never type it in yourself.'],
    ['Why can I not book a slot?', 'Booking opens only after your registration is approved and the scheme requirements for your commodity are met. Your registration status page shows what is still pending.'],
    ['What is the difference between my two tokens?', 'The main token, like PUN-1042, is your place in the arrival queue. The quality token, like GREEN-018, is issued after the quality check and decides which section you go to.'],
    ['Can I change my slot?', CFG.reschedulingAllowed ? `Yes. Rescheduling is open until ${CFG.cancellationDeadlineHrs} hours before the slot. The old slot is released and a new token is issued; the old booking is kept in history.` : 'Rescheduling is switched off in the current configuration. Cancel and book again instead.'],
    ['What if I miss my slot?', `After ${CFG.lateToleranceMin} minutes past your slot the booking may be marked as missed. It is not cancelled automatically — check with the centre or book another slot.`],
    ['Is my Aadhaar or account number safe?', 'Both are masked everywhere in the interface, never put in a page address, and never printed to the browser console. This prototype uses fictional numbers only.']
  ];
  return `<div class="pwrap"><h1 class="ptitle">Help</h1>
    <p class="plead">Common questions about registration, booking and payment.</p>
    ${qa.map(([q, a]) => `<div class="card"><h2 class="card__title">${esc(q)}</h2><p class="muted mt-sm">${esc(a)}</p></div>`).join('')}
    <div class="card sahayak-card"><div class="card__head"><div><h2 class="card__title">AnnSaarthi Sahayak</h2><p class="muted mt-sm">Quick answers for booking, tokens, payments and receipts.</p></div><span class="st st--ok">Demo assistant</span></div><div class="chips mt"><button class="chip" data-act="sahayak" data-question="token">Where is my token?</button><button class="chip" data-act="sahayak" data-question="payment">Why is payment pending?</button><button class="chip" data-act="sahayak" data-question="receipt">Where is my receipt?</button></div><div id="sahayak-answer" class="note mt" hidden></div><p class="muted mt-sm">Need human help? Visit the procurement centre help desk.</p></div></div>`;
}

/* ---------- farmer actions ---------- */
function handleFarmerAction(a, el, e) {
  const r = S.reg;
  switch (a) {
    case 'auth-send': {
      e.preventDefault();
      const m = ($('#auth-mobile').value || '').trim();
      if (!validMobile(m)) { S.auth.err = 'mobile'; S.auth.mobile = m; render(); return true; }
      S.auth = { mobile: m, otp: makeOtp(), sent: true, secondsLeft: 30, verified: false, mode: 'login' };
      startResendTimer(); render(); toast('OTP sent to +91 ' + m); return true;
    }
    case 'auth-resend': e.preventDefault(); S.auth.otp = makeOtp(); startResendTimer(); render(); toast('New OTP sent.'); return true;
    case 'auth-change': e.preventDefault(); S.auth = { mobile: S.auth.mobile, otp: null, sent: false, secondsLeft: 0, verified: false, mode: 'login' }; render(); return true;
    case 'auth-verify': {
      e.preventDefault();
      const code = ($('#auth-otp').value || '').trim();
      if (code !== S.auth.otp && code !== '123456') { S.auth.err = 'otp'; render(); return true; }
      clearInterval(S.auth.timer);
      resetFarmerSessionState();
      const f = DB.farmers.find((x) => x.mobile === S.auth.mobile);
      if (f) {
        S.auth.verified = true;
        if (f.farmerId) { S.farmerId = f.farmerId; S.pending = null; S.view = 'dash'; toast('Signed in as ' + f.fullName); }
        else { S.farmerId = null; S.pending = f; toast('Signed in. Your application is still under verification.'); }
        render(); return true;
      }
      S.reg = newReg(S.auth.mobile);
      S.reg.mobileVerified = true; S.reg.data.mobileVerifiedAt = nowTime(); S.reg.step = 2;
      toast('Mobile verified. Let us start your registration.'); render(); return true;
    }
    case 'reg-send-otp': {
      e.preventDefault(); collectStep();
      const m = ($('#reg-mobile').value || '').trim();
      r.data.mobile = m;
      if (!validMobile(m)) { toast('Enter a valid 10-digit mobile number starting with 6 to 9.', true); return true; }
      if (DB.farmers.some((f) => f.mobile === m && f.registrationStatus !== 'REJECTED')) { toast('That number already has an active registration. Sign in instead.', true); return true; }
      r.otp = makeOtp(); r.resendIn = 30; regTimer(); render(); return true;
    }
    case 'reg-resend-otp': e.preventDefault(); r.otp = makeOtp(); r.resendIn = 30; regTimer(); render(); return true;
    case 'reg-verify-otp': {
      e.preventDefault();
      const code = ($('#reg-otp').value || '').trim();
      if (code !== r.otp && code !== '123456') { toast('That code does not match the demo OTP shown above.', true); return true; }
      r.mobileVerified = true; r.data.mobileVerifiedAt = nowTime(); r.otp = null; clearInterval(r.timer);
      toast('Mobile number verified.'); render(); return true;
    }
    case 'reg-change-mobile': e.preventDefault(); r.mobileVerified = false; r.otp = null; render(); return true;
    case 'reg-next': {
      e.preventDefault(); collectStep();
      if (r.step === 1 && !r.mobileVerified) { toast('Verify your mobile number first.', true); return true; }
      if (!validateStep()) { toast('Please complete the highlighted fields before continuing.', true); render(); return true; }
      if (r.step === 5 && !r.data.accountHolderName) r.data.accountHolderName = r.data.nameAsPerId || r.data.fullName;
      r.step++; render(); $('#p-main').scrollTop = 0; return true;
    }
    case 'reg-back': e.preventDefault(); collectStep(); r.errors = {}; r.step = Math.max(1, r.step - 1); render(); return true;
    case 'reg-goto': e.preventDefault(); collectStep(); r.step = Number(el.dataset.step); render(); return true;
    case 'reg-add-land': e.preventDefault(); collectStep(); r.data.landRecords = (r.data.landRecords || ['']).concat(''); render(); return true;
    case 'reg-del-land': e.preventDefault(); collectStep(); r.data.landRecords.splice(Number(el.dataset.i), 1); render(); return true;
    case 'reg-crop': {
      e.preventDefault(); collectStep();
      const c = el.dataset.crop; const list = r.data.mainCrops || [];
      r.data.mainCrops = list.includes(c) ? list.filter((x) => x !== c) : list.concat(c);
      render(); return true;
    }
    case 'reg-ifsc': {
      e.preventDefault(); collectStep();
      const code = (r.data.ifsc || '').toUpperCase();
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(code)) { r.errors.ifsc = 'IFSC is 4 letters, a zero, then 6 characters — e.g. SBIN0001842.'; render(); return true; }
      const hit = IFSC_BANKS[code.slice(0, 4)];
      if (!hit) { r.errors.ifsc = 'That IFSC is not in the demo bank directory. Try SBIN0001842, HDFC0000482 or BARB0PUNE01.'; render(); return true; }
      r.data.bankName = hit[0]; r.data.branchName = hit[1]; r.data.bankState = 'Maharashtra · Pune';
      toast('Bank and branch filled in from the demo IFSC directory.'); render(); return true;
    }
    case 'reg-submit': {
      e.preventDefault(); collectStep();
      const c = S.reg.consents;
      r.errors = {};
      let stepBad = 0;
      for (let s = 2; s <= 7; s++) { const keep = r.step; r.step = s; if (!validateStep()) { stepBad = s; r.step = keep; break; } r.step = keep; }
      if (!c.accuracy || !c.verification || !c.dataUse) r.errors.consent = 'All three confirmations are required before submitting.';
      if (stepBad) r.errors.submit = `Please complete the highlighted fields before submitting. Step ${stepBad} (${REG_STEPS[stepBad - 1]}) still has missing information.`;
      if (stepBad || r.errors.consent) { render(); toast('Please complete the highlighted fields before submitting.', true); return true; }
      submitRegistration(); return true;
    }
    case 'reg-done': {
      e.preventDefault();
      const f = DB.farmers.find((x) => x.mobile === S.reg.data.mobile);
      resetFarmerSessionState();
      S.reg = null; S.pending = f.farmerId ? null : f; S.farmerId = f.farmerId || null; S.view = 'dash';
      render(); return true;
    }
    case 'privacy': {
      e.preventDefault();
      askConfirm('Privacy policy (prototype)', 'Your information is used to register you, verify eligibility, manage procurement and process payment. Identity and bank numbers are masked in the interface, are not placed in page addresses, and are not written to browser logs. This prototype stores fictional demo data in memory only, and clears it when you reload the page.', 'Close', () => {});
      return true;
    }
    case 'resubmit': {
      e.preventDefault();
      const f = S.pending || farmerById(S.farmerId);
      S.pending = null;
      S.reg = newReg(f.mobile); S.reg.mobileVerified = true; S.reg.step = 2;
      Object.assign(S.reg.data, f, { mobile: f.mobile, dateOfBirth: f.dob });
      S.reg.docs = { identity: f.identityDocument, bank: f.bankDocument, land: null };
      S.reg.resubmitOf = f.applicationId; S.farmerId = null;
      render(); return true;
    }
    /* booking */
    case 'book-other': e.preventDefault(); S.book.commodityId = 'OTHER'; S.book.otherCropName = S.book.otherCropName || ''; S.book.centreId = null; S.book.date = null; S.book.startHour = null; S.book.step = 1; render(); return true;
    case 'book-other-confirm': {
      e.preventDefault();
      const input = $('#book-other-crop');
      const name = (input && input.value || '').trim();
      if (!name) { toast('Enter the crop name to continue.', true); if (input) input.focus(); return true; }
      S.book.otherCropName = name;
      const safe = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'CUSTOM';
      const id = `CUSTOM_${safe}`;
      let c = DB.commodities.find((x) => x.id === id);
      if (!c) { c = { id, name, emoji: '🌿', status: 'OPEN', msp: 0, unit: 'quintal', custom: true }; DB.commodities.push(c); }
      let centre = DB.centres.find((x) => x.id === 'C1');
      if (centre && !centre.commodities.includes(id)) centre.commodities.push(id);
      if (centre && !scheduleFor(centre.id, id)) {
        DB.schedules.push({ id: `S-${centre.id}-${id}`, centreId: centre.id, commodityId: id, startDate: iso(addDays(new Date(), -3)), endDate: iso(addDays(new Date(), 21)), dailyCapacity: centre.dailyCapacity, openHour: centre.openHour, closeHour: centre.closeHour, status: 'OPEN' });
      }
      S.book.commodityId = id; S.book.centreId = null; S.book.date = null; S.book.startHour = null; S.book.step = 2; render(); return true;
    }
    case 'book-commodity': e.preventDefault(); S.book.commodityId = el.dataset.id; S.book.otherCropName = ''; S.book.centreId = null; S.book.date = null; S.book.startHour = null; S.book.step = 2; render(); return true;
    case 'book-centre': e.preventDefault(); S.book.centreId = el.dataset.id; S.book.date = null; S.book.startHour = null; S.book.step = 3; render(); return true;
    case 'book-date': e.preventDefault(); S.book.date = el.dataset.id; S.book.startHour = null; S.book.step = 4; render(); return true;
    case 'book-slot': e.preventDefault(); S.book.startHour = Number(el.dataset.id); S.book.step = 5; render(); return true;
    case 'book-step': e.preventDefault(); S.book.step = Number(el.dataset.step); render(); return true;
    case 'book-confirm': e.preventDefault(); confirmBooking(); return true;
    case 'cancel-booking': {
      e.preventDefault();
      askConfirm('Cancel this procurement slot?', 'Are you sure you want to cancel this procurement slot? The slot goes back into the pool and your main token is removed from the queue.', 'Cancel booking', (reason) => cancelBooking(reason), true);
      return true;
    }
    case 'resched': {
      e.preventDefault();
      const f = farmerById(S.farmerId); const bk = activeBookingOf(f.farmerId);
      if (!CFG.reschedulingAllowed) { toast('Rescheduling is switched off in the current configuration.', true); return true; }
      S.book = { commodityId: bk.commodityId, centreId: bk.centreId, date: null, startHour: null, step: 3, rescheduleOf: bk.bookingId };
      S.view = 'book'; render(); return true;
    }
    case 'demo-login': {
      e.preventDefault();
      resetFarmerSessionState();
      S.auth = { mobile: '9822001842', otp: '123456', sent: true, secondsLeft: 0, verified: false, mode: 'login' };
      render();
      toast('Demo farmer loaded. Use OTP 123456.');
      return true;
    }
    case 'sahayak': {
      e.preventDefault();
      const answers = { token: 'Your current token and procurement stage are shown under My token and Procurement journey.', payment: 'Payment status changes after the officer initiates and completes the simulated payment.', receipt: 'After payment is completed, open Payments & receipt and select Download receipt.' };
      const box = $('#sahayak-answer');
      if (box) { box.hidden = false; box.textContent = answers[el.dataset.question] || 'Please visit the procurement centre help desk for assistance.'; }
      return true;
    }
    case 'download-receipt': {
      e.preventDefault();
      const t = findToken(el.dataset.id);
      if (!t || t.paymentStatus !== 'PAID') { toast('Receipt becomes available after payment is completed.', true); return true; }
      const f = farmerById(t.farmerId) || {};
      const text = `ANNSAARTHI DIGITAL PROCUREMENT RECEIPT\n\nReceipt No: ${t.receiptNo || nextReceipt()}\nFarmer: ${f.fullName || t.farmerName}\nFarmer ID: ${f.farmerId || 'DEMO'}\nToken: ${t.token}\nQuality Token: ${t.qualityToken || '—'}\n${t.oq && t.oq.batchId ? `Batch ID: ${t.oq.batchId}\nQuality Report ID: ${t.oq.reportId || '-'}\nGrade A: ${t.oq.result ? t.oq.result.gradeA_percentage + '%' : '-'}  URS: ${t.oq.result ? t.oq.result.urs_percentage + '%' : '-'}\n` : ''}Commodity: ${commodityName(t.commodityId)}\nCentre: ${centreName(t.centreId)}\nNet Weight: ${t.weightQtl} Quintal\nRate: ${rupee(t.ratePerQtl)} / Quintal\nFinal Amount: ${rupee(t.amount)}\nPayment Status: COMPLETED\nPayment Reference: ${t.paymentRef || 'PAY-DEMO'}\n\nPrototype receipt — demo data only.`;
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = `AnnSaarthi_Receipt_${t.token}.txt`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      toast('Receipt downloaded.'); return true;
    }
    case 'refresh-live': {
      e.preventDefault();
      refreshFarmerLiveStatus();
      toast('Live status refreshed.');
      return true;
    }
    case 'lang': {
      e.preventDefault();
      setLanguage(el.dataset.lang || 'en');
      toast(S.uiLang === 'mr' ? 'भाषा: मराठी' : S.uiLang === 'hi' ? 'भाषा: हिंदी' : 'Language: English');
      return true;
    }
    case 'print-receipt': e.preventDefault(); window.print(); return true;
    default: return false;
  }
}
function regTimer() {
  const r = S.reg; clearInterval(r.timer);
  r.timer = setInterval(() => {
    r.resendIn--;
    const onStep1 = S.open && S.role === 'farmer' && S.reg && S.reg.step === 1;
    if (r.resendIn <= 0) {
      clearInterval(r.timer);
      if (onStep1) render();                     // swap countdown for the Resend button
      return;
    }
    const el = $('#reg-countdown');
    if (onStep1 && el) el.textContent = String(r.resendIn) + 's';
    else if (onStep1) render();
  }, 1000);
}

function submitRegistration() {
  const r = S.reg, d = r.data;
  const appId = r.resubmitOf || nextApplicationId();
  let f = DB.farmers.find((x) => x.mobile === d.mobile);
  const payload = {
    applicationId: appId, fullName: d.fullName, nameAsPerId: d.nameAsPerId, relativeName: d.relativeName, relativeType: d.relativeType,
    dob: d.dateOfBirth, dateOfBirth: d.dateOfBirth, gender: d.gender, email: d.email, mobile: d.mobile, mobileVerified: true, mobileVerifiedAt: d.mobileVerifiedAt,
    farmerCategory: d.farmerCategory, farmerType: d.farmerType, state: d.state, district: d.district, subDistrict: d.subDistrict, block: d.block,
    localBody: d.localBody, village: d.village, pinCode: d.pinCode, addressLine: d.addressLine, landStatus: d.landStatus,
    totalLandArea: d.totalLandArea, landUnit: d.landUnit, landRecords: (d.landRecords || []).filter(Boolean), mainCrops: d.mainCrops || [], otherCropName: d.otherCropName || '',
    expectedCommodity: d.expectedCommodity, identityDocumentType: d.identityDocumentType, identityDocumentNumber: d.identityDocumentNumber,
    identityDocument: r.docs.identity, accountHolderName: d.accountHolderName, accountNumber: d.accountNumber, ifsc: d.ifsc,
    bankName: d.bankName, branchName: d.branchName, accountType: d.accountType, bankDocument: r.docs.bank, landDocument: r.docs.land,
    registrationStatus: 'SUBMITTED', kycStatus: 'PENDING', bankStatus: 'PENDING', stage: 'REGISTERED', submittedAt: TODAY, farmerId: null
  };
  if (f) Object.assign(f, payload); else { f = payload; DB.farmers.push(f); }
  const existingApp = DB.applications.find((a) => a.applicationId === appId);
  if (existingApp) Object.assign(existingApp, { status: 'SUBMITTED', submittedAt: TODAY, reason: null });
  else DB.applications.push({ applicationId: appId, mobile: d.mobile, status: 'SUBMITTED', submittedAt: TODAY, checks: {} });
  d.applicationId = appId;
  r.step = 9;
  logEvent(`Application ${appId} submitted by ${d.fullName}`);
  render();
}

function confirmBooking() {
  const f = farmerById(S.farmerId); const b = S.book;
  if (S.book.submitting) return;
  const fail = (msg) => { toast(msg, true); };
  if (CFG.requireApprovalBeforeBooking && f.registrationStatus !== 'APPROVED') return fail('Booking needs an approved registration.');
  const commodity = DB.commodities.find((c) => c.id === b.commodityId);
  if (!commodity || commodity.status !== 'OPEN') return fail('Procurement for this commodity is closed.');
  const centre = DB.centres.find((c) => c.id === b.centreId);
  if (!centre || centre.status !== 'ACTIVE') return fail('That centre is not operating right now.');
  if (!dateIsOpen(b.centreId, b.commodityId, b.date)) return fail('That date is no longer open for procurement.');
  const slot = getSlots(b.centreId, b.commodityId, b.date).find((s) => s.startHour === b.startHour);
  if (!slot) return fail('That slot no longer exists. Pick another one.');
  if (slotStatus(slot) === 'FULL') { render(); return fail('That slot filled up. Choose another time.'); }
  const active = DB.bookings.filter((x) => x.farmerId === f.farmerId && ['CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'].includes(x.bookingStatus) && x.bookingId !== b.rescheduleOf);
  if (active.length >= CFG.maxActiveBookingsPerFarmer) return fail('You already have an active booking for this procurement cycle.');

  S.book.submitting = true; render();
  setTimeout(() => {
    if (b.rescheduleOf) {
      const old = DB.bookings.find((x) => x.bookingId === b.rescheduleOf);
      const oldSlot = getSlots(old.centreId, old.commodityId, old.date).find((s) => s.startHour === old.startHour);
      if (oldSlot) oldSlot.bookedCount = Math.max(0, oldSlot.bookedCount - 1);
      old.bookingStatus = 'RESCHEDULED'; old.rescheduledAt = new Date().toISOString();
      old.history.push({ at: new Date().toISOString(), event: `Rescheduled away from ${fmtDate(old.date)} ${fmtTime(old.startHour)}` });
      const oldTok = tokenForBooking(old.bookingId); if (oldTok) oldTok.status = 'CANCELLED';
    }
    const booking = createBookingRecord(f, b.commodityId, b.centreId, b.date, b.startHour, {});
    if (b.rescheduleOf) booking.history.push({ at: new Date().toISOString(), event: `Rescheduled from booking ${b.rescheduleOf}` });
    const tk = tokenForBooking(booking.bookingId);
    logEvent(`${f.fullName} booked ${fmtDate(b.date)} ${fmtTime(b.startHour)} — token ${tk.token}`);
    S.book = { commodityId: 'ONION', centreId: null, date: null, startHour: null, step: 2, submitting: false, otherCropName: '' };
    S.view = 'token';
    toast(`Slot confirmed · token ${tk.token}`);
    render();
  }, 700);
}

function cancelBooking(reason) {
  const f = farmerById(S.farmerId);
  const bk = activeBookingOf(f.farmerId);
  if (!bk) return;
  const slot = getSlots(bk.centreId, bk.commodityId, bk.date).find((s) => s.startHour === bk.startHour);
  if (slot) slot.bookedCount = Math.max(0, slot.bookedCount - 1);
  bk.bookingStatus = 'CANCELLED'; bk.cancelledAt = new Date().toISOString(); bk.cancellationReason = reason || 'Not stated';
  bk.history.push({ at: new Date().toISOString(), event: 'Cancelled by the farmer — ' + (reason || 'no reason given') });
  const tk = tokenForBooking(bk.bookingId); if (tk) tk.status = 'CANCELLED';
  f.stage = 'DOCUMENT_VERIFIED';
  notify(f.farmerId, 'Your booking has been cancelled.', `${bk.bookingId} · slot released back to the centre.`);
  logEvent(`${f.fullName} cancelled booking ${bk.bookingId}`);
  toast('Booking cancelled and the slot released.');
  S.view = 'dash'; render();
}

/* file inputs */
document.addEventListener('change', (e) => {
  const up = e.target.closest('[data-upload]');
  if (up && S.reg) {
    const file = up.files && up.files[0];
    if (!file) return;
    collectStep();
    if (file.size > 5 * 1024 * 1024) { toast('That file is larger than 5 MB. Upload a smaller scan.', true); return; }
    S.reg.docs[up.dataset.upload] = file.name;
    toast('Document uploaded: ' + file.name);
    render(); return;
  }
  const cons = e.target.closest('[data-consent]');
  if (cons && S.reg) { S.reg.consents[cons.dataset.consent] = cons.checked; return; }
  if (e.target.id === 'state' && S.reg) { S.reg.data.state = e.target.value; S.reg.data.district = ''; S.reg.data.subDistrict = ''; S.reg.data.village = ''; collectStep(); S.reg.data.state = e.target.value; render(); return; }
  if (e.target.id === 'district' && S.reg) { collectStep(); S.reg.data.subDistrict = ''; S.reg.data.village = ''; render(); return; }
  if (e.target.id === 'subDistrict' && S.reg) { collectStep(); S.reg.data.village = ''; render(); return; }
  if (e.target.id === 'dateOfBirth' && S.reg) { collectStep(); return; }
  if (e.target.id === 'identityDocumentType' && S.reg) { collectStep(); return; }
  if (e.target.id === 'totalLandArea' && S.reg) { collectStep(); return; }
});

/* ===================== OFFICER + ADMIN INTERFACES ===================== */

const GRADES = [
  { key: 'GREEN', label: 'Grade A — Fair Average Quality', section: 'Section A', note: 'Accepted at full support price.' },
  { key: 'AMBER', label: 'Grade B — Minor deviation', section: 'Section B', note: 'Accepted with a deduction after re-check.' },
  { key: 'RED', label: 'Grade C — Below specification', section: 'Section C', note: 'Sent for re-cleaning or rejection review.' }
];
const gradeOf = (k) => GRADES.find((g) => g.key === k) || GRADES[0];

function setStage(tk, stage, msg) {
  tk.stage = stage;
  const f = farmerById(tk.farmerId);
  if (f) f.stage = stage;
  if (msg && f) notify(f.farmerId, msg, `${stageTitle(stage)} · token ${tk.token}`);
}
const todayTokens = () => DB.tokens.filter((t) => t.centreId === S.officer.centreId && t.date === TODAY && t.status !== 'CANCELLED');

function centreSelect() {
  return `<label class="field" style="max-width:340px">
    <span class="field__label">Procurement centre</span>
    <select id="officer-centre">${DB.centres.map((c) => `<option value="${c.id}"${c.id === S.officer.centreId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
  </label>`;
}
function stageBadge(tk) {
  if (tk.status === 'MISSED') return pill('bad', 'Missed slot');
  if (tk.stage === 'PAYMENT_COMPLETE') return pill('ok', 'Paid');
  if (tk.stage === 'TOKEN_GENERATED') return pill('wait', 'Not checked in');
  return pill(tk.status === 'SERVING' ? 'warn' : 'wait', stageTitle(tk.stage));
}

/* ---------- officer views ---------- */
function officerViews() {
  switch (S.view) {
    case 'checkin': return officerCheckin();
    case 'quality': return officerQuality();
    case 'sections': return officerSections();
    case 'weighing': return officerWeighing();
    case 'pay': return officerPay();
    case 'applications': return applicationsView('officer');
    case 'appdetail': return applicationDetail('officer');
    default: return officerToday();
  }
}

function officerToday() {
  const list = todayTokens().sort((a, b) => a.seq - b.seq);
  const con = congestion(S.officer.centreId, TODAY);
  const centre = DB.centres.find((c) => c.id === S.officer.centreId);
  const st = dayStats(S.officer.centreId, 'ONION', TODAY);
  const counts = {
    checkedIn: list.filter((t) => t.checkInTime).length,
    waiting: list.filter((t) => t.status === 'IN_QUEUE').length,
    quality: list.filter((t) => ['QUALITY_PENDING', 'QUALITY_ASSESSED'].includes(t.stage)).length,
    weighing: list.filter((t) => ['SECTION_ASSIGNED', 'WEIGHING_PENDING'].includes(t.stage)).length,
    done: list.filter((t) => ['PROCUREMENT_COMPLETE', 'PAYMENT_PENDING', 'PAYMENT_COMPLETE'].includes(t.stage)).length
  };
  return `<div class="pwrap pwrap--wide">
    <h1 class="ptitle">Today at ${esc(centre.name)}</h1>
    <p class="plead">${fmtLongDate(TODAY)} · ${fmtTime(centre.openHour)} – ${fmtTime(centre.closeHour)} · ${CFG.activeCounters} counters open</p>
    ${centreSelect()}
    <div class="grid grid--4">
      <div class="stat"><p class="stat__n">${list.length}</p><p class="stat__l">Booked today</p></div>
      <div class="stat"><p class="stat__n">${counts.checkedIn}</p><p class="stat__l">Checked in</p></div>
      <div class="stat"><p class="stat__n">${counts.waiting}</p><p class="stat__l">Waiting in queue</p></div>
      <div class="stat"><p class="stat__n">${counts.quality}</p><p class="stat__l">At quality check</p></div>
      <div class="stat"><p class="stat__n">${counts.weighing}</p><p class="stat__l">At weighing</p></div>
      <div class="stat"><p class="stat__n">${counts.done}</p><p class="stat__l">Completed</p></div>
    </div>
    <p class="mt">${pill(con.level === 'LOW' ? 'ok' : con.level === 'MODERATE' ? 'wait' : 'warn', con.level + ' congestion')} <span class="muted">${con.waiting} farmers waiting · capacity ${st.capacity}, booked ${st.booked}</span></p>
    ${oqOfficerCards(list)}
    <div class="live-panel card mt"><div class="card__head"><div><h2 class="card__title">Live procurement status</h2><p class="muted">Updates automatically as officers move each farmer through the workflow.</p></div><span class="live-dot">LIVE</span></div><div class="live-steps">${[['checkedIn','Checked in'],['quality','Quality check'],['weighing','Weighing'],['done','Completed']].map(([k,l])=>`<div class="live-step"><strong>${counts[k] || 0}</strong><span>${l}</span></div>`).join('')}</div><p class="muted mt-sm">Last refreshed: ${new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</p></div>
    <div class="card mt"><div class="card__head"><h2 class="card__title">Today's bookings</h2><span class="muted">Sorted by token</span></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Token</th><th>Farmer</th><th>Village</th><th>Slot</th><th>Check-in</th><th>Stage</th><th>Action</th></tr></thead><tbody>
      ${list.length ? list.map((t) => { const f = farmerById(t.farmerId) || {};
        return `<tr><td><strong>${esc(t.token)}</strong></td><td>${esc(t.farmerName)}<br><span class="muted">${esc(t.farmerId)}</span></td>
        <td>${esc(f.village || '—')}</td><td>${fmtTime(t.startHour)}</td>
        <td>${t.checkInTime ? pill('ok', t.checkInTime) : pill('off', 'Not arrived')}</td><td>${stageBadge(t)}</td>
        <td>${t.checkInTime ? `<button class="btn btn--secondary btn--sm" data-act="open-token" data-id="${esc(t.token)}">Open</button>`
          : `<button class="btn btn--primary btn--sm" data-act="checkin" data-id="${esc(t.token)}">Check in</button>`}</td></tr>`;
      }).join('') : '<tr><td colspan="7" class="muted">No bookings for this centre today.</td></tr>'}
      </tbody></table></div>
    </div>
  </div>`;
}

function officerCheckin() {
  const list = todayTokens().filter((t) => !t.checkInTime).sort((a, b) => a.seq - b.seq);
  const verified = todayTokens().filter((t) => t.checkInTime && STAGE_INDEX[t.stage] < STAGE_INDEX.QUALITY_PENDING);
  return `<div class="pwrap pwrap--wide">
    <h1 class="ptitle">Check-in & verification</h1>
    <p class="plead">Confirm the farmer's booked token and identity at arrival before sending the farmer to quality assessment.</p>
    <div class="checkin-flow card mt"><div class="checkin-step is-active"><span>1</span><strong>Token</strong><small>Confirm booking</small></div><div class="checkin-line"></div><div class="checkin-step"><span>2</span><strong>Identity</strong><small>Verify farmer</small></div><div class="checkin-line"></div><div class="checkin-step"><span>3</span><strong>Quality</strong><small>Send for assessment</small></div></div>
    ${centreSelect()}
    <div class="card">
      <h2 class="card__title">Scan or enter a token</h2>
      <div class="row mt" style="align-items:flex-end">
        <div style="flex:1;min-width:200px"><label class="field" style="margin:0"><span class="field__label">Token number</span>
          <input id="scan-token" type="text" placeholder="e.g. PUN-1042 or farmer mobile number" autocomplete="off"></label></div>
        <button class="btn btn--secondary" data-act="lookup-token">View farmer details</button>
        <button class="btn btn--primary" data-act="scan">Check in this token</button>
      </div>
    </div>
    ${S.officer.lookupToken ? (() => { const t = findToken(S.officer.lookupToken), f = t ? farmerById(t.farmerId) : null; return t && f ? `<div class="card note--info"><div class="card__head"><h2 class="card__title">Booking details · ${esc(t.token)}</h2><button class="btn btn--secondary btn--sm" data-act="clear-lookup">Close</button></div><div class="grid grid--2"><dl class="kv"><dt>Farmer</dt><dd>${esc(f.fullName)}</dd><dt>Farmer ID</dt><dd>${esc(f.farmerId)}</dd><dt>Mobile</dt><dd>${esc(f.mobile)}</dd><dt>Village</dt><dd>${esc(f.village || '—')}</dd></dl><dl class="kv"><dt>Booking</dt><dd>${esc(t.bookingId)}</dd><dt>Crop</dt><dd>${esc(commodityName(t.commodityId))}</dd><dt>Slot</dt><dd>${fmtTime(t.startHour)} – ${fmtTime(t.endHour)}</dd><dt>Status</dt><dd>${esc(stageTitle(t.stage))}</dd></dl></div></div>` : `<div class="card note note--bad">No booking found for token ${esc(S.officer.lookupToken)}.</div>`; })() : ''}
    <div class="card"><h2 class="card__title">Expected arrivals (${list.length})</h2>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Token</th><th>Farmer</th><th>Slot</th><th>Identity</th><th>Action</th></tr></thead><tbody>
      ${list.length ? list.map((t) => { const f = farmerById(t.farmerId) || {};
        const late = t.endHour + CFG.lateToleranceMin / 60 < new Date().getHours();
        return `<tr><td><strong>${esc(t.token)}</strong></td><td>${esc(t.farmerName)}</td><td>${fmtTime(t.startHour)} – ${fmtTime(t.endHour)}${late ? ' <span class="muted">(past tolerance)</span>' : ''}</td>
        <td>${esc(f.identityDocumentType || 'Aadhaar')} ${maskId(f.identityDocumentNumber, f.identityDocumentType)}</td>
        <td><div class="row"><button class="btn btn--primary btn--sm" data-act="checkin" data-id="${esc(t.token)}">Check in</button>
        <button class="btn btn--secondary btn--sm" data-act="mark-missed" data-id="${esc(t.token)}">Mark missed</button></div></td></tr>`;
      }).join('') : '<tr><td colspan="5" class="muted">Everyone booked for today has arrived.</td></tr>'}
      </tbody></table></div></div>
    <div class="card"><h2 class="card__title">Checked in — pending gate verification (${verified.length})</h2>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Token</th><th>Farmer</th><th>Checked in</th><th>Stage</th><th>Action</th></tr></thead><tbody>
      ${verified.length ? verified.map((t) => `<tr><td><strong>${esc(t.token)}</strong></td><td>${esc(t.farmerName)}</td><td>${esc(t.checkInTime)}</td><td>${stageBadge(t)}</td>
        <td>${t.stage === 'CHECKED_IN' ? `<button class="btn btn--primary btn--sm" data-act="verify-gate" data-id="${esc(t.token)}">Mark verified</button>`
          : `<button class="btn btn--secondary btn--sm" data-act="send-quality" data-id="${esc(t.token)}">Send to quality</button>`}</td></tr>`).join('')
        : '<tr><td colspan="5" class="muted">Nothing waiting at the gate.</td></tr>'}
      </tbody></table></div></div>
  </div>`;
}

/* ===== ONION QUALITY ASSESSMENT =====
   Flow: images -> assessOnionImages() -> result object -> results UI -> digital report.
   assessOnionImages() is the single FUTURE AI INTEGRATION POINT. */
const OQ_MAX_IMAGES = 6;
const OQ_ROUTING = [[70, 'GREEN'], [50, 'AMBER'], [0, 'RED']]; /* demo only: Grade A % -> existing section routing */
const oqRouteFor = (gradeA) => (OQ_ROUTING.find(([min]) => gradeA >= min) || OQ_ROUTING[2])[1];
function oqOf(t) {
  if (!t.oq) { DB.seq.batch = (DB.seq.batch || 0) + 1; t.oq = { token: t.token, batchId: `BATCH-${TODAY.replace(/-/g, '')}-${pad(DB.seq.batch, 3)}`, images: [], gps: null, capturedAt: null, status: 'BATCH_PENDING', result: null, reportId: null }; }
  return t.oq;
}
/* FUTURE AI INTEGRATION POINT — replace the body with the real image-processing call (model or API).
   Input : array of captured images [{id, name, data(dataURL)}], context {batchId}
   Output: { gradeA_percentage, urs_percentage, damaged, rotten, sprouted, undersized, analyzed_images }
   Current implementation returns DEMO values only; they are NOT real measurements. */
function completeQualityStage(t, gradeKey, label) {
  const g = gradeOf(gradeKey);
  t.qualityGrade = g.key; t.qualityLabel = label || g.label;
  setStage(t, 'QUALITY_ASSESSED');
  t.qualityToken = nextQualityToken(g.key);
  setStage(t, 'QUALITY_TOKEN_GENERATED');
  t.section = g.section;
  setStage(t, 'SECTION_ASSIGNED', `Quality token ${t.qualityToken} issued.`);
  S.officer.selectedToken = null;
  logEvent(`${t.token} onion quality recorded — quality token ${t.qualityToken}, ${g.section}`);
  return g;
}
function oqCaptureGps(tok) {
  const t = findToken(tok); if (!t) return; const o = oqOf(t);
  const done = (g) => { o.gps = Object.assign(g, { at: new Date().toISOString() }); render(); };
  const fallback = () => done({ lat: 18.4796, lng: 73.8715, accuracy: null, source: 'demo' });
  if (!navigator.geolocation) return fallback();
  navigator.geolocation.getCurrentPosition((p) => done({ lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5), accuracy: Math.round(p.coords.accuracy), source: 'device' }), fallback, { timeout: 6000, maximumAge: 60000 });
}
function oqAddFiles(tok, files) {
  const t = findToken(tok); if (!t) return; const o = oqOf(t);
  const room = OQ_MAX_IMAGES - o.images.length;
  const list = Array.from(files).filter((f) => /^image\//.test(f.type)).slice(0, Math.max(room, 0));
  if (files.length > list.length) toast(`Up to ${OQ_MAX_IMAGES} images per batch.`, true);
  let pending = list.length; if (!pending) return;
  const finish = () => { if (--pending === 0) { if (!o.gps) oqCaptureGps(tok); else render(); } };
  list.forEach((file) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const sc = Math.min(1, 640 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        o.imgSeq = (o.imgSeq || 0) + 1;
        o.images.push({ id: `IMG-${o.imgSeq}`, name: file.name, data: c.toDataURL('image/jpeg', 0.6), at: new Date().toISOString() });
        if (!o.capturedAt) o.capturedAt = new Date().toISOString();
        finish();
      };
      img.onerror = finish; img.src = r.result;
    };
    r.onerror = finish; r.readAsDataURL(file);
  });
}
const fmtDateTime = (iso) => { try { return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return '—'; } };

/* ===== DIGITAL QUALITY REPORT =====
   Built automatically from o.result (the output of assessOnionImages()). Nothing is typed in by hand, so a real
   AI result can replace the demo result without any change to the report, farmer view or dashboards. */
const OQ_REPORT_STATUS = { ASSESSED: 'Generated - awaiting officer confirmation', RECORDED: 'Assessment recorded', FLAGGED: 'Flagged for manual review' };
const OQ_REPORT_CSS = `.oqr{font-size:.92rem;line-height:1.45;color:#292522}
.oqr h2{margin:.1rem 0;font-size:1.35rem;color:#064E3B}
.oqr h3{margin:1.1rem 0 .45rem;font-size:1rem;color:#075E45;border-bottom:1px solid #DCEDE5;padding-bottom:.25rem}
.oqr p{margin:.3rem 0}
.oqr-head{display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;align-items:flex-start;border-bottom:3px solid #075E45;padding-bottom:.7rem}
.oqr-eyebrow{margin:0;font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;font-weight:800;color:#087F5B}
.oqr-id{text-align:right}.oqr-id small{display:block;color:#5A514D}.oqr-id strong{font-size:1.05rem}
.oqr-note{background:#EFF7F3;border:1px solid #B9D8C9;border-radius:8px;padding:.5rem .7rem;margin:.7rem 0}
.oqr-status{margin:.4rem 0;font-weight:600}
.oqr-t{width:100%;border-collapse:collapse}.oqr-t th,.oqr-t td{text-align:left;padding:.35rem .5rem;border-bottom:1px solid #eee;vertical-align:top}.oqr-t th{width:38%;color:#5A514D;font-weight:600}
.oqr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:.6rem}
.oqr-box{border:1px solid #B9D8C9;border-radius:8px;padding:.6rem .7rem;background:#fff}.oqr-box small{display:block;color:#5A514D}.oqr-box b{font-size:1.5rem}
.oqr-bar{height:8px;border-radius:99px;background:#e6e6e6;overflow:hidden;margin-top:.3rem}.oqr-bar i{display:block;height:100%;background:#087F5B}.oqr-bar.is-urs i{background:#d99a2b}
.oqr-photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:.5rem}.oqr-photos img{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:6px;border:1px solid #ddd}
.oqr-foot{margin-top:1rem;color:#5A514D;font-size:.8rem}
.modal__box--report{max-width:860px}`;
document.head.insertAdjacentHTML('beforeend', `<style id="oqr-css">${OQ_REPORT_CSS}</style>`);

const oqReportReady = (t) => !!(t && t.oq && t.oq.result && ['ASSESSED', 'RECORDED', 'FLAGGED'].includes(t.oq.status));
/* Officers can open the report as soon as it is generated; a farmer only sees their own, once the officer has recorded it. */
function oqReportAllowed(t) {
  if (!oqReportReady(t)) return false;
  if (S.role === 'farmer') return t.farmerId === S.farmerId;   /* same report, available the moment it is generated */
  return true;
}
function oqReportData(t) {
  const o = t.oq, c = DB.centres.find((x) => x.id === t.centreId) || {};
  return { reportId: o.reportId, farmerName: t.farmerName, farmerId: t.farmerId, batchId: o.batchId, centre: c.name || '--',
    generatedAt: o.assessedAt, capturedAt: o.capturedAt, gps: o.gps, images: o.images || [], r: o.result, status: o.status,
    statusLabel: OQ_REPORT_STATUS[o.status] || o.status, flagReason: o.flagReason, qualityToken: t.qualityToken, section: t.section, token: t.token };
}
function oqReportMarkup(d) {
  const r = d.r, tot = r.total_assessed || 1, row = (k, v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
  const defects = [['Damaged', r.damaged], ['Rotten', r.rotten], ['Sprouted', r.sprouted], ['Undersized', r.undersized]];
  const gps = d.gps ? `${esc(d.gps.lat)}, ${esc(d.gps.lng)}${d.gps.source === 'demo' ? ' (demo location)' : ''}` : 'Not captured';
  return `<div class="oqr">
    <div class="oqr-head"><div><p class="oqr-eyebrow">AnnSaarthi</p><h2>Digital Quality Report</h2><p>Onion Quality Assessment</p></div>
      <div class="oqr-id"><small>Report ID</small><strong>${esc(d.reportId)}</strong></div></div>
    <p class="oqr-note">Generated automatically from the image-based assessment of the captured onion photographs.${r.isDemo ? ' Demo values for the prototype - not a validated measurement.' : ''}</p>
    <p class="oqr-status">Assessment status: ${esc(d.statusLabel)}${d.flagReason ? ' - ' + esc(d.flagReason) : ''}</p>
    <table class="oqr-t"><tbody>
      ${row('Farmer', esc(d.farmerName))}${row('Farmer ID', esc(d.farmerId))}${row('Batch / Lot ID', esc(d.batchId))}
      ${row('Procurement centre', esc(d.centre))}
      ${row('Report generated', d.generatedAt ? esc(fmtDateTime(d.generatedAt)) : '--')}${row('Images captured', esc(d.images.length) + (d.capturedAt ? ' &middot; ' + esc(fmtDateTime(d.capturedAt)) : ''))}
      ${row('GPS location', gps)}${row('Onions assessed', esc(tot) + ' across ' + esc(r.analyzed_images) + ' image' + (r.analyzed_images === 1 ? '' : 's'))}
      ${d.qualityToken ? row('Quality token', esc(d.qualityToken) + (d.section ? ' &middot; ' + esc(d.section) : '')) : ''}
    </tbody></table>
    <h3>Grade summary</h3>
    <div class="oqr-grid">
      <div class="oqr-box"><small>Grade A</small><b>${esc(r.gradeA_percentage)}%</b><div class="oqr-bar"><i style="width:${esc(r.gradeA_percentage)}%"></i></div></div>
      <div class="oqr-box"><small>URS</small><b>${esc(r.urs_percentage)}%</b><div class="oqr-bar is-urs"><i style="width:${esc(r.urs_percentage)}%"></i></div></div>
    </div>
    <h3>Defect findings</h3>
    <div class="oqr-grid">${defects.map(([k, v]) => `<div class="oqr-box"><small>${k}</small><b>${esc(v)}</b><small>${Math.round(v / tot * 100)}% of onions</small></div>`).join('')}</div>
    <h3>Produce photographs (${d.images.length})</h3>
    <div class="oqr-photos">${d.images.map((im) => `<img src="${im.data}" alt="Onion batch photograph">`).join('') || '<p>No photographs attached.</p>'}</div>
    <h3>Overall assessment</h3>
    <p>${esc(r.gradeA_percentage)}% of the assessed onions were classified Grade A and ${esc(r.urs_percentage)}% URS. Findings: ${esc(r.damaged)} damaged, ${esc(r.rotten)} rotten, ${esc(r.sprouted)} sprouted and ${esc(r.undersized)} undersized out of ${esc(tot)} onions.</p>
    <p class="oqr-foot">The grade is generated from the assessment and is not entered manually. Manual review is used only as an exception for unclear images or unusual cases.</p>
  </div>`;
}
const oqReportDocument = (d) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Digital Quality Report ${esc(d.reportId)}</title><style>body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;margin:0;padding:1.2rem;background:#EFF7F3}.oqr{max-width:820px;margin:0 auto;background:#fff;padding:1.4rem;border-radius:12px}@media print{body{background:#fff;padding:0}}${OQ_REPORT_CSS}</style></head><body>${oqReportMarkup(d)}</body></html>`;
function oqShowReport(tok) {
  const t = findToken(tok);
  if (!oqReportAllowed(t)) { toast('The quality report is available once the assessment is complete.', true); return; }
  const m = $('#p-modal');
  m.innerHTML = `<div class="modal__box modal__box--report" role="dialog" aria-modal="true" aria-label="Digital Quality Report">
    <div class="row row--end no-print" style="margin-bottom:.7rem"><button class="btn btn--primary btn--sm" data-act="oq-report-download" data-id="${esc(tok)}">Download Report</button>
      <button class="btn btn--secondary btn--sm" data-act="oq-report-print" data-id="${esc(tok)}">Print / Save as PDF</button>
      <button class="btn btn--secondary btn--sm" data-act="modal-close">Close</button></div>
    ${oqReportMarkup(oqReportData(t))}</div>`;
  m.hidden = false;
  S.oqReport = { tok, role: S.role, view: S.view };   /* remembered so the report survives a re-render (language change, live refresh) */
}
function oqRestoreReport() {
  const r = S.oqReport; if (!r) return;
  if (!S.open || r.role !== S.role || r.view !== S.view || !oqReportAllowed(findToken(r.tok))) { S.oqReport = null; return; }
  oqShowReport(r.tok);
}
function oqDownloadReport(tok) {
  const t = findToken(tok);
  if (!oqReportAllowed(t)) { toast('The quality report is available once the assessment is complete.', true); return; }
  const d = oqReportData(t), url = URL.createObjectURL(new Blob([oqReportDocument(d)], { type: 'text/html;charset=utf-8' })), a = document.createElement('a');
  a.href = url; a.download = `AnnSaarthi_QualityReport_${d.reportId}.html`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  toast('Quality report downloaded.');
}
function oqPrintReport(tok) {
  const t = findToken(tok);
  if (!oqReportAllowed(t)) return;
  const w = window.open('', '_blank');
  if (!w) { toast('Allow pop-ups to print, or use Download Report.', true); return; }
  w.document.write(oqReportDocument(oqReportData(t))); w.document.close(); w.focus(); setTimeout(() => w.print(), 400);
}
/* Shared by farmer and officer screens (report buttons) plus the officer's "open this batch" shortcut. */
function handleOqReportAction(a, el, e) {
  switch (a) {
    case 'oq-report-view': e.preventDefault(); oqShowReport(el.dataset.id); return true;
    case 'oq-report-download': e.preventDefault(); oqDownloadReport(el.dataset.id); return true;
    case 'oq-report-print': e.preventDefault(); oqPrintReport(el.dataset.id); return true;
    case 'oq-open': e.preventDefault(); S.officer.selectedToken = el.dataset.id; S.view = 'quality'; render(); return true;
    default: return false;
  }
}
const oqReportButtons = (tok) => `<button class="btn btn--primary btn--sm" data-act="oq-report-view" data-id="${esc(tok)}">View Report</button> <button class="btn btn--secondary btn--sm" data-act="oq-report-download" data-id="${esc(tok)}">Download Report</button>`;

/* ----- farmer side: assessment status, Grade A / URS, main findings, report ----- */
const oqTkFor = (f, tk) => (tk && tk.oq) ? tk : (DB.tokens.filter((x) => x.farmerId === f.farmerId && x.oq && x.oq.result).slice(-1)[0] || tk);
function oqFarmerCard(tk) {
  if (!tk) return '';
  const o = tk.oq || null, qi = STAGE_INDEX.QUALITY_PENDING, si = STAGE_INDEX[tk.stage] ?? 0;
  if (!o && si > qi) return '';   /* older record that never went through the onion assessment */
  let status, body = '';
  if (o && o.result && ['ASSESSED', 'RECORDED', 'FLAGGED'].includes(o.status)) {
    const r = o.result, tot = r.total_assessed || 1;
    status = o.status === 'RECORDED' ? pill('ok', 'Assessment recorded') : o.status === 'FLAGGED' ? pill('bad', 'Flagged for manual review') : pill('ok', 'Report generated');
    body = `<dl class="kv"><dt>Batch ID</dt><dd>${esc(o.batchId)}</dd><dt>Report ID</dt><dd>${esc(o.reportId)}</dd></dl>
      <div class="grid grid--2 mt">
        <div class="oq-defect"><small class="muted">Grade A</small><span class="oq-big">${esc(r.gradeA_percentage)}%</span><div class="oq-bar"><i style="width:${esc(r.gradeA_percentage)}%"></i></div></div>
        <div class="oq-defect"><small class="muted">URS</small><span class="oq-big">${esc(r.urs_percentage)}%</span><div class="oq-bar is-urs"><i style="width:${esc(r.urs_percentage)}%"></i></div></div>
      </div>
      <p class="muted mt-sm">Main findings (${esc(tot)} onions assessed)</p>
      <div class="oq-defects">${[['Damaged', r.damaged], ['Rotten', r.rotten], ['Sprouted', r.sprouted], ['Undersized', r.undersized]].map(([k, v]) => `<div class="oq-defect"><small class="muted">${k}</small><b>${esc(v)}</b></div>`).join('')}</div>
      ${r.isDemo ? '<p class="muted">Demo values for the prototype.</p>' : ''}
      <div class="row mt no-print">${oqReportButtons(tk.token)} <button class="btn btn--secondary btn--sm" data-go="reports">All quality reports</button></div>`;
  } else if (o && o.status === 'FLAGGED') {
    status = pill('bad', 'Flagged for manual review');
    body = '<p class="muted">The officer is reviewing this batch. Your result will appear here once the review is complete.</p>';
  } else if (o && o.status === 'ASSESSED') {
    status = pill('wait', 'Awaiting officer confirmation');
    body = '<p class="muted">Your onions have been assessed. The result appears here once the officer confirms it.</p>';
  } else if (o && o.status === 'PROCESSING') {
    status = pill('wait', 'Assessment in progress');
    body = '<p class="muted">Your onion images are being assessed.</p>';
  } else if (o && o.images && o.images.length) {
    status = pill('wait', 'Images captured');
    body = '<p class="muted">Photographs of your batch have been captured. The assessment will start shortly.</p>';
  } else if (si < qi) {
    status = pill('off', 'Starts after document verification');
    body = '<p class="muted">The onion quality assessment begins once your documents are verified at the centre.</p>';
  } else {
    status = pill('wait', 'Waiting for assessment');
    body = '<p class="muted">Your batch is in the queue for the onion quality assessment.</p>';
  }
  return `<div class="card mt"><div class="card__head"><div><h2 class="card__title">Onion Quality Assessment</h2><p class="muted">Standardized image-based assessment of onion quality for transparent procurement.</p></div>${status}</div>${body}</div>`;
}
function oqHistoryBits(t) {
  if (!oqReportReady(t)) return '';
  return `<br><span class="muted">Grade A ${esc(t.oq.result.gradeA_percentage)}% &middot; URS ${esc(t.oq.result.urs_percentage)}%</span> <a href="#" data-act="oq-report-view" data-id="${esc(t.token)}">Report</a>`;
}

/* ----- officer dashboard: batches, pending, completed, flagged, Grade A / URS summary ----- */
function oqOfficerCards(list) {
  const st = (t) => (t.oq ? t.oq.status : null);
  const pending = list.filter((t) => t.stage === 'QUALITY_PENDING' && (!t.oq || ['BATCH_PENDING', 'PROCESSING'].includes(st(t))));
  const review = list.filter((t) => st(t) === 'ASSESSED'), done = list.filter((t) => st(t) === 'RECORDED'), flagged = list.filter((t) => st(t) === 'FLAGGED');
  const res = list.filter((t) => t.oq && t.oq.result && ['ASSESSED', 'RECORDED'].includes(st(t)));
  const avg = (k) => res.length ? Math.round(res.reduce((sum, t) => sum + t.oq.result[k], 0) / res.length) : null;
  const a = avg('gradeA_percentage'), u = avg('urs_percentage');
  return `<div class="card mt"><div class="card__head"><div><h2 class="card__title">Onion Quality Assessment</h2><p class="muted">Standardized image-based assessment of onion quality for transparent procurement.</p></div>
      <button class="btn btn--secondary btn--sm" data-go="quality">Open assessments</button></div>
    <div class="grid grid--4">
      <div class="stat"><p class="stat__n">${list.filter((t) => t.checkInTime).length}</p><p class="stat__l">Today's batches</p></div>
      <div class="stat"><p class="stat__n">${pending.length}</p><p class="stat__l">Pending assessments</p></div>
      <div class="stat"><p class="stat__n">${done.length}</p><p class="stat__l">Completed assessments</p></div>
      <div class="stat"><p class="stat__n">${flagged.length}</p><p class="stat__l">Flagged for review</p></div>
    </div>
    ${review.length ? `<p class="mt-sm">${pill('wait', review.length + ' assessed batch' + (review.length === 1 ? '' : 'es') + ' awaiting officer confirmation')}</p>` : ''}
    <div class="grid grid--2 mt">
      <div class="oq-defect"><small class="muted">Average Grade A</small><span class="oq-big">${a == null ? '--' : a + '%'}</span><div class="oq-bar"><i style="width:${a || 0}%"></i></div></div>
      <div class="oq-defect"><small class="muted">Average URS</small><span class="oq-big">${u == null ? '--' : u + '%'}</span><div class="oq-bar is-urs"><i style="width:${u || 0}%"></i></div></div>
    </div>
    <p class="muted mt-sm">${res.length ? `Across ${res.length} assessed batch${res.length === 1 ? '' : 'es'} today.` : 'No batches assessed yet today.'}</p>
    ${flagged.length ? `<h3 class="mt">Flagged batches</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Token</th><th>Farmer</th><th>Batch ID</th><th>Reason</th><th>Action</th></tr></thead><tbody>
      ${flagged.map((t) => `<tr><td><strong>${esc(t.token)}</strong></td><td>${esc(t.farmerName)}</td><td>${esc(t.oq.batchId)}</td><td>${esc(t.oq.flagReason || '--')}</td>
        <td><button class="btn btn--primary btn--sm" data-act="oq-open" data-id="${esc(t.token)}">View Assessment</button></td></tr>`).join('')}</tbody></table></div>` : ''}
  </div>`;
}

/* ----- farmer: "Quality reports" record - every digital quality report generated for this farmer's batches ----- */
function viewQualityReports(f) {
  const list = DB.tokens.filter((t) => t.farmerId === f.farmerId && oqReportReady(t))
    .sort((a, b) => String(b.oq.assessedAt || '').localeCompare(String(a.oq.assessedAt || '')));
  const stat = (o) => o.status === 'RECORDED' ? pill('ok', 'Assessment recorded') : o.status === 'FLAGGED' ? pill('bad', 'Flagged for manual review') : pill('wait', 'Awaiting officer confirmation');
  return `<div class="pwrap pwrap--wide"><h1 class="ptitle">Quality reports</h1>
    <p class="plead">Your digital quality reports. Each report appears here as soon as the officer's onion quality assessment generates it - the same report the officer sees.</p>
    ${list.length ? list.map((t) => { const o = t.oq, r = o.result, c = DB.centres.find((x) => x.id === t.centreId) || {};
      return `<div class="card mt"><div class="card__head"><div><h2 class="card__title">${esc(o.reportId)}</h2><p class="muted">Batch ${esc(o.batchId)} &middot; ${esc(c.name || '--')} &middot; ${o.assessedAt ? esc(fmtDateTime(o.assessedAt)) : '--'}</p></div>${stat(o)}</div>
        <div class="grid grid--2"><div class="oq-defect"><small class="muted">Grade A</small><span class="oq-big">${esc(r.gradeA_percentage)}%</span><div class="oq-bar"><i style="width:${esc(r.gradeA_percentage)}%"></i></div></div>
          <div class="oq-defect"><small class="muted">URS</small><span class="oq-big">${esc(r.urs_percentage)}%</span><div class="oq-bar is-urs"><i style="width:${esc(r.urs_percentage)}%"></i></div></div></div>
        <div class="oq-defects mt">${[['Damaged', r.damaged], ['Rotten', r.rotten], ['Sprouted', r.sprouted], ['Undersized', r.undersized]].map(([k, v]) => `<div class="oq-defect"><small class="muted">${k}</small><b>${esc(v)}</b></div>`).join('')}</div>
        <p class="muted mt-sm">${esc(o.images.length)} photograph${o.images.length === 1 ? '' : 's'} &middot; token ${esc(t.token)}</p>
        <div class="row mt no-print">${oqReportButtons(t.token)}</div></div>`; }).join('')
      : '<div class="card mt"><p class="muted">No quality reports yet. Your report appears here automatically once the officer completes the onion quality assessment for your batch.</p></div>'}
  </div>`;
}
/* Tell the farmer at the same moment the report changes on the officer side. */
function oqNotify(t, title, body) {
  notify(t.farmerId, title, body);
  DB.notifications[0].reportToken = t.token;
}

const OQ_STEPS = ['Images received', 'Onion detection', 'Defect assessment', 'Size assessment', 'Grade calculation'];
const oqPhase = (o) => (o.status === 'PROCESSING' && S.officer.oqRun === o.token) ? 'PROCESSING' : (o.status === 'ASSESSED' || o.status === 'FLAGGED') ? 'RESULTS' : 'CAPTURE';
function oqStatusPill(t) {
  const o = t.oq; if (!o) return pill('off', 'Not started');
  if (o.status === 'FLAGGED') return pill('bad', 'Flagged for manual review');
  if (o.status === 'ASSESSED') return pill('ok', 'Assessed — awaiting confirmation');
  return o.images && o.images.length ? pill('wait', 'Images captured') : pill('off', 'Not started');
}
function oqRunAssessment(tok) {
  const t = findToken(tok), o = oqOf(t); o.token = tok; o.status = 'PROCESSING'; S.officer.oqRun = tok; S.officer.oqStep = 0; render();
  const job = assessOnionImages(o.images, { batchId: o.batchId }); /* <- FUTURE AI call happens here */
  job.catch(() => {});   /* a rejected assessment (e.g. quota 429) is handled below and never affects the rest of the portal */
  const tick = () => {
    if (S.officer.oqStep < OQ_STEPS.length) { S.officer.oqStep++; render(); return setTimeout(tick, 650); }
    job.then((r) => {
      o.result = r; o.status = 'ASSESSED'; o.assessedAt = new Date().toISOString();
      o.reportId = o.reportId || `QR-${o.batchId.replace('BATCH-', '')}`; S.officer.oqRun = null;
      oqNotify(t, 'Digital Quality Report ready', `Your onion quality report ${o.reportId} for batch ${o.batchId} has been generated: Grade A ${r.gradeA_percentage}%, URS ${r.urs_percentage}%.`); render();
    }).catch(() => { o.status = 'BATCH_PENDING'; S.officer.oqRun = null; toast('Assessment could not be completed. Please try again.', true); render(); });
  };
  setTimeout(tick, 500);
}
function oqProcessingView(t, o) {
  const n = S.officer.oqStep || 0;
  return `<div class="card"><h2 class="card__title">AI Quality Assessment</h2>
    <p class="muted">Analyzing onion images… Batch ${esc(o.batchId)} · ${o.images.length} image${o.images.length === 1 ? '' : 's'}</p>
    <ul class="oq-proc">${OQ_STEPS.map((x, i) => `<li class="${i < n ? 'is-done' : i === n ? 'is-now' : ''}">${i < n ? '✓' : i === n ? '' : '○'} ${esc(x)}</li>`).join('')}</ul>
    <p class="muted">Prototype placeholder for the image-processing engine.</p></div>`;
}
function oqResultsView(t, o, centre) {
  const r = o.result, g = gradeOf(oqRouteFor(r.gradeA_percentage)), flagged = o.status === 'FLAGGED';
  const defects = [['Damaged', r.damaged], ['Rotten', r.rotten], ['Sprouted', r.sprouted], ['Undersized', r.undersized]];
  return `<div class="card"><div class="card__head"><h2 class="card__title">Quality Assessment Results</h2><button class="btn btn--secondary btn--sm" data-act="clear-sel">Close</button></div>
    <div class="note">Demo assessment: these values are illustrative placeholders. The image-processing engine will be connected at this step.</div>
    <dl class="kv mt"><dt>Batch ID</dt><dd>${esc(o.batchId)}</dd><dt>Farmer</dt><dd>${esc(t.farmerName)} · ${esc(t.farmerId)}</dd><dt>Centre</dt><dd>${esc(centre.name || '—')}</dd><dt>Report ID</dt><dd>${esc(o.reportId)}</dd></dl>
    ${flagged ? `<div class="note note--bad mt">Flagged for manual review${o.flagReason ? ': ' + esc(o.flagReason) : ''}. Recording is paused until the batch is re-assessed.</div>` : ''}
    <h3 class="mt">Total onions assessed: ${esc(r.total_assessed)} · ${esc(r.analyzed_images)} image${r.analyzed_images === 1 ? '' : 's'}</h3>
    <div class="grid grid--2">
      <div class="oq-defect"><small class="muted">Grade A</small><span class="oq-big">${r.gradeA_percentage}%</span><div class="oq-bar"><i style="width:${r.gradeA_percentage}%"></i></div></div>
      <div class="oq-defect"><small class="muted">URS</small><span class="oq-big">${r.urs_percentage}%</span><div class="oq-bar is-urs"><i style="width:${r.urs_percentage}%"></i></div></div>
    </div>
    <h3 class="mt">Defect findings</h3>
    <div class="oq-defects">${defects.map(([k, v]) => `<div class="oq-defect"><small class="muted">${k}</small><b>${v}</b><small class="muted">${Math.round(v / r.total_assessed * 100)}% of onions</small></div>`).join('')}</div>
    <h3 class="mt">Assessed images</h3>
    <div class="oq-thumbs">${o.images.map((im) => `<div class="oq-thumb oq-ovl"><img src="${im.data}" alt="Assessed onion photo"><span>Detection overlay area</span></div>`).join('')}</div>
    <p class="muted">Detected Defects (bounding boxes and highlights will appear on the images once the engine is connected):</p>
    <div class="oq-chips"><span>Damaged</span><span>Rotten</span><span>Sprouted</span><span>Undersized</span></div>
    <h3 class="mt">How was this assessment determined?</h3>
    <ul class="oq-list"><li>✓ Visible damage</li><li>✓ Rot / decay indicators</li><li>✓ Sprouting</li><li>✓ Size classification</li><li>✓ Grade A / URS classification</li></ul>
    <h3 class="mt">Overall assessment</h3>
    <p>${r.gradeA_percentage}% of assessed onions classified Grade A and ${r.urs_percentage}% URS. Procurement grade: <strong>${esc(g.label)}</strong> (quality token ${g.key}, ${esc(g.section)}). The grade is generated from the assessment and is not entered manually.</p>
    <h3 class="mt">Digital Quality Report</h3>
    <p class="muted">Report ${esc(o.reportId)} was generated automatically from this assessment.</p>
    <div class="row">${oqReportButtons(t.token)}</div>
    <div class="row mt">
      <button class="btn btn--primary" data-act="oq-confirm" data-id="${esc(t.token)}" ${flagged ? 'disabled' : ''}>Confirm &amp; Record Assessment</button>
      ${flagged ? `<button class="btn btn--secondary" data-act="oq-reassess" data-id="${esc(t.token)}">Re-capture &amp; re-assess</button>` : `<button class="btn btn--secondary" data-act="oq-flag" data-id="${esc(t.token)}">Flag for Manual Review</button>`}
    </div>
    <p class="muted mt-sm">Manual review is an exception path for unclear images or unusual cases. The grade cannot be edited.</p></div>`;
}

function officerQuality() {
  const queue = todayTokens().filter((t) => t.stage === 'QUALITY_PENDING');
  const done = todayTokens().filter((t) => t.qualityToken);
  const sel = S.officer.selectedToken ? DB.tokens.find((t) => t.token === S.officer.selectedToken) : null;
  const active = sel && sel.stage === 'QUALITY_PENDING' ? sel : null;
  const f = active ? (farmerById(active.farmerId) || {}) : {};
  const o = active ? oqOf(active) : null;
  const centre = DB.centres.find((c) => c.id === S.officer.centreId) || {};
  const ready = o && o.images.length > 0 && o.gps;
  return `<div class="pwrap pwrap--wide">
    <h1 class="ptitle">Onion Quality Assessment</h1>
    <p class="plead">Standardized image-based assessment of onion quality for transparent procurement.</p>
    ${centreSelect()}
    ${active && oqPhase(o) === 'PROCESSING' ? oqProcessingView(active, o) : ''}
    ${active && oqPhase(o) === 'RESULTS' ? oqResultsView(active, o, centre) : ''}
    ${active && oqPhase(o) === 'CAPTURE' ? `
    <div class="oq-steps"><span>1 Batch details</span><span class="${o.images.length ? '' : 'is-on'}">2 Capture images</span><span class="${o.images.length ? 'is-on' : ''}">3 Quality assessment</span><span>4 Results</span><span>5 Digital report</span></div>
    <div class="card"><div class="card__head"><h2 class="card__title">Onion Batch Details</h2><button class="btn btn--secondary btn--sm" data-act="clear-sel">Close</button></div>
      <div class="grid grid--2">
        <dl class="kv"><dt>Farmer</dt><dd>${esc(active.farmerName)}</dd><dt>Farmer ID</dt><dd>${esc(active.farmerId)}</dd><dt>Batch / Lot ID</dt><dd>${esc(o.batchId)}</dd><dt>Main token</dt><dd>${esc(active.token)}</dd></dl>
        <dl class="kv"><dt>Procurement centre</dt><dd>${esc(centre.name || '—')}</dd><dt>Date</dt><dd>${fmtDate(active.date)}</dd><dt>Assessment status</dt><dd>${pill('wait', o.images.length ? 'Images captured' : 'Awaiting images')}</dd></dl>
      </div></div>
    <div class="card"><h2 class="card__title">Capture Onion Images</h2>
      <p class="muted">Photograph the onion batch before assessment. GPS and time are recorded for traceability only; they do not affect the quality result.</p>
      <input type="file" id="oq-cam" data-oq-files="${esc(active.token)}" accept="image/*" capture="environment" hidden>
      <input type="file" id="oq-up" data-oq-files="${esc(active.token)}" accept="image/*" multiple hidden>
      <div class="row mt"><button class="btn btn--primary" data-act="oq-cam">Take photo</button><button class="btn btn--secondary" data-act="oq-up">Upload images</button>
        ${o.images.length ? `<button class="btn btn--secondary" data-act="oq-clear" data-id="${esc(active.token)}">Clear all</button>` : ''}</div>
      ${o.images.length ? `<div class="oq-thumbs">${o.images.map((im) => `<div class="oq-thumb"><img src="${im.data}" alt="Onion batch photo ${esc(im.id)}"><button data-act="oq-remove" data-id="${esc(active.token)}" data-img="${esc(im.id)}" aria-label="Remove photo" title="Remove / retake">×</button></div>`).join('')}</div>`
        : '<div class="oq-empty">No images yet. Take a photo or upload from the device.</div>'}
      <div class="oq-meta">
        <div><small>Images captured</small><strong>${o.images.length} / ${OQ_MAX_IMAGES}</strong></div>
        <div><small>GPS location</small><strong>${o.gps ? 'Captured ✓' : 'Not captured'}</strong>${o.gps ? `<small>${o.gps.lat}, ${o.gps.lng}${o.gps.source === 'demo' ? ' (demo location)' : ''}</small>` : `<small><a href="#" data-act="oq-gps" data-id="${esc(active.token)}">Capture now</a></small>`}</div>
        <div><small>Date &amp; time</small><strong>${o.capturedAt ? fmtDateTime(o.capturedAt) : '—'}</strong></div>
        <div><small>Batch ID</small><strong>${esc(o.batchId)}</strong></div>
      </div></div>
    <div class="card note--info"><h2 class="card__title">Onion Quality Assessment</h2>
      <dl class="kv"><dt>Batch ID</dt><dd>${esc(o.batchId)}</dd><dt>Farmer</dt><dd>${esc(active.farmerName)}</dd><dt>Centre</dt><dd>${esc(centre.name || '—')}</dd></dl>
      <div class="row mt"><button class="btn btn--primary" data-act="oq-start" data-id="${esc(active.token)}" ${ready ? '' : 'disabled'}>Start Quality Assessment</button>${ready ? '' : '<span class="muted">Add at least one image, and capture GPS.</span>'}</div>
    </div>` : ''}
    <div class="card"><h2 class="card__title">Waiting for assessment (${queue.length})</h2>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Main token</th><th>Farmer</th><th>Assessment status</th><th>Checked in</th><th>Action</th></tr></thead><tbody>
      ${queue.length ? queue.map((t) => `<tr><td><strong>${esc(t.token)}</strong></td><td>${esc(t.farmerName)}</td><td>${oqStatusPill(t)}</td><td>${esc(t.checkInTime || '—')}</td>
        <td><button class="btn btn--primary btn--sm" data-act="select-token" data-id="${esc(t.token)}">${t.oq && (t.oq.status === 'ASSESSED' || t.oq.status === 'FLAGGED') ? 'View Assessment' : 'Assess'}</button></td></tr>`).join('')
        : '<tr><td colspan="5" class="muted">No farmer is waiting for a quality assessment.</td></tr>'}
      </tbody></table></div></div>
    <div class="card"><h2 class="card__title">Quality tokens issued today (${done.length})</h2>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Quality token</th><th>Main token</th><th>Farmer</th><th>Result</th><th>Section</th><th>Batch ID</th><th>Report</th></tr></thead><tbody>
      ${done.length ? done.map((t) => `<tr><td><strong>${esc(t.qualityToken)}</strong></td><td>${esc(t.token)}</td><td>${esc(t.farmerName)}</td>
        <td>${esc(t.qualityLabel)}${t.oq && t.oq.result ? `<br><span class="muted">Grade A ${t.oq.result.gradeA_percentage}% · URS ${t.oq.result.urs_percentage}%</span>` : ''}</td><td>${esc(t.section)}</td><td>${esc(t.oq ? t.oq.batchId : '—')}</td><td>${t.oq && t.oq.result ? oqReportButtons(t.token) : '--'}</td></tr>`).join('')
        : '<tr><td colspan="7" class="muted">None yet today.</td></tr>'}
      </tbody></table></div></div>
  </div>`;
}

function officerSections() {
  const centre = DB.centres.find((c) => c.id === S.officer.centreId);
  const list = todayTokens().filter((t) => t.section && STAGE_INDEX[t.stage] < STAGE_INDEX.WEIGHED);
  return `<div class="pwrap pwrap--wide">
    <h1 class="ptitle">Section queues</h1>
    <p class="plead">After the quality check each farmer moves to the section that matches the assessment result.</p>
    ${centreSelect()}
    <div class="grid grid--3">${centre.sections.map((sec) => {
      const rows = list.filter((t) => t.section === sec);
      return `<div class="card"><div class="card__head"><h2 class="card__title">${esc(sec)}</h2><span class="muted">${rows.length} waiting</span></div>
        ${rows.length ? rows.map((t) => `<div style="padding:.5rem 0;border-bottom:1px solid var(--line)">
          <strong>${esc(t.qualityToken)}</strong> <span class="muted">· ${esc(t.token)} · ${esc(t.farmerName)}</span><br><span class="muted">${esc(t.qualityLabel || '')}</span><br>
          <div class="row mt-sm"><button class="btn btn--secondary btn--sm" data-act="to-weighing" data-id="${esc(t.token)}">Send to weighing</button></div>
        </div>`).join('') : '<p class="muted">Queue empty.</p>'}
      </div>`;
    }).join('')}</div>
  </div>`;
}

function officerWeighing() {
  const queue = todayTokens().filter((t) => ['SECTION_ASSIGNED', 'WEIGHING_PENDING'].includes(t.stage));
  const sel = S.officer.weighToken ? DB.tokens.find((t) => t.token === S.officer.weighToken) : null;
  const done = todayTokens().filter((t) => t.weightQtl);
  return `<div class="pwrap pwrap--wide">
    <h1 class="ptitle">Weighing & procurement</h1>
    <p class="plead">Record the net weight and rate. The amount is calculated from them, and the procurement record is closed.</p>
    ${centreSelect()}
    ${sel ? `<div class="card"><div class="card__head"><h2 class="card__title">${esc(sel.token)} · ${esc(sel.farmerName)} · ${esc(sel.qualityToken || '')}</h2>
      <button class="btn btn--secondary btn--sm" data-act="clear-weigh">Close</button></div>
      <div class="grid grid--3">
        <label class="field"><span class="field__label">Net weight (quintal)</span><input id="w-qty" type="number" step="0.01" min="0" value="38.5"></label>
        <label class="field"><span class="field__label">Rate per quintal</span><input id="w-rate" type="number" step="1" min="0" value="${(DB.commodities.find((c) => c.id === sel.commodityId) || {}).msp || 2425}"></label>
        <label class="field"><span class="field__label">Deductions</span><input id="w-ded" type="number" step="1" min="0" value="${sel.qualityGrade === 'AMBER' ? 1500 : 0}"></label>
      </div>
      <p class="muted">Amount payable = weight × rate − deductions.</p>
      <button class="btn btn--primary mt" data-act="save-weigh" data-id="${esc(sel.token)}">Record procurement</button>
    </div>` : ''}
    <div class="card"><h2 class="card__title">Waiting at the weighbridge (${queue.length})</h2>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Quality token</th><th>Main token</th><th>Farmer</th><th>Section</th><th>Action</th></tr></thead><tbody>
      ${queue.length ? queue.map((t) => `<tr><td><strong>${esc(t.qualityToken || '—')}</strong></td><td>${esc(t.token)}</td><td>${esc(t.farmerName)}</td><td>${esc(t.section || '—')}</td>
        <td><button class="btn btn--primary btn--sm" data-act="select-weigh" data-id="${esc(t.token)}">Weigh</button></td></tr>`).join('')
        : '<tr><td colspan="5" class="muted">Nobody at weighing right now.</td></tr>'}
      </tbody></table></div></div>
    <div class="card"><h2 class="card__title">Recorded today (${done.length})</h2>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Procurement ID</th><th>Farmer</th><th>Weight</th><th>Rate</th><th>Amount</th><th>Payment</th></tr></thead><tbody>
      ${done.length ? done.map((t) => `<tr><td>${esc(t.procurementId)}</td><td>${esc(t.farmerName)}</td><td class="num">${esc(t.weightQtl)} qtl</td>
        <td class="num">${rupee(t.ratePerQtl)}</td><td class="num">${rupee(t.amount)}</td>
        <td>${t.paymentStatus === 'PAID' ? pill('ok', 'Paid') : t.paymentStatus === 'INITIATED' ? pill('wait', 'Pending') : pill('off', 'Not started')}</td></tr>`).join('')
        : '<tr><td colspan="6" class="muted">Nothing recorded yet.</td></tr>'}
      </tbody></table></div></div>
  </div>`;
}

function officerPay() {
  const rows = DB.tokens.filter((t) => t.centreId === S.officer.centreId && t.weightQtl);
  return `<div class="pwrap pwrap--wide">
    <h1 class="ptitle">Payment updates</h1>
    <p class="plead">Payments are simulated. In a live build this would connect to the treasury or bank transfer system.</p>
    ${centreSelect()}
    <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Procurement</th><th>Farmer</th><th>Account</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead><tbody>
    ${rows.length ? rows.slice().reverse().map((t) => { const f = farmerById(t.farmerId) || {};
      return `<tr><td>${esc(t.procurementId)}<br><span class="muted">${fmtDate(t.date)}</span></td><td>${esc(t.farmerName)}<br><span class="muted">${esc(t.farmerId)}</span></td>
      <td>${esc(f.bankName || '—')}<br><span class="muted">${maskAcct(f.accountNumber)}</span></td><td class="num">${rupee(t.amount)}</td>
      <td>${t.paymentStatus === 'PAID' ? pill('ok', 'Credited ' + esc(t.paymentRef || '')) : t.paymentStatus === 'INITIATED' ? pill('wait', 'Payment pending') : pill('off', 'Not started')}</td>
      <td>${t.paymentStatus === 'PAID' ? `<button class="btn btn--secondary btn--sm" data-act="download-receipt" data-id="${esc(t.token)}">Download receipt</button>` : t.paymentStatus === 'INITIATED'
        ? `<button class="btn btn--primary btn--sm" data-act="pay-complete" data-id="${esc(t.token)}">Mark credited</button>`
        : `<button class="btn btn--secondary btn--sm" data-act="pay-init" data-id="${esc(t.token)}">Initiate payment</button>`}</td></tr>`;
    }).join('') : '<tr><td colspan="6" class="muted">No procurement records yet.</td></tr>'}
    </tbody></table></div></div>
  </div>`;
}

/* ---------- applications (shared by officer + admin) ---------- */
function applicationsView() {
  const apps = DB.applications.slice().reverse();
  return `<div class="pwrap pwrap--wide">
    <h1 class="ptitle">Farmer applications</h1>
    <p class="plead">Each application is verified component by component. The Farmer ID is generated by the system only after approval.</p>
    <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr>
      <th>Application</th><th>Farmer</th><th>Village</th><th>Mobile</th><th>Submitted</th><th>KYC</th><th>Bank</th><th>Documents</th><th>Status</th><th>Action</th></tr></thead><tbody>
    ${apps.map((a) => { const f = DB.farmers.find((x) => x.applicationId === a.applicationId) || {};
      const docs = [f.identityDocument, f.bankDocument].filter(Boolean).length;
      return `<tr><td>${esc(a.applicationId)}</td><td>${esc(f.fullName || '—')}${f.farmerId ? `<br><span class="muted">${esc(f.farmerId)}</span>` : ''}</td>
      <td>${esc(f.village || '—')}</td><td>${maskMobile(f.mobile)}</td><td>${fmtDate(a.submittedAt)}</td>
      <td>${f.kycStatus === 'VERIFIED' ? pill('ok', 'Verified') : pill('wait', 'Pending')}</td>
      <td>${f.bankStatus === 'VERIFIED' ? pill('ok', 'Verified') : pill('wait', 'Pending')}</td>
      <td>${docs ? pill('ok', docs + ' uploaded') : pill('warn', 'Missing')}</td>
      <td>${a.status === 'FARMER_ID_GENERATED' ? pill('ok', 'Farmer ID issued') : a.status === 'APPROVED' ? pill('ok', 'Approved')
        : a.status === 'REJECTED' ? pill('bad', 'Rejected') : a.status === 'RESUBMISSION_REQUIRED' ? pill('warn', 'Resubmission required')
        : a.status === 'UNDER_REVIEW' ? pill('wait', 'Under review') : pill('wait', 'Submitted')}</td>
      <td><button class="btn btn--secondary btn--sm" data-act="open-app" data-id="${esc(a.applicationId)}">Open</button></td></tr>`;
    }).join('')}
    </tbody></table></div></div></div>`;
}

const CHECKS = [
  ['name', 'Name verified against the identity document'],
  ['dob', 'Date of birth verified'],
  ['mobile', 'Mobile verified by OTP'],
  ['idDoc', 'Identity document reviewed'],
  ['idMatch', 'Identity information matched'],
  ['address', 'Address reviewed'],
  ['bankDetails', 'Bank account details reviewed'],
  ['bankDoc', 'Bank document reviewed'],
  ['bankVerified', 'Bank account marked verified'],
  ['farmerType', 'Farmer type verified'],
  ['eligibility', 'Eligibility documents reviewed']
];

function applicationDetail() {
  const app = DB.applications.find((a) => a.applicationId === S.appId);
  const f = DB.farmers.find((x) => x.applicationId === S.appId);
  if (!app || !f) return `<div class="pwrap"><p class="muted">Application not found.</p><button class="btn btn--secondary" data-go="applications">Back</button></div>`;
  const done = CHECKS.filter(([k]) => app.checks[k]).length;
  const decided = ['APPROVED', 'FARMER_ID_GENERATED', 'REJECTED'].includes(app.status);
  const sec = (title, pairs) => `<div class="card"><h2 class="card__title">${esc(title)}</h2><dl class="kv mt-sm">${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl></div>`;
  return `<div class="pwrap pwrap--wide">
    <div class="row row--between">
      <h1 class="ptitle">${esc(app.applicationId)}</h1>
      <button class="btn btn--secondary btn--sm" data-go="applications">Back to list</button>
    </div>
    <p class="plead">${esc(f.fullName)} · submitted ${fmtDate(app.submittedAt)} · ${f.farmerId ? 'Farmer ID ' + esc(f.farmerId) : 'no Farmer ID yet'}</p>
    <div class="grid grid--2">
      <div>
        ${sec('Personal details', [['Name', esc(f.fullName)], ['Name as per ID', esc(f.nameAsPerId)], ['Relation', `${esc(f.relativeName)} (${esc(f.relativeType)})`],
          ['Date of birth', fmtDate(f.dob)], ['Gender', esc(f.gender)], ['Mobile', `${maskMobile(f.mobile)} ${pill('ok', 'OTP verified')}`],
          ['Farmer type', esc(f.farmerType)], ['Category', esc(f.farmerCategory || 'Not specified')]])}
        ${sec('Address', [['State', esc(f.state)], ['District', esc(f.district)], ['Taluka', esc(f.subDistrict || '—')], ['Village', esc(f.village)],
          ['PIN', esc(f.pinCode)], ['Address', esc(f.addressLine)]])}
        ${sec('Agricultural details', [['Land status', esc(f.landStatus || '—')], ['Area', f.totalLandArea ? esc(f.totalLandArea + ' ' + f.landUnit) : '—'],
          ['Land records', esc((f.landRecords || []).join(', ') || '—')], ['Main crops', esc((f.mainCrops || []).join(', ') || '—')]])}
        ${sec('Identity & bank', [['ID type', esc(f.identityDocumentType)], ['ID number', maskId(f.identityDocumentNumber, f.identityDocumentType)],
          ['ID document', f.identityDocument ? pill('ok', 'Uploaded: ' + esc(f.identityDocument)) : pill('warn', 'Not uploaded')],
          ['Account holder', esc(f.accountHolderName)], ['Account', maskAcct(f.accountNumber)], ['IFSC', esc(f.ifsc)],
          ['Bank', `${esc(f.bankName)} · ${esc(f.branchName)}`], ['Bank document', f.bankDocument ? pill('ok', 'Uploaded') : pill('off', 'Not required')]])}
      </div>
      <div>
        <div class="card"><div class="card__head"><h2 class="card__title">Verification checklist</h2><span class="muted" id="check-count">${done} of ${CHECKS.length} checked</span></div>
          ${CHECKS.map(([k, label]) => `<label class="checkline"><input type="checkbox" data-check="${k}" ${app.checks[k] ? 'checked' : ''} ${decided ? 'disabled' : ''}><span>${esc(label)}</span></label>`).join('')}
        </div>
        <div class="card"><h2 class="card__title">Decision</h2>
          ${decided ? `<p class="mt-sm">${app.status === 'REJECTED' ? pill('bad', 'Rejected') : pill('ok', 'Approved — Farmer ID ' + esc(f.farmerId || ''))}</p>
            ${app.reason ? `<p class="muted mt-sm">Remarks: ${esc(app.reason)}</p>` : ''}` : `
            <p class="muted mt-sm mb">Approving generates the permanent Farmer ID and unlocks slot booking for this farmer.</p>
            <div class="row">
              <button class="btn btn--primary btn--sm" data-act="app-approve" data-id="${esc(app.applicationId)}">Approve</button>
              <button class="btn btn--secondary btn--sm" data-act="app-resubmit" data-id="${esc(app.applicationId)}">Request resubmission</button>
              <button class="btn btn--secondary btn--sm" data-act="app-reject" data-id="${esc(app.applicationId)}">Reject</button>
            </div>`}
        </div>
      </div>
    </div>
  </div>`;
}

/* ---------- admin ---------- */
function adminViews() {
  switch (S.view) {
    case 'livequeue': return adminQueue();
    case 'applications': return applicationsView('admin');
    case 'appdetail': return applicationDetail('admin');
    case 'centres': return adminCentres();
    case 'schedules': return adminSchedules();
    case 'slotcfg': return adminSlotConfig();
    case 'farmers': return adminFarmers();
    default: return adminOverview();
  }
}

function adminOverview() {
  const all = DB.tokens.filter((t) => t.date === TODAY && t.status !== 'CANCELLED');
  const by = (fn) => all.filter(fn).length;
  const centres = DB.centres.map((c) => {
    const list = all.filter((t) => t.centreId === c.id);
    const con = congestion(c.id, TODAY);
    return { c, list, con };
  });
  const paid = all.filter((t) => t.paymentStatus === 'PAID');
  const pendingPay = all.filter((t) => t.weightQtl && t.paymentStatus !== 'PAID');
  return `<div class="pwrap pwrap--wide">
    <h1 class="ptitle">Today at a glance</h1>
    <p class="plead">${fmtLongDate(TODAY)} · all centres · figures update as officers move farmers through the stages.</p>
    <div class="grid grid--4">
      <div class="stat"><p class="stat__n">${all.length}</p><p class="stat__l">Total farmers today</p></div>
      <div class="stat"><p class="stat__n">${by((t) => t.status === 'IN_QUEUE' || t.status === 'SERVING')}</p><p class="stat__l">Waiting / in queue</p></div>
      <div class="stat"><p class="stat__n">${by((t) => ['SECTION_ASSIGNED', 'WEIGHING_PENDING'].includes(t.stage))}</p><p class="stat__l">In weighing</p></div>
      <div class="stat"><p class="stat__n">${by((t) => STAGE_INDEX[t.stage] >= STAGE_INDEX.PROCUREMENT_COMPLETE)}</p><p class="stat__l">Completed today</p></div>
      <div class="stat"><p class="stat__n">${paid.length}</p><p class="stat__l">Payments completed</p></div>
      <div class="stat"><p class="stat__n">${pendingPay.length}</p><p class="stat__l">Payments pending</p></div>
      <div class="stat"><p class="stat__n">${DB.applications.filter((a) => ['SUBMITTED', 'UNDER_REVIEW'].includes(a.status)).length}</p><p class="stat__l">Applications to verify</p></div>
      <div class="stat"><p class="stat__n">${DB.farmers.filter((f) => f.farmerId).length}</p><p class="stat__l">Registered farmers</p></div>
    </div>
    <div class="card mt"><h2 class="card__title">Queue at each counter</h2>
      <div class="counters mt">${centres.map(({ c, list, con }) => {
        const serving = list.find((t) => t.status === 'SERVING');
        return `<div class="stat"><p style="font-weight:700">${esc(c.name)}</p>
          <p class="muted">Now serving ${serving ? esc(serving.token) : 'idle'} · ${c.counters} counters</p>
          <p class="mt-sm">${pill(con.level === 'LOW' ? 'ok' : con.level === 'MODERATE' ? 'wait' : 'warn', con.level + ' congestion')}</p>
          <p class="muted mt-sm">${con.waiting} waiting · estimated ${etaMinutes(con.waiting, c.id)} min</p></div>`;
      }).join('')}</div>
    </div>
    <div class="card"><h2 class="card__title">Capacity</h2>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Centre</th><th>Commodity</th><th>Daily capacity</th><th>Booked</th><th>Available</th><th>Status</th></tr></thead><tbody>
      ${DB.centres.flatMap((c) => c.commodities.map((cm) => { const st = dayStats(c.id, cm, TODAY); const open = dateIsOpen(c.id, cm, TODAY);
        return `<tr><td>${esc(c.name)}</td><td>${esc(commodityName(cm))}</td><td class="num">${st.capacity}</td><td class="num">${st.booked}</td><td class="num">${st.available}</td>
        <td>${!open ? pill('off', 'Closed today') : st.available <= 0 ? pill('bad', "Today's capacity is full") : st.available <= st.capacity * CFG.limitedThresholdPct / 100 ? pill('warn', 'Limited') : pill('ok', 'Available')}</td></tr>`;
      })).join('')}
      </tbody></table></div></div>
    <div class="card"><h2 class="card__title">Recent activity</h2>
      ${DB.events.length ? DB.events.slice(0, 8).map((ev) => `<p class="muted">${esc(ev.at)} · ${esc(ev.text)}</p>`).join('') : '<p class="muted">No activity recorded in this session yet.</p>'}</div>
  </div>`;
}

function adminQueue() {
  const centre = DB.centres.find((c) => c.id === S.officer.centreId);
  const list = DB.tokens.filter((t) => t.centreId === centre.id && t.date === TODAY && t.status !== 'CANCELLED').sort((a, b) => a.seq - b.seq);
  return `<div class="pwrap pwrap--wide">
    <h1 class="ptitle">Live queue</h1>
    <p class="plead">The main queue in token order. Position comes from active queue records, not from subtracting token numbers.</p>
    ${centreSelect()}
    <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr>
      <th>Token</th><th>Farmer</th><th>Slot</th><th>Check-in</th><th>Stage</th><th>Quality token</th><th>Section</th><th>Waiting</th></tr></thead><tbody>
    ${list.length ? list.map((t) => {
      const ahead = farmersAhead(t);
      return `<tr><td><strong>${esc(t.token)}</strong>${t.status === 'SERVING' ? ' ' + pill('warn', 'Serving') : ''}</td>
      <td>${esc(t.farmerName)}<br><span class="muted">${esc(t.farmerId)}</span></td><td>${fmtTime(t.startHour)}</td>
      <td>${t.checkInTime ? esc(t.checkInTime) : pill('off', 'Not arrived')}</td><td>${stageBadge(t)}</td>
      <td>${esc(t.qualityToken || '—')}</td><td>${esc(t.section || '—')}</td>
      <td>${STAGE_INDEX[t.stage] >= STAGE_INDEX.PROCUREMENT_COMPLETE ? '<span class="muted">done</span>' : `about ${etaMinutes(ahead, t.centreId)} min`}</td></tr>`;
    }).join('') : '<tr><td colspan="8" class="muted">No tokens in the queue today.</td></tr>'}
    </tbody></table></div></div>
  </div>`;
}

function adminCentres() {
  return `<div class="pwrap pwrap--wide">
    <h1 class="ptitle">Procurement centres</h1>
    <p class="plead">Hours, capacity, commodities and status. Changes here flow straight into what farmers can book.</p>
    ${DB.centres.map((c) => `<div class="card"><div class="card__head"><h2 class="card__title">${esc(c.name)} <span class="muted">(${esc(c.code)})</span></h2>
      ${c.status === 'ACTIVE' ? pill('ok', 'Active') : pill('off', 'Deactivated')}</div>
      <div class="grid grid--3">
        <label class="field"><span class="field__label">Daily capacity</span><input type="number" min="0" value="${c.dailyCapacity}" data-centre="${c.id}" data-key="dailyCapacity"></label>
        <label class="field"><span class="field__label">Opens at (hour)</span><input type="number" min="0" max="23" value="${c.openHour}" data-centre="${c.id}" data-key="openHour"></label>
        <label class="field"><span class="field__label">Closes at (hour)</span><input type="number" min="1" max="23" value="${c.closeHour}" data-centre="${c.id}" data-key="closeHour"></label>
        <label class="field"><span class="field__label">Counters open</span><input type="number" min="1" max="8" value="${c.counters}" data-centre="${c.id}" data-key="counters"></label>
        <div class="field"><span class="field__label">Commodities</span><p>${c.commodities.map((x) => esc(commodityName(x))).join(', ')}</p></div>
        <div class="field"><span class="field__label">Sections</span><p>${c.sections.map(esc).join(', ')}</p></div>
      </div>
      <p class="muted">${esc(c.address)} · ${esc(c.subDistrict)}, ${esc(c.district)}, ${esc(c.state)} · ${esc(c.days)}</p>
      <div class="row mt"><button class="btn btn--secondary btn--sm" data-act="toggle-centre" data-id="${c.id}">${c.status === 'ACTIVE' ? 'Deactivate centre' : 'Activate centre'}</button></div>
    </div>`).join('')}
    <div class="note">Adding a brand-new centre is stubbed in this prototype: the three demo centres above cover the booking, queue and section flows end to end.</div>
  </div>`;
}

function adminSchedules() {
  return `<div class="pwrap pwrap--wide">
    <h1 class="ptitle">Schedules & capacity</h1>
    <p class="plead">One schedule per centre and commodity. Closing a schedule immediately removes those dates from the farmer's calendar.</p>
    <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Schedule</th><th>Centre</th><th>Commodity</th><th>Window</th><th>Daily capacity</th><th>Status</th><th>Action</th></tr></thead><tbody>
    ${DB.schedules.map((s) => `<tr><td>${esc(s.id)}</td><td>${esc(centreName(s.centreId))}</td><td>${esc(commodityName(s.commodityId))}</td>
      <td>${fmtDate(s.startDate)} – ${fmtDate(s.endDate)}</td>
      <td><input type="number" min="0" value="${s.dailyCapacity}" data-sched="${s.id}" data-key="dailyCapacity" style="width:100px"></td>
      <td>${s.status === 'OPEN' ? pill('ok', 'Open') : pill('off', 'Closed')}</td>
      <td><button class="btn btn--secondary btn--sm" data-act="toggle-sched" data-id="${s.id}">${s.status === 'OPEN' ? 'Close' : 'Open'}</button></td></tr>`).join('')}
    </tbody></table></div></div>
    <div class="card"><h2 class="card__title">Commodity windows</h2>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Commodity</th><th>Support price (demo)</th><th>Status</th><th>Action</th></tr></thead><tbody>
      ${DB.commodities.map((c) => `<tr><td>${c.emoji} ${esc(c.name)}</td><td class="num">${rupee(c.msp)} / quintal</td>
        <td>${c.status === 'OPEN' ? pill('ok', 'Procurement open') : pill('off', 'Procurement closed')}</td>
        <td><button class="btn btn--secondary btn--sm" data-act="toggle-commodity" data-id="${c.id}">${c.status === 'OPEN' ? 'Close procurement' : 'Open procurement'}</button></td></tr>`).join('')}
      </tbody></table></div>
      <p class="muted mt">Prices are fictional demo figures, not official support prices.</p></div>
  </div>`;
}

function adminSlotConfig() {
  const f = (id, label, value, hint, attrs) => `<label class="field"><span class="field__label">${esc(label)}</span>
    <input type="number" id="cfg-${id}" value="${value}" ${attrs || ''}><span class="field__hint">${esc(hint)}</span></label>`;
  return `<div class="pwrap">
    <h1 class="ptitle">Slot & booking rules</h1>
    <p class="plead">Everything the booking flow enforces is set here rather than hard-coded.</p>
    <div class="card"><h2 class="card__title">Slots</h2>
      <div class="grid grid--2">
        <label class="field"><span class="field__label">Slot duration</span>
          <select id="cfg-slotDurationMin">${[30, 60, 90, 120].map((v) => `<option value="${v}"${CFG.slotDurationMin === v ? ' selected' : ''}>${v} minutes</option>`).join('')}</select>
          <span class="field__hint">Changing this rebuilds the slot grid for future dates.</span></label>
        ${f('slotCapacity', 'Farmers per slot', CFG.slotCapacity, 'Used for every new slot.', 'min="1" max="60"')}
        ${f('limitedThresholdPct', 'Limited threshold (%)', CFG.limitedThresholdPct, 'At or below this share remaining, a slot reads as Limited.', 'min="1" max="90"')}
        ${f('maxActiveBookingsPerFarmer', 'Active bookings per farmer', CFG.maxActiveBookingsPerFarmer, 'Per procurement cycle.', 'min="1" max="5"')}
      </div></div>
    <div class="card"><h2 class="card__title">Arrival & changes</h2>
      <div class="grid grid--2">
        ${f('lateToleranceMin', 'Late arrival tolerance (minutes)', CFG.lateToleranceMin, 'After this, a booking may be marked missed.', 'min="0" max="240"')}
        ${f('cancellationDeadlineHrs', 'Cancellation deadline (hours before slot)', CFG.cancellationDeadlineHrs, 'Applies to cancellation and rescheduling.', 'min="0" max="72"')}
        ${f('avgProcessingMin', 'Average processing time (minutes)', CFG.avgProcessingMin, 'Used for the estimated waiting time.', 'min="1" max="60"')}
        ${f('activeCounters', 'Active counters', CFG.activeCounters, 'Parallel counters shorten the estimate.', 'min="1" max="10"')}
      </div>
      <label class="checkline"><input type="checkbox" id="cfg-reschedulingAllowed" ${CFG.reschedulingAllowed ? 'checked' : ''}><span>Allow farmers to reschedule a confirmed booking</span></label>
      <label class="checkline"><input type="checkbox" id="cfg-requireApprovalBeforeBooking" ${CFG.requireApprovalBeforeBooking ? 'checked' : ''}><span>Require an approved registration before slot booking</span></label>
    </div>
    <div class="card"><h2 class="card__title">Congestion thresholds</h2>
      <div class="grid grid--2">
        ${f('congestionLowMax', 'Low congestion up to', CFG.congestionLowMax, 'Farmers waiting.', 'min="1" max="200"')}
        ${f('congestionModerateMax', 'Moderate congestion up to', CFG.congestionModerateMax, 'Above this reads as high congestion.', 'min="2" max="500"')}
      </div></div>
    <div class="card"><h2 class="card__title">Scheme document requirements</h2>
      <label class="checkline"><input type="checkbox" id="cfg-requireIdDocument" ${CFG.requireIdDocument ? 'checked' : ''}><span>Identity document upload required</span></label>
      <label class="checkline"><input type="checkbox" id="cfg-requireBankDocument" ${CFG.requireBankDocument ? 'checked' : ''}><span>Bank proof required (passbook or cancelled cheque)</span></label>
      <label class="checkline"><input type="checkbox" id="cfg-requireLandDocument" ${CFG.requireLandDocument ? 'checked' : ''}><span>Land or eligibility proof required</span></label>
    </div>
    <div class="row row--end"><button class="btn btn--primary" data-act="save-cfg">Save rules</button></div>
  </div>`;
}

function adminFarmers() {
  return `<div class="pwrap pwrap--wide">
    <h1 class="ptitle">Registered farmers</h1>
    <p class="plead">Identity and bank numbers stay masked here, as they do everywhere else in the system.</p>
    <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr>
      <th>Farmer ID</th><th>Name</th><th>Village</th><th>Mobile</th><th>Type</th><th>Identity</th><th>Bank</th><th>Status</th><th>Current stage</th></tr></thead><tbody>
    ${DB.farmers.map((f) => `<tr><td>${esc(f.farmerId || '—')}</td><td>${esc(f.fullName)}</td><td>${esc(f.village)}</td><td>${maskMobile(f.mobile)}</td>
      <td>${esc(f.farmerType || '—')}</td><td>${maskId(f.identityDocumentNumber, f.identityDocumentType)}</td><td>${maskAcct(f.accountNumber)}</td>
      <td>${f.registrationStatus === 'APPROVED' ? pill('ok', 'Approved') : f.registrationStatus === 'REJECTED' ? pill('bad', 'Rejected') : pill('wait', 'Pending')}</td>
      <td>${esc(stageTitle(f.stage))}</td></tr>`).join('')}
    </tbody></table></div></div></div>`;
}

/* ---------- display wall ---------- */
function viewDisplayWall() {
  const centre = DB.centres.find((c) => c.id === S.officer.centreId);
  const list = DB.tokens.filter((t) => t.centreId === centre.id && t.date === TODAY && t.status !== 'CANCELLED').sort((a, b) => a.seq - b.seq);
  const serving = list.find((t) => t.status === 'SERVING');
  const next = list.filter((t) => t.status === 'IN_QUEUE').slice(0, 8);
  const quality = list.filter((t) => t.qualityToken && STAGE_INDEX[t.stage] < STAGE_INDEX.WEIGHED);
  return `<div class="display-wall">
    <div class="row row--between">
      <div><p style="font-weight:700;letter-spacing:.02em">${esc(centre.name)}</p>
      <p style="opacity:.75">${fmtLongDate(TODAY)} · ${fmtTime(centre.openHour)} – ${fmtTime(centre.closeHour)}</p></div>
      <div class="row"><select id="officer-centre" style="max-width:260px">${DB.centres.map((c) => `<option value="${c.id}"${c.id === centre.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <button class="pbar__btn" data-act="switch">Switch interface</button><button class="pbar__btn" data-act="exit">Close</button></div>
    </div>
    <div class="grid grid--2 mt">
      <div class="wall__card"><p style="opacity:.75">Now serving</p>
        <p class="wall__now">${esc(serving ? serving.token : '—')}</p>
        <p style="opacity:.8">${serving ? esc(serving.farmerName) + ' · ' + esc(stageTitle(serving.stage)) : 'Counter idle'}</p></div>
      <div class="wall__card"><p style="opacity:.75">Next in the main queue</p>
        <div class="wall__list mt">${next.length ? next.map((t) => `<span class="wall__tok">${esc(t.token)}</span>`).join('') : '<span style="opacity:.7">Queue empty</span>'}</div>
        <p style="opacity:.75;margin-top:1rem">Estimated waiting time for the last token shown: ${next.length ? etaMinutes(farmersAhead(next[next.length - 1]), centre.id) : 0} minutes</p></div>
    </div>
    <div class="wall__card mt"><p style="opacity:.75">Quality tokens in the sections</p>
      <div class="wall__list mt">${quality.length ? quality.map((t) => `<span class="wall__tok">${esc(t.qualityToken)} · ${esc(t.section)}</span>`).join('') : '<span style="opacity:.7">No farmer in a section right now</span>'}</div>
      <p style="opacity:.75;margin-top:1rem">Green means fair average quality, amber a minor deviation, red below specification. The grade is written on every token so colour is never the only signal.</p></div>
  </div>`;
}

/* ---------- officer actions ---------- */
function findToken(tok) { return DB.tokens.find((t) => t.token === tok); }

/* Officer check-in input accepts a token number (PUN-1042) OR the farmer's registered mobile number.
   Mobile -> existing farmer (farmerId) -> that farmer's existing booking -> that booking's existing token.
   Read-only: never creates a farmer, booking or token and never touches seeded data. */
const normMobile = (v) => { const d = String(v == null ? '' : v).replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; };
/* A seeded demo farmer can exist in the loaded DB without their seeded booking (data saved before the booking was
   seeded, or an empty bookings list in the backend). Re-attach the ORIGINAL seeded booking + token, once, and only when
   the farmer has no booking record at all (a cancelled/missed booking is a record and is never resurrected) and the
   ids do not clash with anything already there, so duplicates are impossible. */
function restoreSeededBookingIfMissing(farmerIds) {
  let restored = false;
  farmerIds.forEach((fid) => {
    const hasAnyBooking = DB.bookings.some((b) => b.farmerId === fid);
    SEED_SNAPSHOT.bookings.filter((b) => b.farmerId === fid).forEach((b) => {
      const t = SEED_SNAPSHOT.tokens.find((x) => x.bookingId === b.bookingId);
      if (!t) return;
      const tokenClash = DB.tokens.some((x) => x.bookingId === b.bookingId || (x.token === t.token && x.centreId === t.centreId && x.date === t.date));
      /* booking record is there but its token is missing: re-attach ONLY the token (never a second booking) */
      if (DB.bookings.some((x) => x.bookingId === b.bookingId)) {
        if (!tokenClash) { DB.tokens.push(JSON.parse(JSON.stringify(t))); restored = true; }
        return;
      }
      if (hasAnyBooking) return;
      const clash = DB.bookings.some((x) => x.bookingId === b.bookingId || x.procurementId === b.procurementId) || tokenClash;
      if (clash) return;
      DB.bookings.push(JSON.parse(JSON.stringify(b))); DB.tokens.push(JSON.parse(JSON.stringify(t))); restored = true;
    });
  });
  return restored;
}
/* A masked number as it can be read off the screen (98XXXXXX21, +91 XXXXX 01842) -> RegExp, else null. */
function maskedMobileRegExp(raw) {
  let m = String(raw == null ? '' : raw).toUpperCase().replace(/[\s\-+()]/g, '').replace(/[\u2022*]/g, 'X');
  if (!/^\d*X+\d*$/.test(m)) return null;
  if (m.length > 10) m = m.slice(-10);
  return m.length === 10 ? new RegExp('^' + m.replace(/X/g, '\\d') + '$') : null;
}
function resolveTokenInput(raw) {
  const s = String(raw == null ? '' : raw).trim().toUpperCase();
  if (!s) return { token: null, error: 'Enter a token number or the farmer\u2019s registered mobile number first.' };
  const direct = findToken(s) || findToken(s.replace(/\s+/g, '').replace(/^([A-Z]+)-?(\d+)$/, '$1-$2'));
  if (direct) return { token: direct, error: '' };
  const maskRe = maskedMobileRegExp(s);
  if (!maskRe && (/[A-Z]/.test(s) || normMobile(s).length !== 10)) return { token: null, error: 'No booking found for token ' + s };
  const mob = normMobile(s);
  const farmers = DB.farmers.filter((f) => (maskRe ? maskRe.test(normMobile(f.mobile)) : normMobile(f.mobile) === mob));
  if (!farmers.length) return { token: null, error: 'No registered farmer found for mobile ' + (maskRe ? s : mob) + '.' };
  if (maskRe && new Set(farmers.map((f) => f.farmerId || f.applicationId)).size > 1) return { token: null, error: 'More than one farmer matches that masked number. Enter the full 10-digit mobile number.' };
  const ids = farmers.map((f) => f.farmerId).filter(Boolean);
  restoreSeededBookingIfMissing(ids);
  const cands = DB.bookings
    .filter((b) => ids.includes(b.farmerId) && !['CANCELLED', 'RESCHEDULED', 'MISSED'].includes(b.bookingStatus))
    .map((b) => ({ b, t: tokenForBooking(b.bookingId) }))
    .filter((x) => x.t && x.t.status !== 'CANCELLED');
  if (!cands.length) return { token: null, error: farmers[0].fullName + ' (' + farmers[0].farmerId + ') has no active booking.' };
  const rank = (x) => (x.t.date === TODAY ? (x.t.centreId === S.officer.centreId ? 0 : 1) : (x.t.date > TODAY ? 2 : 3))
    + (['CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'].includes(x.b.bookingStatus) ? 0 : 10);
  cands.sort((a, b) => rank(a) - rank(b) || (a.t.date > b.t.date ? 1 : a.t.date < b.t.date ? -1 : 0));
  return { token: cands[0].t, error: '' };
}

function handleOfficerAction(a, el, e) {
  switch (a) {
    case 'lookup-token': {
      e.preventDefault(); const raw = ($('#scan-token').value || '').trim();
      if (!raw) { toast('Enter a token number or the farmer\u2019s registered mobile number first.', true); $('#scan-token').focus(); return true; }
      const hit = resolveTokenInput(raw);
      if (!hit.token) { toast(hit.error, true); return true; }
      S.officer.lookupToken = hit.token.token; render(); return true;
    }
    case 'clear-lookup': e.preventDefault(); S.officer.lookupToken = null; render(); return true;
    case 'checkin': case 'scan': {
      e.preventDefault();
      let tok = a === 'scan' ? ($('#scan-token').value || '').trim().toUpperCase() : el.dataset.id;
      let t;
      if (a === 'scan') {
        const hit = resolveTokenInput(tok);
        if (!hit.token) { toast(hit.error, true); return true; }
        t = hit.token; tok = t.token;
      } else {
        t = findToken(tok);
        if (!t) { toast('No booking found for token ' + tok, true); return true; }
      }
      if (t.date !== TODAY) { toast(`Token ${tok} is booked for ${fmtDate(t.date)}, not today.`, true); return true; }
      if (t.checkInTime) { toast(`${tok} is already checked in at ${t.checkInTime}.`, true); return true; }
      t.checkInTime = nowTime(); t.status = 'IN_QUEUE';
      const bk = DB.bookings.find((b) => b.bookingId === t.bookingId); if (bk) bk.bookingStatus = 'CHECKED_IN';
      setStage(t, 'CHECKED_IN', 'You are checked in.');
      logEvent(`${t.token} checked in (${t.farmerName})`);
      toast(`${t.token} checked in at ${t.checkInTime}`); render(); return true;
    }
    case 'mark-missed': {
      e.preventDefault();
      const t = findToken(el.dataset.id);
      askConfirm('Mark this slot as missed?', `Token ${esc(t.token)} has not arrived. Marking it missed keeps the booking record and does not cancel it automatically.`, 'Mark missed', () => {
        t.status = 'MISSED';
        const bk = DB.bookings.find((b) => b.bookingId === t.bookingId); if (bk) { bk.bookingStatus = 'MISSED'; bk.history.push({ at: new Date().toISOString(), event: 'Marked missed by the centre' }); }
        notify(t.farmerId, 'Your assigned slot has been missed.', 'Please check available slots or contact the procurement centre.');
        logEvent(`${t.token} marked missed`); toast(`${t.token} marked missed.`); render();
      });
      return true;
    }
    case 'verify-gate': {
      e.preventDefault(); const t = findToken(el.dataset.id);
      setStage(t, 'VERIFICATION_COMPLETE', 'Your details were verified at the gate.');
      logEvent(`${t.token} verified at the gate`); toast(`${t.token} verified.`); render(); return true;
    }
    case 'send-quality': {
      e.preventDefault(); const t = findToken(el.dataset.id);
      setStage(t, 'QUALITY_PENDING', 'You are in the quality assessment queue.');
      toast(`${t.token} sent to quality assessment.`); render(); return true;
    }
    case 'oq-cam': e.preventDefault(); { const i = $('#oq-cam'); if (i) i.click(); } return true;
    case 'oq-up': e.preventDefault(); { const i = $('#oq-up'); if (i) i.click(); } return true;
    case 'oq-gps': e.preventDefault(); oqCaptureGps(el.dataset.id); return true;
    case 'oq-remove': { e.preventDefault(); const o = oqOf(findToken(el.dataset.id)); o.images = o.images.filter((im) => im.id !== el.dataset.img); if (!o.images.length) o.capturedAt = null; render(); return true; }
    case 'oq-clear': { e.preventDefault(); const o = oqOf(findToken(el.dataset.id)); o.images = []; o.capturedAt = null; render(); return true; }
    case 'oq-start': e.preventDefault(); oqRunAssessment(el.dataset.id); return true;
    case 'oq-confirm': {
      e.preventDefault(); const t = findToken(el.dataset.id), o = oqOf(t);
      const g = completeQualityStage(t, oqRouteFor(o.result.gradeA_percentage));
      o.status = 'RECORDED'; o.recordedAt = new Date().toISOString();
      oqNotify(t, 'Quality assessment recorded', `The officer has confirmed your assessment for batch ${o.batchId} (report ${o.reportId}). Next step: weighing.`);
      toast(`Assessment recorded · ${t.qualityToken} · ${g.section}`); render(); return true;
    }
    case 'oq-flag': {
      e.preventDefault(); const t = findToken(el.dataset.id), o = oqOf(t);
      askConfirm('Flag this batch for manual review?', 'Use this only for unclear images or unusual cases. The batch will not move to weighing until it is re-assessed.', 'Flag batch', (reason) => {
        o.status = 'FLAGGED'; o.flagReason = reason; oqNotify(t, 'Batch flagged for manual review', `Batch ${o.batchId} needs a manual review (${reason || 'unclear images'}). Please wait for the officer.`); logEvent(`${t.token} flagged for manual review (${o.batchId})`); toast('Batch flagged for manual review.'); render();
      }, true);
      return true;
    }
    case 'oq-reassess': {
      e.preventDefault(); const o = oqOf(findToken(el.dataset.id));
      o.status = 'BATCH_PENDING'; o.result = null; o.images = []; o.capturedAt = null; o.flagReason = null; render(); return true;
    }
    case 'select-token': e.preventDefault(); S.officer.selectedToken = el.dataset.id; render(); return true;
    case 'clear-sel': e.preventDefault(); S.officer.selectedToken = null; render(); return true;
    case 'grade': {
      e.preventDefault();
      const t = findToken(el.dataset.id); const g = gradeOf(el.dataset.grade);
      t.moisture = Number(($('#q-moisture') || {}).value || 11.2);
      t.foreignMatter = Number(($('#q-fm') || {}).value || 0.8);
      t.qualityGrade = g.key; t.qualityLabel = g.label;
      setStage(t, 'QUALITY_ASSESSED');
      t.qualityToken = nextQualityToken(g.key);
      setStage(t, 'QUALITY_TOKEN_GENERATED');
      t.section = g.section;
      setStage(t, 'SECTION_ASSIGNED', `Quality token ${t.qualityToken} issued.`);
      S.officer.selectedToken = null;
      logEvent(`${t.token} graded ${g.key} — quality token ${t.qualityToken}, ${g.section}`);
      toast(`Quality token ${t.qualityToken} issued · ${g.section}`); render(); return true;
    }
    case 'to-weighing': {
      e.preventDefault(); const t = findToken(el.dataset.id);
      setStage(t, 'WEIGHING_PENDING', 'Please move to the weighbridge.');
      toast(`${t.token} moved to weighing.`); render(); return true;
    }
    case 'select-weigh': e.preventDefault(); S.officer.weighToken = el.dataset.id; S.view = 'weighing'; render(); return true;
    case 'clear-weigh': e.preventDefault(); S.officer.weighToken = null; render(); return true;
    case 'save-weigh': {
      e.preventDefault(); const t = findToken(el.dataset.id);
      const qty = Number($('#w-qty').value), rate = Number($('#w-rate').value), ded = Number($('#w-ded').value || 0);
      if (!(qty > 0) || !(rate > 0)) { toast('Enter a weight and a rate greater than zero.', true); return true; }
      t.weightQtl = Math.round(qty * 100) / 100; t.ratePerQtl = rate; t.deductions = ded;
      t.amount = Math.round((qty * rate - ded) * 100) / 100;
      setStage(t, 'WEIGHED');
      setStage(t, 'PROCUREMENT_COMPLETE', `Procurement recorded: ${t.weightQtl} quintal, ${rupee(t.amount)}.`);
      t.status = 'COMPLETED';
      const bk = DB.bookings.find((b) => b.bookingId === t.bookingId); if (bk) bk.bookingStatus = 'COMPLETED';
      S.officer.weighToken = null;
      logEvent(`${t.token} weighed ${t.weightQtl} qtl — ${rupee(t.amount)}`);
      toast('Procurement recorded.'); render(); return true;
    }
    case 'pay-init': {
      e.preventDefault(); const t = findToken(el.dataset.id);
      t.paymentStatus = 'INITIATED'; setStage(t, 'PAYMENT_PENDING', 'Your payment has been initiated.');
      logEvent(`Payment initiated for ${t.procurementId}`); toast('Payment initiated.'); render(); return true;
    }
    case 'pay-complete': {
      e.preventDefault(); const t = findToken(el.dataset.id);
      askConfirm('Confirm payment credited?', `This marks ${rupee(t.amount)} as credited to the farmer's account and issues the receipt. Simulated — no real transfer happens.`, 'Mark credited', () => {
        t.paymentStatus = 'PAID'; t.paymentRef = 'UTR' + Date.now().toString().slice(-12); t.receiptNo = nextReceipt();
        setStage(t, 'PAYMENT_COMPLETE', `Payment of ${rupee(t.amount)} credited.`);
        logEvent(`Payment credited for ${t.procurementId} — ${t.paymentRef}`);
        toast('Payment marked credited.'); render();
      });
      return true;
    }
    case 'open-token': {
      e.preventDefault();
      const t = findToken(el.dataset.id);
      const i = STAGE_INDEX[t.stage];
      if (i < STAGE_INDEX.QUALITY_PENDING) S.view = 'checkin';
      else if (i < STAGE_INDEX.SECTION_ASSIGNED) { S.officer.selectedToken = t.token; S.view = 'quality'; }
      else if (i < STAGE_INDEX.WEIGHED) { S.officer.weighToken = t.token; S.view = 'weighing'; }
      else S.view = 'pay';
      render(); return true;
    }
    case 'open-app': e.preventDefault(); S.appId = el.dataset.id; S.view = 'appdetail';
      { const app = DB.applications.find((x) => x.applicationId === S.appId); if (app && app.status === 'SUBMITTED') app.status = 'UNDER_REVIEW'; }
      render(); return true;
    case 'app-approve': {
      e.preventDefault();
      const app = DB.applications.find((x) => x.applicationId === el.dataset.id);
      const f = DB.farmers.find((x) => x.applicationId === app.applicationId);
      const missing = CHECKS.filter(([k]) => !app.checks[k]);
      if (missing.length) { toast(`Complete the checklist first — ${missing.length} item${missing.length === 1 ? '' : 's'} still unchecked.`, true); return true; }
      askConfirm('Approve this registration?', `Approving generates a permanent Farmer ID for ${esc(f.fullName)} and unlocks slot booking. This prototype Farmer ID is not an official government identifier.`, 'Approve and issue Farmer ID', () => {
        f.farmerId = nextFarmerId(); f.registrationStatus = 'APPROVED'; f.kycStatus = 'VERIFIED'; f.bankStatus = 'VERIFIED';
        f.approvedAt = TODAY; f.stage = 'DOCUMENT_VERIFIED';
        app.status = 'FARMER_ID_GENERATED'; app.approvedAt = TODAY;
        notify(f.farmerId, 'Your registration is approved.', `Farmer ID ${f.farmerId} has been generated. You can book a procurement slot now.`);
        logEvent(`${app.applicationId} approved — Farmer ID ${f.farmerId}`);
        toast(`Approved · Farmer ID ${f.farmerId} generated.`); render();
      });
      return true;
    }
    case 'app-reject': case 'app-resubmit': {
      e.preventDefault();
      const app = DB.applications.find((x) => x.applicationId === el.dataset.id);
      const f = DB.farmers.find((x) => x.applicationId === app.applicationId);
      const reject = a === 'app-reject';
      askConfirm(reject ? 'Reject this application?' : 'Request resubmission?',
        reject ? 'The farmer sees the reason and which information needs correction, and can submit a corrected application.'
               : 'The farmer is asked to correct the information you name below and submit again.',
        reject ? 'Reject application' : 'Request resubmission', (reason) => {
          app.status = reject ? 'REJECTED' : 'RESUBMISSION_REQUIRED'; app.reason = reason;
          f.registrationStatus = reject ? 'REJECTED' : 'RESUBMISSION_REQUIRED';
          logEvent(`${app.applicationId} ${reject ? 'rejected' : 'sent back for resubmission'}`);
          toast(reject ? 'Application rejected.' : 'Resubmission requested.'); render();
        }, true);
      return true;
    }
    default: return false;
  }
}

/* ---------- admin actions ---------- */
function handleAdminAction(a, el, e) {
  switch (a) {
    case 'toggle-centre': {
      e.preventDefault(); const c = DB.centres.find((x) => x.id === el.dataset.id);
      c.status = c.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      DB.slots = {}; logEvent(`${c.name} ${c.status === 'ACTIVE' ? 'activated' : 'deactivated'}`);
      toast(`${c.name} is now ${c.status === 'ACTIVE' ? 'active' : 'deactivated'}.`); render(); return true;
    }
    case 'toggle-sched': {
      e.preventDefault(); const s = DB.schedules.find((x) => x.id === el.dataset.id);
      s.status = s.status === 'OPEN' ? 'CLOSED' : 'OPEN'; DB.slots = {};
      logEvent(`Schedule ${s.id} ${s.status.toLowerCase()}`); toast(`Schedule ${s.status === 'OPEN' ? 'opened' : 'closed'}.`); render(); return true;
    }
    case 'toggle-commodity': {
      e.preventDefault(); const c = DB.commodities.find((x) => x.id === el.dataset.id);
      c.status = c.status === 'OPEN' ? 'CLOSED' : 'OPEN';
      logEvent(`${c.name} procurement ${c.status.toLowerCase()}`); toast(`${c.name} procurement ${c.status === 'OPEN' ? 'opened' : 'closed'}.`); render(); return true;
    }
    case 'save-cfg': {
      e.preventDefault();
      const num = (id) => { const el2 = $('#cfg-' + id); return el2 ? Number(el2.value) : CFG[id]; };
      const bool = (id) => { const el2 = $('#cfg-' + id); return el2 ? el2.checked : CFG[id]; };
      const prevDuration = CFG.slotDurationMin, prevCap = CFG.slotCapacity;
      ['slotDurationMin', 'slotCapacity', 'limitedThresholdPct', 'maxActiveBookingsPerFarmer', 'lateToleranceMin', 'cancellationDeadlineHrs', 'avgProcessingMin', 'activeCounters', 'congestionLowMax', 'congestionModerateMax']
        .forEach((k) => { const v = num(k); if (!isNaN(v) && v > 0) CFG[k] = v; });
      ['reschedulingAllowed', 'requireApprovalBeforeBooking', 'requireIdDocument', 'requireBankDocument', 'requireLandDocument'].forEach((k) => { CFG[k] = bool(k); });
      if (CFG.congestionModerateMax <= CFG.congestionLowMax) CFG.congestionModerateMax = CFG.congestionLowMax + 5;
      if (CFG.slotDurationMin !== prevDuration || CFG.slotCapacity !== prevCap) DB.slots = {};
      logEvent('Booking rules updated');
      toast('Rules saved. Availability updates immediately.'); render(); return true;
    }
    default: return false;
  }
}

/* ---------- inline admin/officer inputs ---------- */
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'officer-centre') { S.officer.centreId = t.value; S.officer.selectedToken = null; S.officer.weighToken = null; render(); return; }
  if (t.dataset && t.dataset.oqFiles) { oqAddFiles(t.dataset.oqFiles, t.files || []); t.value = ''; return; }
  const chk = t.closest('[data-check]');
  if (chk) {
    const app = DB.applications.find((x) => x.applicationId === S.appId);
    if (app) {
      app.checks[chk.dataset.check] = chk.checked;
      const counter = $('#check-count');
      if (counter) counter.textContent = `${CHECKS.filter(([k]) => app.checks[k]).length} of ${CHECKS.length} checked`;
      scheduleBackendSave();
    }
    return;
  }
  if (t.dataset && t.dataset.centre) {
    const c = DB.centres.find((x) => x.id === t.dataset.centre);
    const v = Number(t.value); if (!isNaN(v)) { c[t.dataset.key] = v; DB.slots = {}; toast('Centre updated.'); }
    return;
  }
  if (t.dataset && t.dataset.sched) {
    const s = DB.schedules.find((x) => x.id === t.dataset.sched);
    const v = Number(t.value); if (!isNaN(v)) { s.dailyCapacity = v; toast('Schedule capacity updated.'); }
  }
});

/* Last statement of startup: every const/function above exists, so the stored session can be rendered safely. */
resumePortalHook = resumePortal;
restoreSession();
}
