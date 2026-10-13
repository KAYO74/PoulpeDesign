; Installeur Windows (NSIS) : la langue choisie au début de l'installation est aussi celle de l'appli.
; Elle est écrite dans langue.txt, à côté de Poulpe.exe ; l'appli la lit au lancement
; (commande installer_language, voir src/lib.rs et apps/editor/src/startLanguage.ts).
;
; Lanceur : Tauri nomme les raccourcis d'après productName (« Poulpe », gardé pour que les mises à
; jour retrouvent l'appli installée). On les renomme « Poulpe Design », aussi après une mise à jour.

!macro POULPE_RENOMME_RACCOURCI DOSSIER
  ${If} ${FileExists} "${DOSSIER}\${PRODUCTNAME}.lnk"
    Delete "${DOSSIER}\Poulpe Design.lnk"
    Rename "${DOSSIER}\${PRODUCTNAME}.lnk" "${DOSSIER}\Poulpe Design.lnk"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  Push $0
  Push $1
  StrCpy $1 "en"
  ${If} $LANGUAGE == ${LANG_FRENCH}
    StrCpy $1 "fr"
  ${EndIf}
  FileOpen $0 "$INSTDIR\langue.txt" w
  FileWrite $0 $1
  FileClose $0
  Pop $1
  Pop $0
  !insertmacro POULPE_RENOMME_RACCOURCI "$SMPROGRAMS"
  !insertmacro POULPE_RENOMME_RACCOURCI "$DESKTOP"
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayName" "Poulpe Design"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$INSTDIR\langue.txt"
  ${If} $UpdateMode <> 1
    Delete "$SMPROGRAMS\Poulpe Design.lnk"
    Delete "$DESKTOP\Poulpe Design.lnk"
  ${EndIf}
!macroend
