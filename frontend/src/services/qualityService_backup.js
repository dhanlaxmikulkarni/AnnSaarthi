/* Onion quality assessment service.
   assessOnionImages() is the single integration point for a real image-processing model.
   Input : images [{id, name, data(dataURL)}], ctx {batchId}
   Output: { gradeA_percentage, urs_percentage, damaged, rotten, sprouted, undersized, total_assessed, analyzed_images }
   To connect a real service later: implement it behind POST /api/quality/assess (backend/app.py)
   and call it from here; the portal UI needs no changes.
   The implementation below is the ORIGINAL prototype's demo placeholder (isDemo: true) — not a real measurement. */
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h; };

export async function assessOnionImages(images, ctx) {
  const h = hash(String(ctx.batchId) + images.length), total = 120;
  const damaged = 4 + (h % 6), rotten = 2 + ((h >> 3) % 4), sprouted = 3 + ((h >> 6) % 5), undersized = 5 + ((h >> 9) % 7);
  const gradeA = Math.round(((total - damaged - rotten - sprouted - undersized) / total) * 100);
  return { gradeA_percentage: gradeA, urs_percentage: 100 - gradeA, damaged, rotten, sprouted, undersized, total_assessed: total, analyzed_images: images.length, isDemo: true };
}
