UUID := dasbo-island@ayubaswad.gmail.com
DEST := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: build install uninstall schemas test typecheck clean

build:
	npm run build
	glib-compile-schemas dist/schemas

install: build
	rm -rf "$(DEST)"
	mkdir -p "$(DEST)"
	cp -r dist/. "$(DEST)/"
	chmod +x "$(DEST)/hooks/dasbo-hook" 2>/dev/null || true
	@echo "Installed. Log out and back in (X11), then: gnome-extensions enable $(UUID)"

uninstall:
	rm -rf "$(DEST)"

test:
	npm test

typecheck:
	npm run typecheck

clean:
	rm -rf dist node_modules
