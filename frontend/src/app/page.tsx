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
  const [reportError, setReportError] = useState<string | null>(null);

  // Auto-scroll ref
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom whenever messages change or AI is thinking
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
          // ignore
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

  // 2. Fetch Report (Takes candidate directly to report view with loading/error retry)
  const fetchReport = async (conversationMessages?: ChatMessage[]) => {
    const msgsToEvaluate = conversationMessages || messages;
    setScreen("report");
    setIsGeneratingReport(true);
    setReportError(null);

    try {
      const res = await fetch(`${API_BASE_URL}/interview/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          difficulty: difficulty,
          messages: msgsToEvaluate,
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
    } catch (err: unknown) {
      if (err instanceof TypeError && err.message.includes("fetch")) {
        setReportError(
          `Cannot connect to backend server at ${API_BASE_URL}. Make sure your FastAPI server is running.`
        );
      } else if (err instanceof Error) {
        setReportError(err.message);
      } else {
        setReportError("An unexpected error occurred while generating the report.");
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
          messages: messages, // Send history before this answer per backend contract
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

      // If interviewer ends the interview, automatically transition to report screen
      if (data.interview_ended) {
        await fetchReport(data.messages);
      }
    } catch (err: unknown) {
      setIsThinking(false);
      // Restore input text so candidate doesn't lose their answer
      setInputAnswer(cleanAnswer);
      // Rollback optimistic message on failure
      setMessages(messages);

      if (err instanceof Error) {
        setChatError(err.message);
      } else {
        setChatError("Network error while submitting answer.");
      }
    }
  };

  // Keydown: Enter sends, Shift+Enter for newline
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      handleSendAnswer();
    }
  };

  // Reset to initial setup
  const handleReset = () => {
    setScreen("setup");
    setMessages([]);
    setInputAnswer("");
    setIsThinking(false);
    setChatError(null);
    setSetupError(null);
    setReport(null);
    setReportError(null);
    setIsGeneratingReport(false);
  };

  // Score color helper: Good (>=70), Okay (55-69), Weak (<55)
  const getScoreDetails = (score: number) => {
    if (score >= 70) {
      return {
        category: "Good",
        colorClass: "text-emerald-400",
        borderClass: "border-emerald-500/40",
        bgClass: "bg-emerald-950/20",
        badgeBg: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
        barColor: "bg-emerald-500",
      };
    }
    if (score >= 55) {
      return {
        category: "Okay",
        colorClass: "text-amber-400",
        borderClass: "border-amber-500/40",
        bgClass: "bg-amber-950/20",
        badgeBg: "bg-amber-500/10 text-amber-300 border-amber-500/30",
        barColor: "bg-amber-500",
      };
    }
    return {
      category: "Weak",
      colorClass: "text-rose-400",
      borderClass: "border-rose-500/40",
      bgClass: "bg-rose-950/20",
      badgeBg: "bg-rose-500/10 text-rose-300 border-rose-500/30",
      barColor: "bg-rose-500",
    };
  };

  return (
    <div className="relative min-h-screen bg-[#09090b] text-zinc-100 flex flex-col items-center justify-start antialiased selection:bg-indigo-500/30 selection:text-indigo-200 overflow-x-hidden">
      {/* Ambient background glow */}
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

              {/* Right: Manual End/Report & Exit */}
              <div className="flex items-center gap-2 sm:gap-3">
                <button
                  onClick={() => fetchReport(messages)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 transition cursor-pointer"
                  title="Conclude interview early and generate evaluation"
                >
                  End & View Report
                </button>
                <button
                  onClick={handleReset}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800 transition cursor-pointer"
                >
                  Exit Session
                </button>
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
                  disabled={isThinking}
                  placeholder={
                    isThinking
                      ? "Interviewer is evaluating your response..."
                      : "Type your answer... (Enter to send, Shift+Enter for new line)"
                  }
                  className="w-full resize-none rounded-xl border border-zinc-800 bg-zinc-900/90 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50 transition"
                />

                <button
                  type="button"
                  onClick={handleSendAnswer}
                  disabled={isThinking || !inputAnswer.trim()}
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
      {screen === "report" && (
        <div className="w-full max-w-4xl px-4 sm:px-6 py-10 sm:py-16 flex flex-col items-center z-10">
          {/* Top navigation row */}
          <div className="w-full flex items-center justify-between mb-8">
            <button
              onClick={() => setScreen("interview")}
              className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5 transition cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
              <span>Back to Conversation</span>
            </button>

            <button
              onClick={handleReset}
              className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white text-xs font-semibold border border-zinc-700/80 transition cursor-pointer"
            >
              Start New Interview
            </button>
          </div>

          {/* 3A: LOADING STATE */}
          {isGeneratingReport && (
            <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900/70 p-10 backdrop-blur-xl shadow-2xl flex flex-col items-center text-center gap-6 my-12">
              <div className="relative flex items-center justify-center">
                <div className="w-16 h-16 rounded-full border-4 border-indigo-500/20 border-t-indigo-500 animate-spin" />
                <div className="absolute w-8 h-8 rounded-full bg-indigo-500/10 flex items-center justify-center">
                  <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 01-6.23-.693L4.2 13.9" />
                  </svg>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-bold text-white mb-1.5">
                  Analyzing Your Interview
                </h3>
                <p className="text-xs text-zinc-400 max-w-xs leading-relaxed">
                  The interviewer is evaluating your technical accuracy, system trade-offs, and compiling strengths and revision topics...
                </p>
              </div>

              <div className="w-full bg-zinc-800/80 rounded-full h-1.5 overflow-hidden">
                <div className="bg-indigo-500 h-full w-2/3 animate-pulse rounded-full" />
              </div>
            </div>
          )}

          {/* 3B: ERROR STATE WITH RETRY BUTTON */}
          {!isGeneratingReport && reportError && (
            <div className="w-full max-w-xl rounded-2xl border border-red-500/40 bg-red-950/20 p-8 backdrop-blur-xl shadow-2xl flex flex-col items-center text-center gap-5 my-8">
              <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </div>

              <div>
                <h3 className="text-base font-bold text-red-300">
                  Report Generation Failed
                </h3>
                <p className="text-xs text-red-300/80 mt-1 max-w-md leading-relaxed">
                  {reportError}
                </p>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => fetchReport(messages)}
                  className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold text-xs transition shadow-lg shadow-red-950/40 cursor-pointer flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                  </svg>
                  <span>Retry Generating Report</span>
                </button>

                <button
                  onClick={() => setScreen("interview")}
                  className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition cursor-pointer"
                >
                  Back to Interview
                </button>
              </div>
            </div>
          )}

          {/* 3C: COMPLETE REPORT VIEW */}
          {!isGeneratingReport && !reportError && report && (
            <div className="w-full flex flex-col gap-8">
              {/* Header Title: "Interview Complete" with topic & difficulty */}
              <div className="text-center flex flex-col items-center">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mb-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  Assessment Complete
                </div>
                <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
                  Interview Complete
                </h1>
                <div className="flex items-center justify-center gap-2 mt-2 text-sm text-zinc-400">
                  <span>Topic:</span>
                  <span className="text-zinc-200 font-semibold">{topic}</span>
                  <span>•</span>
                  <span>Difficulty:</span>
                  <span
                    className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border capitalize ${DIFFICULTY_CONFIG[difficulty].badgeBg}`}
                  >
                    {difficulty}
                  </span>
                </div>
              </div>

              {/* Big Scorecard Hero Banner */}
              {(() => {
                const scoreInfo = getScoreDetails(report.score);
                const isPass = report.result === "Pass";

                return (
                  <div
                    className={`w-full rounded-3xl border ${scoreInfo.borderClass} ${scoreInfo.bgClass} p-6 sm:p-8 backdrop-blur-xl shadow-2xl flex flex-col sm:flex-row items-center justify-between gap-6`}
                  >
                    {/* Score Big Display */}
                    <div className="flex flex-col items-center sm:items-start">
                      <span className="text-xs uppercase tracking-wider font-semibold text-zinc-400 mb-1">
                        Overall Performance Score
                      </span>
                      <div className="flex items-baseline gap-2">
                        <span className={`text-6xl sm:text-7xl font-black tracking-tight ${scoreInfo.colorClass}`}>
                          {report.score}
                        </span>
                        <span className="text-2xl font-medium text-zinc-500">
                          / 100
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${scoreInfo.badgeBg}`}>
                          Rating: {scoreInfo.category}
                        </span>
                        <span className="text-xs text-zinc-400 capitalize">
                          ({report.verdict})
                        </span>
                      </div>
                    </div>

                    {/* PASS or FAIL Stamp */}
                    <div className="flex flex-col items-center sm:items-end gap-2">
                      <span className="text-xs uppercase tracking-wider font-semibold text-zinc-400">
                        Final Outcome
                      </span>
                      {isPass ? (
                        <div className="inline-flex items-center gap-2.5 px-6 py-2.5 rounded-2xl bg-emerald-500/20 border-2 border-emerald-500/50 text-emerald-300 font-black text-xl tracking-wider uppercase shadow-xl shadow-emerald-950/40">
                          <svg
                            className="w-6 h-6 text-emerald-400"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={3}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M4.5 12.75l6 6 9-13.5"
                            />
                          </svg>
                          <span>PASS</span>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-2.5 px-6 py-2.5 rounded-2xl bg-rose-500/20 border-2 border-rose-500/50 text-rose-300 font-black text-xl tracking-wider uppercase shadow-xl shadow-rose-950/40">
                          <svg
                            className="w-6 h-6 text-rose-400"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={3}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                          <span>FAIL</span>
                        </div>
                      )}
                      <span className="text-[11px] text-zinc-500">
                        {isPass ? "Exceeded the 55-point passing threshold" : "Below the 55-point passing threshold"}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* SECTION 1: Interviewer's Verdict */}
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 backdrop-blur-md flex flex-col gap-3">
                <div className="flex items-center gap-2 text-indigo-400 font-semibold text-sm">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                  </svg>
                  <span>Interviewer&apos;s Verdict</span>
                </div>
                <div className="text-zinc-200 text-sm leading-relaxed">
                  {report.score >= 85 && (
                    <p>
                      <strong>Excellent Performance:</strong> You demonstrated comprehensive technical depth, clear structured reasoning, and accurate explanations for {topic}. Your answers directly addressed architectural constraints and trade-offs.
                    </p>
                  )}
                  {report.score >= 70 && report.score < 85 && (
                    <p>
                      <strong>Good Technical Understanding:</strong> You established solid fundamentals and practical intuition for {topic}. Minor follow-up probing exposed a few areas where deeper precision or edge-case handling would strengthen your responses.
                    </p>
                  )}
                  {report.score >= 55 && report.score < 70 && (
                    <p>
                      <strong>Adequate Knowledge:</strong> You demonstrated basic conceptual awareness of {topic}, but struggled with deeper architectural details or concrete implementations. Further hands-on practice is recommended.
                    </p>
                  )}
                  {report.score < 55 && (
                    <p>
                      <strong>Weak Outcome:</strong> Several foundational concepts in {topic} were missed or incomplete during this interview. Review the suggested revision topics below and retake the session.
                    </p>
                  )}
                </div>
              </div>

              {/* SECTIONS 2 & 3: Strengths and Areas for Improvement Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {/* Strengths Section */}
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/10 p-6 flex flex-col gap-4">
                  <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>Demonstrated Strengths</span>
                  </div>

                  {report.strengths.length > 0 ? (
                    <ul className="space-y-2.5">
                      {report.strengths.map((str, idx) => (
                        <li key={idx} className="flex items-start gap-2.5 text-xs text-zinc-200 leading-relaxed">
                          <span className="text-emerald-400 font-bold shrink-0 mt-0.5">✓</span>
                          <span>{str}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-zinc-500 italic">
                      No distinct strengths were identified from the answers provided.
                    </p>
                  )}
                </div>

                {/* Areas for Improvement Section */}
                <div className="rounded-2xl border border-rose-500/20 bg-rose-950/10 p-6 flex flex-col gap-4">
                  <div className="flex items-center gap-2 text-rose-400 font-semibold text-sm">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                    </svg>
                    <span>Areas for Improvement</span>
                  </div>

                  {report.weaknesses.length > 0 ? (
                    <ul className="space-y-2.5">
                      {report.weaknesses.map((weakness, idx) => (
                        <li key={idx} className="flex items-start gap-2.5 text-xs text-zinc-200 leading-relaxed">
                          <span className="text-rose-400 font-bold shrink-0 mt-0.5">✕</span>
                          <span>{weakness}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-zinc-500 italic">
                      No significant weaknesses or conceptual gaps were observed.
                    </p>
                  )}
                </div>
              </div>

              {/* SECTION 4: Topics to Revise */}
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 backdrop-blur-md flex flex-col gap-3">
                <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                  </svg>
                  <span>Topics to Revise</span>
                </div>

                {report.topics_to_revise.length > 0 ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {report.topics_to_revise.map((revTopic, idx) => (
                      <span
                        key={idx}
                        className="text-xs px-3.5 py-1.5 rounded-xl bg-zinc-800/90 text-zinc-200 border border-zinc-700/80 font-medium"
                      >
                        {revTopic}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500 italic">
                    All tested topics met the required standard.
                  </p>
                )}
              </div>

              {/* Action Button: Start New Interview */}
              <div className="flex justify-center pt-4 pb-12">
                <button
                  onClick={handleReset}
                  className="px-8 py-3.5 rounded-xl bg-gradient-to-r from-indigo-500 via-indigo-600 to-purple-600 text-white font-semibold text-sm shadow-xl shadow-indigo-600/30 hover:shadow-indigo-600/50 hover:opacity-95 active:scale-[0.99] transition cursor-pointer flex items-center gap-2"
                >
                  <span>Start New Interview</span>
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
