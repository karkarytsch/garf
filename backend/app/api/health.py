from fastapi import APIRouter


router = APIRouter(prefix="/api", tags=["service"])


@router.get("/health")
def health() -> dict[str, str]:
    """Report that the API process is running and able to receive requests."""
    return {"status": "ok"}
