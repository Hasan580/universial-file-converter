!macro customCheckAppRunning
  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 == 0
    DetailPrint `Closing running "${PRODUCT_NAME}"...`

    StrCpy $R1 0

    close_loop:
      IntOp $R1 $R1 + 1

      !ifdef INSTALL_MODE_PER_ALL_USERS
        nsExec::Exec `taskkill /im "${APP_EXECUTABLE_FILENAME}"`
      !else
        nsExec::Exec `%SYSTEMROOT%\System32\cmd.exe /c taskkill /im "${APP_EXECUTABLE_FILENAME}" /fi "USERNAME eq %USERNAME%"`
      !endif

      Sleep 1000
      !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
      ${if} $R0 != 0
        Goto not_running
      ${endIf}

      !ifdef INSTALL_MODE_PER_ALL_USERS
        nsExec::Exec `taskkill /f /im "${APP_EXECUTABLE_FILENAME}"`
      !else
        nsExec::Exec `%SYSTEMROOT%\System32\cmd.exe /c taskkill /f /im "${APP_EXECUTABLE_FILENAME}" /fi "USERNAME eq %USERNAME%"`
      !endif

      Sleep 2500
      !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
      ${if} $R0 != 0
        Goto not_running
      ${endIf}

      ${if} $R1 < 5
        DetailPrint `Waiting for "${PRODUCT_NAME}" to finish shutting down...`
        Goto close_loop
      ${endIf}

      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY close_loop
      Quit

    not_running:
  ${endIf}
!macroend
