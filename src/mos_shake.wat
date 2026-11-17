;; mos_shake — EffectCraft effect plug-in (ABI 1)
;; Handheld camera shake in pixel space: the image is displaced / rotated (and,
;; optionally, tilted in 3D with perspective) by smooth value noise, so no layer
;; transform property is touched.
;;
;; per sample time t:
;;   tx,ty = amp * nz(1,2,t)                  translation (buffer px)
;;   rz    = rot * nz(3,t)                    in-plane rotation (rad)
;;   rx,ry = rotx * nz(4,5,t)                 X/Y tilt, only when rot3d is on
;;   R     = Rz(rz) * Ry(ry) * Rx(rx)
;;   n     = R * e3 = (r13, r23, r33)
;;   D     = 3 * max(w,h)                     camera distance (px)
;;
;; inverse map (output pixel -> source pixel), sx/sy relative to the centre:
;;   den = n1*sx + n2*sy + n3*D
;;   u   = (a11*sx + a12*sy) / den + cx
;;   v   = (a21*sx + a22*sy) / den + cy
;;   a11 = D*(r11*r33 - r31*r13)   a12 = D*(r21*r33 - r31*r23)
;;   a21 = D*(r12*r33 - r32*r13)   a22 = D*(r22*r33 - r32*r23)
;; With R = identity this is exactly sx -> sx (no half-pixel offset).
;;
;; Noise is a two octave value noise (0.72 + 0.28 at 0.37x period). 抖动频率 sets
;; the knot period T = 1/rate; 抖动平滑度 blends the interpolation between linear
;; (f) and quintic smootherstep, u = f + sm*(6f^5 - 15f^4 + 10f^3 - f).
;;
;; 运动模糊: 8 sub-samples over a 1/60 s shutter (180 deg @ 30 fps).
;; 拼贴模式: out-of-frame samples wrap around; otherwise they are transparent.
;;
;; Performance notes (the host executes wasm in an interpreter, so every
;; instruction counts): the inner loop keeps the inverse map in f32, walks the
;; numerators / denominator incrementally (two adds and one divide per pixel),
;; and has a fully inlined bilinear fast path for the interior of the frame.
;; Function calls, integer remainders and f64<->f32 conversions only happen on
;; the frame border.  Whole-frame copies use the bulk memory instructions.
(module
  (memory (export "memory") 2)
  ;; ---- manifest (utf-8 json, injected by build.js) ----
  (data (i32.const 1024) "__MANIFEST_BYTES__")
  (global $man_len i32 (i32.const __MANIFEST_LEN__))
  ;; ---- memory layout ----
  ;; 0      .. 1024   reserved
  ;; 1024   .. +man   manifest
  ;; 32768  ..        arena: [params][pixels][scratch][accum]
  (global $ARENA i32 (i32.const 32768))
  (global $pages (mut i32) (i32.const 2))
  ;; ---- per-render state ----
  (global $W (mut i32) (i32.const 1))
  (global $H (mut i32) (i32.const 1))
  (global $PIX (mut i32) (i32.const 0))
  (global $SRC (mut i32) (i32.const 0))
  (global $ACC (mut i32) (i32.const 0))
  (global $TILE (mut i32) (i32.const 0))
  (global $MB (mut i32) (i32.const 0))
  (global $AMP (mut f64) (f64.const 0))
  (global $PER (mut f64) (f64.const 0.1))
  (global $SM (mut f64) (f64.const 1))
  (global $ROT (mut f64) (f64.const 0))
  (global $ROTX (mut f64) (f64.const 0))
  (global $D (mut f64) (f64.const 100))
  (global $cx (mut f64) (f64.const 0))
  (global $cy (mut f64) (f64.const 0))
  (global $ox (mut f64) (f64.const 0))
  (global $oy (mut f64) (f64.const 0))
  (global $a11 (mut f64) (f64.const 1))
  (global $a12 (mut f64) (f64.const 0))
  (global $a21 (mut f64) (f64.const 0))
  (global $a22 (mut f64) (f64.const 1))
  (global $n1 (mut f64) (f64.const 0))
  (global $n2 (mut f64) (f64.const 0))
  (global $n3d (mut f64) (f64.const 1))
  ;; ---- f32 mirror of the map, filled by $setT for the hot loop ----
  ;; 3D off:  FU = a11/n3d, FV = a21/n3d, FDN = 0,  FKD = 1
  ;; 3D on :  FU = a11,     FV = a21,     FDN = n1, FKD = n3d
  (global $FU (mut f32) (f32.const 1))
  (global $FV (mut f32) (f32.const 0))
  (global $FDN (mut f32) (f32.const 0))
  (global $F12 (mut f32) (f32.const 0))
  (global $F22 (mut f32) (f32.const 1))
  (global $FN2 (mut f32) (f32.const 0))
  (global $FKD (mut f32) (f32.const 1))
  (global $FOX (mut f32) (f32.const 0))
  (global $FOY (mut f32) (f32.const 0))
  (global $FCX (mut f32) (f32.const 0))
  (global $FCY (mut f32) (f32.const 0))
  (global $EQ3D (mut i32) (i32.const 0))
  (global $oR (mut f64) (f64.const 0))
  (global $oG (mut f64) (f64.const 0))
  (global $oB (mut f64) (f64.const 0))
  (global $oA (mut f64) (f64.const 0))
  ;; ================= tiny helpers =================
  (func $imax (param $a i32) (param $b i32) (result i32)
    local.get $a local.get $b local.get $a local.get $b i32.gt_s select)
  (func $wrapi (param $i i32) (param $n i32) (result i32)
    local.get $i local.get $n i32.rem_s local.get $n i32.add local.get $n i32.rem_s)
  ;; ================= trigonometry (no imports available) =================
  ;; sin(x) for any x: reduce to |r| <= pi/4 with a quadrant, then Taylor to r^9.
  (func $sin (param $x f64) (result f64)
    (local $k f64) (local $r f64) (local $r2 f64) (local $s f64) (local $c f64)
    (local $q i32) (local $t f64)
    local.get $x f64.const 0.6366197723675814 f64.mul f64.nearest local.set $k
    local.get $x local.get $k f64.const 1.5707963267948966 f64.mul f64.sub local.set $r
    local.get $r local.get $r f64.mul local.set $r2
    local.get $r2 f64.const 0.0000027557319223985893 f64.mul
    f64.const -0.0001984126984126984 f64.add local.set $t
    local.get $t local.get $r2 f64.mul f64.const 0.008333333333333333 f64.add local.set $t
    local.get $t local.get $r2 f64.mul f64.const -0.16666666666666666 f64.add local.set $t
    local.get $t local.get $r2 f64.mul f64.const 1 f64.add local.set $t
    local.get $t local.get $r f64.mul local.set $s
    local.get $r2 f64.const -2.755731922398589e-7 f64.mul
    f64.const 0.0000248015873015873 f64.add local.set $t
    local.get $t local.get $r2 f64.mul f64.const -0.001388888888888889 f64.add local.set $t
    local.get $t local.get $r2 f64.mul f64.const 0.041666666666666664 f64.add local.set $t
    local.get $t local.get $r2 f64.mul f64.const -0.5 f64.add local.set $t
    local.get $t local.get $r2 f64.mul f64.const 1 f64.add local.set $c
    local.get $k i32.trunc_f64_s i32.const 3 i32.and local.set $q
    local.get $q i32.eqz (if (then local.get $s return))
    local.get $q i32.const 1 i32.eq (if (then local.get $c return))
    local.get $q i32.const 2 i32.eq (if (then f64.const 0 local.get $s f64.sub return))
    f64.const 0 local.get $c f64.sub)
  (func $cos (param $x f64) (result f64)
    local.get $x f64.const 1.5707963267948966 f64.add call $sin)
  ;; ================= value noise =================
  (func $hash (param $ch i32) (param $i i32) (result f64)
    (local $k i32)
    local.get $ch i32.const 2654435761 i32.mul
    local.get $i i32.const 2246822519 i32.mul i32.add local.set $k
    local.get $k i32.const 61 i32.xor local.get $k i32.const 16 i32.shr_u i32.xor local.set $k
    local.get $k i32.const 9 i32.mul local.set $k
    local.get $k local.get $k i32.const 4 i32.shr_u i32.xor local.set $k
    local.get $k i32.const 668265263 i32.mul local.set $k
    local.get $k local.get $k i32.const 15 i32.shr_u i32.xor local.set $k
    local.get $k i32.const 8 i32.shr_u f64.convert_i32_u
    f64.const 0.000000059604644775390625 f64.mul
    f64.const 2 f64.mul f64.const 1 f64.sub)
  (func $noise (param $ch i32) (param $t f64) (param $T f64) (result f64)
    (local $g f64) (local $fl f64) (local $f f64) (local $u f64)
    (local $v0 f64) (local $v1 f64) (local $i i32)
    local.get $t local.get $T f64.div local.set $g
    local.get $g f64.floor local.set $fl
    local.get $g local.get $fl f64.sub local.set $f
    local.get $fl i32.trunc_f64_s local.set $i
    ;; interpolation: 平滑度 blends linear (corners, snappy) -> quintic smootherstep (floaty)
    ;; u = f + sm * (6f^5 - 15f^4 + 10f^3 - f)
    local.get $f local.get $f f64.mul local.get $f f64.mul
    local.get $f local.get $f f64.const 6 f64.mul f64.const 15 f64.sub
    f64.mul f64.const 10 f64.add
    f64.mul local.get $f f64.sub
    global.get $SM f64.mul local.get $f f64.add local.set $u
    local.get $ch local.get $i call $hash local.set $v0
    local.get $ch local.get $i i32.const 1 i32.add call $hash local.set $v1
    local.get $v0 local.get $v1 local.get $v0 f64.sub local.get $u f64.mul f64.add)
  (func $nz (param $ch i32) (param $t f64) (result f64)
    local.get $ch local.get $t global.get $PER call $noise f64.const 0.72 f64.mul
    local.get $ch i32.const 37 i32.add local.get $t
    global.get $PER f64.const 0.37 f64.mul call $noise f64.const 0.28 f64.mul
    f64.add)
  ;; ================= transform for one sample time =================
  (func $setT (param $t f64)
    (local $tx f64) (local $ty f64) (local $rz f64) (local $rx f64) (local $ry f64)
    (local $cz f64) (local $sz f64) (local $cB f64) (local $sB f64)
    (local $cA f64) (local $sA f64)
    (local $r11 f64) (local $r12 f64) (local $r13 f64)
    (local $r21 f64) (local $r22 f64) (local $r23 f64)
    (local $r31 f64) (local $r32 f64) (local $r33 f64) (local $ir f64)
    i32.const 1 local.get $t call $nz global.get $AMP f64.mul local.set $tx
    i32.const 2 local.get $t call $nz global.get $AMP f64.mul local.set $ty
    i32.const 3 local.get $t call $nz global.get $ROT f64.mul local.set $rz
    i32.const 4 local.get $t call $nz global.get $ROTX f64.mul local.set $rx
    i32.const 5 local.get $t call $nz global.get $ROTX f64.mul local.set $ry
    local.get $rz call $cos local.set $cz
    local.get $rz call $sin local.set $sz
    local.get $ry call $cos local.set $cB
    local.get $ry call $sin local.set $sB
    local.get $rx call $cos local.set $cA
    local.get $rx call $sin local.set $sA
    ;; R = Rz * Ry * Rx
    local.get $cz local.get $cB f64.mul local.set $r11
    local.get $cz local.get $sB f64.mul local.get $sA f64.mul
    local.get $sz local.get $cA f64.mul f64.sub local.set $r12
    local.get $cz local.get $sB f64.mul local.get $cA f64.mul
    local.get $sz local.get $sA f64.mul f64.add local.set $r13
    local.get $sz local.get $cB f64.mul local.set $r21
    local.get $sz local.get $sB f64.mul local.get $sA f64.mul
    local.get $cz local.get $cA f64.mul f64.add local.set $r22
    local.get $sz local.get $sB f64.mul local.get $cA f64.mul
    local.get $cz local.get $sA f64.mul f64.sub local.set $r23
    f64.const 0 local.get $sB f64.sub local.set $r31
    local.get $cB local.get $sA f64.mul local.set $r32
    local.get $cB local.get $cA f64.mul local.set $r33
    ;; n = R * e3
    local.get $r13 global.set $n1
    local.get $r23 global.set $n2
    local.get $r33 global.get $D f64.mul global.set $n3d
    local.get $r11 local.get $r33 f64.mul local.get $r31 local.get $r13 f64.mul f64.sub
    global.get $D f64.mul global.set $a11
    local.get $r21 local.get $r33 f64.mul local.get $r31 local.get $r23 f64.mul f64.sub
    global.get $D f64.mul global.set $a12
    local.get $r12 local.get $r33 f64.mul local.get $r32 local.get $r13 f64.mul f64.sub
    global.get $D f64.mul global.set $a21
    local.get $r22 local.get $r33 f64.mul local.get $r32 local.get $r23 f64.mul f64.sub
    global.get $D f64.mul global.set $a22
    ;; screen origin of the inverse map: sx = x - (cx + tx)
    f64.const 0 global.get $cx local.get $tx f64.add f64.sub global.set $ox
    f64.const 0 global.get $cy local.get $ty f64.add f64.sub global.set $oy
    ;; ---- f32 mirror for the hot loop ----
    ;; 3D off: fold 1/n3d into the numerators and keep den == 1, so the inner
    ;; loop needs no per-pixel perspective state at all.
    global.get $n1 f64.abs f64.const 0.0000001 f64.lt
    global.get $n2 f64.abs f64.const 0.0000001 f64.lt
    i32.and global.set $EQ3D
    (if (global.get $EQ3D)
      (then
        ;; only 3D-off rows may run the affine fast path
        f64.const 1 global.get $n3d f64.div local.set $ir
        local.get $ir global.get $a11 f64.mul f32.demote_f64 global.set $FU
        local.get $ir global.get $a21 f64.mul f32.demote_f64 global.set $FV
        local.get $ir global.get $a12 f64.mul f32.demote_f64 global.set $F12
        local.get $ir global.get $a22 f64.mul f32.demote_f64 global.set $F22
        f32.const 0 global.set $FDN
        f32.const 0 global.set $FN2
        f32.const 1 global.set $FKD)
      (else
        global.get $a11 f32.demote_f64 global.set $FU
        global.get $a21 f32.demote_f64 global.set $FV
        global.get $a12 f32.demote_f64 global.set $F12
        global.get $a22 f32.demote_f64 global.set $F22
        global.get $n1 f32.demote_f64 global.set $FDN
        global.get $n2 f32.demote_f64 global.set $FN2
        global.get $n3d f32.demote_f64 global.set $FKD))
    global.get $ox f32.demote_f64 global.set $FOX
    global.get $oy f32.demote_f64 global.set $FOY
    global.get $cx f32.demote_f64 global.set $FCX
    global.get $cy f32.demote_f64 global.set $FCY)
  ;; ================= sampling (frame border only) =================
  ;; add wg * src(ix,iy) to (oR,oG,oB,oA); 拼贴模式 wraps, otherwise out-of-frame is transparent
  (func $acc (param $ix i32) (param $iy i32) (param $wg f64)
    (local $x i32) (local $y i32) (local $a i32)
    global.get $TILE i32.eqz
    (if (then
      local.get $ix i32.const 0 i32.lt_s
      local.get $ix global.get $W i32.ge_s i32.or
      local.get $iy i32.const 0 i32.lt_s i32.or
      local.get $iy global.get $H i32.ge_s i32.or
      (if (then return))))
    local.get $ix global.get $W call $wrapi local.set $x
    local.get $iy global.get $H call $wrapi local.set $y
    global.get $SRC
    local.get $y global.get $W i32.mul local.get $x i32.add
    i32.const 4 i32.shl i32.add
    local.set $a
    global.get $oR local.get $a f32.load f64.promote_f32
    local.get $wg f64.mul f64.add global.set $oR
    global.get $oG local.get $a f32.load offset=4 f64.promote_f32
    local.get $wg f64.mul f64.add global.set $oG
    global.get $oB local.get $a f32.load offset=8 f64.promote_f32
    local.get $wg f64.mul f64.add global.set $oB
    global.get $oA local.get $a f32.load offset=12 f64.promote_f32
    local.get $wg f64.mul f64.add global.set $oA)
  (func $samp (param $fx f64) (param $fy f64)
    (local $x0 i32) (local $y0 i32) (local $tx f64) (local $ty f64)
    (local $ax f64) (local $bx f64) (local $cx1 f64) (local $dx f64)
    local.get $fx f64.floor local.set $ax
    local.get $fx local.get $ax f64.sub local.set $tx
    local.get $fy f64.floor local.set $bx
    local.get $fy local.get $bx f64.sub local.set $ty
    local.get $ax i32.trunc_f64_s local.set $x0
    local.get $bx i32.trunc_f64_s local.set $y0
    f64.const 1 local.get $tx f64.sub local.set $cx1
    f64.const 1 local.get $ty f64.sub local.set $dx
    f64.const 0 global.set $oR
    f64.const 0 global.set $oG
    f64.const 0 global.set $oB
    f64.const 0 global.set $oA
    local.get $x0 local.get $y0 local.get $cx1 local.get $dx f64.mul call $acc
    local.get $x0 i32.const 1 i32.add local.get $y0
    local.get $tx local.get $dx f64.mul call $acc
    local.get $x0 local.get $y0 i32.const 1 i32.add
    local.get $cx1 local.get $ty f64.mul call $acc
    local.get $x0 i32.const 1 i32.add local.get $y0 i32.const 1 i32.add
    local.get $tx local.get $ty f64.mul call $acc)
  ;; ================= one pass over the frame =================
  ;; accum = 0: write the shaken frame into $PIX (last pass)
  ;; accum = 1: add this sub-sample into $ACC (motion blur)
  ;; ================= inverse map walk =================
  ;; $passA: affine path (三轴 off, denominator is exactly 1): no divide, no
  ;; denominator test, and the map is stepped with two adds per pixel.
  (func $passA (param $accum i32)
    (local $x i32) (local $y i32) (local $off i32) (local $rowdst i32)
    (local $sy f32) (local $nu f32) (local $nv f32)
    (local $u f32) (local $v f32) (local $ax f32) (local $ay f32)
    (local $ix i32) (local $iy i32) (local $fx f32) (local $fy f32)
    (local $w0 f32) (local $w1 f32) (local $w2 f32) (local $w3 f32)
    (local $Wm1 i32) (local $Hm1 i32) (local $stride i32)
    (local $b i32) (local $c i32) (local $dst i32)
    (local $r f32) (local $g f32) (local $bl f32) (local $al f32)
    global.get $W i32.const 1 i32.sub local.set $Wm1
    global.get $H i32.const 1 i32.sub local.set $Hm1
    global.get $W i32.const 4 i32.shl local.set $stride
    global.get $PIX local.set $dst
    local.get $accum (if (then global.get $ACC local.set $dst))
    i32.const 0 local.set $y
    (block $yend
      (loop $yl
        local.get $y global.get $H i32.ge_s br_if $yend
        local.get $y f32.convert_i32_s global.get $FOY f32.add local.set $sy
        global.get $FU global.get $FOX f32.mul
        global.get $F12 local.get $sy f32.mul f32.add
        global.get $FCX f32.add local.set $nu
        global.get $FV global.get $FOX f32.mul
        global.get $F22 local.get $sy f32.mul f32.add
        global.get $FCY f32.add local.set $nv
        local.get $dst
        local.get $y global.get $W i32.mul i32.const 4 i32.shl i32.add local.set $rowdst
        local.get $rowdst local.set $off
        i32.const 0 local.set $x
        (block $xend
          (loop $xl
            local.get $x global.get $W i32.ge_s br_if $xend
            local.get $nu local.set $u
            local.get $nv local.set $v
            local.get $u f32.floor local.set $ax
            local.get $v f32.floor local.set $ay
            local.get $ax i32.trunc_f32_s local.set $ix
            local.get $ay i32.trunc_f32_s local.set $iy
            local.get $ix local.get $Wm1 i32.ge_u
            local.get $iy local.get $Hm1 i32.ge_u i32.or
            (if
              (then
                local.get $u f64.promote_f32 local.get $v f64.promote_f32 call $samp
                    local.get $accum
                (if (then
                  local.get $off
                  local.get $off f32.load global.get $oR f32.demote_f64 f32.add f32.store
                  local.get $off i32.const 4 i32.add
                  local.get $off i32.const 4 i32.add f32.load global.get $oG f32.demote_f64 f32.add f32.store
                  local.get $off i32.const 8 i32.add
                  local.get $off i32.const 8 i32.add f32.load global.get $oB f32.demote_f64 f32.add f32.store
                  local.get $off i32.const 12 i32.add
                  local.get $off i32.const 12 i32.add f32.load global.get $oA f32.demote_f64 f32.add f32.store)
                (else
                  local.get $off global.get $oR f32.demote_f64 f32.store
                  local.get $off i32.const 4 i32.add global.get $oG f32.demote_f64 f32.store
                  local.get $off i32.const 8 i32.add global.get $oB f32.demote_f64 f32.store
                  local.get $off i32.const 12 i32.add global.get $oA f32.demote_f64 f32.store)))
              (else
                local.get $u local.get $ax f32.sub local.set $fx
                local.get $v local.get $ay f32.sub local.set $fy
                f32.const 1 local.get $fx f32.sub local.set $w0
                f32.const 1 local.get $fy f32.sub local.set $w1
                local.get $w0 local.get $w1 f32.mul local.set $w2
                local.get $w0 local.get $fy f32.mul local.set $w3
                local.get $fx local.get $w1 f32.mul local.set $w0
                local.get $fx local.get $fy f32.mul local.set $w1
                global.get $SRC
                local.get $iy global.get $W i32.mul local.get $ix i32.add
                i32.const 4 i32.shl i32.add local.set $b
                local.get $b local.get $stride i32.add local.set $c
                local.get $w2 local.get $b f32.load f32.mul
                local.get $w0 local.get $b f32.load offset=16 f32.mul f32.add
                local.get $w3 local.get $c f32.load f32.mul f32.add
                local.get $w1 local.get $c f32.load offset=16 f32.mul f32.add
                local.set $r
                local.get $w2 local.get $b f32.load offset=4 f32.mul
                local.get $w0 local.get $b f32.load offset=20 f32.mul f32.add
                local.get $w3 local.get $c f32.load offset=4 f32.mul f32.add
                local.get $w1 local.get $c f32.load offset=20 f32.mul f32.add
                local.set $g
                local.get $w2 local.get $b f32.load offset=8 f32.mul
                local.get $w0 local.get $b f32.load offset=24 f32.mul f32.add
                local.get $w3 local.get $c f32.load offset=8 f32.mul f32.add
                local.get $w1 local.get $c f32.load offset=24 f32.mul f32.add
                local.set $bl
                local.get $w2 local.get $b f32.load offset=12 f32.mul
                local.get $w0 local.get $b f32.load offset=28 f32.mul f32.add
                local.get $w3 local.get $c f32.load offset=12 f32.mul f32.add
                local.get $w1 local.get $c f32.load offset=28 f32.mul f32.add
                local.set $al
                    local.get $accum
                (if
                  (then
                    local.get $off
                    local.get $off f32.load local.get $r f32.add f32.store
                    local.get $off i32.const 4 i32.add
                    local.get $off i32.const 4 i32.add f32.load local.get $g f32.add f32.store
                    local.get $off i32.const 8 i32.add
                    local.get $off i32.const 8 i32.add f32.load local.get $bl f32.add f32.store
                    local.get $off i32.const 12 i32.add
                    local.get $off i32.const 12 i32.add f32.load local.get $al f32.add f32.store)
                  (else
                    local.get $off local.get $r f32.store
                    local.get $off i32.const 4 i32.add local.get $g f32.store
                    local.get $off i32.const 8 i32.add local.get $bl f32.store
                    local.get $off i32.const 12 i32.add local.get $al f32.store))))
            local.get $x i32.const 1 i32.add local.set $x
            local.get $off i32.const 16 i32.add local.set $off
            local.get $nu global.get $FU f32.add local.set $nu
            local.get $nv global.get $FV f32.add local.set $nv
            br $xl))
        local.get $y i32.const 1 i32.add local.set $y
        br $yl)))
  ;; $passP: perspective path (三轴 on) -- keeps the per-pixel denominator.
  (func $passP (param $accum i32)
    (local $x i32) (local $y i32) (local $off i32) (local $rowdst i32)
    (local $sy f32) (local $nu f32) (local $nv f32) (local $dn f32)
    (local $u f32) (local $v f32) (local $ax f32) (local $ay f32)
    (local $ix i32) (local $iy i32) (local $fx f32) (local $fy f32)
    (local $w0 f32) (local $w1 f32) (local $w2 f32) (local $w3 f32)
    (local $Wm1 i32) (local $Hm1 i32) (local $stride i32)
    (local $b i32) (local $c i32) (local $dst i32)
    (local $r f32) (local $g f32) (local $bl f32) (local $al f32)
    global.get $W i32.const 1 i32.sub local.set $Wm1
    global.get $H i32.const 1 i32.sub local.set $Hm1
    global.get $W i32.const 4 i32.shl local.set $stride
    global.get $PIX local.set $dst
    local.get $accum (if (then global.get $ACC local.set $dst))
    i32.const 0 local.set $y
    (block $yend
      (loop $yl
        local.get $y global.get $H i32.ge_s br_if $yend
        local.get $y f32.convert_i32_s global.get $FOY f32.add local.set $sy
        global.get $FU global.get $FOX f32.mul
        global.get $F12 local.get $sy f32.mul f32.add local.set $nu
        global.get $FV global.get $FOX f32.mul
        global.get $F22 local.get $sy f32.mul f32.add local.set $nv
        global.get $FDN global.get $FOX f32.mul
        global.get $FN2 local.get $sy f32.mul f32.add
        global.get $FKD f32.add local.set $dn
        local.get $dst
        local.get $y global.get $W i32.mul i32.const 4 i32.shl i32.add local.set $rowdst
        local.get $rowdst local.set $off
        i32.const 0 local.set $x
        (block $xend
          (loop $xl
            local.get $x global.get $W i32.ge_s br_if $xend
            local.get $dn f32.const 0 f32.le
            (if (then
              local.get $accum i32.eqz
              (if (then
                    local.get $off i64.const 0 i64.store
                local.get $off i32.const 8 i32.add i64.const 0 i64.store))
              local.get $x i32.const 1 i32.add local.set $x
            local.get $off i32.const 16 i32.add local.set $off
              local.get $nu global.get $FU f32.add local.set $nu
              local.get $nv global.get $FV f32.add local.set $nv
              local.get $dn global.get $FDN f32.add local.set $dn
              br $xl))
            local.get $nu local.get $dn f32.div global.get $FCX f32.add local.set $u
            local.get $nv local.get $dn f32.div global.get $FCY f32.add local.set $v
            local.get $u f32.floor local.set $ax
            local.get $v f32.floor local.set $ay
            local.get $ax i32.trunc_f32_s local.set $ix
            local.get $ay i32.trunc_f32_s local.set $iy
            local.get $ix local.get $Wm1 i32.ge_u
            local.get $iy local.get $Hm1 i32.ge_u i32.or
            (if
              (then
                local.get $u f64.promote_f32 local.get $v f64.promote_f32 call $samp
                    local.get $accum
                (if (then
                  local.get $off
                  local.get $off f32.load global.get $oR f32.demote_f64 f32.add f32.store
                  local.get $off i32.const 4 i32.add
                  local.get $off i32.const 4 i32.add f32.load global.get $oG f32.demote_f64 f32.add f32.store
                  local.get $off i32.const 8 i32.add
                  local.get $off i32.const 8 i32.add f32.load global.get $oB f32.demote_f64 f32.add f32.store
                  local.get $off i32.const 12 i32.add
                  local.get $off i32.const 12 i32.add f32.load global.get $oA f32.demote_f64 f32.add f32.store)
                (else
                  local.get $off global.get $oR f32.demote_f64 f32.store
                  local.get $off i32.const 4 i32.add global.get $oG f32.demote_f64 f32.store
                  local.get $off i32.const 8 i32.add global.get $oB f32.demote_f64 f32.store
                  local.get $off i32.const 12 i32.add global.get $oA f32.demote_f64 f32.store)))
              (else
                local.get $u local.get $ax f32.sub local.set $fx
                local.get $v local.get $ay f32.sub local.set $fy
                f32.const 1 local.get $fx f32.sub local.set $w0
                f32.const 1 local.get $fy f32.sub local.set $w1
                local.get $w0 local.get $w1 f32.mul local.set $w2
                local.get $w0 local.get $fy f32.mul local.set $w3
                local.get $fx local.get $w1 f32.mul local.set $w0
                local.get $fx local.get $fy f32.mul local.set $w1
                global.get $SRC
                local.get $iy global.get $W i32.mul local.get $ix i32.add
                i32.const 4 i32.shl i32.add local.set $b
                local.get $b local.get $stride i32.add local.set $c
                local.get $w2 local.get $b f32.load f32.mul
                local.get $w0 local.get $b f32.load offset=16 f32.mul f32.add
                local.get $w3 local.get $c f32.load f32.mul f32.add
                local.get $w1 local.get $c f32.load offset=16 f32.mul f32.add
                local.set $r
                local.get $w2 local.get $b f32.load offset=4 f32.mul
                local.get $w0 local.get $b f32.load offset=20 f32.mul f32.add
                local.get $w3 local.get $c f32.load offset=4 f32.mul f32.add
                local.get $w1 local.get $c f32.load offset=20 f32.mul f32.add
                local.set $g
                local.get $w2 local.get $b f32.load offset=8 f32.mul
                local.get $w0 local.get $b f32.load offset=24 f32.mul f32.add
                local.get $w3 local.get $c f32.load offset=8 f32.mul f32.add
                local.get $w1 local.get $c f32.load offset=24 f32.mul f32.add
                local.set $bl
                local.get $w2 local.get $b f32.load offset=12 f32.mul
                local.get $w0 local.get $b f32.load offset=28 f32.mul f32.add
                local.get $w3 local.get $c f32.load offset=12 f32.mul f32.add
                local.get $w1 local.get $c f32.load offset=28 f32.mul f32.add
                local.set $al
                    local.get $accum
                (if
                  (then
                    local.get $off
                    local.get $off f32.load local.get $r f32.add f32.store
                    local.get $off i32.const 4 i32.add
                    local.get $off i32.const 4 i32.add f32.load local.get $g f32.add f32.store
                    local.get $off i32.const 8 i32.add
                    local.get $off i32.const 8 i32.add f32.load local.get $bl f32.add f32.store
                    local.get $off i32.const 12 i32.add
                    local.get $off i32.const 12 i32.add f32.load local.get $al f32.add f32.store)
                  (else
                    local.get $off local.get $r f32.store
                    local.get $off i32.const 4 i32.add local.get $g f32.store
                    local.get $off i32.const 8 i32.add local.get $bl f32.store
                    local.get $off i32.const 12 i32.add local.get $al f32.store))))
            local.get $x i32.const 1 i32.add local.set $x
            local.get $off i32.const 16 i32.add local.set $off
            local.get $nu global.get $FU f32.add local.set $nu
            local.get $nv global.get $FV f32.add local.set $nv
            local.get $dn global.get $FDN f32.add local.set $dn
            br $xl))
        local.get $y i32.const 1 i32.add local.set $y
        br $yl)))
  ;; ================= ABI =================
  (func (export "ec_api_version") (result i32) i32.const 1)
  (func (export "ec_manifest_ptr") (result i32) i32.const 1024)
  (func (export "ec_manifest_len") (result i32) global.get $man_len)
  (func (export "ec_alloc") (param $n i32) (result i32)
    (local $need i32) (local $want i32)
    ;; params + pixels + scratch + accum -> three frame sized buffers
    local.get $n i32.const 3 i32.mul
    global.get $ARENA i32.add i32.const 65536 i32.add local.set $need
    local.get $need
    global.get $pages i32.const 16 i32.shl i32.gt_u
    (if (then
      local.get $need i32.const 65535 i32.add i32.const 16 i32.shr_u local.set $want
      local.get $want global.get $pages i32.sub memory.grow drop
      local.get $want global.set $pages))
    global.get $ARENA)
  (func (export "ec_render")
    (param $pixels i32) (param $w i32) (param $h i32)
    (param $params i32) (param $nparams i32)
    (param $time f64) (param $scale f64) (result i32)
    (local $amp f64) (local $sm f64) (local $rot f64) (local $rotx f64)
    (local $rate f64)
    (local $total i32) (local $i i32) (local $k i32) (local $ti f64)
    (local $s8 f32) (local $ns i32) (local $inv f64) (local $invf f32)
    local.get $w i32.const 0 i32.le_s
    local.get $h i32.const 0 i32.le_s i32.or
    local.get $nparams i32.const 7 i32.lt_s i32.or
    (if (then i32.const 1 return))
    ;; ---- parameters (declaration order) ----
    ;; 0 抖动幅度 | 1 抖动频率(Hz) | 2 抖动平滑度 | 3 抖动的旋转度 | 4 三轴 | 5 运动模糊 | 6 拼贴
    local.get $params f64.load f64.const 0 f64.max local.get $scale f64.mul local.set $amp
    local.get $params f64.load offset=8 f64.const 0.02 f64.max f64.const 60 f64.min
    local.set $rate
    local.get $params f64.load offset=16 f64.const 100 f64.div
    f64.const 0 f64.max f64.const 1 f64.min local.set $sm
    local.get $params f64.load offset=24 f64.const 0 f64.max f64.const 60 f64.min
    f64.const 0.017453292519943295 f64.mul local.set $rot
    local.get $params f64.load offset=40 f64.const 0.5 f64.gt global.set $MB
    local.get $params f64.load offset=48 f64.const 0.5 f64.gt global.set $TILE
    ;; 运动模糊采样数（第 8 个参数；宿主仍按 7 个参数调用时用满 8 个）
    i32.const 8 local.set $ns
    local.get $nparams i32.const 8 i32.ge_s
    (if (then
      local.get $params f64.load offset=56
      f64.const 1 f64.max f64.const 8 f64.min
      i32.trunc_f64_s local.set $ns))
    f64.const 1 local.get $ns f64.convert_i32_s f64.div local.set $inv
    local.get $inv f32.demote_f64 local.set $invf
    ;; 三轴旋转开关: X/Y 用两倍角度（cos 在 1-2 度时根本看不出来），上限 0.75 rad
    f64.const 0 local.set $rotx
    local.get $params f64.load offset=32 f64.const 0.5 f64.gt
    (if (then
      local.get $rot f64.const 2 f64.mul f64.const 0.75 f64.min local.set $rotx))
    ;; 抖动频率: Hz -> 每段噪声的时长 PER = 1 / rate
    f64.const 1 local.get $rate f64.div global.set $PER
    ;; nothing to do: leave the pixels untouched
    local.get $amp f64.const 0.000001 f64.lt
    local.get $rot f64.const 0.000001 f64.lt
    i32.and
    (if (then i32.const 0 return))
    ;; ---- frame state ----
    local.get $w global.set $W
    local.get $h global.set $H
    local.get $pixels global.set $PIX
    local.get $amp global.set $AMP
    local.get $rot global.set $ROT
    local.get $rotx global.set $ROTX
    local.get $sm global.set $SM
    local.get $w local.get $h i32.mul i32.const 16 i32.mul local.set $total
    local.get $pixels local.get $total i32.add global.set $SRC
    local.get $pixels local.get $total i32.const 2 i32.mul i32.add global.set $ACC
    local.get $w i32.const 1 i32.sub f64.convert_i32_s f64.const 0.5 f64.mul global.set $cx
    local.get $h i32.const 1 i32.sub f64.convert_i32_s f64.const 0.5 f64.mul global.set $cy
    local.get $w local.get $h call $imax f64.convert_i32_s f64.const 3 f64.mul global.set $D
    ;; ---- keep the untransformed frame in the scratch buffer ----
    global.get $SRC global.get $PIX local.get $total memory.copy
    global.get $MB
    (if (then
      ;; ---- motion blur: 8 sub-samples across a 1/60 s shutter ----
      global.get $ACC i32.const 0 local.get $total memory.fill
      i32.const 0 local.set $k
      (block $bend
        (loop $bl
          local.get $k local.get $ns i32.ge_s br_if $bend
          local.get $time
          local.get $k f64.convert_i32_s f64.const 0.5 f64.add
          local.get $inv f64.mul f64.const 0.5 f64.sub
          f64.const 0.016666666666666666 f64.mul
          f64.add local.set $ti
          local.get $ti call $setT
          global.get $EQ3D
          (if (then i32.const 1 call $passA) (else i32.const 1 call $passP))
          local.get $k i32.const 1 i32.add local.set $k
          br $bl))
      ;; average the accumulation back into the frame (1 / samples)
      local.get $invf local.set $s8
      i32.const 0 local.set $i
      (block $aend
        (loop $al
          local.get $i local.get $total i32.ge_u br_if $aend
          global.get $PIX local.get $i i32.add
          global.get $ACC local.get $i i32.add f32.load local.get $s8 f32.mul
          f32.store
          local.get $i i32.const 4 i32.add local.set $i
          br $al)))
    (else
      local.get $time call $setT
      global.get $EQ3D
      (if (then i32.const 0 call $passA) (else i32.const 0 call $passP))))
    i32.const 0)
)
