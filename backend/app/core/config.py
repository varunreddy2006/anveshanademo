from pydantic import BaseSettings, Field, root_validator


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
    risk_band_low_max: int = Field(default=33, ge=0, le=100)
    risk_band_guarded_max: int = Field(default=55, ge=1, le=100)
    risk_band_elevated_max: int = Field(default=75, ge=2, le=100)

    @root_validator
    def validate_risk_bands(cls, values):
        low = values.get("risk_band_low_max", 33)
        guarded = values.get("risk_band_guarded_max", 55)
        elevated = values.get("risk_band_elevated_max", 75)
        if not low < guarded < elevated:
            raise ValueError("Risk bands must be ordered low < guarded < elevated")
        return values

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


settings = Settings()
