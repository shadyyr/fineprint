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

import json
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import extract as extraction
from ingest import IngestResult, ingest
from models import CanonicalDocument
from normalize import normalize

load_dotenv(Path(__file__).resolve().parent / ".env")

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "fixtures" / "sample_offer.json"

MAX_UPLOAD_BYTES = 15 * 1024 * 1024

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
    return {
        "ok": True,
        "fixture_available": FIXTURE.exists(),
        "live_extraction": extraction.available(),
        "model": extraction.DEFAULT_MODEL if extraction.available() else None,
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


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)) -> CanonicalDocument:
    """Analyze an uploaded aid letter: ingest -> extract -> verify -> normalize.

    There is deliberately no fixture fallback on this path. The fixture
    describes one specific synthetic letter, so serving it in response to
    somebody's own document would present another school's numbers as theirs.
    A failure here is reported as a failure. The sample path (GET /sample) is
    the only place the fixture is legitimate, because there it really is the
    same document.
    """
    payload = await _read_pdf(file)
    result = ingest(payload)
    _require_text_layer(result)

    if not extraction.available():
        raise HTTPException(
            status_code=503,
            detail=(
                "Live extraction is not configured on the server. Add "
                "ANTHROPIC_API_KEY to api/.env, or try the sample offer."
            ),
        )

    try:
        claims = extraction.ClaudeExtractor().extract(result)
    except extraction.ExtractionRefused as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except extraction.ExtractionFailed as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - surface the cause, do not fake a result
        raise HTTPException(
            status_code=502,
            detail=f"Extraction failed: {exc}",
        ) from exc

    return normalize(
        claims,
        result,
        source_file_name=file.filename or "upload.pdf",
        source="live",
        model=extraction.DEFAULT_MODEL,
    )
