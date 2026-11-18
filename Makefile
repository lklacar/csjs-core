.PHONY: assets client server server-run

MAP ?= de_dust2
GAME_DATA := $(CURDIR)/website/public/game-data
AMXX_USERS ?= $(CURDIR)/server/local/amxx-users.ini

assets:
	python3 scripts/prepare-assets.py "$(STEAM_HALF_LIFE)" "$(MAP)"

client:
	./scripts/build-client.sh

server:
	docker build --platform linux/amd64 -f server/Dockerfile -t csjs-public-server .

server-run:
	@test -f "$(GAME_DATA)/cstrike/maps/$(MAP).bsp" || (echo "Run make assets for $(MAP) first." && exit 1)
	@set --; \
	if [ -f "$(AMXX_USERS)" ]; then \
		set -- --mount "type=bind,src=$(AMXX_USERS),dst=/csjs/cstrike/addons/amxmodx/configs/users.ini,readonly"; \
	fi; \
	docker run "$$@" --rm -it --platform linux/amd64 -p 127.0.0.1:27016:27016/tcp -p 127.0.0.1:27015:27015/udp \
		--mount "type=bind,src=$(GAME_DATA),dst=/data,readonly" csjs-public-server \
		+hostname CSJS +maxplayers 16 +map "$(MAP)"
