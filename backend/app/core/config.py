from pydantic import BaseSettings


class Settings(BaseSettings):
    app_name: str = "AI Industrial Safety Copilot"
    api_v1_prefix: str = "/api"
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/safety_copilot"
    secret_key: str = "change-me"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


settings = Settings()
