from contextlib import asynccontextmanager
import logging
import os
import sys
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from ai import (
    MODEL,
    AIProviderError,
    ChatMessage,
    GroqNotConfigured,
    InterviewRequest,
    Report,
    generate_report,
    groq_api_key,
    next_interviewer_message,
)

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("ai_interview_coach")


@asynccontextmanager
async def lifespan(app: FastAPI):
  """Lifecycle context manager that prints server readiness and configuration."""
  key = groq_api_key()
  key_status = (
      "CONFIGURED (Ready)"
      if key
      else "MISSING (Set GROQ_API_KEY in backend/.env)"
  )
  port = os.getenv("PORT", "8000")

  banner = f"""
{"=" * 64}
  🎙️  AI Interview Coach - FastAPI Backend Server
{"=" * 64}
  • Server Port    : {port}
  • AI Model       : {MODEL}
  • Groq API Key   : {key_status}
  • Health Endpoint: /health
  • Documentation  : /docs
{"=" * 64}"""
  print(banner, flush=True)

  if not key:
    print(
        "  ⚠️  WARNING: GROQ_API_KEY is not configured.",
        file=sys.stderr,
        flush=True,
    )
    print(
        "     Calls to start interviews will fail until you provide a key.",
        file=sys.stderr,
        flush=True,
    )
    print(
        "     Get a free key at: https://console.groq.com/keys\n",
        file=sys.stderr,
        flush=True,
    )

  yield
  print("\n  🛑 AI Interview Coach Backend stopped.\n", flush=True)


app = FastAPI(
    title="AI Interview Coach API",
    description="Adaptive AI-powered technical mock interviews",
    version="1.0.0",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# Dynamic CORS Configuration (Localhost + Vercel + Custom Domains)
# ---------------------------------------------------------------------------
# Allow explicit domains from environment variables (comma-separated)
raw_origins = os.getenv("ALLOWED_ORIGINS", os.getenv("FRONTEND_URL", ""))
explicit_origins = [
    origin.strip().rstrip("/")
    for origin in raw_origins.split(",")
    if origin.strip()
]

# Regex matches localhost on any port AND all Vercel deployment URLs (*.vercel.app)
cors_origin_regex = os.getenv(
    "CORS_ORIGIN_REGEX",
    r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$|^https://.*\.vercel\.app$",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=explicit_origins if explicit_origins else [],
    allow_origin_regex=cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request & Response Models with Clean Validation
# ---------------------------------------------------------------------------
class StartInterview(BaseModel):
  topic: str = Field(
      ...,
      min_length=1,
      max_length=200,
      description="The technical subject to interview on",
  )
  difficulty: str = Field(
      default="medium", description="Difficulty: easy, medium, or hard"
  )

  @field_validator("topic")
  @classmethod
  def validate_topic(cls, v: str) -> str:
    cleaned = v.strip()
    if not cleaned:
      raise ValueError("Topic cannot be empty or only spaces.")
    return cleaned

  @field_validator("difficulty", mode="before")
  @classmethod
  def validate_difficulty(cls, v: str) -> str:
    cleaned = str(v).strip().lower()
    if cleaned not in ("easy", "medium", "hard"):
      raise ValueError("Difficulty must be 'easy', 'medium', or 'hard'.")
    return cleaned


class SubmitAnswer(BaseModel):
  topic: str = Field(..., min_length=1, max_length=200)
  difficulty: str = Field(default="medium")
  messages: list[ChatMessage] = Field(default_factory=list, max_length=60)
  answer: str = Field(
      ...,
      min_length=1,
      max_length=8000,
      description="The candidate's response",
  )

  @field_validator("topic")
  @classmethod
  def validate_topic(cls, v: str) -> str:
    cleaned = v.strip()
    if not cleaned:
      raise ValueError("Topic cannot be empty.")
    return cleaned

  @field_validator("difficulty", mode="before")
  @classmethod
  def validate_difficulty(cls, v: str) -> str:
    cleaned = str(v).strip().lower()
    if cleaned not in ("easy", "medium", "hard"):
      raise ValueError("Difficulty must be 'easy', 'medium', or 'hard'.")
    return cleaned

  @field_validator("answer")
  @classmethod
  def validate_answer(cls, v: str) -> str:
    cleaned = " ".join(v.split())
    if not cleaned:
      raise ValueError("Answer cannot be empty or only whitespace.")
    return cleaned


class InterviewStep(BaseModel):
  message: str
  interview_ended: bool
  messages: list[ChatMessage]


# ---------------------------------------------------------------------------
# Friendly Exception Handlers
# ---------------------------------------------------------------------------
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
):
  """Transform Pydantic raw validation error lists into clean, readable sentences."""
  errors = exc.errors()
  if errors:
    first_err = errors[0]
    field = first_err.get("loc", [""])[-1]
    msg = first_err.get("msg", "Invalid input.")
    if msg.startswith("Value error, "):
      msg = msg[len("Value error, ") :]
    friendly_msg = (
        f"Validation error on '{field}': {msg}"
        if field and field != "__root__"
        else msg
    )
  else:
    friendly_msg = "The request payload is invalid."

  return JSONResponse(status_code=422, content={"detail": friendly_msg})


@app.exception_handler(GroqNotConfigured)
async def groq_unconfigured_handler(request: Request, exc: GroqNotConfigured):
  return JSONResponse(status_code=503, content={"detail": str(exc)})


@app.exception_handler(AIProviderError)
async def ai_provider_error_handler(request: Request, exc: AIProviderError):
  return JSONResponse(
      status_code=exc.status_code, content={"detail": str(exc)}
  )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
  """Catch-all to prevent unhandled crashes and return a friendly 500 message."""
  logger.exception("Unhandled server exception on %s %s", request.method, request.url)
  return JSONResponse(
      status_code=500,
      content={
          "detail": (
              "An internal server error occurred while processing your"
              " request. Please try again."
          )
      },
  )


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
  """Quick status and readiness probe."""
  has_key = bool(groq_api_key())
  return {
      "status": "ok",
      "groq_configured": has_key,
      "model": MODEL,
      "message": (
          "Ready to conduct interviews."
          if has_key
          else "GROQ_API_KEY is not configured in backend/.env."
      ),
  }


@app.post("/interview/start", response_model=InterviewStep)
def interview_start(body: StartInterview):
  """Starts a new interview session and returns the interviewer's first greeting & question."""
  request = InterviewRequest(
      topic=body.topic, difficulty=body.difficulty, messages=[]
  )
  turn = next_interviewer_message(request)
  messages = [ChatMessage(role="interviewer", content=turn.message)]
  return InterviewStep(
      message=turn.message,
      interview_ended=turn.interview_ended,
      messages=messages,
  )


@app.post("/interview/answer", response_model=InterviewStep)
def interview_answer(body: SubmitAnswer):
  """Processes candidate's answer, evaluates understanding, and returns the next turn."""
  if not body.messages or body.messages[-1].role != "interviewer":
    raise HTTPException(
        status_code=400,
        detail="An interviewer question is required before submitting an answer.",
    )

  messages = list(body.messages) + [
      ChatMessage(role="candidate", content=body.answer)
  ]
  request = InterviewRequest(
      topic=body.topic, difficulty=body.difficulty, messages=messages
  )
  turn = next_interviewer_message(request)
  messages.append(ChatMessage(role="interviewer", content=turn.message))
  return InterviewStep(
      message=turn.message,
      interview_ended=turn.interview_ended,
      messages=messages,
  )


@app.post("/interview/report", response_model=Report)
def interview_report(request: InterviewRequest):
  """Evaluates the conversation history and generates the structured scorecard."""
  return generate_report(request)


# ---------------------------------------------------------------------------
# Entry point for cloud hosts (e.g., Render, Railway, Heroku)
# ---------------------------------------------------------------------------
if __name__ == "__main__":
  import uvicorn

  port = int(os.getenv("PORT", 8000))
  host = os.getenv("HOST", "0.0.0.0")
  uvicorn.run("main:app", host=host, port=port, reload=False)
