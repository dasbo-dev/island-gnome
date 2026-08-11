UUID := dasbo-island@ayubaswad.gmail.com
DEST := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: build install uninstall schemas test typecheck clean pack

build:
	npm run build
	glib-compile-schemas dist/schemas

install: build
	rm -rf "$(DEST)"
	mkdir -p "$(DEST)"
	cp -r dist/. "$(DEST)/"
	chmod +x "$(DEST)/hooks/dasbo-hook" 2>/dev/null || true
	@echo "Installed. Reload the shell: on X11 press Alt+F2, type r, press Enter; on Wayland, log out and back in."
	@echo "Then run: gnome-extensions enable $(UUID)"

uninstall:
	rm -rf "$(DEST)"

test:
	npm test

typecheck:
	npm run typecheck

clean:
	rm -rf dist node_modules

pack: build
	cd dist && zip -qr ../$(UUID).shell-extension.zip . -x '*.map'
	@echo "Wrote $(UUID).shell-extension.zip"
