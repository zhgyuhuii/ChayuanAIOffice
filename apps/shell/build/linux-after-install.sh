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
# deb/rpm post-install: expose the genoffice command line shipped inside the app.
# Only an absent name, a dead link or a link into our own install dir is taken
# over; anything else at /usr/bin/genoffice belongs to another program (genoffice#893).
launcher="/opt/ChaAI Office/resources/cli/genoffice"
link="/usr/bin/genoffice"
[ -x "$launcher" ] || exit 0
if [ -L "$link" ]; then
  case "$(readlink "$link")" in
    /opt/ChaAI Office/*) ;;
    *) [ -e "$link" ] && { echo "genoffice: $link is another program, left as is; run: ln -s $launcher $link" >&2; exit 0; } ;;
  esac
elif [ -e "$link" ]; then
  echo "genoffice: $link is another program, left as is; run: ln -s $launcher $link" >&2
  exit 0
fi
ln -sfn "$launcher" "$link"
exit 0
