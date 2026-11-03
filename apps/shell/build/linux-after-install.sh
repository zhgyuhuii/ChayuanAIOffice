#!/bin/sh
# deb/rpm post-install. Replaces electron-builder's default template, so its
# chrome-sandbox and AppArmor steps are repeated here (chaoffice#2150 parity).
set -e
app="/opt/GenOffice"
# Chromium aborts when the SUID helper exists without 4755; Chrome's deb sets it unconditionally.
[ -f "$app/chrome-sandbox" ] && { chown root:root "$app/chrome-sandbox" 2>/dev/null || true; chmod 4755 "$app/chrome-sandbox" 2>/dev/null || true; }
# Ubuntu 24.04+ restricts unprivileged userns; --skip-kernel-load doubles as the abi/4.0 check.
profile_src="$app/resources/apparmor-profile"
profile_dst="/etc/apparmor.d/chaoffice"
if [ -f "$profile_src" ] && apparmor_status --enabled >/dev/null 2>&1; then
  if apparmor_parser --skip-kernel-load --debug "$profile_src" >/dev/null 2>&1; then
    cp -f "$profile_src" "$profile_dst"
    if ! { [ -x /usr/bin/ischroot ] && /usr/bin/ischroot; } && command -v apparmor_parser >/dev/null 2>&1; then
      apparmor_parser --replace --write-cache --skip-read-cache "$profile_dst" || true
    fi
  fi
fi
# electron-builder stamps every MIME type it registers with
# <icon name="x-office-document"/>, which overrides the system's per-type
# icons (spreadsheet, presentation, text, pdf...) for all 21 types we claim
# (chaoffice#2126 parity). Dropping the line lets each type fall back to its
# freedesktop generic-icon; the glob/MimeType associations are untouched.
mime="/usr/share/mime/packages/chaoffice.xml"
if [ -f "$mime" ] && grep -q '<icon name="x-office-document"' "$mime"; then
  sed -i '/<icon name="x-office-document"/d' "$mime"
fi
command -v update-mime-database >/dev/null 2>&1 && update-mime-database /usr/share/mime >/dev/null 2>&1 || true
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
# Expose the chaoffice command line shipped inside the app. Only an absent
# KDE Plasma's Dolphin lists the "Create New" menu from the XDG templates
# directories, which include the system-wide /usr/share/templates
# (chaoffice#2384). Only our three exact file names are written, so another
# suite's templates are never overwritten here or removed later. AppImage
# runs no install script, and a payload without shell-new skips this.
shell_new="$app/resources/shell-new"
templates_dir="/usr/share/templates"
if [ -d "$shell_new" ]; then
  mkdir -p "$templates_dir"
  for ext in docx xlsx pptx; do
    case "$ext" in
      docx) name="ChaAI Office Document.docx" ;;
      xlsx) name="ChaAI Office Spreadsheet.xlsx" ;;
      pptx) name="ChaAI Office Presentation.pptx" ;;
    esac
    # cp -f is the fallback for a busybox install(1) without -m. A template
    # that cannot be written must not fail the whole package install.
    install -m 0644 "$shell_new/blank.$ext" "$templates_dir/$name" 2>/dev/null ||
      cp -f "$shell_new/blank.$ext" "$templates_dir/$name" || true
  done
fi
# Expose the chaoffice command line shipped inside the app. Only an absent
# name, a dead link or a link into our own install dir is taken over; anything
# else at /usr/bin/chaoffice belongs to another program (chaoffice#893 parity).
launcher="$app/resources/cli/chaoffice"
link="/usr/bin/chaoffice"
[ -x "$launcher" ] || exit 0
if [ -L "$link" ]; then
  case "$(readlink "$link")" in
    "/opt/GenOffice"/*) ;;
    *) [ -e "$link" ] && { echo "chaoffice: $link is another program, left as is; run: ln -s $launcher $link" >&2; exit 0; } ;;
  esac
elif [ -e "$link" ]; then
  echo "chaoffice: $link is another program, left as is; run: ln -s $launcher $link" >&2
  exit 0
fi
ln -sfn "$launcher" "$link"
exit 0
