#!/bin/sh
# deb/rpm post-install: expose the chatoffice command line shipped inside the app.
set -e
launcher="/opt/ChatOffice/resources/cli/chatoffice"
if [ -x "$launcher" ]; then
  ln -sf "$launcher" /usr/bin/chatoffice
fi
exit 0
