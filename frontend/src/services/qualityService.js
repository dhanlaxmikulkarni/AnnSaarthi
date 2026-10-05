/* Onion quality assessment service.
   assessOnionImages() calls the Flask backend (POST /api/quality/assess), which uses Gemini Vision.
   Input : images [{id, name, data(dataURL)}], ctx {batchId}
   Output: { gradeA_percentage, urs_percentage, damaged, rotten, sprouted, undersized, total_assessed, analyzed_images, isDemo:false }
   Throws an Error (with a user-readable message) if no onion is detected or the image is unusable. */
const ENDPOINT = '/api/quality/assess';

export async function assessOnionImages(images, ctx) {
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batchId: ctx && ctx.batchId,
        images: images.map(({ id, name, data }) => ({ id, name, data })),
      }),
    });
  } catch (e) {
    throw new Error('Quality service is unreachable. Please check that the backend is running.');
  }

  let body = null;
  try { body = await res.json(); } catch (e) { /* non-JSON response */ }

  if (!res.ok || !body || body.error) {
    const err = new Error((body && body.error) || 'Quality assessment failed. Please try again.');
    err.code = body && body.code;
    throw err;
  }

  const { gradeA_percentage, urs_percentage, damaged, rotten, sprouted, undersized, total_assessed, analyzed_images } = body;
  return { gradeA_percentage, urs_percentage, damaged, rotten, sprouted, undersized, total_assessed, analyzed_images, isDemo: false };
}