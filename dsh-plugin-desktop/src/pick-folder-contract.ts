/** Channel for the native directory picker the renderer may open via the preload bridge
 *  (OpenFilm 同款 `openfilm:native:pick-folder` 形态:封面导出等 client-plugin 页面
 *  也需要「选择导出的保存位置」原生目录对话框,与既有 save-file-picker 并列)。 */

/** Preload-to-main channel carrying one directory picker request. */
export const DESKTOP_PICK_FOLDER_CHANNEL = 'dsh-desktop:pick-folder'

/** Parameters accepted by the native directory dialog (Electron OpenDialogOptions subset). */
export interface DesktopPickFolderRequest {
  readonly title?: string
  /** Directory the dialog opens at; absent lets the OS remember its last location. */
  readonly defaultPath?: string
}
