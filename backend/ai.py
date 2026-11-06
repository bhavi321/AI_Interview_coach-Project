import json
import os
from typing import Literal

from groq import APIError, Groq
from pydantic import BaseModel, Field, field_validator

MODEL = "llama-3.3-70b-versatile"

Difficulty = Literal["easy", "medium", "hard"]
Verdict = Literal["excellent", "good", "adequate", "weak"]
Result = Literal["Pass", "Fail"]

DIFFICULTY_GUIDANCE = {
    "easy": "Ask for basic definitions and recall. Stay on fundamentals.",
    "medium": "Ask applied problems. The candidate should use the idea, not only define it.",
    "hard": "Ask about trade-offs and system thinking. Press on design choices, constraints, and consequences.",
}


class GroqNotConfigured(Exception):
    pass


class ChatMessage(BaseModel):
    role: Literal["interviewer", "candidate"]
    content: str = Field(min_length=1, max_length=8000)


class InterviewRequest(BaseModel):
    topic: str = Field(min_length=1, max_length=200)
    difficulty: Difficulty
    messages: list[ChatMessage] = Field(default_factory=list, max_length=40)

    @field_validator("topic")
    @classmethod
    def strip_topic(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("topic is required")
        return cleaned

    @field_validator("difficulty", mode="before")
    @classmethod
    def normalize_difficulty(cls, value: str) -> str:
        return str(value).strip().lower()


class InterviewTurn(BaseModel):
    message: str
    interview_ended: bool


class Report(BaseModel):
    score: int = Field(ge=0, le=100)
    strengths: list[str]
    weaknesses: list[str]
    topics_to_revise: list[str]
    verdict: Verdict
    result: Result


def groq_api_key() -> str:
    return os.getenv("GROQ_API_KEY", "").strip()


def verdict_for(score: int) -> Verdict:
    if score >= 85:
        return "excellent"
    if score >= 70:
        return "good"
    if score >= 55:
        return "adequate"
    return "weak"


def result_for(score: int) -> Result:
    return "Pass" if score >= 55 else "Fail"


def _require_client() -> Groq:
    key = groq_api_key()
    if not key:
        raise GroqNotConfigured("GROQ_API_KEY is not set. Add it to backend/.env.")
    return Groq(api_key=key)


def _transcript(messages: list[ChatMessage]) -> str:
    if not messages:
        return "(The interview has not started. Ask the first question.)"
    lines = []
    for message in messages:
        speaker = "Interviewer" if message.role == "interviewer" else "Candidate"
        lines.append(f"{speaker}: {message.content.strip()}")
    return "\n".join(lines)


def _complete_json(system: str, user: str, schema_name: str, schema: dict, temperature: float) -> dict:
    client = _require_client()
    try:
        completion = client.chat.completions.create(
            model=MODEL,
            temperature=temperature,
            max_tokens=900,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": schema_name,
                    "strict": True,
                    "schema": schema,
                },
            },
        )
    except APIError as exc:
        raise RuntimeError(_public_groq_error(exc)) from exc

    content = completion.choices[0].message.content or ""
    try:
        return json.loads(content)
    except json.JSONDecodeError as exc:
        raise RuntimeError("The model returned data that was not valid JSON.") from exc


def _public_groq_error(exc: APIError) -> str:
    message = getattr(exc, "message", None) or "The Groq request failed."
    key = groq_api_key()
    if key and key in message:
        message = message.replace(key, "[redacted]")
    return message


def _clean_points(items: list[str], limit: int = 6) -> list[str]:
    cleaned = []
    for item in items:
        text = " ".join(str(item).split())
        if text and text not in cleaned:
            cleaned.append(text)
        if len(cleaned) == limit:
            break
    return cleaned


def next_interviewer_message(request: InterviewRequest) -> InterviewTurn:
    system = f"""You are a professional technical interviewer. The topic is "{request.topic}". Difficulty is {request.difficulty}.
{DIFFICULTY_GUIDANCE[request.difficulty]}

Conduct the interview with these rules:
- One question at a time.
- If there is no conversation yet, greet the candidate in one short sentence and ask the first question. Do not end the interview.
- If the last message is already from the interviewer and the candidate has not answered it, restate that same question briefly. Do not add a new question and do not end the interview.
- Judge only the candidate's latest answer.
- If the answer is strong, acknowledge it briefly and ask about a different aspect of the topic.
- If the answer is partly right, ask one probing follow-up about the missing part. Do not reveal the answer.
- If the answer is wrong, note the gap in one line and move on to a different aspect. Do not supply the correct answer.
- Never teach. Never hint. Never explain the solution. Never list what a good answer would include.
- Stay professional and encouraging. Do not be sarcastic or harsh.
- If the candidate is clearly struggling across several questions, end the interview early and kindly. Do not end after a single weak answer.
- If the candidate is doing very well, wrap up once the key areas of the topic are covered. Do not wrap up after the first strong answer.
- When the interview continues, interview_ended is false and the message contains exactly one question.
- When you end the interview, interview_ended is true and the message is a short closing with no question.
"""
    payload = _complete_json(
        system,
        f"Conversation so far:\n{_transcript(request.messages)}",
        "interview_turn",
        {
            "type": "object",
            "properties": {
                "message": {"type": "string"},
                "interview_ended": {"type": "boolean"},
            },
            "required": ["message", "interview_ended"],
            "additionalProperties": False,
        },
        temperature=0.4,
    )
    message = " ".join(str(payload.get("message", "")).split())
    if not message:
        raise RuntimeError("The interviewer returned an empty message.")
    return InterviewTurn(message=message, interview_ended=bool(payload.get("interview_ended")))


def generate_report(request: InterviewRequest) -> Report:
    candidate_lines = [message.content.strip() for message in request.messages if message.role == "candidate" and message.content.strip()]
    if not candidate_lines:
        return Report(
            score=0,
            strengths=[],
            weaknesses=["The candidate did not give any answers."],
            topics_to_revise=[request.topic],
            verdict="weak",
            result="Fail",
        )

    system = f"""You score a technical interview on "{request.topic}" at {request.difficulty} difficulty.
Use only statements the candidate actually made. Do not invent answers, and do not praise or criticize anything they did not say.

Return a score from 0 to 100 for the whole interview:
- 85 to 100: excellent. Answers are accurate, specific, and cover the question.
- 70 to 84: good. Mostly correct, with minor gaps.
- 55 to 69: adequate. Partial understanding and several gaps.
- 0 to 54: weak. Answers are wrong, vague, or missing on most questions.

strengths: concrete points the candidate got right, paraphrasing what they said. Use an empty list when nothing they said was a real strength.
weaknesses: concrete gaps or incorrect claims, each tied to something they said or failed to answer.
topics_to_revise: short topic names that follow from those weaknesses.
"""
    payload = _complete_json(
        system,
        f"Full conversation:\n{_transcript(request.messages)}",
        "interview_report",
        {
            "type": "object",
            "properties": {
                "score": {"type": "integer"},
                "strengths": {"type": "array", "items": {"type": "string"}},
                "weaknesses": {"type": "array", "items": {"type": "string"}},
                "topics_to_revise": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["score", "strengths", "weaknesses", "topics_to_revise"],
            "additionalProperties": False,
        },
        temperature=0.2,
    )
    try:
        score = int(payload["score"])
    except (KeyError, TypeError, ValueError) as exc:
        raise RuntimeError("The report did not include a numeric score.") from exc
    score = max(0, min(100, score))
    return Report(
        score=score,
        strengths=_clean_points(payload.get("strengths") or []),
        weaknesses=_clean_points(payload.get("weaknesses") or []),
        topics_to_revise=_clean_points(payload.get("topics_to_revise") or []),
        verdict=verdict_for(score),
        result=result_for(score),
    )
