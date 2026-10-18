"""Every non-2xx response is {"error": {"code": ..., "message": ...}} with a Russian message."""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        self.status, self.code, self.message = status, code, message


# Fallbacks for errors raised by FastAPI/Starlette itself (unknown route, wrong method, ...).
_DEFAULTS = {
    404: ("NOT_FOUND", "Адрес не найден."),
    405: ("METHOD_NOT_ALLOWED", "Метод не поддерживается."),
}


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)


def register(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error(request: Request, exc: ApiError) -> JSONResponse:
        return _error(exc.status, exc.code, exc.message)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code, message = _DEFAULTS.get(exc.status_code, ("HTTP_ERROR", "Ошибка запроса."))
        return _error(exc.status_code, code, message)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        return _error(422, "VALIDATION_ERROR", "Некорректный запрос.")

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled error on %s %s", request.method, request.url.path)
        return _error(500, "INTERNAL_ERROR", "Внутренняя ошибка сервера. Попробуйте ещё раз.")
