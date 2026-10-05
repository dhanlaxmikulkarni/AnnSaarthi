import os
from dotenv import load_dotenv
from google import genai

load_dotenv()

key = os.getenv("GEMINI_API_KEY")

if not key:
    print("❌ GEMINI_API_KEY was not found.")
    exit()

print("✅ API key was found.")

client = genai.Client(api_key=key)

try:
    response = client.models.generate_content(
        model="gemini-3.8-flash",
        contents="Reply with exactly: Gemini API is working."
    )

    print("✅ Gemini API is working!")
    print("Gemini response:", response.text)

except Exception as e:
    print("❌ Gemini API test failed.")
    print(type(e).__name__)
    print(e)