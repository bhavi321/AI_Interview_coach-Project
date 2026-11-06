# 🎙️ AI Interview Coach

An adaptive, real-time technical mock interview platform powered by **Next.js**, **FastAPI**, and **Groq** (`openai/gpt-oss-120b`).

The interviewer asks one question at a time, dynamically scales follow-ups based on your technical depth, knows when to wrap up, and delivers a structured performance scorecard with actionable feedback and a Pass/Fail verdict.

---

## ✨ Features

- **Adaptive Questioning**: Calibrated to three difficulty levels:
  - **Easy**: Core definitions, syntax, and fundamental recall.
  - **Medium**: Real-world scenarios, debugging, and applied problem solving.
  - **Hard**: Architectural trade-offs, scalability, and system design thinking.
- **Dynamic Follow-Ups**: Probes partially correct responses without revealing answers, acknowledges strong points, and politely notes gaps.
- **Structured Performance Scorecard**:
  - Score (0–100) with color brackets (Good $\ge 70$, Okay $55–69$, Weak $<55$).
  - Pass / Fail outcome (threshold at 55).
  - Interviewer's verdict commentary.
  - Demonstrated strengths grounded in your actual answers.
  - Concrete areas for improvement and recommended revision topics.
- **Modern Dark UI**: Built with Next.js 16, React 19, and Tailwind CSS. Fully responsive on mobile, auto-expanding inputs, and inline technical code formatting.

---

## 🛠️ Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS
- **Backend**: FastAPI, Pydantic v2, Uvicorn, Python-dotenv
- **AI Inference**: Groq Cloud SDK (`openai/gpt-oss-120b`)

---

## 🚀 Quick Start

### 1. Clone & Set Up Backend

```bash
cd backend

# Create and activate virtual environment
python -m venv .venv

# On Linux/macOS or Git Bash:
source .venv/bin/activate
# On Windows PowerShell:
# .\.venv\Scripts\Activate.ps1

# Install dependencies
pip install -r requirements.txt

# Configure your Groq API key
cp .env.example .env
# Edit .env and insert your GROQ_API_KEY from https://console.groq.com/keys

# Start FastAPI server
uvicorn main:app --reload
```
The backend starts at `http://localhost:8000` (docs at `http://localhost:8000/docs`).

---

### 2. Set Up Frontend

In a separate terminal:

```bash
cd frontend

# Install dependencies
npm install

# (Optional) Copy env example if running backend on a custom port
cp .env.example .env.local

# Start Next.js dev server
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## ☁️ Cloud Deployment

### Backend on Render (Web Service)
1. In Render, create a new **Web Service** and connect your GitHub repository.
2. Configure settings:
   - **Root Directory**: `backend`
   - **Runtime**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
3. Under **Environment Variables**:
   - `GROQ_API_KEY`: Your Groq API key
   - (Optional) `ALLOWED_ORIGINS`: Comma-separated domains if using a custom domain (all `*.vercel.app` domains are enabled by default)

### Frontend on Vercel
1. In Vercel, import your repository.
2. Configure settings:
   - **Framework Preset**: Next.js
   - **Root Directory**: `frontend`
3. Under **Environment Variables**:
   - `NEXT_PUBLIC_API_URL`: Your Render backend service URL (e.g., `https://your-backend.onrender.com`)
4. Deploy!

---

## 🔒 Security & Environment Variables

- `backend/.env` is ignored by Git and should never be committed.
- Obtain an API key from [Groq Console](https://console.groq.com/keys).

---

## 📄 License

MIT

