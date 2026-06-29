"""
Tests for app/proxy_circuit.py — circuit breaker state machine.

No DB or HTTP setup required; tests manipulate the module-level _circuit
dict directly and reset it before each case.
"""
import sys
import time
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app.proxy_circuit as _cb


def _reset():
    _cb._circuit["failures"] = 0
    _cb._circuit["tripped_at"] = None
    _cb._circuit["first_failure_at"] = None


def test_circuit_starts_closed():
    _reset()
    assert _cb._circuit_state() == "closed"


def test_circuit_trips_at_threshold():
    _reset()
    for _ in range(_cb._CB_THRESHOLD):
        _cb._circuit_record_failure()
    assert _cb._circuit_state() == "open"


def test_circuit_does_not_trip_below_threshold():
    _reset()
    for _ in range(_cb._CB_THRESHOLD - 1):
        _cb._circuit_record_failure()
    assert _cb._circuit_state() == "closed"


def test_circuit_resets_after_window():
    _reset()
    for _ in range(_cb._CB_THRESHOLD):
        _cb._circuit_record_failure()
    assert _cb._circuit_state() == "open"

    future = time.time() + _cb._CB_WINDOW + 1
    with patch("app.proxy_circuit.time") as mock_time:
        mock_time.time.return_value = future
        assert _cb._circuit_state() == "closed"


def test_circuit_success_resets_failures():
    _reset()
    for _ in range(3):
        _cb._circuit_record_failure()
    assert _cb._circuit["failures"] == 3

    _cb._circuit_record_success()

    assert _cb._circuit["failures"] == 0
    assert _cb._circuit["first_failure_at"] is None


def test_success_is_noop_when_open():
    """record_success while tripped must not reset state — window expiry is the only recovery."""
    _reset()
    for _ in range(_cb._CB_THRESHOLD):
        _cb._circuit_record_failure()
    assert _cb._circuit_state() == "open"

    _cb._circuit_record_success()

    assert _cb._circuit["tripped_at"] is not None
    assert _cb._circuit_state() == "open"


def test_window_reset_clears_old_failures():
    """Failures older than _CB_WINDOW are discarded; one new failure stays below threshold."""
    _reset()
    past = time.time() - _cb._CB_WINDOW - 1
    _cb._circuit["first_failure_at"] = past
    _cb._circuit["failures"] = 4  # one short of threshold

    _cb._circuit_record_failure()  # window elapsed → resets counter, then increments to 1

    assert _cb._circuit["failures"] == 1
    assert _cb._circuit_state() == "closed"


def test_tripped_at_set_exactly_at_threshold():
    _reset()
    for _ in range(_cb._CB_THRESHOLD - 1):
        _cb._circuit_record_failure()
    assert _cb._circuit["tripped_at"] is None  # not yet tripped

    _cb._circuit_record_failure()              # threshold hit
    assert _cb._circuit["tripped_at"] is not None
