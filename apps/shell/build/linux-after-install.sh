#!/bin/sh
# deb/rpm post-install: fix the Electron SUID sandbox permissions and expose
# the chatoffice command line shipped inside the app.
set -e
app_dir="/opt/ChaAI Office"
sandbox="$app_dir/chrome-sandbox"
if [ -f "$sandbox" ]; then
  chown root:root "$sandbox"
  chmod 4755 "$sandbox"
fi
launcher="$app_dir/resources/cli/chaoffice"
if [ -x "$launcher" ]; then
  ln -sf "$launcher" /usr/bin/chaoffice
fi
exit 0
