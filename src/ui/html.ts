/**
 * 圖形控制台的單一自足 HTML（內嵌 CSS / JS、零外部資源）。
 *
 * - Token 以 <meta> 內嵌，前端呼叫 API 時放進 `X-AGI18N-Token` header
 * - 腳本帶 CSP nonce；動態資料一律以 textContent 寫入，不使用 innerHTML
 * - 深淺色自適應（prefers-color-scheme），右上角可切換 繁中 / 简中 / EN
 */

export interface UiHtmlOptions {
  token: string;
  nonce: string;
  version: string;
  hookVersion: number;
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** 介面文字（繁中 / 简中 / 日本語 / 한국어 / EN） */
export const UI_TEXT: Record<'zh-TW' | 'zh-CN' | 'ja' | 'ko' | 'en', Record<string, string>> = {
  'zh-TW': {
    title: 'Antigravity 多語系控制台',
    subtitle: '不用背指令：在這裡套用繁／簡／日／韓在地化、自訂背景，或一鍵還原官方原版。',
    'status.title': '狀態總覽',
    'col.target': '目標',
    'col.path': '安裝路徑',
    'col.state': '狀態',
    'col.hook': '掛鉤',
    'col.backup': '備份',
    'paths.title': '自訂安裝路徑（偵測不到時填寫）',
    'paths.app': 'App（含 app.asar 的資料夾）',
    'paths.ide': 'IDE 安裝資料夾',
    'paths.cli': 'CLI（agy）路徑',
    refresh: '重新整理',
    'actions.title': '一鍵操作',
    'actions.zhTW': '套用繁體中文＋背景面板',
    'actions.zhCN': '套用簡體中文＋背景面板',
    'actions.ja': '套用日文（日本語）＋背景面板',
    'actions.ko': '套用韓文（한국어）＋背景面板',
    'actions.none': '只要自訂背景與 Ctrl+Alt+B 面板（維持英文）',
    'actions.restore': '一鍵還原官方原版',
    'actions.dryRun': '只預覽（dry-run，不修改任何檔案）',
    'actions.note': '套用前會自動備份並校驗 SHA-256；請先完全關閉 Antigravity。套用後重新開啟 Antigravity 即生效。',
    'rules.title': '零侵入模式：多語系 AI 全域規則',
    'rules.desc': '不修改任何安裝檔，只讓 AI 全程以指定語言回覆。',
    'rules.install': '安裝規則',
    'rules.remove': '移除規則',
    'bg.title': '背景快捷設定',
    'bg.hint': '套用後，在 Antigravity 裡按 Ctrl+Alt+B（macOS：⌘+⌥+B）就能免重開，直接選擇電腦裡的圖片。',
    'bg.opacity': '不透明度',
    'bg.blur': '模糊',
    'bg.tint': '遮罩',
    'bg.mode': '圖層',
    'bg.tint.none': '無',
    'bg.tint.dark25': '暗色 25%',
    'bg.tint.dark45': '深暗 45%',
    'bg.tint.navy35': '深藍 35%',
    'bg.mode.overlay': '覆蓋在介面上',
    'bg.mode.underlay': '放在介面底層',
    'bg.image': '或直接輸入電腦中的圖片路徑：',
    'bg.useImage': '使用此圖片',
    'bg.pick': '選擇電腦圖片…',
    'bg.tooLarge': '圖片超過 10 MB，請選擇較小的圖片',
    'bg.badType': '只支援 PNG、JPEG、WebP、GIF 圖片',
    'hint.not-applied': 'App 尚未套用，背景與 Ctrl+Alt+B 面板還不會生效。請按下方「一鍵操作」中任一個套用按鈕（只想要背景、維持英文，就選「只要自訂背景與 Ctrl+Alt+B 面板」）。',
    'hint.no-runtime': 'App 目前的套用方式沒有載入背景功能。請按下方「一鍵操作」中任一個套用按鈕，重新套用一次即可。',
    'hint.old-hook': 'App 的背景功能是舊版（v{current}，最新為 v{latest}），部分功能無法使用。請按下方「一鍵操作」中任一個套用按鈕，重新套用一次即可升級。',
    'bg.on': '啟用',
    'bg.off': '停用',
    'bg.clear': '清除設定',
    'bg.state.none': '背景：未設定',
    'bg.state.on': '背景：已啟用',
    'bg.state.off': '背景：已停用',
    'result.title': '執行結果',
    'result.empty': '尚未執行任何操作。',
    'lock.title': 'Antigravity 可能正在執行，鎖住了檔案',
    'lock.retry': '我已關閉 Antigravity，重試',
    shutdown: '關閉控制台',
    'shutdown.done': '控制台已關閉，可以關閉這個分頁了。',
    working: '執行中…',
    'state.not-installed': '未偵測到',
    'state.unsupported': '不支援',
    'state.not-applied': '原版（尚未套用）',
    'state.applied': '已套用',
    'state.outdated': '部分失效（可能是官方更新，建議重新套用）',
    'state.stale': '已還原為原版',
    'state.bgOnly': '僅背景模式',
    'backup.ok': '正常',
    'backup.bad': '異常',
    'r.applied': '已套用',
    'r.dry-run': '預覽完成',
    'r.already-applied': '已套用過（未變更）',
    'r.unsupported': '不支援',
    'r.no-match': '沒有命中任何字串',
    'r.not-installed': '未偵測到，略過',
    'r.skipped': '略過',
    'r.error': '失敗',
    'r.restored': '已還原',
    'r.already-original': '已是原版',
    'r.blocked': '已中止（未修改任何檔案）',
    'r.nothing': '沒有可還原的套用紀錄',
    'r.serverMsg': '詳細訊息以繁體中文顯示',
    'preset.aurora': '極光',
    'preset.nebula': '星雲',
    'preset.sunset': '霓虹夕陽',
    'preset.midnight': '深夜藍',
    'preset.forest': '靜謐森林',
    'sc.title': '桌面捷徑（智慧啟動器）',
    'sc.desc': '從這個捷徑開啟 Antigravity：若官方剛自動更新、覆蓋了在地化，會先自動重新套用再啟動。不常駐任何背景程式（0 MB 記憶體）。',
    'sc.name': '名稱',
    'sc.lang': '語系',
    'sc.lang.auto': '沿用上次套用的語系',
    'sc.lang.none': '僅背景模式（維持英文）',
    'sc.install': '建立桌面捷徑',
    'sc.remove': '移除桌面捷徑',
    'sc.state.none': '捷徑：未建立',
    'sc.state.ok': '捷徑：已建立',
    'sc.state.foreign': '捷徑：同名檔案已存在（非本工具建立）',
    'sc.kind.windows-lnk': 'Windows 桌面捷徑（.lnk）',
    'sc.kind.wsl-lnk': 'Windows 桌面捷徑（透過 WSL 執行）',
    'sc.kind.macos-command': 'macOS 桌面腳本（.command）',
    'sc.kind.linux-desktop': 'Linux 應用程式選單（.desktop）',
  },
  'zh-CN': {
    title: 'Antigravity 多语言控制台',
    subtitle: '不用记命令：在这里应用繁／简／日／韩本地化、自定义背景，或一键还原官方原版。',
    'status.title': '状态总览',
    'col.target': '目标',
    'col.path': '安装路径',
    'col.state': '状态',
    'col.hook': '挂钩',
    'col.backup': '备份',
    'paths.title': '自定义安装路径（检测不到时填写）',
    'paths.app': 'App（包含 app.asar 的文件夹）',
    'paths.ide': 'IDE 安装文件夹',
    'paths.cli': 'CLI（agy）路径',
    refresh: '刷新',
    'actions.title': '一键操作',
    'actions.zhTW': '应用繁体中文＋背景面板',
    'actions.zhCN': '应用简体中文＋背景面板',
    'actions.ja': '应用日语＋背景面板',
    'actions.ko': '应用韩语＋背景面板',
    'actions.none': '只要自定义背景与 Ctrl+Alt+B 面板（保持英文）',
    'actions.restore': '一键还原官方原版',
    'actions.dryRun': '只预览（dry-run，不修改任何文件）',
    'actions.note': '应用前会自动备份并校验 SHA-256；请先完全关闭 Antigravity。应用后重新打开 Antigravity 即生效。',
    'rules.title': '零侵入模式：多语言 AI 全局规则',
    'rules.desc': '不修改任何安装文件，只让 AI 全程用指定语言回复。',
    'rules.install': '安装规则',
    'rules.remove': '移除规则',
    'bg.title': '背景快捷设置',
    'bg.hint': '应用后，在 Antigravity 里按 Ctrl+Alt+B（macOS：⌘+⌥+B）即可免重启，直接选择电脑里的图片。',
    'bg.opacity': '不透明度',
    'bg.blur': '模糊',
    'bg.tint': '遮罩',
    'bg.mode': '图层',
    'bg.tint.none': '无',
    'bg.tint.dark25': '暗色 25%',
    'bg.tint.dark45': '深暗 45%',
    'bg.tint.navy35': '深蓝 35%',
    'bg.mode.overlay': '覆盖在界面上',
    'bg.mode.underlay': '放在界面底层',
    'bg.image': '或直接输入电脑中的图片路径：',
    'bg.useImage': '使用此图片',
    'bg.pick': '选择电脑图片…',
    'bg.tooLarge': '图片超过 10 MB，请选择较小的图片',
    'bg.badType': '只支持 PNG、JPEG、WebP、GIF 图片',
    'hint.not-applied': 'App 尚未应用，背景与 Ctrl+Alt+B 面板还不会生效。请点击下方「一键操作」中任一个应用按钮（只想要背景、保持英文，就选「只要自定义背景与 Ctrl+Alt+B 面板」）。',
    'hint.no-runtime': 'App 当前的应用方式没有加载背景功能。请点击下方「一键操作」中任一个应用按钮，重新应用一次即可。',
    'hint.old-hook': 'App 的背景功能是旧版（v{current}，最新为 v{latest}），部分功能无法使用。请点击下方「一键操作」中任一个应用按钮，重新应用一次即可升级。',
    'bg.on': '启用',
    'bg.off': '停用',
    'bg.clear': '清除设置',
    'bg.state.none': '背景：未设置',
    'bg.state.on': '背景：已启用',
    'bg.state.off': '背景：已停用',
    'result.title': '执行结果',
    'result.empty': '尚未执行任何操作。',
    'lock.title': 'Antigravity 可能正在运行，锁住了文件',
    'lock.retry': '我已关闭 Antigravity，重试',
    shutdown: '关闭控制台',
    'shutdown.done': '控制台已关闭，可以关闭这个标签页了。',
    working: '执行中…',
    'state.not-installed': '未检测到',
    'state.unsupported': '不支持',
    'state.not-applied': '原版（尚未应用）',
    'state.applied': '已应用',
    'state.outdated': '部分失效（可能是官方更新，建议重新应用）',
    'state.stale': '已还原为原版',
    'state.bgOnly': '仅背景模式',
    'backup.ok': '正常',
    'backup.bad': '异常',
    'r.applied': '已应用',
    'r.dry-run': '预览完成',
    'r.already-applied': '已应用过（未变更）',
    'r.unsupported': '不支持',
    'r.no-match': '没有命中任何字符串',
    'r.not-installed': '未检测到，跳过',
    'r.skipped': '跳过',
    'r.error': '失败',
    'r.restored': '已还原',
    'r.already-original': '已是原版',
    'r.blocked': '已中止（未修改任何文件）',
    'r.nothing': '没有可还原的应用记录',
    'r.serverMsg': '详细信息以繁体中文显示',
    'preset.aurora': '极光',
    'preset.nebula': '星云',
    'preset.sunset': '霓虹夕阳',
    'preset.midnight': '深夜蓝',
    'preset.forest': '静谧森林',
    'sc.title': '桌面快捷方式（智能启动器）',
    'sc.desc': '从这个快捷方式打开 Antigravity：如果官方刚自动更新、覆盖了本地化，会先自动重新应用再启动。不常驻任何后台程序（0 MB 内存）。',
    'sc.name': '名称',
    'sc.lang': '语言',
    'sc.lang.auto': '沿用上次应用的语言',
    'sc.lang.none': '仅背景模式（保持英文）',
    'sc.install': '创建桌面快捷方式',
    'sc.remove': '移除桌面快捷方式',
    'sc.state.none': '快捷方式：未创建',
    'sc.state.ok': '快捷方式：已创建',
    'sc.state.foreign': '快捷方式：同名文件已存在（非本工具创建）',
    'sc.kind.windows-lnk': 'Windows 桌面快捷方式（.lnk）',
    'sc.kind.wsl-lnk': 'Windows 桌面快捷方式（通过 WSL 运行）',
    'sc.kind.macos-command': 'macOS 桌面脚本（.command）',
    'sc.kind.linux-desktop': 'Linux 应用程序菜单（.desktop）',
  },
  ja: {
    title: 'Antigravity 多言語コントロールパネル',
    subtitle: 'コマンド不要：日本語・中国語・韓国語化、背景カスタマイズ、公式版への復元をワンクリックで行えます。',
    'status.title': 'ステータス一覧',
    'col.target': '対象',
    'col.path': 'インストールパス',
    'col.state': '状態',
    'col.hook': 'フック',
    'col.backup': 'バックアップ',
    'paths.title': 'カスタムパス（自動検出されない場合に入力）',
    'paths.app': 'App（app.asar を含むフォルダー）',
    'paths.ide': 'IDE インストールフォルダー',
    'paths.cli': 'CLI（agy）パス',
    refresh: '更新',
    'actions.title': 'ワンクリック操作',
    'actions.zhTW': '繁体字中国語＋背景パネルを適用',
    'actions.zhCN': '簡体字中国語＋背景パネルを適用',
    'actions.ja': '日本語＋背景パネルを適用',
    'actions.ko': '韓国語（한국어）＋背景パネルを適用',
    'actions.none': '背景と Ctrl+Alt+B パネルのみ適用（英語のまま）',
    'actions.restore': '公式版へワンクリック復元',
    'actions.dryRun': 'プレビューのみ（dry-run・ファイル変更なし）',
    'actions.note': '適用前に原本を自動バックアップし SHA-256 で検証します。Antigravity を完全終了してから適用し、再起動してください。',
    'rules.title': '非侵入モード：AI グローバル言語ルール',
    'rules.desc': 'アプリ本体を一切変更せず、AI の応答言語のみを指定言語に固定します。',
    'rules.install': 'ルールをインストール',
    'rules.remove': 'ルールを削除',
    'bg.title': '背景クイック設定',
    'bg.hint': '適用後は Antigravity 内で Ctrl+Alt+B（macOS：⌘+⌥+B）を押すだけで再起動なしに画像を変更できます。',
    'bg.opacity': '不透明度',
    'bg.blur': 'ぼかし',
    'bg.tint': 'ティント',
    'bg.mode': 'レイヤー',
    'bg.tint.none': 'なし',
    'bg.tint.dark25': 'ダーク 25%',
    'bg.tint.dark45': 'ディープ 45%',
    'bg.tint.navy35': 'ネイビー 35%',
    'bg.mode.overlay': 'UI の前面に重ねる',
    'bg.mode.underlay': 'UI の背面に配置',
    'bg.image': 'またはローカル画像パスを直接入力：',
    'bg.useImage': 'この画像を使用',
    'bg.pick': '画像を選択…',
    'bg.tooLarge': '画像サイズが 10 MB を超えています。小さい画像を選択してください',
    'bg.badType': 'PNG、JPEG、WebP、GIF 画像のみ対応しています',
    'hint.not-applied': 'App にはまだ適用されていないため、背景と Ctrl+Alt+B パネルは有効になっていません。下の「ワンクリック操作」から任意の適用ボタンを押してください。',
    'hint.no-runtime': '現在の適用方式では背景フックが読み込まれていません。下の「ワンクリック操作」から再適用してください。',
    'hint.old-hook': 'App の背景フックが旧バージョンです（v{current}、最新は v{latest}）。下の「ワンクリック操作」から再適用するとアップグレードされます。',
    'bg.on': '有効化',
    'bg.off': '無効化',
    'bg.clear': '設定をクリア',
    'bg.state.none': '背景：未設定',
    'bg.state.on': '背景：有効',
    'bg.state.off': '背景：無効',
    'result.title': '実行結果',
    'result.empty': 'まだ操作は実行されていません。',
    'lock.title': 'Antigravity が実行中でファイルがロックされています',
    'lock.retry': 'Antigravity を終了しました・再試行',
    shutdown: 'パネルを閉じる',
    'shutdown.done': 'コントロールパネルを終了しました。このタブを閉じて構いません。',
    working: '実行中…',
    'state.not-installed': '未検出',
    'state.unsupported': '非対応',
    'state.not-applied': '公式版（未適用）',
    'state.applied': '適用済み',
    'state.outdated': '一部失効（公式更新の可能性・再適用を推奨）',
    'state.stale': '公式版に復元済み',
    'state.bgOnly': '背景のみモード',
    'backup.ok': '正常',
    'backup.bad': '異常',
    'r.applied': '適用完了',
    'r.dry-run': 'プレビュー完了',
    'r.already-applied': '適用済み（変更なし）',
    'r.unsupported': '非対応',
    'r.no-match': '一致する文字列がありません',
    'r.not-installed': '未検出・スキップ',
    'r.skipped': 'スキップ',
    'r.error': '失敗',
    'r.restored': '復元完了',
    'r.already-original': 'すでに公式版です',
    'r.blocked': '中止（ファイル未変更）',
    'r.nothing': '復元可能な適用記録がありません',
    'r.serverMsg': '詳細メッセージは繁体字中国語で表示されます',
    'preset.aurora': 'オーロラ',
    'preset.nebula': '星雲',
    'preset.sunset': 'ネオン夕焼け',
    'preset.midnight': 'ミッドナイト',
    'preset.forest': '静寂の森',
    'sc.title': 'デスクトップショートカット（スマートランチャー）',
    'sc.desc': 'このショートカットから Antigravity を開くと、公式の自動アップデートでローカライズが上書きされていた場合に自動で再適用してから起動します。常駐プログラムはありません（メモリ使用 0 MB）。',
    'sc.name': '名前',
    'sc.lang': '言語',
    'sc.lang.auto': '前回適用した言語を使用',
    'sc.lang.none': '背景のみ（英語のまま）',
    'sc.install': 'デスクトップショートカットを作成',
    'sc.remove': 'デスクトップショートカットを削除',
    'sc.state.none': 'ショートカット：未作成',
    'sc.state.ok': 'ショートカット：作成済み',
    'sc.state.foreign': 'ショートカット：同名のファイルが既に存在します（このツール以外で作成）',
    'sc.kind.windows-lnk': 'Windows デスクトップショートカット（.lnk）',
    'sc.kind.wsl-lnk': 'Windows デスクトップショートカット（WSL 経由で実行）',
    'sc.kind.macos-command': 'macOS デスクトップスクリプト（.command）',
    'sc.kind.linux-desktop': 'Linux アプリケーションメニュー（.desktop）',
  },
  ko: {
    title: 'Antigravity 다국어 제어판',
    subtitle: '명령어 없이 한국어·중국어·일본어 현지화, 배경 꾸미기, 공식 버전 복원을 한 번에 처리하세요.',
    'status.title': '상태 요약',
    'col.target': '대상',
    'col.path': '설치 경로',
    'col.state': '상태',
    'col.hook': '훅',
    'col.backup': '백업',
    'paths.title': '사용자 지정 설치 경로 (자동 감지 실패 시 입력)',
    'paths.app': 'App (app.asar가 있는 폴더)',
    'paths.ide': 'IDE 설치 폴더',
    'paths.cli': 'CLI (agy) 경로',
    refresh: '새로 고침',
    'actions.title': '원클릭 작업',
    'actions.zhTW': '중국어 번체 + 배경 패널 적용',
    'actions.zhCN': '중국어 간체 + 배경 패널 적용',
    'actions.ja': '일본어 (日本語) + 배경 패널 적용',
    'actions.ko': '한국어 + 배경 패널 적용',
    'actions.none': '배경 및 Ctrl+Alt+B 패널만 적용 (영어 유지)',
    'actions.restore': '공식 버전으로 원클릭 복원',
    'actions.dryRun': '미리보기만 실행 (dry-run, 파일 변경 없음)',
    'actions.note': '적용 전 원본을 자동 백업하고 SHA-256으로 검증합니다. Antigravity를 완전히 종료한 뒤 적용하고 다시 실행하세요.',
    'rules.title': '무침투 모드: AI 전역 언어 규칙',
    'rules.desc': '설치 파일을 수정하지 않고 AI 응답 언어만 지정한 언어로 설정합니다.',
    'rules.install': '규칙 설치',
    'rules.remove': '규칙 제거',
    'bg.title': '배경 빠른 설정',
    'bg.hint': '적용 후 Antigravity에서 Ctrl+Alt+B (macOS: ⌘+⌥+B)를 누르면 재시작 없이 이미지를 바로 바꿀 수 있습니다.',
    'bg.opacity': '불투명도',
    'bg.blur': '흐림',
    'bg.tint': '틴트',
    'bg.mode': '레이어',
    'bg.tint.none': '없음',
    'bg.tint.dark25': '어둡게 25%',
    'bg.tint.dark45': '더 어둡게 45%',
    'bg.tint.navy35': '네이비 35%',
    'bg.mode.overlay': 'UI 위에 덮기',
    'bg.mode.underlay': 'UI 아래에 배치',
    'bg.image': '또는 컴퓨터의 이미지 경로 직접 입력:',
    'bg.useImage': '이 이미지 사용',
    'bg.pick': '이미지 선택…',
    'bg.tooLarge': '이미지가 10 MB를 초과합니다. 더 작은 이미지를 선택하세요',
    'bg.badType': 'PNG, JPEG, WebP, GIF 이미지만 지원합니다',
    'hint.not-applied': 'App에 아직 적용되지 않아 배경과 Ctrl+Alt+B 패널이 활성화되지 않았습니다. 아래 "원클릭 작업"에서 원하는 적용 버튼을 눌러 주세요.',
    'hint.no-runtime': '현재 적용 방식에 배경 훅이 포함되어 있지 않습니다. 아래 "원클릭 작업"에서 다시 적용해 주세요.',
    'hint.old-hook': 'App의 배경 훅이 이전 버전입니다 (v{current}, 최신 v{latest}). 아래 "원클릭 작업"에서 다시 적용하면 업그레이드됩니다.',
    'bg.on': '활성화',
    'bg.off': '비활성화',
    'bg.clear': '설정 지우기',
    'bg.state.none': '배경: 설정 안 됨',
    'bg.state.on': '배경: 활성화됨',
    'bg.state.off': '배경: 비활성화됨',
    'result.title': '실행 결과',
    'result.empty': '아직 실행된 작업이 없습니다.',
    'lock.title': 'Antigravity가 실행 중이어서 파일이 잠겨 있습니다',
    'lock.retry': 'Antigravity 종료 완료 · 다시 시도',
    shutdown: '제어판 닫기',
    'shutdown.done': '제어판이 종료되었습니다. 이 탭을 닫아도 됩니다.',
    working: '실행 중…',
    'state.not-installed': '감지되지 않음',
    'state.unsupported': '지원되지 않음',
    'state.not-applied': '공식 버전 (미적용)',
    'state.applied': '적용됨',
    'state.outdated': '일부 만료 (공식 업데이트 가능성 · 재적용 권장)',
    'state.stale': '공식 버전으로 복원됨',
    'state.bgOnly': '배경 전용 모드',
    'backup.ok': '정상',
    'backup.bad': '오류',
    'r.applied': '적용 완료',
    'r.dry-run': '미리보기 완료',
    'r.already-applied': '이미 적용됨 (변경 없음)',
    'r.unsupported': '지원되지 않음',
    'r.no-match': '일치하는 문자열 없음',
    'r.not-installed': '감지되지 않음, 건너뜀',
    'r.skipped': '건너뜀',
    'r.error': '실패',
    'r.restored': '복원 완료',
    'r.already-original': '이미 공식 버전임',
    'r.blocked': '중단됨 (파일 변경 없음)',
    'r.nothing': '복원할 적용 기록이 없습니다',
    'r.serverMsg': '상세 메시지는 중국어 번체로 표시됩니다',
    'preset.aurora': '오로라',
    'preset.nebula': '성운',
    'preset.sunset': '네온 석양',
    'preset.midnight': '미드나잇',
    'preset.forest': '고요한 숲',
    'sc.title': '바탕 화면 바로 가기 (스마트 런처)',
    'sc.desc': '이 바로 가기로 Antigravity를 열면, 공식 자동 업데이트로 현지화가 덮어써진 경우 자동으로 다시 적용한 뒤 실행합니다. 상주 프로그램은 없습니다 (메모리 0 MB).',
    'sc.name': '이름',
    'sc.lang': '언어',
    'sc.lang.auto': '마지막으로 적용한 언어 사용',
    'sc.lang.none': '배경만 (영어 유지)',
    'sc.install': '바탕 화면 바로 가기 만들기',
    'sc.remove': '바탕 화면 바로 가기 삭제',
    'sc.state.none': '바로 가기: 만들지 않음',
    'sc.state.ok': '바로 가기: 만들어짐',
    'sc.state.foreign': '바로 가기: 같은 이름의 파일이 이미 있음 (이 도구가 만들지 않음)',
    'sc.kind.windows-lnk': 'Windows 바탕 화면 바로 가기 (.lnk)',
    'sc.kind.wsl-lnk': 'Windows 바탕 화면 바로 가기 (WSL로 실행)',
    'sc.kind.macos-command': 'macOS 바탕 화면 스크립트 (.command)',
    'sc.kind.linux-desktop': 'Linux 애플리케이션 메뉴 (.desktop)',
  },
  en: {
    title: 'Antigravity i18n Control Panel',
    subtitle: 'No commands to remember: apply zh-TW / zh-CN / Japanese / Korean localization, customize the background, or restore the official build in one click.',
    'status.title': 'Status',
    'col.target': 'Target',
    'col.path': 'Install path',
    'col.state': 'State',
    'col.hook': 'Hook',
    'col.backup': 'Backup',
    'paths.title': 'Custom install paths (if not detected)',
    'paths.app': 'App (folder containing app.asar)',
    'paths.ide': 'IDE install folder',
    'paths.cli': 'CLI (agy) path',
    refresh: 'Refresh',
    'actions.title': 'One-click actions',
    'actions.zhTW': 'Apply Traditional Chinese + background panel',
    'actions.zhCN': 'Apply Simplified Chinese + background panel',
    'actions.ja': 'Apply Japanese (日本語) + background panel',
    'actions.ko': 'Apply Korean (한국어) + background panel',
    'actions.none': 'Background & Ctrl+Alt+B panel only (keep English)',
    'actions.restore': 'Restore the official build',
    'actions.dryRun': 'Preview only (dry-run, no files are changed)',
    'actions.note': 'Originals are backed up and SHA-256 verified first. Quit Antigravity completely before applying, then reopen it.',
    'rules.title': 'Zero-touch mode: AI global language rule',
    'rules.desc': 'Changes no installed files; only makes the AI reply in your chosen language.',
    'rules.install': 'Install rule',
    'rules.remove': 'Remove rule',
    'bg.title': 'Background',
    'bg.hint': 'After applying, press Ctrl+Alt+B (macOS: ⌘+⌥+B) inside Antigravity to pick any image from your computer — no restart needed.',
    'bg.opacity': 'Opacity',
    'bg.blur': 'Blur',
    'bg.tint': 'Tint',
    'bg.mode': 'Layer',
    'bg.tint.none': 'None',
    'bg.tint.dark25': 'Dark 25%',
    'bg.tint.dark45': 'Darker 45%',
    'bg.tint.navy35': 'Navy 35%',
    'bg.mode.overlay': 'Over the UI',
    'bg.mode.underlay': 'Under the UI',
    'bg.image': 'Or type an image path on this computer:',
    'bg.useImage': 'Use this image',
    'bg.pick': 'Choose an image…',
    'bg.tooLarge': 'The image is larger than 10 MB — please choose a smaller one',
    'bg.badType': 'Only PNG, JPEG, WebP and GIF images are supported',
    'hint.not-applied': 'The App is not patched yet, so the background and the Ctrl+Alt+B panel are not active. Click any apply button under "One-click actions" below (pick "Background & Ctrl+Alt+B panel only" to keep the English UI).',
    'hint.no-runtime': 'The App was patched without the background hook. Click any apply button under "One-click actions" below to re-apply.',
    'hint.old-hook': 'The App has an old background hook (v{current}, latest is v{latest}), so some features are unavailable. Click any apply button under "One-click actions" below to upgrade.',
    'bg.on': 'Enable',
    'bg.off': 'Disable',
    'bg.clear': 'Clear',
    'bg.state.none': 'Background: not set',
    'bg.state.on': 'Background: enabled',
    'bg.state.off': 'Background: disabled',
    'result.title': 'Result',
    'result.empty': 'Nothing has been run yet.',
    'lock.title': 'Antigravity seems to be running and is locking the files',
    'lock.retry': 'I quit Antigravity — retry',
    shutdown: 'Close control panel',
    'shutdown.done': 'The control panel has stopped. You can close this tab.',
    working: 'Working…',
    'state.not-installed': 'Not detected',
    'state.unsupported': 'Unsupported',
    'state.not-applied': 'Official (not applied)',
    'state.applied': 'Applied',
    'state.outdated': 'Partially outdated (probably an official update — re-apply)',
    'state.stale': 'Restored to official',
    'state.bgOnly': 'Background only',
    'backup.ok': 'OK',
    'backup.bad': 'Problem',
    'r.applied': 'Applied',
    'r.dry-run': 'Preview done',
    'r.already-applied': 'Already applied (unchanged)',
    'r.unsupported': 'Unsupported',
    'r.no-match': 'No strings matched',
    'r.not-installed': 'Not detected, skipped',
    'r.skipped': 'Skipped',
    'r.error': 'Failed',
    'r.restored': 'Restored',
    'r.already-original': 'Already official',
    'r.blocked': 'Aborted (no files changed)',
    'r.nothing': 'Nothing to restore',
    'r.serverMsg': 'Detailed messages are shown in Traditional Chinese',
    'preset.aurora': 'Aurora',
    'preset.nebula': 'Nebula',
    'preset.sunset': 'Neon Sunset',
    'preset.midnight': 'Midnight',
    'preset.forest': 'Forest',
    'sc.title': 'Desktop shortcut (smart launcher)',
    'sc.desc': 'Open Antigravity from this shortcut: if an official auto-update has overwritten the localization, it is re-applied automatically before launch. Nothing stays running in the background (0 MB memory).',
    'sc.name': 'Name',
    'sc.lang': 'Language',
    'sc.lang.auto': 'Keep the last applied language',
    'sc.lang.none': 'Background only (keep English)',
    'sc.install': 'Create desktop shortcut',
    'sc.remove': 'Remove desktop shortcut',
    'sc.state.none': 'Shortcut: not created',
    'sc.state.ok': 'Shortcut: created',
    'sc.state.foreign': 'Shortcut: a file with the same name already exists (not created by this tool)',
    'sc.kind.windows-lnk': 'Windows desktop shortcut (.lnk)',
    'sc.kind.wsl-lnk': 'Windows desktop shortcut (runs through WSL)',
    'sc.kind.macos-command': 'macOS desktop script (.command)',
    'sc.kind.linux-desktop': 'Linux application menu (.desktop)',
  },
};

const CSS = `
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--fg:#1d1f23;--muted:#6b7280;--line:#e3e5e8;--accent:#2563eb;--accent-fg:#fff;--ok:#15803d;--warn:#b45309;--bad:#b91c1c;--code:#f1f3f5}
@media (prefers-color-scheme:dark){:root{--bg:#141518;--card:#1c1d21;--fg:#e8e8ea;--muted:#9a9ca3;--line:#2c2e33;--accent:#5b8cff;--accent-fg:#0b0c0e;--ok:#4ade80;--warn:#fbbf24;--bad:#f87171;--code:#24262b}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 system-ui,-apple-system,"Segoe UI","Microsoft JhengHei","PingFang TC","PingFang SC",sans-serif}
header{display:flex;align-items:center;gap:12px;padding:18px 24px 6px;max-width:1080px;margin:0 auto}
header h1{font-size:20px;margin:0}
.ver{color:var(--muted);font-size:12px}
.langs{margin-left:auto;display:flex;gap:4px}
.langs button[aria-pressed=true]{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}
.sub{max-width:1080px;margin:0 auto;padding:0 24px 8px;color:var(--muted)}
main{max-width:1080px;margin:0 auto;padding:8px 24px 24px;display:grid;gap:16px;grid-template-columns:1fr 1fr}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.wide{grid-column:1/-1}
h2{font-size:15px;margin:0 0 10px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{white-space:nowrap}
td.nowrap{white-space:nowrap}
td.path,.note.path{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;word-break:break-all}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}.muted{color:var(--muted)}
button{font:inherit;cursor:pointer;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:8px;padding:7px 12px}
button:hover{border-color:var(--accent)}
button:disabled{opacity:.55;cursor:progress}
button.primary{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}
button.danger{color:var(--bad)}
.stack{display:grid;gap:8px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}
label.ctl{display:flex;align-items:center;gap:8px}
label.ctl span{min-width:64px;color:var(--muted)}
input[type=text]{flex:1;min-width:180px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
select{padding:5px 6px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
details{margin-top:10px}
summary{cursor:pointer;color:var(--muted)}
.presets{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:10px 0}
.preset{height:72px;border-radius:10px;border:1px solid var(--line);color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.8);display:flex;align-items:flex-end;padding:6px 8px;font-size:12px}
.hint{background:var(--code);border-radius:8px;padding:8px 10px;color:var(--fg)}
.note{color:var(--muted);font-size:12px}
#lock{border:1px solid var(--warn);border-radius:10px;padding:10px 14px;margin-bottom:10px}
#lock h3{margin:0 0 6px;font-size:14px;color:var(--warn)}
#log{background:var(--code);border-radius:8px;padding:10px 12px;margin:0;white-space:pre-wrap;word-break:break-word;font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;max-height:320px;overflow:auto}
footer{max-width:1080px;margin:0 auto;padding:0 24px 32px;display:flex;justify-content:flex-end}
[hidden]{display:none !important}
@media (max-width:820px){main{grid-template-columns:1fr}.presets{grid-template-columns:repeat(3,1fr)}}
`;

/** 前端腳本：刻意不用 template literal，避免與外層 TS 字串混淆 */
const SCRIPT = `
(function () {
  'use strict';
  var TEXT = __TEXT__;
  var TOKEN = document.querySelector('meta[name="agi18n-token"]').getAttribute('content');
  var LOCK = ['EBUSY', 'EPERM', 'EACCES'];
  var lang = 'zh-TW';
  var last = null;
  var status = null;
  try {
    var saved = localStorage.getItem('agi18n-ui-lang');
    if (saved && TEXT[saved]) lang = saved;
    else if (/^ja/i.test(navigator.language)) lang = 'ja';
    else if (/^ko/i.test(navigator.language)) lang = 'ko';
    else if (/^zh-(CN|SG|Hans)/i.test(navigator.language)) lang = 'zh-CN';
    else if (!/^zh/i.test(navigator.language)) lang = 'en';
  } catch (e) {}

  function $(id) { return document.getElementById(id); }
  function t(key) { return (TEXT[lang] && TEXT[lang][key]) || TEXT['zh-TW'][key] || key; }
  function presetLabel(name, fallback) {
    var key = 'preset.' + name;
    return (TEXT[lang] && TEXT[lang][key]) || fallback || name;
  }
  function sep() { return lang === 'en' || lang === 'ko' ? ': ' : '：'; }
  function paren(s) { return lang === 'en' || lang === 'ko' ? ' (' + s + ')' : '（' + s + '）'; }

  function el(tag, text, cls) {
    var n = document.createElement(tag);
    if (text !== undefined && text !== null) n.textContent = String(text);
    if (cls) n.className = cls;
    return n;
  }

  function applyLang() {
    document.documentElement.lang = lang === 'en' ? 'en' : lang === 'ja' ? 'ja' : lang === 'ko' ? 'ko' : lang === 'zh-CN' ? 'zh-Hans' : 'zh-Hant';
    document.title = t('title');
    document.querySelectorAll('[data-i18n]').forEach(function (n) { n.textContent = t(n.getAttribute('data-i18n')); });
    document.querySelectorAll('.langs button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === lang)); });
    document.querySelectorAll('#presets .preset').forEach(function (b) { b.textContent = presetLabel(b.getAttribute('data-preset'), b.getAttribute('data-label')); });
    if (status) renderStatus(status);
    if (shortcutLast) renderShortcut(shortcutLast);
  }

  function paths() {
    var out = {};
    ['app', 'ide', 'cli'].forEach(function (k) { var v = $('path-' + k).value.trim(); if (v) out[k] = v; });
    return out;
  }

  function api(method, path, body) {
    return fetch(path, {
      method: method,
      headers: { 'X-AGI18N-Token': TOKEN, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; }).then(function (j) { j.httpStatus = r.status; return j; });
    });
  }

  function log(lines, cls) {
    var box = $('log');
    if (box.getAttribute('data-empty') === '1') { box.textContent = ''; box.removeAttribute('data-empty'); }
    var stamp = new Date().toLocaleTimeString();
    [].concat(lines).forEach(function (line, i) {
      var div = el('div', (i === 0 ? '[' + stamp + '] ' : '    ') + line, cls);
      box.appendChild(div);
    });
    box.scrollTop = box.scrollHeight;
  }

  function showLock(err) {
    var box = $('lock');
    if (!err || LOCK.indexOf(err.code) < 0) { box.hidden = true; return; }
    var ol = $('lock-steps');
    ol.textContent = '';
    (err.steps || []).forEach(function (s) { ol.appendChild(el('li', s)); });
    $('lock-msg').textContent = err.message;
    box.hidden = false;
  }

  function setBusy(on) {
    document.querySelectorAll('button[data-act], #refresh').forEach(function (b) { b.disabled = on; });
  }

  function run(label, fn) {
    last = { label: label, fn: fn };
    setBusy(true);
    log(label + ' — ' + t('working'), 'muted');
    return fn().then(function (res) {
      report(res);
      return refresh();
    }).catch(function (e) {
      log(String(e && e.message || e), 'bad');
    }).then(function () { setBusy(false); });
  }

  function report(res) {
    var lockErr = null;
    if (res.error && !res.results) {
      log(res.error, 'bad');
      if (res.detail) lockErr = res.detail;
    }
    (res.results || []).forEach(function (r) {
      var cls = r.status === 'error' || r.status === 'blocked' ? 'bad' : r.status === 'applied' || r.status === 'restored' || r.status === 'dry-run' ? 'ok' : 'muted';
      var lines = ['[' + r.id + '] ' + t('r.' + r.status) + (r.installRoot ? '  ' + r.installRoot : '')];
      if (r.stats && res.lang !== 'none' && r.status !== 'not-installed' && r.status !== 'skipped') {
        lines.push(r.stats.matchedKeys + '/' + r.stats.totalKeys + ' · ' + r.stats.totalHits + ' · ' + Math.round(r.stats.coverage * 1000) / 10 + '%');
      }
      if (r.runtime && r.runtime.enabled) {
        lines.push(r.runtime.translation === false ? 'runtime: background + Ctrl+Alt+B panel' : 'runtime: ' + r.runtime.entries + ' entries @ ' + r.runtime.mainEntry);
      }
      (r.warnings || []).forEach(function (w) { lines.push('⚠ ' + w); });
      // 還原結果的 files 是陣列（套用結果的 files 是檔案數量）
      if (Array.isArray(r.files)) {
        r.files.forEach(function (f) { lines.push((f.action === 'restored' ? '✔ ' : f.action === 'blocked' ? '✖ ' : '· ') + f.path + (f.reason ? '（' + f.reason + '）' : '')); });
      }
      if (r.error) {
        lines.push('✖ ' + r.error.message);
        if (LOCK.indexOf(r.error.code) >= 0) lockErr = r.error;
      }
      log(lines, cls);
    });
    if (res.results && res.results.length === 0) log(t('r.nothing'), 'muted');
    if (res.shortcut) {
      var sc = res.shortcut;
      var lines3 = ['shortcut ' + sc.action + (sc.action === 'remove' && !sc.removed ? ' —' : ' ✔') + '  ' + t('sc.kind.' + sc.kind), sc.file];
      if (sc.action === 'install') lines3.push(sc.command);
      (sc.warnings || []).forEach(function (w) { lines3.push('⚠ ' + w); });
      log(lines3, 'ok');
    }
    if (res.action) {
      var lines2 = ['bg ' + res.action + ' ✔'];
      if (res.imagePath) lines2.push(res.imagePath);
      if (res.mirrorImage) lines2.push(res.mirrorImage);
      if (res.file) lines2.push(res.file);
      if (res.mirror) lines2.push(res.mirror);
      (res.warnings || []).forEach(function (w) { lines2.push('⚠ ' + w); });
      if (res.result && res.result.path) lines2.push(res.result.path);
      if (res.result && res.result.removed) res.result.removed.forEach(function (p) { lines2.push('✔ ' + p); });
      log(lines2, res.ok === false ? 'warn' : 'ok');
    }
    showLock(lockErr);
  }

  function stateText(r) {
    if (r.state === 'applied' && r.backgroundOnly) return t('state.applied') + sep() + t('state.bgOnly');
    if (r.state === 'applied' && r.lang) return t('state.applied') + sep() + r.lang;
    return t('state.' + r.state) + (r.reason ? paren(r.reason) : '');
  }

  /** 掛鉤提示依介面語系顯示，並引導使用者點擊下方的套用按鈕 */
  function hintText(s) {
    var h = s.hintInfo;
    if (!h) return '';
    if (h.code === 'not-applied') {
      // 沒偵測到 App、也沒有設定背景時不提示，避免誤導
      var app = s.targets.filter(function (r) { return r.id === 'app'; })[0];
      var hasBg = s.background && s.background.config;
      if ((!app || app.state === 'not-installed') && !hasBg) return '';
    }
    return t('hint.' + h.code).replace('{current}', String(h.current || '')).replace('{latest}', String(h.latest || ''));
  }

  function renderStatus(s) {
    status = s;
    var body = $('targets');
    body.textContent = '';
    s.targets.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.appendChild(el('td', r.id.toUpperCase(), 'nowrap'));
      tr.appendChild(el('td', r.installRoot || '—', 'path'));
      var cls = r.state === 'applied' ? 'ok' : r.state === 'outdated' ? 'warn' : r.state === 'not-installed' || r.state === 'unsupported' ? 'muted' : '';
      tr.appendChild(el('td', stateText(r), cls));
      tr.appendChild(el('td', r.hookVersion ? 'v' + r.hookVersion + (r.hookVersion < s.hookVersion ? ' → v' + s.hookVersion : '') : '—', 'nowrap' + (r.hookVersion && r.hookVersion < s.hookVersion ? ' warn' : '')));
      tr.appendChild(el('td', r.backupOk === undefined ? '—' : r.backupOk ? t('backup.ok') : t('backup.bad'), 'nowrap' + (r.backupOk === false ? ' bad' : '')));
      body.appendChild(tr);
    });
    var bg = s.background;
    var bgText = bg.error ? bg.error : !bg.config ? t('bg.state.none') : (bg.config.enabled ? t('bg.state.on') : t('bg.state.off')) + ' · ' + (bg.config.kind === 'preset' ? bg.config.preset : bg.config.imagePath);
    $('bg-state').textContent = bgText;
    var hint = hintText(s);
    $('hint').textContent = hint;
    $('hint').hidden = !hint;
    if ($('presets').childElementCount === 0) {
      s.presets.forEach(function (p) {
        var b = el('button', presetLabel(p.name, p.label), 'preset');
        b.setAttribute('data-act', 'preset');
        b.setAttribute('data-preset', p.name);
        b.setAttribute('data-label', p.label);
        b.title = p.description;
        b.style.backgroundImage = p.image;
        b.addEventListener('click', function () {
          run(presetLabel(p.name, p.label), function () {
            return api('POST', '/api/bg', { action: 'preset', preset: p.name, opacity: $('bg-opacity').value, blur: $('bg-blur').value, tint: $('bg-tint').value, mode: $('bg-mode').value });
          });
        });
        $('presets').appendChild(b);
      });
    }
  }

  function refresh() {
    var q = paths();
    var qs = Object.keys(q).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]); }).join('&');
    return api('GET', '/api/status' + (qs ? '?' + qs : '')).then(function (s) {
      if (s.ok === false) { log(s.error || 'status failed', 'bad'); return; }
      renderStatus(s);
    }).then(refreshShortcut);
  }

  function shortcutBody() {
    return { name: $('sc-name').value.trim(), lang: $('sc-lang').value, paths: { app: $('path-app').value.trim() } };
  }

  var shortcutLast = null;
  function renderShortcut(res) {
    shortcutLast = res;
    var s = res && res.shortcut;
    if (!s) {
      $('sc-state').textContent = (res && res.error) || '';
      $('sc-file').textContent = '';
      return;
    }
    $('sc-state').textContent = (s.exists ? (s.managed ? t('sc.state.ok') : t('sc.state.foreign')) : t('sc.state.none')) + ' · ' + t('sc.kind.' + s.kind);
    $('sc-file').textContent = s.file;
  }

  function refreshShortcut() {
    var q = 'name=' + encodeURIComponent($('sc-name').value.trim()) + '&app=' + encodeURIComponent($('path-app').value.trim());
    return api('GET', '/api/shortcut?' + q).then(renderShortcut).catch(function () {});
  }

  function applyBody(l) {
    return { lang: l, target: l === 'none' ? 'app' : 'all', paths: paths(), dryRun: $('dry-run').checked, force: true };
  }

  var ACTIONS = {
    'apply-zh-TW': function () { return api('POST', '/api/apply', applyBody('zh-TW')); },
    'apply-zh-CN': function () { return api('POST', '/api/apply', applyBody('zh-CN')); },
    'apply-ja': function () { return api('POST', '/api/apply', applyBody('ja')); },
    'apply-ko': function () { return api('POST', '/api/apply', applyBody('ko')); },
    'apply-none': function () { return api('POST', '/api/apply', applyBody('none')); },
    restore: function () { return api('POST', '/api/restore', { target: 'all', paths: paths() }); },
    'rules-install': function () { return api('POST', '/api/rules', { action: 'install', lang: $('rules-lang').value }); },
    'rules-remove': function () { return api('POST', '/api/rules', { action: 'remove' }); },
    'bg-image': function () { return api('POST', '/api/bg', { action: 'set', imagePath: $('bg-path').value, opacity: $('bg-opacity').value, blur: $('bg-blur').value, tint: $('bg-tint').value, mode: $('bg-mode').value }); },
    'bg-on': function () { return api('POST', '/api/bg', { action: 'on' }); },
    'bg-off': function () { return api('POST', '/api/bg', { action: 'off' }); },
    'bg-clear': function () { return api('POST', '/api/bg', { action: 'clear' }); },
    'sc-install': function () { return api('POST', '/api/shortcut/install', shortcutBody()); },
    'sc-remove': function () { return api('POST', '/api/shortcut/remove', shortcutBody()); },
  };

  document.querySelectorAll('button[data-act]').forEach(function (b) {
    var act = b.getAttribute('data-act');
    if (!ACTIONS[act]) return;
    b.addEventListener('click', function () { run(b.textContent, ACTIONS[act]); });
  });
  document.querySelectorAll('.langs button').forEach(function (b) {
    b.addEventListener('click', function () {
      lang = b.getAttribute('data-lang');
      try { localStorage.setItem('agi18n-ui-lang', lang); } catch (e) {}
      applyLang();
    });
  });
  var MAX_UPLOAD = 10 * 1024 * 1024;
  var ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  function bgQuery() {
    return ['opacity', 'blur', 'tint', 'mode'].map(function (k) { return k + '=' + encodeURIComponent($('bg-' + k).value); }).join('&');
  }
  function upload(file) {
    return fetch('/api/bg/upload?' + bgQuery(), {
      method: 'POST',
      headers: { 'X-AGI18N-Token': TOKEN, 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; });
    });
  }
  $('bg-pick').addEventListener('click', function () { $('bg-file').click(); });
  $('bg-file').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    if (file.size > MAX_UPLOAD) { log(t('bg.tooLarge'), 'bad'); return; }
    if (ACCEPT.indexOf(file.type) < 0) { log(t('bg.badType'), 'bad'); return; }
    run(t('bg.pick') + ' ' + file.name, function () { return upload(file); });
  });
  $('refresh').addEventListener('click', function () { refresh(); });
  $('lock-retry').addEventListener('click', function () { if (last) run(last.label, last.fn); });
  $('bg-opacity').addEventListener('input', function () { $('bg-opacity-v').textContent = Number(this.value).toFixed(2); });
  $('bg-blur').addEventListener('input', function () { $('bg-blur-v').textContent = this.value + 'px'; });
  $('shutdown').addEventListener('click', function () {
    api('POST', '/api/shutdown').then(function () {
      document.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
      log(t('shutdown.done'), 'ok');
    });
  });

  $('log').setAttribute('data-empty', '1');
  applyLang();
  $('log').textContent = t('result.empty');
  refresh();
})();
`;

export function renderUiHtml(opts: UiHtmlOptions): string {
  const script = SCRIPT.replace('__TEXT__', JSON.stringify(UI_TEXT).replace(/</g, '\\u003c'));
  const opt = (value: string, key: string): string => `<option value="${escapeHtml(value)}" data-i18n="${key}"></option>`;
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="agi18n-token" content="${escapeHtml(opts.token)}">
<title>Antigravity i18n</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <h1 data-i18n="title"></h1>
  <span class="ver">v${escapeHtml(opts.version)} · hook v${opts.hookVersion}</span>
  <nav class="langs" aria-label="Language">
    <button type="button" data-lang="zh-TW">繁中</button>
    <button type="button" data-lang="zh-CN">简中</button>
    <button type="button" data-lang="ja">日本語</button>
    <button type="button" data-lang="ko">한국어</button>
    <button type="button" data-lang="en">EN</button>
  </nav>
</header>
<p class="sub" data-i18n="subtitle"></p>
<main>
  <section class="card wide" id="status-card">
    <h2 data-i18n="status.title"></h2>
    <table>
      <thead><tr><th data-i18n="col.target"></th><th data-i18n="col.path"></th><th data-i18n="col.state"></th><th data-i18n="col.hook"></th><th data-i18n="col.backup"></th></tr></thead>
      <tbody id="targets"></tbody>
    </table>
    <div class="row"><span id="bg-state" class="muted"></span></div>
    <div id="hint" class="hint warn" hidden></div>
    <details>
      <summary data-i18n="paths.title"></summary>
      <div class="stack" style="margin-top:8px">
        <label class="ctl"><span data-i18n="paths.app"></span><input type="text" id="path-app" spellcheck="false"></label>
        <label class="ctl"><span data-i18n="paths.ide"></span><input type="text" id="path-ide" spellcheck="false"></label>
        <label class="ctl"><span data-i18n="paths.cli"></span><input type="text" id="path-cli" spellcheck="false"></label>
      </div>
    </details>
    <div class="row"><button type="button" id="refresh" data-i18n="refresh"></button></div>
  </section>

  <section class="card">
    <h2 data-i18n="actions.title"></h2>
    <div class="stack">
      <button type="button" class="primary" data-act="apply-zh-TW" data-i18n="actions.zhTW"></button>
      <button type="button" class="primary" data-act="apply-zh-CN" data-i18n="actions.zhCN"></button>
      <button type="button" class="primary" data-act="apply-ja" data-i18n="actions.ja"></button>
      <button type="button" class="primary" data-act="apply-ko" data-i18n="actions.ko"></button>
      <button type="button" data-act="apply-none" data-i18n="actions.none"></button>
      <button type="button" class="danger" data-act="restore" data-i18n="actions.restore"></button>
    </div>
    <label class="row"><input type="checkbox" id="dry-run"> <span data-i18n="actions.dryRun"></span></label>
    <p class="note" data-i18n="actions.note"></p>
    <h2 style="margin-top:16px" data-i18n="rules.title"></h2>
    <p class="note" data-i18n="rules.desc"></p>
    <div class="row">
      <select id="rules-lang"><option value="zh-TW">繁體中文</option><option value="zh-CN">简体中文</option><option value="ja">日本語</option><option value="ko">한국어</option></select>
      <button type="button" data-act="rules-install" data-i18n="rules.install"></button>
      <button type="button" data-act="rules-remove" data-i18n="rules.remove"></button>
    </div>
  </section>

  <section class="card">
    <h2 data-i18n="bg.title"></h2>
    <p class="hint" data-i18n="bg.hint"></p>
    <div class="presets" id="presets"></div>
    <label class="ctl"><span data-i18n="bg.opacity"></span><input type="range" id="bg-opacity" min="0.01" max="1" step="0.01" value="0.12"><span id="bg-opacity-v">0.12</span></label>
    <label class="ctl"><span data-i18n="bg.blur"></span><input type="range" id="bg-blur" min="0" max="32" step="1" value="0"><span id="bg-blur-v">0px</span></label>
    <label class="ctl"><span data-i18n="bg.tint"></span><select id="bg-tint">${opt('none', 'bg.tint.none')}${opt('rgba(0,0,0,0.25)', 'bg.tint.dark25')}${opt('rgba(0,0,0,0.45)', 'bg.tint.dark45')}${opt('rgba(10,25,60,0.35)', 'bg.tint.navy35')}</select></label>
    <label class="ctl"><span data-i18n="bg.mode"></span><select id="bg-mode">${opt('overlay', 'bg.mode.overlay')}${opt('underlay', 'bg.mode.underlay')}</select></label>
    <div class="row">
      <button type="button" class="primary" id="bg-pick" data-act="bg-pick" data-i18n="bg.pick"></button>
      <input type="file" id="bg-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
    </div>
    <p class="note" data-i18n="bg.image"></p>
    <div class="row"><input type="text" id="bg-path" spellcheck="false" aria-label="image path" placeholder="C:\\Users\\me\\Pictures\\wallpaper.jpg"><button type="button" data-act="bg-image" data-i18n="bg.useImage"></button></div>
    <div class="row">
      <button type="button" data-act="bg-on" data-i18n="bg.on"></button>
      <button type="button" data-act="bg-off" data-i18n="bg.off"></button>
      <button type="button" class="danger" data-act="bg-clear" data-i18n="bg.clear"></button>
    </div>
  </section>

  <section class="card wide" id="shortcut-card">
    <h2 data-i18n="sc.title"></h2>
    <p class="note" data-i18n="sc.desc"></p>
    <div class="row">
      <label class="ctl"><span data-i18n="sc.name"></span><input type="text" id="sc-name" spellcheck="false" maxlength="80" value="Antigravity (i18n)"></label>
      <label class="ctl"><span data-i18n="sc.lang"></span><select id="sc-lang">${opt('', 'sc.lang.auto')}<option value="zh-TW">繁體中文</option><option value="zh-CN">简体中文</option><option value="ja">日本語</option><option value="ko">한국어</option>${opt('none', 'sc.lang.none')}</select></label>
    </div>
    <div class="row">
      <button type="button" class="primary" data-act="sc-install" data-i18n="sc.install"></button>
      <button type="button" class="danger" data-act="sc-remove" data-i18n="sc.remove"></button>
      <span id="sc-state" class="muted"></span>
    </div>
    <div id="sc-file" class="note path"></div>
  </section>

  <section class="card wide" id="result-card">
    <h2 data-i18n="result.title"></h2>
    <div id="lock" hidden>
      <h3 data-i18n="lock.title"></h3>
      <div id="lock-msg" class="note"></div>
      <ol id="lock-steps"></ol>
      <button type="button" class="primary" id="lock-retry" data-i18n="lock.retry"></button>
    </div>
    <div id="log" role="log" aria-live="polite"></div>
    <p class="note" data-i18n="r.serverMsg"></p>
  </section>
</main>
<footer><button type="button" id="shutdown" data-i18n="shutdown"></button></footer>
<script nonce="${escapeHtml(opts.nonce)}">${script}</script>
</body>
</html>`;
}
