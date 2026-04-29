WATCH_PARTY_SERVER_URL ?= https://watch.ruszabarov.com
VERSION_BUMP ?= patch
EXTENSION_FILTER := @open-watch-party/extension

.PHONY: extensions extension-version extension-chrome extension-firefox extension-safari

extensions: extension-chrome extension-firefox extension-safari

extension-version:
	npm --prefix apps/extension version $(VERSION_BUMP) --no-git-tag-version

extension-chrome: extension-version
	WATCH_PARTY_SERVER_URL=$(WATCH_PARTY_SERVER_URL) pnpm --filter $(EXTENSION_FILTER) exec wxt zip -b chrome

extension-firefox: extension-version
	WATCH_PARTY_SERVER_URL=$(WATCH_PARTY_SERVER_URL) pnpm --filter $(EXTENSION_FILTER) exec wxt zip -b firefox

extension-safari: extension-version
	WATCH_PARTY_SERVER_URL=$(WATCH_PARTY_SERVER_URL) pnpm --filter $(EXTENSION_FILTER) exec wxt zip -b safari
