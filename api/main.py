"""FinePrint extraction service.

Stateless document-to-JSON transformer. It ingests a PDF, asks a model to
interpret it, verifies every claim against the document's own text, and
returns a canonical model.

It deliberately does no financial arithmetic. That lives in the TypeScript
engine so the what-if simulator recomputes locally with no round trip, and so
the product stays usable when this service is down.

Run:  ../.venv/bin/uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

import logging
import sqlite3
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

API_DIR = Path(__file__).resolve().parent
load_dotenv(API_DIR / ".env")

import extract as extraction  # noqa: E402 - .env config must load first
from guardrails import (  # noqa: E402
    GuardrailConfigurationError,
    QuotaExceeded,
    public_api_enabled,
    public_mode,
    quota_store,
    trust_proxy_headers,
)
from ingest import IngestResult, ingest  # noqa: E402
from models import CanonicalDocument  # noqa: E402
from pipeline import analyze_document  # noqa: E402

ROOT = API_DIR.parent
FIXTURE = ROOT / "fixtures" / "sample_offer.json"

MAX_UPLOAD_BYTES = 15 * 1024 * 1024
logger = logging.getLogger("fineprint.api")

app = FastAPI(title="FinePrint extraction service", version="0.1.0")

# The Next.js dev server proxies through its own route handler, so this is
# only here for direct local probing.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def load_fixture() -> CanonicalDocument:
    """The committed sample analysis, validated on the way out.

    Parsing rather than passing the raw JSON through means a fixture that has
    drifted from the schema fails here instead of in the browser.
    """
    return CanonicalDocument.model_validate_json(FIXTURE.read_text())


@app.get("/health")
def health() -> dict[str, object]:
    extraction_enabled = extraction.available() and (
        not public_mode() or public_api_enabled()
    )
    return {
        "ok": True,
        "fixture_available": FIXTURE.exists(),
        "live_extraction": extraction_enabled,
        "public_mode": public_mode(),
        "model": extraction.DEFAULT_MODEL if extraction_enabled else None,
        "fallback_model": (
            extraction.FALLBACK_MODEL if extraction_enabled else None
        ),
        "reasoning_effort": extraction.DEFAULT_REASONING_EFFORT,
    }


@app.get("/sample")
def sample() -> CanonicalDocument:
    """The committed sample analysis, for the landing page's sample path."""
    return load_fixture()


class DebugLine(BaseModel):
    """One extracted line, for the coordinate validator at /debug/boxes."""

    line_id: str
    page: int
    text: str
    bbox: list[float]


class DebugIngest(BaseModel):
    pages: list[dict[str, object]]
    lines: list[DebugLine]
    char_count: int
    text_layer_sufficient: bool


async def _read_pdf(file: UploadFile) -> bytes:
    """Validate an upload and return its bytes."""
    if file.content_type not in {"application/pdf", "application/octet-stream"}:
        raise HTTPException(
            status_code=415,
            detail="FinePrint reads text-based PDFs. Please upload a PDF.",
        )

    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="The uploaded file was empty.")
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail="That file is larger than 15 MB. Please upload a smaller PDF.",
        )
    if not payload.startswith(b"%PDF"):
        raise HTTPException(
            status_code=415,
            detail="That file is not a PDF. FinePrint reads text-based PDF offers.",
        )
    return payload


def _require_text_layer(result: IngestResult) -> None:
    """Refuse a document FinePrint cannot verify against.

    Without a text layer there is nothing to cite, so no extracted figure
    could pass the admission gate. Failing clearly is the honest outcome:
    reading the page image alone would produce numbers with no provenance.
    """
    if result.text_layer_sufficient:
        return
    raise HTTPException(
        status_code=422,
        detail=(
            "This looks like a scanned document. FinePrint needs a text-based PDF "
            "so it can trace every figure back to the words on the page. Try the "
            "sample offer, or export the letter as a text PDF."
        ),
    )


@app.post("/debug/ingest", response_model=DebugIngest)
async def debug_ingest(file: UploadFile = File(...)) -> DebugIngest:
    """Raw layout lines for the coordinate validator.

    The /debug/boxes page draws every one of these over the rendered PDF. If
    the boxes do not sit on their text, evidence highlighting is broken and
    nothing downstream can be trusted.
    """
    if public_mode():
        # This route returns a document's raw text and exists only for local
        # coordinate debugging. It must never be part of the public surface.
        raise HTTPException(status_code=404, detail="Not found")

    payload = await _read_pdf(file)
    result = ingest(payload, render_images=False)
    return DebugIngest(
        pages=[
            {
                "page": p.page,
                "width_pt": p.width_pt,
                "height_pt": p.height_pt,
                "rotation": p.rotation,
            }
            for p in result.pages
        ],
        lines=[
            DebugLine(line_id=l.line_id, page=l.page, text=l.text, bbox=list(l.bbox))
            for l in result.lines
        ],
        char_count=result.char_count,
        text_layer_sufficient=result.text_layer_sufficient,
    )


def _client_address(request: Request) -> str:
    """Get the address to hash for rate limiting, without logging it."""
    if trust_proxy_headers():
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",", maxsplit=1)[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


def _quota_error(exc: QuotaExceeded) -> HTTPException:
    if exc.scope == "daily":
        detail = (
            "FinePrint has reached today's live-reading limit. "
            "Please try the sample offer or come back tomorrow."
        )
    else:
        detail = (
            "Too many live-reading attempts from this connection. "
            "Please wait before trying again."
        )
    return HTTPException(
        status_code=429,
        detail=detail,
        headers={"Retry-After": str(exc.retry_after_seconds)},
    )


@app.post("/analyze")
async def analyze(
    request: Request,
    file: UploadFile = File(...),
) -> CanonicalDocument:
    """Analyze an uploaded aid letter: ingest -> extract -> verify -> normalize.

    There is deliberately no fixture fallback on this path. The fixture
    describes one specific synthetic letter, so serving it in response to
    somebody's own document would present another school's numbers as theirs.
    A failure here is reported as a failure. The sample path (GET /sample) is
    the only place the fixture is legitimate, because there it really is the
    same document.
    """
    limiter = None
    if public_mode():
        if not public_api_enabled():
            raise HTTPException(
                status_code=503,
                detail=(
                    "Live reading is not available yet. Please try a sample offer."
                ),
            )
        try:
            limiter = quota_store()
            limiter.check_ip(_client_address(request))
        except GuardrailConfigurationError:
            logger.error("analysis_unavailable category=guardrail_configuration")
            raise HTTPException(
                status_code=503,
                detail=(
                    "Live reading is temporarily unavailable. "
                    "Please try a sample offer."
                ),
            ) from None
        except (OSError, sqlite3.Error):
            logger.error("analysis_unavailable category=guardrail_storage")
            raise HTTPException(
                status_code=503,
                detail=(
                    "Live reading is temporarily unavailable. "
                    "Please try a sample offer."
                ),
            ) from None
        except QuotaExceeded as exc:
            logger.info("analysis_rejected category=per_ip_quota")
            raise _quota_error(exc) from None

    payload = await _read_pdf(file)
    result = ingest(payload)
    _require_text_layer(result)

    if not extraction.available():
        raise HTTPException(
            status_code=503,
            detail=(
                "Live reading is temporarily unavailable. "
                "Please try a sample offer."
            ),
        )

    if limiter is not None:
        try:
            # Count attempts that reach the provider, including failed calls.
            limiter.reserve_analysis()
        except QuotaExceeded as exc:
            logger.info("analysis_rejected category=daily_quota")
            raise _quota_error(exc) from None
        except (OSError, sqlite3.Error):
            logger.error("analysis_unavailable category=guardrail_storage")
            raise HTTPException(
                status_code=503,
                detail=(
                    "Live reading is temporarily unavailable. "
                    "Please try a sample offer."
                ),
            ) from None

    try:
        routed = analyze_document(
            result,
            source_file_name=file.filename or "upload.pdf",
        )
    except extraction.ExtractionRefused:
        logger.info("analysis_failed category=provider_refusal")
        raise HTTPException(
            status_code=422,
            detail=(
                "FinePrint couldn't read this letter safely. Try a text-based "
                "PDF or a sample offer."
            ),
        ) from None
    except extraction.ExtractionFailed:
        logger.warning("analysis_failed category=provider_response")
        raise HTTPException(
            status_code=502,
            detail=(
                "FinePrint couldn't finish reading this letter. "
                "Please try again later."
            ),
        ) from None
    except Exception:  # noqa: BLE001 - fail closed without exposing internals
        logger.error("analysis_failed category=unexpected")
        raise HTTPException(
            status_code=502,
            detail=(
                "FinePrint couldn't finish reading this letter. "
                "Please try again later."
            ),
        ) from None

    return routed.document
