#!/bin/sh
# deb/rpm post-remove: drop the chatoffice symlink only on a real uninstall.
# rpm runs the old package's %postun after the new %post during an upgrade
# (with $1 = 1); deb passes "upgrade" there. Removing then would kill the
# link the new version just created.
case "$1" in
  0|remove|purge) ;;
  *) exit 0 ;;
esac
if [ -L /usr/bin/chatoffice ] && [ "$(readlink /usr/bin/chatoffice)" = "/opt/ChatOffice/resources/cli/chatoffice" ]; then
  rm -f /usr/bin/chatoffice
fi
exit 0
