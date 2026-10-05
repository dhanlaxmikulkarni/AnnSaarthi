"""Real onion quality assessment via Gemini Vision. Key is read from GEMINI_API_KEY (backend only)."""
import base64
import os
import re
import time

from flask import Blueprint, jsonify, request
from pydantic import BaseModel

try:  # optional: load backend/.env if python-dotenv is installed
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from google import genai
from google.genai import types

quality_bp = Blueprint("quality", __name__)

MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.8-flash")
MAX_IMAGES = 5
MAX_IMAGE_BYTES = 8 * 1024 * 1024
ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}
NO_ONION_MSG = "No onion sample detected. Please upload a clear onion sample."
UNUSABLE_MSG = "The image is not clear enough to assess. Please upload a clear, well-lit photo of the onion sample."

PROMPT = """You are an agricultural quality inspector for onion procurement.
Look ONLY at what is actually visible in this image. Do not guess.

1. onion_visible: true only if real onion bulbs are clearly visible. Any other subject
   (other vegetables, people, documents, empty scenes, drawings, screens) -> false.
2. image_usable: true only if the image is sharp, lit and close enough to judge defects.
3. onion_count: number of individual onion bulbs you can clearly see (0 if none).
4. Assign each visible onion to AT MOST ONE category, its single most serious defect,
   in this order of priority: rotten, damaged, sprouted, undersized.
   Report each category as a percentage of onion_count (0-100). The four values must
   sum to 100 or less. Healthy onions are not counted in any category.
   - rotten: soft, mouldy, black or decaying
   - damaged: cuts, bruises, cracks, peeled or crushed skin, pest marks
   - sprouted: green shoots visible
   - undersized: clearly small compared with the other onions in the frame
5. reason: one short sentence describing what you see.
If onion_visible is false or image_usable is false, set all percentages and onion_count to 0."""


class OnionAssessment(BaseModel):
    onion_visible: bool
    image_usable: bool
    onion_count: int
    damaged_pct: float
    rotten_pct: float
    sprouted_pct: float
    undersized_pct: float
    reason: str


class AssessError(Exception):
    def __init__(self, message, code, status=422):
        super().__init__(message)
        self.message, self.code, self.status = message, code, status


def _decode(data_url):
    m = re.match(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$", data_url or "", re.DOTALL)
    if not m or m.group(1).lower() not in ALLOWED_MIME:
        raise AssessError("Unsupported image. Please upload a JPG, PNG or WEBP photo.", "BAD_IMAGE", 400)
    try:
        raw = base64.b64decode(m.group(2), validate=False)
    except Exception:
        raise AssessError("Could not read the uploaded image.", "BAD_IMAGE", 400)
    if not raw or len(raw) > MAX_IMAGE_BYTES:
        raise AssessError("Image is empty or larger than 8 MB.", "BAD_IMAGE", 400)
    return m.group(1).lower(), raw


def _inspect(client, mime, raw):
    max_attempts = 3

    for attempt in range(1, max_attempts + 1):
        try:
            print(f"Gemini assessment attempt {attempt}/{max_attempts}...")

            resp = client.models.generate_content(
                model=MODEL,
                contents=[
                    types.Part.from_bytes(data=raw, mime_type=mime),
                    PROMPT
                ],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=OnionAssessment,
                    temperature=0,
                ),
            )

            result = resp.parsed

            if result is None:
                raise ValueError("Gemini returned an empty response.")

            print("Gemini assessment successful.")
            return result

        except Exception as e:
            error_text = str(e)

            print(f"Gemini error on attempt {attempt}: {repr(e)}")

            # Retry temporary Gemini availability/rate-limit errors
            if ("503" in error_text or
                "UNAVAILABLE" in error_text or
                "429" in error_text or
                "RESOURCE_EXHAUSTED" in error_text):

                if attempt < max_attempts:
                    wait_time = 2 ** attempt
                    print(
                        f"Gemini is temporarily unavailable. "
                        f"Retrying in {wait_time} seconds..."
                    )
                    time.sleep(wait_time)
                    continue

            # Do not retry permanent errors
            raise AssessError(
                "The AI quality service is temporarily unavailable. Please try again.",
                "AI_ERROR",
                502
            )

def _clamp(v):
    return max(0.0, min(100.0, float(v or 0)))


@quality_bp.route("/api/quality/assess", methods=["POST"])
def assess():
    api_key = os.environ.get("GEMINI_API_KEY")

    if not api_key:
        return jsonify(
            error="Quality service is not configured (GEMINI_API_KEY missing on the server).",
            code="NO_KEY"
        ), 500

    payload = request.get_json(silent=True) or {}
    images = payload.get("images") or []

    if not images:
        return jsonify(
            error="No image received.",
            code="BAD_IMAGE"
        ), 400

    if len(images) > MAX_IMAGES:
        return jsonify(
            error=f"Please upload at most {MAX_IMAGES} images.",
            code="BAD_IMAGE"
        ), 400

    try:
        client = genai.Client(api_key=api_key)

        total = 0
        weighted = {
            "damaged": 0.0,
            "rotten": 0.0,
            "sprouted": 0.0,
            "undersized": 0.0
        }

        for img in images:
            mime, raw = _decode(img.get("data"))

            # Ask Gemini to inspect this image
            r = _inspect(client, mime, raw)

            # TEMPORARY DEBUG OUTPUT
            print("========================================")
            print("GEMINI RESULT:")
            print(r)
            print("========================================")

            label = img.get("name") or "image"

            if not r.onion_visible or r.onion_count < 1:
                raise AssessError(
                    NO_ONION_MSG if len(images) == 1
                    else f"{NO_ONION_MSG} ({label})",
                    "NO_ONION"
                )

            if not r.image_usable:
                raise AssessError(
                    UNUSABLE_MSG if len(images) == 1
                    else f"{UNUSABLE_MSG} ({label})",
                    "UNUSABLE"
                )

            pcts = {
                "damaged": _clamp(r.damaged_pct),
                "rotten": _clamp(r.rotten_pct),
                "sprouted": _clamp(r.sprouted_pct),
                "undersized": _clamp(r.undersized_pct)
            }

            s = sum(pcts.values())

            if s > 100:
                pcts = {
                    k: v * 100 / s
                    for k, v in pcts.items()
                }

            n = int(r.onion_count)

            total += n

            for k in weighted:
                weighted[k] += pcts[k] * n

        if total <= 0:
            raise AssessError(
                "No onions could be assessed in the uploaded image.",
                "NO_ONION"
            )

        # Calculate weighted defect percentages
        pct = {
            k: weighted[k] / total
            for k in weighted
        }

        defect = min(100.0, sum(pct.values()))
        grade_a = int(round(100 - defect))

        counts = {
            k: int(round(pct[k] * total / 100))
            for k in pct
        }

        return jsonify(
            gradeA_percentage=grade_a,
            urs_percentage=100 - grade_a,
            damaged=counts["damaged"],
            rotten=counts["rotten"],
            sprouted=counts["sprouted"],
            undersized=counts["undersized"],
            total_assessed=total,
            analyzed_images=len(images),
            isDemo=False
        )

    except AssessError as e:
        return jsonify(
            error=e.message,
            code=e.code
        ), e.status

    except Exception as e:
        print("GEMINI ERROR:", repr(e))

        return jsonify(
            error="The onion quality assessment service encountered an error.",
            code="GEMINI_ERROR",
            details=str(e)
        ), 500