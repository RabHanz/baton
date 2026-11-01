!macro customInstall
  ; Renamed from Baton: the exe is now Tessaya.exe, so drop the old shortcuts, and point a login
  ; entry (if there was one) at it, under the one name the app itself uses.
  Delete "$SMPROGRAMS\Baton.lnk"
  Delete "$DESKTOP\Baton.lnk"
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Baton"
  ReadRegStr $1 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Baton"
  ${If} $0 != ""
  ${OrIf} $1 != ""
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}" '"$appExe"'
  ${EndIf}
  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    ${IfNot} ${FileExists} "$newStartMenuLink"
      !insertmacro createMenuDirectory
      CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    ${EndIf}
  !endif
!macroend
