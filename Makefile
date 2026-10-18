.PHONY: dev migrate revision test

dev: migrate
	uv run uvicorn app.main:app --reload --reload-dir app --port 8000

migrate:
	uv run alembic upgrade head

# make revision m="add column x"
revision:
	uv run alembic revision --autogenerate -m "$(m)"

test:
	uv run pytest -q
