import os
import re
import requests
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import TranscriptsDisabled, NoTranscriptFound
from sentence_transformers import SentenceTransformer
import chromadb
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

app = FastAPI()

# Allow the Next.js frontend (running on localhost:3000) to call this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Shared clients (loaded once at startup) ---
embed_model = SentenceTransformer("all-MiniLM-L6-v2")
chroma_client = chromadb.PersistentClient(path="../data/chroma_db")
collection = chroma_client.get_or_create_collection(name="youtube_chunks")

llm_client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.getenv("OPENROUTER_API_KEY"),
)

# --- Request/response models ---
class IngestRequest(BaseModel):
    url_or_id: str

class AskRequest(BaseModel):
    question: str

# --- Core pipeline functions (from our tested scripts) ---
def extract_video_id(url_or_id):
    patterns = [r"(?:v=|\/)([0-9A-Za-z_-]{11}).*"]
    for pattern in patterns:
        match = re.search(pattern, url_or_id)
        if match:
            return match.group(1)
    return url_or_id

def get_video_title(video_id):
    try:
        url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            return response.json().get("title", "Unknown Title")
    except Exception:
        pass
    return "Unknown Title"

def fetch_transcript(video_id):
    try:
        ytt_api = YouTubeTranscriptApi()
        return ytt_api.fetch(video_id)
    except TranscriptsDisabled:
        raise RuntimeError(f"Captions are disabled for video {video_id}.")
    except NoTranscriptFound:
        raise RuntimeError(f"No transcript found for video {video_id}.")
    except Exception as e:
        raise RuntimeError(f"Could not fetch transcript for {video_id}: {e}")

def chunk_transcript(transcript, video_id, chunk_duration=45, overlap_snippets=2):
    chunks = []
    current_chunk_snippets = []
    current_chunk_start = None
    all_snippets = list(transcript)

    i = 0
    while i < len(all_snippets):
        snippet = all_snippets[i]
        if current_chunk_start is None:
            current_chunk_start = snippet.start
        current_chunk_snippets.append(snippet)
        elapsed = snippet.start - current_chunk_start
        is_last_snippet = (i == len(all_snippets) - 1)

        if elapsed >= chunk_duration or is_last_snippet:
            text = " ".join(s.text for s in current_chunk_snippets)
            chunks.append({"text": text, "start": current_chunk_start, "video_id": video_id})

            if not is_last_snippet:
                overlap = current_chunk_snippets[-overlap_snippets:] if len(current_chunk_snippets) >= overlap_snippets else current_chunk_snippets[:]
                current_chunk_snippets = list(overlap)
                current_chunk_start = current_chunk_snippets[0].start
            else:
                current_chunk_snippets = []
        i += 1

    return chunks

def make_timestamp_url(video_id, start_seconds):
    return f"https://www.youtube.com/watch?v={video_id}&t={int(start_seconds)}s"

def format_timestamp(seconds):
    """Convert seconds to H:MM:SS or MM:SS format."""
    seconds = int(seconds)
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    if hours > 0:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"

def video_already_ingested(video_id):
    existing = collection.get(where={"video_id": video_id}, limit=1)
    return len(existing["ids"]) > 0

def get_all_video_ids():
    all_data = collection.get(include=["metadatas"])
    return list(set(m["video_id"] for m in all_data["metadatas"])) if all_data["metadatas"] else []

def get_all_videos_metadata():
    """Return one entry per video with id + title."""
    all_data = collection.get(include=["metadatas"])
    seen = {}
    for m in all_data["metadatas"]:
        seen[m["video_id"]] = m.get("video_title", m["video_id"])
    return [{"video_id": vid, "title": title} for vid, title in seen.items()]

def retrieve_per_video(query, video_ids, k=3):
    query_embedding = embed_model.encode([query]).tolist()
    per_video_results = {}
    for vid in video_ids:
        results = collection.query(
            query_embeddings=query_embedding,
            n_results=k,
            where={"video_id": vid},
            include=["documents", "metadatas", "distances"]
        )
        chunks = []
        for i, doc in enumerate(results["documents"][0]):
            meta = results["metadatas"][0][i]
            distance = results["distances"][0][i]
            chunks.append({
                "text": doc,
                "start": meta["start"],
                "title": meta.get("video_title", vid),
                "url": meta.get("url", ""),
                "distance": distance
            })
        per_video_results[vid] = chunks
    return per_video_results
def is_relevant(per_video_results, threshold=1.3):
    """Check if the best match across all videos is close enough to be relevant.
    ChromaDB uses cosine distance by default: 0 = identical, 2 = opposite.
    threshold=1.0 is a reasonable cutoff — tune based on testing."""
    all_distances = [
        c["distance"] for chunks in per_video_results.values() for c in chunks
    ]
    if not all_distances:
        return False
    return min(all_distances) < threshold

def build_prompt(query, per_video_results):
    video_titles = {vid: chunks[0]["title"] if chunks else vid for vid, chunks in per_video_results.items()}
    video_numbers = {vid: i + 1 for i, vid in enumerate(per_video_results.keys())}

    context_blocks = []
    for vid, chunks in per_video_results.items():
        video_num = video_numbers[vid]
        title = video_titles[vid]
        for c in chunks:
            timestamp_str = format_timestamp(c["start"])
            context_blocks.append(f"[Video {video_num}: \"{title}\" at {timestamp_str}]: {c['text']}")
    context_text = "\n\n".join(context_blocks)

    return f"""You are comparing what different YouTube videos say about a topic.

Question: {query}

Here are relevant excerpts from each video, labeled by video number, title, and timestamp:

{context_text}

Respond in exactly this structure:

## Summary
A 2-3 sentence direct answer to the question, synthesized across all videos.

## Per-Video Breakdown
For each video, briefly state what it says relevant to the question, with timestamp citations. Refer to videos by their number and title, e.g. "Video 1 (title) at 1:48".

## Comparison Verdict
For each key point, classify it as one of:
- **AGREE**: videos say the same thing (cite both by video number)
- **DISAGREE**: videos conflict (cite both by video number, explain the conflict)
- **COMPLEMENTARY**: one video covers something the other doesn't mention (cite by video number)

Only use the excerpts above — do not add outside knowledge. Keep it concise.
"""
def ask_llm(prompt):
    models_to_try = [
        "nvidia/nemotron-3.5-lightning:free",
        "nvidia/nemotron-3-super-120b-a12b:free",
        "google/gemma-4-31b-it:free",
        "google/gemma-4-26b-a4b-it:free",
    ]
    last_error = None
    for model in models_to_try:
        try:
            response = llm_client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                timeout=60,
            )
            content = response.choices[0].message.content
            if content and content.strip():
                cleaned = extract_final_answer(content)
                if cleaned.strip():
                    return cleaned
            print(f"Model {model} returned empty/unusable content, trying next...")
        except Exception as e:
            print(f"Model {model} failed ({e}), trying next...")
            last_error = e
    raise RuntimeError(f"All models failed or returned empty content. Last error: {last_error}")

def extract_final_answer(content):
    marker = "## Summary"
    idx = content.rfind(marker)
    if idx != -1:
        return content[idx:]
    return content
def extract_final_answer(content):
    """Strip any visible chain-of-thought preamble, keeping only the structured answer."""
    marker = "## Summary"
    idx = content.rfind(marker)  # last occurrence, not first
    if idx != -1:
        return content[idx:]
    return content

@app.get("/videos")
def list_videos():
    """Return all videos currently ingested."""
    return {"videos": get_all_videos_metadata()}

@app.post("/ingest")
def ingest_video(req: IngestRequest):
    video_id = extract_video_id(req.url_or_id)

    if video_already_ingested(video_id):
        return {"status": "already_exists", "video_id": video_id}

    video_title = get_video_title(video_id)

    try:
        transcript = fetch_transcript(video_id)
    except RuntimeError as e:
        return {"status": "error", "message": str(e)}

    chunks = chunk_transcript(transcript, video_id)
    texts = [c["text"] for c in chunks]
    embeddings = embed_model.encode(texts).tolist()
    ids = [f"{chunks[i]['video_id']}_{i}" for i in range(len(chunks))]
    metadatas = [
        {
            "video_id": c["video_id"],
            "video_title": video_title,
            "start": c["start"],
            "url": make_timestamp_url(c["video_id"], c["start"])
        }
        for c in chunks
    ]

    collection.add(ids=ids, embeddings=embeddings, documents=texts, metadatas=metadatas)

    return {"status": "success", "video_id": video_id, "title": video_title, "chunks": len(chunks)}
@app.delete("/videos/{video_id}")
def delete_video(video_id: str):
    existing = collection.get(where={"video_id": video_id})
    if not existing["ids"]:
        return {"status": "error", "message": f"Video {video_id} not found."}
    collection.delete(ids=existing["ids"])
    return {"status": "success", "video_id": video_id}

@app.delete("/videos")
def clear_all_videos():
    all_data = collection.get()
    if all_data["ids"]:
        collection.delete(ids=all_data["ids"])
    return {"status": "success", "message": "All videos cleared."}

@app.post("/ask")
def ask_question(req: AskRequest):
    video_ids = get_all_video_ids()
    if not video_ids:
        return {"status": "error", "message": "No videos ingested yet."}

    per_video_results = retrieve_per_video(req.question, video_ids)

    if not is_relevant(per_video_results):
        return {
            "status": "success",
            "answer": "This question doesn't appear to be covered by the ingested videos. Try asking something related to their content, or add a video on this topic.",
            "sources": []
        }

    prompt = build_prompt(req.question, per_video_results)
    answer = ask_llm(prompt)

    # Flatten sources for the frontend
    sources = []
    for vid, chunks in per_video_results.items():
        for c in chunks:
            sources.append({
                "title": c["title"],
                "timestamp": format_timestamp(c["start"]),
                "url": c["url"]
            })

    return {"status": "success", "answer": answer, "sources": sources}