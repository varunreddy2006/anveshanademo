from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from math import exp
from typing import Iterable, Mapping


EVENT_WEIGHTS = {
    "Restricted-zone entry": 15.0,
    "Hazard-zone proximity": 12.0,
    "Crowding threshold": 8.0,
}


@dataclass(frozen=True)
class RiskWeights:
    restricted_entry: float = EVENT_WEIGHTS["Restricted-zone entry"]
    hazard_proximity: float = EVENT_WEIGHTS["Hazard-zone proximity"]
    crowding: float = EVENT_WEIGHTS["Crowding threshold"]

    def for_event(self, event_type: str) -> float:
        return {
            "Restricted-zone entry": self.restricted_entry,
            "Hazard-zone proximity": self.hazard_proximity,
            "Crowding threshold": self.crowding,
        }.get(event_type, 0.0)


def as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def score_events(
    events: Iterable[Mapping[str, object]],
    now: datetime,
    weights: RiskWeights = RiskWeights(),
    half_life_minutes: float = 30.0,
) -> int:
    if half_life_minutes <= 0:
        raise ValueError("Risk decay half-life must be positive")
    current_time = as_utc(now)
    weighted_risk = 0.0
    for event in events:
        event_time = event.get("created_at")
        event_type = event.get("event_type")
        if not isinstance(event_time, datetime) or not isinstance(event_type, str):
            raise ValueError("Each risk event must include a datetime created_at and string event_type")
        age_minutes = max(0.0, (current_time - as_utc(event_time)).total_seconds() / 60)
        weighted_risk += weights.for_event(event_type) * exp(-0.6931471805599453 * age_minutes / half_life_minutes)
    return max(0, min(100, round(weighted_risk)))


def regression_slope(
    samples: Iterable[tuple[datetime, float]],
    *,
    now: datetime,
    window_minutes: float = 15.0,
) -> float:
    if window_minutes <= 0:
        raise ValueError("Trend window must be positive")
    current_time = as_utc(now)
    start = current_time - timedelta(minutes=window_minutes)
    points = [
        ((as_utc(timestamp) - start).total_seconds() / 60, float(score))
        for timestamp, score in samples
        if start <= as_utc(timestamp) <= current_time
    ]
    if len(points) < 2:
        return 0.0
    mean_x = sum(x for x, _ in points) / len(points)
    mean_y = sum(y for _, y in points) / len(points)
    denominator = sum((x - mean_x) ** 2 for x, _ in points)
    if denominator == 0:
        return 0.0
    return round(sum((x - mean_x) * (y - mean_y) for x, y in points) / denominator, 2)


def risk_trend(velocity: float) -> str:
    if velocity > 0.5:
        return "increasing"
    if velocity < -0.5:
        return "decreasing"
    return "stable"


def project_score(score: int, velocity: float, minutes: float = 5.0) -> int:
    return max(0, min(100, round(score + velocity * minutes)))


def risk_explanation(
    score: int,
    score_five_minutes_ago: int,
    recent_events: Iterable[Mapping[str, object]],
) -> str:
    delta = score - score_five_minutes_ago
    if delta > 0:
        summary = f"Risk increased by {delta} points in the last 5 minutes"
    elif delta < 0:
        summary = f"Risk decreased by {abs(delta)} points in the last 5 minutes"
    else:
        summary = "Risk remained stable over the last 5 minutes"
    counts: dict[str, int] = {}
    labels = {
        "Restricted-zone entry": ("restricted-zone entry", "restricted-zone entries"),
        "Hazard-zone proximity": ("hazard-proximity event", "hazard-proximity events"),
        "Crowding threshold": ("crowding event", "crowding events"),
    }
    for event in recent_events:
        event_type = event.get("event_type")
        if isinstance(event_type, str) and event_type in labels:
            counts[event_type] = counts.get(event_type, 0) + 1
    causes = []
    for event_type, (singular, plural) in labels.items():
        count = counts.get(event_type, 0)
        if count:
            unit = singular if count == 1 else plural
            causes.append(f"{count} {unit}")
    if causes:
        summary += " due to " + " and ".join(causes)
    elif delta < 0:
        summary += " as earlier events decay"
    else:
        summary += " with no new recorded events"
    return summary + "."
