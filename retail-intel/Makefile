.PHONY: setup api web test e2e
setup:  ## install backend venv + frontend packages
	cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
	cd frontend && npm install
api:    ## run the API on :8100 (seeds demo data on first start)
	cd backend && .venv/bin/uvicorn main:app --reload --port 8100
web:    ## run the web app on :5173 (proxies /api to :8100)
	cd frontend && npm run dev
test:   ## backend + frontend unit/integration tests
	cd backend && .venv/bin/python -m pytest -q
	cd frontend && npm test && npm run typecheck
e2e:    ## build the web app and run the Playwright end-to-end smoke test
	cd frontend && npm run build && npm run e2e
