; ═══════════════════════════════════════════════════════════════════════════
; MindCare OS — greffons NSIS de l'installateur (§I du plan, étape 9).
;
; CE FICHIER EXISTE POUR UNE SEULE RAISON : rendre EXPLICITE et VÉRIFIABLE la
; garantie la plus lourde de conséquence de tout l'empaquetage —
;
;     LA DÉSINSTALLATION NE TOUCHE JAMAIS %ProgramData%\MindCare.
;
; Ce dossier contient le cluster PostgreSQL du cabinet : les dossiers
; patients, les consultations, les notes signées, la comptabilité, les
; sauvegardes chiffrées. Sous la loi 18-07 comme sous la règle 3 de
; CLAUDE.md (« aucun DELETE sur une donnée clinique ou financière »), un
; désinstallateur qui emporterait ce dossier serait une perte de données
; irréversible déclenchée par un clic dans le Panneau de configuration.
;
; La garantie tient déjà par CONSTRUCTION : l'installateur n'écrit que dans
; $INSTDIR, et le désinstallateur ne supprime que ce qu'il a écrit. Mais une
; garantie qui ne tient que par omission ne survit pas à la prochaine
; modification de ce fichier. On l'écrit donc, on la contrôle, et on la dit à
; l'utilisatrice à l'écran.
; ═══════════════════════════════════════════════════════════════════════════

!macro customInstall
  DetailPrint "Les donnees du cabinet seront conservees dans $%ProgramData%\MindCare."
  DetailPrint "Ce dossier est independant de l'application : une mise a jour ou une"
  DetailPrint "desinstallation ne le modifie pas."
!macroend

!macro customUnInstall
  ; ── Contrôle 1 : le dossier désinstallé n'est pas le dossier de données ──
  ;
  ; Si $INSTDIR pointait sur %ProgramData%\MindCare — par une installation
  ; ancienne, une erreur de saisie dans l'assistant, ou une future
  ; modification maladroite de ce fichier — la suppression de $INSTDIR
  ; emporterait la base. On refuse alors la désinstallation plutôt que de la
  ; mener à bien : un désinstallateur qui échoue se relance, une base
  ; supprimée ne revient pas.
  ReadEnvStr $0 "ProgramData"
  StrCpy $1 "$0\MindCare"
  ${If} $INSTDIR == $1
    MessageBox MB_ICONSTOP "Desinstallation interrompue : le dossier de l'application est aussi le dossier de donnees du cabinet ($1). Les donnees patients ne seront PAS supprimees. Contactez le support avant de continuer."
    Abort
  ${EndIf}

  ; ── Contrôle 2 : rien, ici, ne supprime le dossier de données ────────────
  ;
  ; Aucun RMDir, aucun Delete sur $1 n'est écrit dans cette macro, et aucun ne
  ; doit jamais l'être. `deleteAppDataOnUninstall: false` (electron-builder.yml)
  ; couvre de son côté %APPDATA%\MindCare, où vivent les journaux.
  DetailPrint "Les donnees du cabinet ($1) sont conservees."
  MessageBox MB_ICONINFORMATION "MindCare OS a ete desinstalle.$\r$\n$\r$\nLes donnees du cabinet ont ete CONSERVEES dans :$\r$\n$1$\r$\n$\r$\nReinstaller MindCare OS les retrouvera telles quelles. Pour les supprimer definitivement, il faut effacer ce dossier a la main."
!macroend
