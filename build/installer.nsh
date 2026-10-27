; Extra NSIS logic for Uni Companion.

; The default CRC self-check makes a large installer sit on "Verifying installer" for many seconds
; before any window appears, which looks exactly like "the installer did not open".
; Releases are already integrity-checked by GitHub (HTTPS) and by the updater (sha512 + blockmap).
!macro customHeader
  CRCCheck off
!macroend

; v5 renamed the product. Remove the shortcuts that carry the old name so an update does not leave two.
!macro customInstall
  Delete "$DESKTOP\Universal File Converter.lnk"
  Delete "$SMPROGRAMS\Universal File Converter.lnk"
  RMDir /r "$SMPROGRAMS\Universal File Converter"
!macroend

; Remove the Explorer right-click entry the app can add (Settings > Explorer right-click menu).
!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\*\shell\UniversalConverter"
!macroend
