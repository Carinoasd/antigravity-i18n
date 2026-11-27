/**
 * 內建的純 CSS 漸層背景預設（零圖片檔、幾乎零記憶體開銷）。
 *
 * 這份表是唯一來源：`bg presets` 由此列出清單，`apply --target app` 時則以 JSON
 * 內嵌進主行程掛鉤，供 `bg preset <name>` 在執行期查表。切換預設不需重新打包
 * app.asar；**新增或修改預設**則需要重新 `apply --force` 一次才會更新掛鉤內的表。
 *
 * `image` 只能使用 `linear-gradient` / `radial-gradient` / `conic-gradient` 與
 * 顏色值，字元限制在 `[A-Za-z0-9#%.,()\s-]`（掛鉤與 renderer 都會再驗證）。
 */

export interface BackgroundPreset {
  /** 中文名稱 */
  label: string;
  /** 簡短說明 */
  description: string;
  /** CSS background-image 值 */
  image: string;
}

export const BACKGROUND_PRESETS: Record<string, BackgroundPreset> = {
  aurora: {
    label: '極光',
    description: '青綠與藍紫交織的極光，冷色調、層次柔和',
    image: [
      'radial-gradient(ellipse 80% 60% at 15% 0%, rgba(0, 255, 170, 0.55), transparent 60%)',
      'radial-gradient(ellipse 70% 55% at 85% 10%, rgba(64, 128, 255, 0.5), transparent 60%)',
      'radial-gradient(ellipse 90% 60% at 50% 100%, rgba(170, 70, 255, 0.45), transparent 65%)',
      'linear-gradient(160deg, #04121f 0%, #0a1f36 50%, #120a33 100%)',
    ].join(', '),
  },
  nebula: {
    label: '星雲',
    description: '深空中的洋紅與紫色星雲，帶微弱光暈',
    image: [
      'radial-gradient(circle at 30% 35%, rgba(255, 80, 200, 0.5), transparent 45%)',
      'radial-gradient(circle at 70% 60%, rgba(120, 60, 255, 0.55), transparent 50%)',
      'radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.08), transparent 70%)',
      'linear-gradient(135deg, #0b0418 0%, #1a0b2e 55%, #05020d 100%)',
    ].join(', '),
  },
  sunset: {
    label: '霓虹夕陽',
    description: '橘、粉、紫的霓虹漸層，溫暖鮮明',
    image: [
      'radial-gradient(ellipse 120% 70% at 50% 110%, rgba(255, 140, 50, 0.65), transparent 60%)',
      'linear-gradient(180deg, #1b0b3a 0%, #5b1a6e 40%, #d6336c 75%, #ff8a3d 100%)',
    ].join(', '),
  },
  midnight: {
    label: '深夜藍',
    description: '低調的深藍漸層，適合長時間寫程式',
    image: [
      'radial-gradient(ellipse 90% 70% at 80% 0%, rgba(60, 110, 200, 0.35), transparent 60%)',
      'linear-gradient(180deg, #0a1428 0%, #0d1b33 50%, #060c18 100%)',
    ].join(', '),
  },
  forest: {
    label: '靜謐森林',
    description: '墨綠與苔綠的柔和漸層，安靜不刺眼',
    image: [
      'radial-gradient(ellipse 80% 60% at 20% 20%, rgba(80, 160, 110, 0.4), transparent 60%)',
      'radial-gradient(ellipse 70% 60% at 85% 85%, rgba(30, 90, 70, 0.45), transparent 60%)',
      'linear-gradient(160deg, #07170f 0%, #0e2a1d 55%, #06110b 100%)',
    ].join(', '),
  },
};

/** 掛鉤內嵌用：只保留 CSS 值 */
export function presetImages(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, p] of Object.entries(BACKGROUND_PRESETS)) out[name] = p.image;
  return out;
}
