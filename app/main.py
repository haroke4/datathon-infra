import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import errors, worker
from app.api import jury_router, router
from app.db import engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("apscheduler").setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await worker.start()
    try:
        yield
    finally:
        await worker.stop()
        await engine.dispose()


app = FastAPI(title="Cashier Compliance API", lifespan=lifespan)
errors.register(app)
app.include_router(router)
app.include_router(jury_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
