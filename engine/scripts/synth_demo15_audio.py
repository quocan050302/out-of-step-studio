#!/usr/bin/env python3
"""
Synthesizes the original 15.000-second (450 frames @ 30fps, 48000 Hz stereo PCM16 WAV)
musical score and timed Foley SFX for OOSDemo15: "The Roman Messenger Who Lost His Scroll".

Pure deterministic procedural synthesis using Python standard library + NumPy.
Zero copyrighted samples or external network dependencies.
"""
import sys
import os
import wave
import numpy as np

SR = 48000
FRAMES = 450
FPS = 30.0
DUR = FRAMES / FPS  # 15.000 seconds exactly
N = int(SR * DUR)   # 720,000 samples

rng = np.random.default_rng(20261119)
t = np.arange(N, dtype=np.float64) / SR

music_L = np.zeros(N, dtype=np.float64)
music_R = np.zeros(N, dtype=np.float64)
sfx_L = np.zeros(N, dtype=np.float64)
sfx_R = np.zeros(N, dtype=np.float64)


def add_stereo(buf_l, buf_r, i0, sig, pan=0.0):
    n = len(sig)
    if i0 < 0:
        sig = sig[-i0:]
        i0 = 0
        n = len(sig)
    if i0 >= N or n <= 0:
        return
    i1 = min(N, i0 + n)
    seg = sig[: i1 - i0]
    angle = (pan + 1.0) * (np.pi / 4.0)
    buf_l[i0:i1] += seg * np.cos(angle)
    buf_r[i0:i1] += seg * np.sin(angle)


def lyre_pluck(freq, start_sec, dur_sec=0.65, amp=0.16, pan=0.0):
    i0 = int(start_sec * SR)
    n = int(dur_sec * SR)
    if n <= 0:
        return
    tt = np.arange(n, dtype=np.float64) / SR
    attack = np.minimum(1.0, tt / 0.006)
    env = attack * np.exp(-tt * 5.2)
    sig = (
        np.sin(2 * np.pi * freq * tt)
        + 0.55 * np.sin(2 * np.pi * 2 * freq * tt) * np.exp(-tt * 7.5)
        + 0.28 * np.sin(2 * np.pi * 3 * freq * tt) * np.exp(-tt * 11.0)
        + 0.12 * np.sin(2 * np.pi * 4 * freq * tt) * np.exp(-tt * 16.0)
    )
    add_stereo(music_L, music_R, i0, amp * env * sig, pan=pan)


def warm_pad(freqs, start_sec, dur_sec, amp=0.07):
    i0 = int(start_sec * SR)
    n = int(dur_sec * SR)
    if n <= 0:
        return
    tt = np.arange(n, dtype=np.float64) / SR
    fade_in = np.minimum(1.0, tt / 0.08)
    fade_out = np.minimum(1.0, (dur_sec - tt) / 0.10)
    env = np.clip(fade_in * fade_out, 0.0, 1.0)
    sig = np.zeros(n, dtype=np.float64)
    for f in freqs:
        sig += np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * 2 * f * tt)
    sig /= max(len(freqs), 1)
    add_stereo(music_L, music_R, i0, amp * env * sig, pan=0.0)


def frame_drum(start_sec, amp=0.14, pitch=88.0):
    i0 = int(start_sec * SR)
    n = int(0.14 * SR)
    tt = np.arange(n, dtype=np.float64) / SR
    f_sweep = pitch * (1.0 + 0.6 * np.exp(-tt * 45))
    body = np.sin(2 * np.pi * f_sweep * tt) * np.exp(-tt * 24)
    tap = rng.standard_normal(n) * np.exp(-tt * 75) * 0.25
    add_stereo(music_L, music_R, i0, amp * (body + tap), pan=0.0)


def tambourine_shake(start_sec, amp=0.045, pan=0.2):
    i0 = int(start_sec * SR)
    n = int(0.08 * SR)
    tt = np.arange(n, dtype=np.float64) / SR
    noise = rng.standard_normal(n)
    ring = np.sin(2 * np.pi * 4200 * tt) + 0.6 * np.sin(2 * np.pi * 6100 * tt)
    sig = (0.6 * noise + 0.4 * ring) * np.exp(-tt * 45)
    add_stereo(music_L, music_R, i0, amp * sig, pan=pan)


# ---------------- 1. Musical Score (0.0s .. 15.0s, zero silent gaps) ----------------
# Chord progression matching the 5 story beats:
# Hook (0-2s): Am7 -> G
# Chase (2-5s): Am -> G -> F -> E7 (fast energetic pulse)
# Escalation (5-9s): Dm -> Am -> F -> E7
# Payoff (9-13s): Fmaj7 -> G6 -> Cmaj7 -> Am ("WATCH OUT FOR WIND" reveal chord at 10.6s)
# Callback (13-15s): Dm7 -> E7 -> Am9 final comedic cadence
sections = [
    (0.0, 2.0, [220.0, 261.63, 329.63, 392.0, 440.0], 0.25),
    (2.0, 5.0, [220.0, 293.66, 329.63, 392.0, 440.0, 523.25], 0.18),
    (5.0, 9.0, [196.0, 246.94, 293.66, 349.23, 392.0, 493.88], 0.18),
    (9.0, 13.0, [174.61, 220.0, 261.63, 329.63, 392.0, 440.0], 0.24),
    (13.0, 15.0, [220.0, 261.63, 329.63, 440.0, 523.25], 0.22),
]

for s_start, s_end, notes, step in sections:
    warm_pad([notes[0] * 0.5, notes[0], notes[2]], s_start, s_end - s_start, amp=0.075)
    cursor = s_start
    idx = 0
    while cursor < s_end - 0.04:
        freq = notes[idx % len(notes)]
        pan = -0.25 if idx % 2 == 0 else 0.25
        lyre_pluck(freq, cursor, dur_sec=0.55, amp=0.14, pan=pan)
        if idx % 2 == 0:
            lyre_pluck(notes[0] * 0.5, cursor, dur_sec=0.7, amp=0.11, pan=0.0)
            frame_drum(cursor, amp=0.12, pitch=86.0)
        else:
            tambourine_shake(cursor, amp=0.04, pan=-pan)
        cursor += step
        idx += 1

# Final resolving chord at 14.55s
for f_note, p in [(220.0, -0.3), (261.63, -0.1), (329.63, 0.1), (440.0, 0.3), (659.25, 0.0)]:
    lyre_pluck(f_note, 14.55, dur_sec=0.44, amp=0.14, pan=p)


# ---------------- 2. Timed Storyboard Foley & Action SFX ----------------
def wind_gust_sfx(start_sec, dur_sec=1.35, amp=0.26, pan_start=-0.5, pan_end=0.6):
    i0 = int(start_sec * SR)
    n = int(dur_sec * SR)
    tt = np.arange(n, dtype=np.float64) / SR
    u = tt / max(dur_sec, 1e-6)
    env = np.sin(np.pi * u) ** 1.4
    raw = rng.standard_normal(n)
    # Moving resonant whistle + filtered air whoosh
    win = 36
    air = np.convolve(raw, np.ones(win) / win, mode="same")
    whistle_freq = 380 + 260 * np.sin(np.pi * u) + 45 * np.sin(2 * np.pi * 6 * tt)
    whistle = np.sin(2 * np.pi * np.cumsum(whistle_freq) / SR) * 0.35
    sig = amp * env * (air * 1.4 + whistle)
    pan_curve = pan_start + (pan_end - pan_start) * u
    angle = (pan_curve + 1.0) * (np.pi / 4.0)
    i1 = min(N, i0 + n)
    seg = sig[: i1 - i0]
    sfx_L[i0:i1] += seg * np.cos(angle[: i1 - i0])
    sfx_R[i0:i1] += seg * np.sin(angle[: i1 - i0])


def scroll_flutter_sfx(start_sec, dur_sec=0.45, amp=0.16, pan=0.2):
    i0 = int(start_sec * SR)
    n = int(dur_sec * SR)
    tt = np.arange(n, dtype=np.float64) / SR
    bursts = 0.5 + 0.5 * np.sin(2 * np.pi * 16.0 * tt)
    noise = np.convolve(rng.standard_normal(n), np.ones(10) / 10, mode="same")
    env = np.sin(np.pi * (tt / dur_sec))
    add_stereo(sfx_L, sfx_R, i0, amp * env * bursts * noise, pan=pan)


def sandal_footstep_sfx(start_sec, amp=0.14, pan=0.0):
    i0 = int(start_sec * SR)
    n = int(0.055 * SR)
    tt = np.arange(n, dtype=np.float64) / SR
    thud = np.sin(2 * np.pi * 195 * tt) * np.exp(-tt * 75)
    grit = rng.standard_normal(n) * np.exp(-tt * 95) * 0.65
    add_stereo(sfx_L, sfx_R, i0, amp * (thud + grit), pan=pan)


def fountain_splash_sfx(start_sec=3.0, dur_sec=1.3, amp=0.12):
    i0 = int(start_sec * SR)
    n = int(dur_sec * SR)
    tt = np.arange(n, dtype=np.float64) / SR
    env = np.sin(np.pi * (tt / dur_sec))
    water = np.convolve(rng.standard_normal(n), np.ones(14) / 14, mode="same")
    ripple = 0.6 + 0.4 * np.sin(2 * np.pi * 11 * tt)
    add_stereo(sfx_L, sfx_R, i0, amp * env * water * ripple, pan=0.15)


def cart_clunk_and_skid_sfx(start_sec=5.55):
    # Leather sandal braking skid
    i0 = int(start_sec * SR)
    n_skid = int(0.42 * SR)
    tt = np.arange(n_skid, dtype=np.float64) / SR
    skid = np.convolve(rng.standard_normal(n_skid), np.ones(16) / 16, mode="same") * np.exp(-tt * 4.5)
    add_stereo(sfx_L, sfx_R, i0, 0.18 * skid, pan=-0.2)

    # Wooden cart axle clunk + spoke rattle
    for offset, pitch, p in [(0.35, 130.0, 0.15), (1.15, 165.0, 0.25), (1.65, 148.0, 0.3)]:
        j0 = int((start_sec + offset) * SR)
        m = int(0.16 * SR)
        uu = np.arange(m, dtype=np.float64) / SR
        wood = (
            np.sin(2 * np.pi * pitch * uu) * np.exp(-uu * 32)
            + 0.6 * np.sin(2 * np.pi * (pitch * 2.4) * uu) * np.exp(-uu * 48)
        )
        add_stereo(sfx_L, sfx_R, j0, 0.22 * wood, pan=p)


def payoff_unroll_and_stinger_sfx():
    # Scroll catch thump at f294 (9.80s)
    sandal_footstep_sfx(9.80, amp=0.20, pan=0.3)
    # Parchment unroll rustle at f312..336 (10.40s..11.20s)
    scroll_flutter_sfx(10.40, dur_sec=0.78, amp=0.20, pan=0.0)
    # Comedic payoff chime stinger ("WATCH OUT FOR WIND" reveal at 11.10s)
    for idx, freq in enumerate([523.25, 659.25, 783.99, 1046.50]):
        lyre_pluck(freq, 11.05 + idx * 0.07, dur_sec=0.9, amp=0.18, pan=(idx - 1.5) * 0.2)


# Trigger Shot 1 Hook Gust (f14 = 0.47s)
wind_gust_sfx(0.44, dur_sec=1.45, amp=0.28, pan_start=-0.4, pan_end=0.65)
scroll_flutter_sfx(0.50, dur_sec=0.65, amp=0.19, pan=0.35)

# Trigger Shot 2 Chase Footsteps & Fountain Pass (2.0s .. 5.0s)
step_t = 2.02
step_i = 0
while step_t < 4.95:
    sandal_footstep_sfx(step_t, amp=0.14, pan=-0.15 if step_i % 2 == 0 else 0.05)
    step_t += 1.0 / 5.5  # 2.75 cycles/sec = 5.5 steps/sec
    step_i += 1
fountain_splash_sfx(2.95, dur_sec=1.35, amp=0.13)
scroll_flutter_sfx(3.60, dur_sec=0.55, amp=0.14, pan=0.45)

# Trigger Shot 3 Escalation Cart Dive, Skid, Under-Axle Bounce & Rocket Launch (5.0s .. 9.0s)
step_t = 5.04
while step_t < 5.65:
    sandal_footstep_sfx(step_t, amp=0.15, pan=-0.2)
    step_t += 0.17
cart_clunk_and_skid_sfx(5.58)
scroll_flutter_sfx(6.75, dur_sec=0.70, amp=0.17, pan=0.1)
wind_gust_sfx(7.82, dur_sec=1.05, amp=0.25, pan_start=0.0, pan_end=0.7)

# Trigger Shot 4 Payoff Catch, Unroll & Reveal Stinger (9.0s .. 13.0s)
step_t = 9.05
while step_t < 9.85:
    sandal_footstep_sfx(step_t, amp=0.13, pan=-0.3)
    step_t += 0.20
payoff_unroll_and_stinger_sfx()

# Trigger Shot 5 Callback Gust Snatch & Final Deadpan Pluck (13.0s .. 15.0s)
wind_gust_sfx(13.15, dur_sec=1.35, amp=0.29, pan_start=-0.1, pan_end=0.75)
scroll_flutter_sfx(13.20, dur_sec=0.80, amp=0.20, pan=0.4)
lyre_pluck(392.0, 14.15, dur_sec=0.35, amp=0.17, pan=-0.2)
lyre_pluck(440.0, 14.40, dur_sec=0.50, amp=0.19, pan=0.2)

# ---------------- 3. Mix & True-Peak Normalization (-1.5 dBFS) ----------------
mix_L = music_L * 0.72 + sfx_L * 0.92
mix_R = music_R * 0.72 + sfx_R * 0.92

# Gentle 20ms fade-in and 40ms fade-out so start/end have zero DC click
fade_in_n = int(0.02 * SR)
fade_out_n = int(0.04 * SR)
mix_L[:fade_in_n] *= np.linspace(0.0, 1.0, fade_in_n)
mix_R[:fade_in_n] *= np.linspace(0.0, 1.0, fade_in_n)
mix_L[-fade_out_n:] *= np.linspace(1.0, 0.15, fade_out_n)
mix_R[-fade_out_n:] *= np.linspace(1.0, 0.15, fade_out_n)

stereo = np.column_stack([mix_L, mix_R])
peak = float(np.max(np.abs(stereo)))
target_peak = 10.0 ** (-1.5 / 20.0)
stereo *= target_peak / max(peak, 1e-6)
pcm16 = (np.clip(stereo, -1.0, 1.0) * 32767.0).astype(np.int16)

out_paths = sys.argv[1:] or ["../out/oos-03/demo15/demo15-mix.wav"]
for out_p in out_paths:
    os.makedirs(os.path.dirname(os.path.abspath(out_p)), exist_ok=True)
    with wave.open(out_p, "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        wf.writeframes(pcm16.tobytes())
    print(f"Synthesized {out_p} ({len(pcm16) / SR:.3f}s, {SR} Hz, 2ch, peak_before_norm={peak:.3f})")
