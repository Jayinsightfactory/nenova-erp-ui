!macro customUnInstall
  ; Only remove our current user's login entry; never other startup applications.
  ${ifNot} ${isUpdated}
  SetRegView 64
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "NenovaDesktop"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "NenovaDesktop"
  SetRegView lastused
  ${endIf}
!macroend
