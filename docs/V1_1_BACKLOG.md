# Groww AI V1.1 Backlog (Implementation Order)

## 1. RAG Storage Hardening (Schema + Migration)
- Goal: productionize filing chunk storage in Neon with strong indexing.
- Schema updates:
  - `filing_rag_chunks` (already introduced) with `vector` embeddings, metadata, and chunk text.
  - Add optional `filing_rag_jobs` table for ingestion job tracking (`queued`, `running`, `done`, `failed`).
- API changes:
  - Keep `POST /api/rag/ingest` for manual ingestion.
  - Add `GET /api/rag/status?symbol=...` for indexed-doc/chunk counts.
- UI impact:
  - No UI change.

## 2. Async Ingestion Worker
- Goal: ingest filings out of band so first chat is fast.
- Backend changes:
  - Move ingestion from request path to worker loop (poll pending jobs from `filing_rag_jobs`).
  - Retry strategy: exponential backoff with max attempts.
- API changes:
  - `POST /api/rag/ingest` should enqueue jobs (non-blocking) instead of full synchronous processing.
- UI impact:
  - Show non-blocking badge: `Indexing filings...`.

## 3. Retrieval Quality Upgrade (Hybrid Search)
- Goal: improve recall/precision by combining vector + lexical scoring.
- Backend changes:
  - Add lexical ranking using `tsvector` / trigram over `chunk_text`.
  - Hybrid rank = weighted(vector similarity, lexical score, freshness).
- API changes:
  - Extend `/api/chat` meta with retrieval diagnostics:
    - `retrieved_chunks`
    - `confidence_label`
    - `confidence_reason`
    - `retrieval_mode` (`vector`/`hybrid`/`fallback`)
- UI impact:
  - Optional confidence chip in assistant responses.

## 4. Citation Precision & Explainability
- Goal: every important claim traces to exact filing evidence.
- Backend changes:
  - Return chunk-level citation payload with stable ids.
  - Include snippet offsets (`start_char`, `end_char`) where possible.
- API changes:
  - `/api/chat` response `sources[]` to include chunk-aware titles and links.
- UI impact:
  - Citation tooltip expands to snippet preview.

## 5. Learning Continuity Layer
- Goal: prevent episodic usage by carrying context across sessions.
- Schema updates:
  - `user_company_watch` (symbol, monitorables, last_seen_period).
  - `user_chat_memory` (symbol, note, created_at).
- API changes:
  - `GET /api/context?symbol=...` for “since your last visit”.
  - `POST /api/context/notes` to save user notes/monitorables.
- UI impact:
  - Add “Since last visit” panel above chat input.

## 6. Safety & Compliance Guardrails
- Goal: strict research-only posture.
- Backend changes:
  - Prompt policy enforcement for buy/sell/recommendation language.
  - Response post-check to rewrite restricted investment-advice outputs.
- API changes:
  - Add `compliance_flags[]` and `policy_version` in chat meta.
- UI impact:
  - Always-on disclaimer: `For research and learning. Not investment advice.`

