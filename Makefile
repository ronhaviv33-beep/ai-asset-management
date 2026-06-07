.PHONY: verify

verify:
	@echo "=== Running isolation + structural harnesses ==="
	python tests/test_mgmt_isolation.py
	python tests/test_w1_alerts.py
	python tests/test_teams.py
	python tests/test_guardmode_recheck.py
	python tests/test_proxy_team_register.py
	python tests/test_team_scope.py
	@echo "=== All harnesses passed ==="
