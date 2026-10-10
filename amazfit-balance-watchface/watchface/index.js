/**
 * Balance Pro – hybrid watch face for Amazfit Balance (480x480, round).
 *
 * All data widgets use the system data bindings (data_type), so values
 * update automatically without any JS timers – this keeps battery usage low.
 */

const CX = 240
const CY = 240

const img = (p) => `images/${p}`
const digits = (folder) => Array.from({ length: 10 }, (_, i) => img(`${folder}/${i}.png`))
const NUM = digits('num')
const DATE = digits('date')
const WEEK_EN = Array.from({ length: 7 }, (_, i) => img(`week_en/${i}.png`))

// Must match the generator (tools/generate_assets.py)
const NUM_W = 17
const NUM_H = 26
const SUB_R = 46 // arc radius inside the 52px sub-dials
const ARC_W = 5

const NORMAL = hmUI.show_level.ONLY_NORMAL
const AOD = hmUI.show_level.ONLY_AOD

function dataText(cx, cy, type, extra = {}) {
  const w = 96
  return hmUI.createWidget(hmUI.widget.TEXT_IMG, {
    x: cx - w / 2,
    y: cy - NUM_H / 2,
    w,
    h: NUM_H,
    font_array: NUM,
    h_space: 0,
    align_h: hmUI.align.CENTER_H,
    type,
    padding: false,
    invalid_image: img('num/dash.png'),
    show_level: NORMAL,
    ...extra
  })
}

function ring(cx, cy, type, color) {
  return hmUI.createWidget(hmUI.widget.ARC_PROGRESS, {
    center_x: cx,
    center_y: cy,
    radius: SUB_R,
    start_angle: -90,
    end_angle: 270,
    color,
    line_width: ARC_W,
    type,
    show_level: NORMAL
  })
}

function shortcut(cx, cy, type) {
  hmUI.createWidget(hmUI.widget.IMG_CLICK, {
    x: cx - 52,
    y: cy - 52,
    w: 104,
    h: 104,
    src: '',
    type,
    show_level: NORMAL
  })
}

WatchFace({
  initView() {
    const dt = hmUI.data_type

    // ---- Backgrounds ---------------------------------------------------
    hmUI.createWidget(hmUI.widget.IMG, { x: 0, y: 0, src: img('bg.png'), show_level: NORMAL })
    hmUI.createWidget(hmUI.widget.IMG, { x: 0, y: 0, src: img('bg_aod.png'), show_level: AOD })

    // ---- Date window: "SAT 10" -----------------------------------------
    hmUI.createWidget(hmUI.widget.IMG_WEEK, {
      x: 200,
      y: 141,
      week_en: WEEK_EN,
      week_tc: WEEK_EN,
      week_sc: WEEK_EN,
      show_level: NORMAL
    })
    hmUI.createWidget(hmUI.widget.IMG_DATE, {
      day_startX: 250,
      day_startY: 141,
      day_sc_array: DATE,
      day_tc_array: DATE,
      day_en_array: DATE,
      day_zero: 1,
      day_space: 0,
      day_align: hmUI.align.LEFT,
      day_is_character: false,
      show_level: NORMAL
    })

    // ---- Steps (left) --------------------------------------------------
    ring(140, 240, dt.STEP, 0xff7a1a)
    dataText(140, 236, dt.STEP)
    shortcut(140, 240, dt.STEP)

    // ---- Battery (right) -----------------------------------------------
    ring(340, 240, dt.BATTERY, 0x40c4ff)
    dataText(340, 236, dt.BATTERY, { unit_en: img('num/percent.png'), unit_sc: img('num/percent.png'), unit_tc: img('num/percent.png') })
    shortcut(340, 240, dt.BATTERY)

    // ---- Heart rate (bottom) -------------------------------------------
    hmUI.createWidget(hmUI.widget.IMG, { x: 230, y: 304, src: img('heart.png'), show_level: NORMAL })
    dataText(240, 342, dt.HEART)
    shortcut(240, 340, dt.HEART)

    // ---- Hands ---------------------------------------------------------
    // posX/posY = rotation pivot inside the hand image (see generator output)
    hmUI.createWidget(hmUI.widget.TIME_POINTER, {
      hour_centerX: CX,
      hour_centerY: CY,
      hour_posX: 11,
      hour_posY: 138,
      hour_path: img('hour.png'),
      minute_centerX: CX,
      minute_centerY: CY,
      minute_posX: 9,
      minute_posY: 200,
      minute_path: img('minute.png'),
      second_centerX: CX,
      second_centerY: CY,
      second_posX: 8,
      second_posY: 206,
      second_path: img('second.png'),
      second_cover_path: img('center.png'),
      second_cover_x: CX - 7,
      second_cover_y: CY - 7,
      show_level: NORMAL
    })

    // Always-on display: dimmed hands, no second hand
    hmUI.createWidget(hmUI.widget.TIME_POINTER, {
      hour_centerX: CX,
      hour_centerY: CY,
      hour_posX: 11,
      hour_posY: 138,
      hour_path: img('hour_aod.png'),
      minute_centerX: CX,
      minute_centerY: CY,
      minute_posX: 9,
      minute_posY: 200,
      minute_path: img('minute_aod.png'),
      minute_cover_path: img('center_aod.png'),
      minute_cover_x: CX - 7,
      minute_cover_y: CY - 7,
      show_level: AOD
    })
  },

  onInit() {},

  build() {
    this.initView()
  },

  onDestroy() {}
})
