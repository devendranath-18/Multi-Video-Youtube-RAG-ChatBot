YouTube RAG Chatbot — Multi-Video Comparison

Ask questions across multiple YouTube videos at once and get answers that show where the sources agree, disagree, or complement each other — with every claim linked back to the exact video and timestamp it came from.

Instead of watching three different reviews or tutorials to piece together the full picture, drop in the links and ask directly:

"Do these reviewers agree the camera is good?" "What does each video say about battery life?" "Where do these tutorials actually disagree?"

How it works
YouTube Videos (2-3+)
        │
        ▼
  Transcript Extraction   (youtube-transcript-api)
        │
        ▼
  Chunking (with overlap to preserve context across boundaries)
        │
        ▼
  Embeddings              (sentence-transformers)
        │
        ▼
  Vector Storage           (ChromaDB, per-video metadata)
        │
        ▼
  Per-Video Retrieval      (top-k pulled separately from EACH video,
        │                   so no single source dominates the comparison)
        ▼
  Relevance Check          (rejects off-topic questions before calling the LLM)
        │
        ▼
  LLM Synthesis             (structured Summary → Per-Video Breakdown →
        │                    Comparison Verdict: AGREE / DISAGREE / COMPLEMENTARY)
        ▼
  Answer + Clickable Timestamp Citations
Why this isn't just "chat with a video"

Most single-video RAG demos retrieve and answer from one document. This project retrieves separately from every ingested video before answering, so a comparison question is guaranteed to draw on all sources fairly — instead of one dominant video crowding out the others in a pooled search. The LLM is then prompted to explicitly classify each point of comparison, rather than just blending sources into a vague summary.

Tech Stack

Backend

FastAPI (Python)
ChromaDB — vector store
Sentence Transformers (all-MiniLM-L6-v2) — embeddings
youtube-transcript-api — transcript fetching
OpenRouter — free-tier LLM access, with automatic fallback across multiple models for reliability

Frontend

Next.js (App Router) + TypeScript
Tailwind CSS
react-markdown for rendering structured answers
Features
Ingest any YouTube video by URL or ID
Automatic video title fetching, dedupe protection, and clear error messages for videos without captions
Delete individual videos or clear the whole set to start a new topic
Chat history — revisit and reopen any past question and answer
Relevance gating — questions unrelated to the ingested videos are rejected before wasting an LLM call
Automatic stripping of visible model "reasoning" so only the final structured answer is shown
Multi-model fallback chain so free-tier rate limits don't break the app
Clickable source citations that jump to the exact timestamp in the original video
Setup
Backend
bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux

pip install -r requirements.txt

Create a .env file in the project root:

OPENROUTER_API_KEY=your_key_here

Run the server:

bash
uvicorn main:app --reload --port 8000
Frontend
bash
cd frontend
npm install
npm run dev

Visit http://localhost:3000.

Known Limitations / Future Work

This project intentionally scopes out a few things that would matter more in a production RAG system:

Chunking is time-based, not semantic — a topic shift mid-chunk isn't detected. Sentence-embedding-based semantic chunking would improve this.
No re-ranking step — retrieval is pure vector similarity. A cross-encoder re-ranking pass (e.g. bge-reranker) would sharpen precision on borderline matches.
No automated evaluation harness — retrieval and answer quality were verified manually during development, not measured against a labeled test set (e.g. with RAGAS-style metrics).
Single shared collection — no per-session or per-user isolation. Fine for a personal/demo deployment, not for multi-tenant public use.
Not production-hardened — no auth, no rate limiting, no persistent storage guarantees on free-tier hosting.
License

MIT
