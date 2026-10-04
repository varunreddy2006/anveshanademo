from datetime import datetime, timedelta, timezone

import pytest

from app.risk import RiskWeights, project_score, regression_slope, risk_trend, score_events


def test_risk_score_uses_configured_weights_and_caps_at_100() -> None:
    now = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)
    events = [
        {"event_type": "Restricted-zone entry", "created_at": now},
        {"event_type": "Hazard-zone proximity", "created_at": now},
        {"event_type": "Crowding threshold", "created_at": now},
    ]

    assert score_events(events, now) == 35
    assert score_events(events, now, RiskWeights(70, 50, 40)) == 100


def test_risk_score_decays_exponentially_over_half_life() -> None:
    now = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)
    event = {"event_type": "Restricted-zone entry", "created_at": now - timedelta(minutes=30)}

    assert score_events([event], now, half_life_minutes=30) == 8


def test_regression_velocity_trend_and_five_minute_projection() -> None:
    now = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)
    samples = [
        (now - timedelta(minutes=10), 20),
        (now - timedelta(minutes=5), 30),
        (now, 40),
    ]
    velocity = regression_slope(samples, now=now, window_minutes=15)

    assert velocity == 2.0
    assert risk_trend(velocity) == "increasing"
    assert project_score(40, velocity) == 50
    assert risk_trend(-0.5) == "stable"
    assert risk_trend(-0.51) == "decreasing"
    assert project_score(99, 8) == 100
    assert project_score(2, -8) == 0


def test_risk_score_rejects_invalid_half_life() -> None:
    with pytest.raises(ValueError, match="half-life"):
        score_events([], datetime.now(timezone.utc), half_life_minutes=0)


@pytest.mark.parametrize(
    ("event_type", "expected_score"),
    [
        ("Missing helmet", 10),
        ("Missing vest", 10),
        ("Smoke detected", 35),
        ("Fire detected", 60),
    ],
)
def test_ppe_and_fire_smoke_events_use_configured_default_risk_weights(
    event_type: str, expected_score: int
) -> None:
    now = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)
    assert score_events([{"event_type": event_type, "created_at": now}], now) == expected_score
