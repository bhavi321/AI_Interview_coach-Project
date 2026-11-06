from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from ai import (
    ChatMessage,
    GroqNotConfigured,
    InterviewRequest,
    Report,
    generate_report,
    groq_api_key,
    next_interviewer_message,
)

load_dotenv()

app = FastAPI(title="AI Interview Coach")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class StartInterview(BaseModel):
    topic: str
    difficulty: str


class SubmitAnswer(BaseModel):
    topic: str
    difficulty: str
    messages: list[ChatMessage]
    answer: str = Field(min_length=1, max_length=8000)


class InterviewStep(BaseModel):
    message: str
    interview_ended: bool
    messages: list[ChatMessage]


@app.get("/health")
def health():
    return {
        "status": "ok",
        "groq_configured": bool(groq_api_key()),
    }


@app.post("/interview/start", response_model=InterviewStep)
def interview_start(body: StartInterview):
    request = InterviewRequest(topic=body.topic, difficulty=body.difficulty, messages=[])
    turn = _run(lambda: next_interviewer_message(request))
    messages = [ChatMessage(role="interviewer", content=turn.message)]
    return InterviewStep(message=turn.message, interview_ended=turn.interview_ended, messages=messages)


@app.post("/interview/answer", response_model=InterviewStep)
def interview_answer(body: SubmitAnswer):
    if not body.messages or body.messages[-1].role != "interviewer":
        raise HTTPException(status_code=400, detail="An interviewer question is required before an answer.")
    answer = " ".join(body.answer.split())
    if not answer:
        raise HTTPException(status_code=422, detail="Answer is required.")
    messages = list(body.messages) + [ChatMessage(role="candidate", content=answer)]
    request = InterviewRequest(topic=body.topic, difficulty=body.difficulty, messages=messages)
    turn = _run(lambda: next_interviewer_message(request))
    messages.append(ChatMessage(role="interviewer", content=turn.message))
    return InterviewStep(message=turn.message, interview_ended=turn.interview_ended, messages=messages)


@app.post("/interview/report", response_model=Report)
def interview_report(request: InterviewRequest):
    return _run(lambda: generate_report(request))


def _run(action):
    try:
        return action()
    except GroqNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
