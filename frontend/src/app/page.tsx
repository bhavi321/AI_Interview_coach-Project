"use client";

import React, { useState, useEffect, useRef } from "react";

type Difficulty = "easy" | "medium" | "hard";

interface ChatMessage {
  role: "interviewer" | "candidate";
  content: string;
}

interface InterviewStep {
  message: string;
  interview_ended: boolean;
  messages: ChatMessage[];
}

interface ReportData {
  score: number;
  strengths: string[];
  weaknesses: string[];
  topics_to_revise: string[];
  verdict: "excellent" | "good" | "adequate" | "weak";
  result: "Pass" | "Fail";
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const DIFFICULTY_CONFIG: Record<
  Difficulty,
  { label: string; badge: string; color: string; badgeBg: string; border: string; desc: string }
> = {
  easy: {
    label: "Easy",
    badge: "Fundamentals",
    color: "text-emerald-400",
    badgeBg: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    border: "border-emerald-500/50",
    desc: "Basic definitions, terminology, and foundational recall.",
  },
  medium: {
    label: "Medium",
    badge: "Applied",
    color: "text-amber-400",
    badgeBg: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    border: "border-amber-500/50",
    desc: "Practical scenarios, real-world problems, and application.",
  },
  hard: {
    label: "Hard",
    badge: "Architecture",
    color: "text-rose-400",
    badgeBg: "bg-rose-500/10 text-rose-400 border-rose-500/30",
    border: "border-rose-500/50",
    desc: "Architectural trade-offs, constraints, and systems thinking.",
  },
};

const SUGGESTED_TOPICS = [
  "Python Concurrency & GIL",
  "System Design: Rate Limiter",
  "React Internals & Virtual DOM",
  "PostgreSQL Indexing & Optimization",
  "Distributed Systems & Consensus",
  "Data Structures & Algorithms",
];

export default function Home() {
  // Screen views: "setup" | "interview" | "report"
  const [screen, setScreen] = useState<"setup" | "interview" | "report">("setup");

  // Setup state
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [isStarting, setIsStarting] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  // Chat & Interview state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputAnswer, setInputAnswer] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  // Report state
  const [report, setReport] = useState<ReportData | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  // Auto-scroll ref
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Automatically scroll to bottom whenever messages change or when AI is thinking
  useEffect(() => {
    if (screen === "interview") {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isThinking, screen]);

  // Focus textarea when thinking completes
  useEffect(() => {
    if (screen === "interview" && !isThinking && !isGeneratingReport) {
      textareaRef.current?.focus();
    }
  }, [isThinking, screen, isGeneratingReport]);

  // 1. Start Interview Handler
  const handleStartInterview = async (e: React.FormEvent) => {
    e.preventDefault();
    setSetupError(null);

    const cleanTopic = topic.trim();
    if (!cleanTopic) {
      setSetupError("Please enter a technical topic to start your interview.");
      return;
    }

    setIsStarting(true);

    try {
      const res = await fetch(`${API_BASE_URL}/interview/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: cleanTopic,
          difficulty: difficulty,
        }),
      });

      if (!res.ok) {
        let errorDetail = `Failed to start interview (Status ${res.status})`;
        try {
          const errData = await res.json();
          if (errData?.detail) {
            errorDetail =
              typeof errData.detail === "string"
                ? errData.detail
                : JSON.stringify(errData.detail);
          }
        } catch {
          // ignore json parse error
        }
        throw new Error(errorDetail);
      }

      const data: InterviewStep = await res.json();
      setMessages(data.messages);
      setScreen("interview");
    } catch (err: unknown) {
      if (err instanceof TypeError && err.message.includes("fetch")) {
        setSetupError(
          `Cannot connect to backend server at ${API_BASE_URL}. Ensure your FastAPI backend is running.`
        );
      } else if (err instanceof Error) {
        setSetupError(err.message);
      } else {
        setSetupError("An unexpected error occurred while starting the interview.");
      }
    } finally {
      setIsStarting(false);
    }
  };

  // 2. Fetch Report (Reusable helper)
  const fetchReport = async (conversationMessages: ChatMessage[]) => {
    setIsGeneratingReport(true);
    setChatError(null);

    try {
      const res = await fetch(`${API_BASE_URL}/interview/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          difficulty: difficulty,
          messages: conversationMessages,
        }),
      });

      if (!res.ok) {
        let errorDetail = `Failed to generate report (Status ${res.status})`;
        try {
          const errData = await res.json();
          if (errData?.detail) {
            errorDetail =
              typeof errData.detail === "string"
                ? errData.detail
                : JSON.stringify(errData.detail);
          }
        } catch {
          // ignore
        }
        throw new Error(errorDetail);
      }

      const reportData: ReportData = await res.json();
      setReport(reportData);
      setScreen("report");
    } catch (err: unknown) {
      if (err instanceof Error) {
        setChatError(`Report Generation Error: ${err.message}`);
      } else {
        setChatError("Failed to generate report. Please try again.");
      }
    } finally {
      setIsGeneratingReport(false);
    }
  };

  // 3. Send Answer Handler
  const handleSendAnswer = async () => {
    const cleanAnswer = inputAnswer.trim();
    if (!cleanAnswer || isThinking || isGeneratingReport) return;

    setChatError(null);
    setInputAnswer("");
    setIsThinking(true);

    // Optimistically update conversation
    const candidateMessage: ChatMessage = { role: "candidate", content: cleanAnswer };
    const optimisticMessages = [...messages, candidateMessage];
    setMessages(optimisticMessages);

    try {
      const res = await fetch(`${API_BASE_URL}/interview/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          difficulty: difficulty,
          messages: messages, // Send history before this answer (per backend endpoint contract)
          answer: cleanAnswer,
        }),
      });

      if (!res.ok) {
        let errorDetail = `Failed to submit answer (Status ${res.status})`;
        try {
          const errData = await res.json();
          if (errData?.detail) {
            errorDetail =
              typeof errData.detail === "string"
                ? errData.detail
                : JSON.stringify(errData.detail);
          }
        } catch {
          // ignore
        }
        throw new Error(errorDetail);
      }

      const data: InterviewStep = await res.json();
      setMessages(data.messages);
      setIsThinking(false);

      // Check if interviewer ended the interview
      if (data.interview_ended) {
        // Automatically fetch report and transition to report screen
        await fetchReport(data.messages);
      }
    } catch (err: unknown) {
      setIsThinking(false);
      // Restore input text so candidate doesn't lose their answer
      setInputAnswer(cleanAnswer);
      // Remove optimistic candidate message on failure
      setMessages(messages);

      if (err instanceof Error) {
        setChatError(err.message);
      } else {
        setChatError("Network error while submitting answer.");
      }
    }
  };

  // Keydown handler: Enter to send, Shift+Enter for newline
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      handleSendAnswer();
    }
  };

  // Reset to setup
  const handleReset = () => {
    setScreen("setup");
    setMessages([]);
    setInputAnswer("");
    setIsThinking(false);
    setChatError(null);
    setSetupError(null);
    setReport(null);
  };

  return (
    <div className="relative min-h-screen bg-[#09090b] text-zinc-100 flex flex-col items-center justify-start antialiased selection:bg-indigo-500/30 selection:text-indigo-200 overflow-x-hidden">
      {/* Subtle ambient backdrop */}
      <div className="pointer-events-none fixed inset-0 flex items-center justify-center opacity-25">
        <div className="h-[600px] w-[600px] rounded-full bg-gradient-to-tr from-indigo-600/40 via-purple-600/30 to-blue-500/20 blur-[140px]" />
      </div>

      {/* ========================================================================= */}
      {/* SCREEN 1: SETUP SCREEN                                                    */}
      {/* ========================================================================= */}
      {screen === "setup" && (
        <div className="w-full max-w-2xl px-4 sm:px-6 py-12 sm:py-20 flex flex-col items-center z-10">
          {/* Header & Tagline */}
          <div className="text-center mb-8 sm:mb-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 mb-4">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
              Adaptive Technical Practice
            </div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-white mb-3">
              AI Interview Coach
            </h1>
            <p className="text-sm sm:text-base text-zinc-400 max-w-lg mx-auto leading-relaxed">
              Real-time, adaptive technical mock interviews. Experience live follow-ups,
              systematic difficulty scaling, and comprehensive performance scorecards.
            </p>
          </div>

          {/* Validation & Error Alert */}
          {setupError && (
            <div className="w-full mb-6 p-4 rounded-xl bg-red-950/40 border border-red-500/40 text-red-200 text-sm flex items-start gap-3 shadow-lg shadow-red-950/20">
              <svg
                className="w-5 h-5 text-red-400 shrink-0 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                />
              </svg>
              <div className="flex-1">
                <p className="font-medium text-red-300">Action Required</p>
                <p className="text-red-300/90 text-xs mt-0.5">{setupError}</p>
              </div>
              <button
                type="button"
                onClick={() => setSetupError(null)}
                className="text-red-400 hover:text-red-200 transition"
              >
                ✕
              </button>
            </div>
          )}

          {/* Setup Form */}
          <form
            onSubmit={handleStartInterview}
            className="w-full rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-6 sm:p-8 backdrop-blur-xl shadow-2xl shadow-black/60 flex flex-col gap-6"
          >
            {/* Topic Input */}
            <div className="flex flex-col gap-2">
              <label
                htmlFor="topic"
                className="text-sm font-medium text-zinc-200 flex items-center justify-between"
              >
                <span>Technical Topic</span>
                <span className="text-xs text-zinc-500">Required</span>
              </label>
              <input
                id="topic"
                type="text"
                value={topic}
                onChange={(e) => {
                  setTopic(e.target.value);
                  if (setupError) setSetupError(null);
                }}
                disabled={isStarting}
                placeholder="e.g. System Design, Python Concurrency, React Internals..."
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950/80 px-4 py-3.5 text-sm text-zinc-100 placeholder-zinc-500 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
              />

              {/* Topic suggestions */}
              <div className="pt-2">
                <span className="text-xs text-zinc-500 block mb-2 font-medium">
                  Popular topics:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTED_TOPICS.map((suggested) => (
                    <button
                      key={suggested}
                      type="button"
                      disabled={isStarting}
                      onClick={() => {
                        setTopic(suggested);
                        if (setupError) setSetupError(null);
                      }}
                      className={`text-xs px-2.5 py-1 rounded-lg border transition ${
                        topic === suggested
                          ? "bg-indigo-600/20 border-indigo-500/50 text-indigo-300 font-medium"
                          : "bg-zinc-950/60 border-zinc-800/80 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                      }`}
                    >
                      {suggested}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Difficulty Selection */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-zinc-200">
                Select Difficulty
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(Object.keys(DIFFICULTY_CONFIG) as Difficulty[]).map((key) => {
                  const opt = DIFFICULTY_CONFIG[key];
                  const isSelected = difficulty === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={isStarting}
                      onClick={() => setDifficulty(key)}
                      className={`relative text-left p-4 rounded-xl border transition-all flex flex-col justify-between ${
                        isSelected
                          ? `${opt.border} bg-zinc-900/90 ring-1 ring-inset ${opt.border}`
                          : "border-zinc-800 bg-zinc-950/60 hover:border-zinc-700 hover:bg-zinc-950"
                      } disabled:opacity-50`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-sm text-zinc-100">
                          {opt.label}
                        </span>
                        <span
                          className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${opt.badgeBg}`}
                        >
                          {opt.badge}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        {opt.desc}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Start Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isStarting}
                className="w-full rounded-xl bg-gradient-to-r from-indigo-500 via-indigo-600 to-purple-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all hover:shadow-indigo-600/40 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
              >
                {isStarting ? (
                  <>
                    <svg
                      className="h-4 w-4 animate-spin text-white"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    <span>Starting Interview...</span>
                  </>
                ) : (
                  <>
                    <span>Start Interview</span>
                    <svg
                      className="w-4 h-4 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                      />
                    </svg>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SCREEN 2: CHAT INTERVIEW SCREEN                                           */}
      {/* ========================================================================= */}
      {screen === "interview" && (
        <div className="w-full h-screen flex flex-col z-10">
          {/* Header Bar */}
          <header className="w-full border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-40 shrink-0">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
              {/* Left: Topic and Difficulty Badge */}
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 01-6.23-.693L4.2 13.9"
                    />
                  </svg>
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                    {topic}
                  </h2>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span
                      className={`text-[10px] font-medium px-2 py-0.2 rounded-full border ${DIFFICULTY_CONFIG[difficulty].badgeBg}`}
                    >
                      {DIFFICULTY_CONFIG[difficulty].label}
                    </span>
                    <span className="text-[11px] text-zinc-500 hidden sm:inline">
                      • Live Technical Interview
                    </span>
                  </div>
                </div>
              </div>

              {/* Right: Exit / End controls */}
              <div className="flex items-center gap-2 sm:gap-3">
                {isGeneratingReport ? (
                  <span className="text-xs text-indigo-400 flex items-center gap-1.5 bg-indigo-950/40 px-3 py-1.5 rounded-lg border border-indigo-500/30">
                    <svg
                      className="w-3.5 h-3.5 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Generating report...
                  </span>
                ) : (
                  <button
                    onClick={handleReset}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800 transition cursor-pointer"
                  >
                    Exit Session
                  </button>
                )}
              </div>
            </div>
          </header>

          {/* Chat Messages Body */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 flex flex-col justify-start">
            <div className="w-full max-w-4xl mx-auto flex flex-col gap-5">
              {/* Error banner during chat */}
              {chatError && (
                <div className="p-3.5 rounded-xl bg-red-950/50 border border-red-500/40 text-red-200 text-xs flex items-center justify-between">
                  <span>{chatError}</span>
                  <button
                    onClick={() => setChatError(null)}
                    className="text-red-400 hover:text-white font-bold ml-2"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Message list */}
              {messages.map((msg, index) => {
                const isInterviewer = msg.role === "interviewer";
                return (
                  <div
                    key={index}
                    className={`flex flex-col ${
                      isInterviewer ? "items-start" : "items-end"
                    }`}
                  >
                    {/* Header Label */}
                    <div className="flex items-center gap-1.5 mb-1 px-1">
                      {isInterviewer ? (
                        <>
                          <div className="w-2 h-2 rounded-full bg-indigo-400" />
                          <span className="text-[11px] font-medium text-zinc-400">
                            Interviewer
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="text-[11px] font-medium text-zinc-400">
                            You
                          </span>
                          <div className="w-2 h-2 rounded-full bg-emerald-400" />
                        </>
                      )}
                    </div>

                    {/* Chat Bubble */}
                    <div
                      className={`max-w-[88%] sm:max-w-[78%] rounded-2xl px-5 py-4 text-sm leading-relaxed whitespace-pre-wrap ${
                        isInterviewer
                          ? "bg-zinc-900 border border-zinc-800 text-zinc-100 rounded-tl-sm shadow-md"
                          : "bg-indigo-600 text-white rounded-tr-sm shadow-md shadow-indigo-950/40"
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                );
              })}

              {/* AI Thinking Indicator Bubble */}
              {isThinking && (
                <div className="flex flex-col items-start">
                  <div className="flex items-center gap-1.5 mb-1 px-1">
                    <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                    <span className="text-[11px] font-medium text-indigo-400">
                      Interviewer is thinking...
                    </span>
                  </div>
                  <div className="bg-zinc-900 border border-zinc-800 rounded-2xl rounded-tl-sm px-5 py-3.5 shadow-md flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-indigo-400 animate-bounce [animation-delay:-0.3s]" />
                    <span className="h-2 w-2 rounded-full bg-indigo-400 animate-bounce [animation-delay:-0.15s]" />
                    <span className="h-2 w-2 rounded-full bg-indigo-400 animate-bounce" />
                  </div>
                </div>
              )}

              {/* Report Generation Transition Banner */}
              {isGeneratingReport && (
                <div className="w-full my-4 p-5 rounded-2xl bg-indigo-950/30 border border-indigo-500/30 text-center flex flex-col items-center gap-2 shadow-lg">
                  <div className="flex items-center gap-2 text-indigo-300 font-semibold text-sm">
                    <svg
                      className="w-4 h-4 animate-spin text-indigo-400"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    <span>Interview Completed</span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    The interviewer has ended the session. Generating your comprehensive scorecard...
                  </p>
                </div>
              )}

              {/* Scroll anchor */}
              <div ref={chatBottomRef} />
            </div>
          </div>

          {/* Sticky Bottom Input Bar */}
          <div className="w-full border-t border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md p-4 sm:p-5 shrink-0">
            <div className="max-w-4xl mx-auto flex flex-col gap-2">
              <div className="relative flex items-end gap-2">
                <textarea
                  ref={textareaRef}
                  rows={2}
                  value={inputAnswer}
                  onChange={(e) => setInputAnswer(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isThinking || isGeneratingReport}
                  placeholder={
                    isGeneratingReport
                      ? "Interview has concluded..."
                      : isThinking
                      ? "Interviewer is evaluating your response..."
                      : "Type your answer... (Enter to send, Shift+Enter for new line)"
                  }
                  className="w-full resize-none rounded-xl border border-zinc-800 bg-zinc-900/90 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50 transition"
                />

                <button
                  type="button"
                  onClick={handleSendAnswer}
                  disabled={isThinking || isGeneratingReport || !inputAnswer.trim()}
                  className="h-11 px-4 sm:px-5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-md shadow-indigo-600/30 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
                >
                  <span>Send</span>
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
                    />
                  </svg>
                </button>
              </div>

              {/* Instructions footer */}
              <div className="flex items-center justify-between text-[11px] text-zinc-500 px-1">
                <span>
                  Press <kbd className="font-mono text-zinc-400 bg-zinc-900 px-1 py-0.5 rounded border border-zinc-800">Enter</kbd> to send, <kbd className="font-mono text-zinc-400 bg-zinc-900 px-1 py-0.5 rounded border border-zinc-800">Shift + Enter</kbd> for new line
                </span>
                <span>
                  {inputAnswer.length > 0 && `${inputAnswer.length} chars`}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SCREEN 3: REPORT SCREEN                                                   */}
      {/* ========================================================================= */}
      {screen === "report" && report && (
        <div className="w-full max-w-3xl px-4 sm:px-6 py-12 flex flex-col gap-6 z-10">
          <div className="text-center mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
              Evaluation Report
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mt-1">
              Interview Performance Summary
            </h2>
            <p className="text-xs sm:text-sm text-zinc-400 mt-1">
              Topic: <span className="text-zinc-200 font-medium">{topic}</span> •
              Difficulty:{" "}
              <span className="text-zinc-200 font-medium capitalize">
                {difficulty}
              </span>
            </p>
          </div>

          {/* Scorecard Hero */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 flex flex-col items-center justify-center text-center">
              <span className="text-xs text-zinc-400 font-medium">Overall Score</span>
              <div className="text-5xl font-black text-white my-2 tracking-tight">
                {report.score}
                <span className="text-xl font-normal text-zinc-500">/100</span>
              </div>
              <span
                className={`px-3 py-1 rounded-full text-xs font-semibold ${
                  report.result === "Pass"
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                    : "bg-red-500/10 text-red-400 border border-red-500/30"
                }`}
              >
                Verdict: {report.result}
              </span>
            </div>

            <div className="sm:col-span-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 flex flex-col justify-center">
              <span className="text-xs text-zinc-400 font-medium uppercase tracking-wider">
                Rating Bracket
              </span>
              <div className="text-2xl font-bold text-white capitalize mt-1">
                {report.verdict}
              </div>
              <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
                {report.score >= 85
                  ? "Exceptional technical grasp. Clear answers with accurate fundamentals and strong communication."
                  : report.score >= 70
                  ? "Good overall grasp. Mostly correct with slight gaps in depth or precision."
                  : report.score >= 55
                  ? "Adequate baseline understanding, but several conceptual or architectural gaps were noted."
                  : "Needs revision. Key questions were unanswered or lacked foundational precision."}
              </p>
            </div>
          </div>

          {/* Strengths & Weaknesses */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Strengths */}
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/10 p-5 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold">
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span>Strengths Demonstrated</span>
              </div>
              {report.strengths.length > 0 ? (
                <ul className="space-y-2 text-xs text-zinc-300">
                  {report.strengths.map((str, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-emerald-400 font-bold">•</span>
                      <span>{str}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-zinc-500 italic">
                  No clear strengths were highlighted in this attempt.
                </p>
              )}
            </div>

            {/* Weaknesses */}
            <div className="rounded-2xl border border-rose-500/20 bg-rose-950/10 p-5 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-rose-400 text-sm font-semibold">
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                  />
                </svg>
                <span>Areas for Improvement</span>
              </div>
              {report.weaknesses.length > 0 ? (
                <ul className="space-y-2 text-xs text-zinc-300">
                  {report.weaknesses.map((w, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-rose-400 font-bold">•</span>
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-zinc-500 italic">
                  No major weaknesses identified.
                </p>
              )}
            </div>
          </div>

          {/* Topics to Revise */}
          {report.topics_to_revise.length > 0 && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 flex flex-col gap-3">
              <span className="text-xs font-semibold text-zinc-300">
                Recommended Topics to Revise
              </span>
              <div className="flex flex-wrap gap-2">
                {report.topics_to_revise.map((topicItem, idx) => (
                  <span
                    key={idx}
                    className="text-xs px-3 py-1 rounded-lg bg-zinc-800/80 text-zinc-300 border border-zinc-700/60"
                  >
                    {topicItem}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Action button */}
          <div className="flex justify-center pt-2">
            <button
              onClick={handleReset}
              className="px-6 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold transition cursor-pointer"
            >
              Start Another Interview
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
