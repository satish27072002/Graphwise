COMPOSE = docker compose --env-file .env -f infra/docker-compose.yml

.PHONY: compose-config compose-up compose-up-d compose-down compose-ps

compose-config:
	$(COMPOSE) config

compose-up:
	$(COMPOSE) up --build

compose-up-d:
	$(COMPOSE) up -d --build

compose-down:
	$(COMPOSE) down

compose-ps:
	$(COMPOSE) ps
