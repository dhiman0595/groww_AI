# Groww AI - Filing Research Assistant

Beginner-friendly stock filing analysis app with:
- mobile/email OTP onboarding flow
- guest mode with restricted company access (3 companies)
- company master dropdown from ISIN mapping (Neon/Postgres)
- real filing feed ingestion (StockInsights API)
- chat + RAG grounded answers
- AI summary battle cards with swipe progression
- LLM fallback chain: `Ollama -> Gemini -> xAI`

## Local Run

```bash
npm install
npm run dev
```

Backend API server:

```bash
npm run server
```

## Required Environment Variables

Copy `.env.example` and set values:

```bash
VITE_DOCS_MODE=real
VITE_API_BASE_URL=http://localhost:8787

DATABASE_URL=postgresql://...

STOCKINSIGHTS_API_KEY=...
STOCKINSIGHTS_API_URL=https://stockinsights-ai-main-95a26a0.zuplo.app/api/in/v0/documents
STOCKINSIGHTS_COMPANY_PARAM=ticker

# LLM fallback order
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=...
OLLAMA_EMBEDDING_MODEL=...

GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash
GEMINI_EMBEDDING_MODEL=text-embedding-004

XAI_API_KEY=...
XAI_MODEL=grok-3-mini
XAI_EMBEDDING_MODEL=...

AUTH_OTP_TTL_MS=300000
AUTH_OTP_MAX_ATTEMPTS=5
AUTH_OTP_RESEND_COOLDOWN_MS=20000
```

OTP is demo-only right now. `POST /api/auth/request-otp` returns `demo_otp` for verification.

## Import Company Master (ISIN Mapping)

```bash
npm run import:companies -- /absolute/path/to/ISIN_mapping.json --replace
```

This populates `companies_master`, used by `/api/companies`.

## API Endpoints

- `GET /api/health`
- `POST /api/auth/request-otp`
- `POST /api/auth/verify-otp`
- `GET /api/companies?query=&limit=`
- `GET /api/documents?symbol=...&doc_type=...`
- `POST /api/chat`
- `POST /api/rag/ingest`
- `GET /api/rag/status?symbol=...`

## Notes

- Date normalization drops invalid epoch-like values (for example `1970`) from filing metadata.
- PDF extraction uses `pdf-parse` v2 API with backward compatibility fallback.
- All chat responses include a research-only caution and avoid buy/sell advice phrasing.
