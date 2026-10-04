from pydantic import BaseSettings, Field


class Settings(BaseSettings):
    app_name: str = "AI Industrial Safety Copilot"
    api_v1_prefix: str = "/api"
    database_url: str = "sqlite:///./safety_copilot.db"
    secret_key: str = "change-me"
    risk_weight_restricted_entry: float = Field(default=15.0, ge=0)
    risk_weight_hazard_proximity: float = Field(default=12.0, ge=0)
    risk_weight_crowding: float = Field(default=8.0, ge=0)
    risk_decay_half_life_minutes: float = Field(default=30.0, gt=0)
    risk_rapid_escalation_velocity: float = Field(default=8.0, gt=0)

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


settings = Settings()
