import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

app = FastAPI(title="AI Interview Coach")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def groq_api_key() -> str:
    return os.getenv("GROQ_API_KEY", "").strip()


@app.get("/health")
def health():
    return {
        "status": "ok",
        "groq_configured": bool(groq_api_key()),
    }
