from fastapi import APIRouter


router = APIRouter(prefix="/api", tags=["service"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
