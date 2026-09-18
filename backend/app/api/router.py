from fastapi import APIRouter

from app.api import analysis, data_views, datasets, health, variables


api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(datasets.router)
api_router.include_router(variables.router)
api_router.include_router(data_views.router)
api_router.include_router(analysis.router)
