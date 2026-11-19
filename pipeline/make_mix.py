# Original synthesized western score + SFX, ducked under voice. NOT the template mix.py.
# Method: numpy synth at 48 kHz stereo.
#  - Music: plucked-string (Karplus-ish decaying harmonics) arpeggio in D major pentatonic-ish,
#    low shuffle rhythm (kick-ish thump + brush noise on offbeats), quiet; chords D / G / D / A.
#  - Ducking: music gain reduced by an envelope derived from voice amplitude (per-beat manual + smoothing).
#  - SFX: boot taps at marchPhase footfalls (2 steps/s, tau in shots 1-4, i.e. t<21.6, louder/growing in shot 3-4),
#    chain creak+sing at 15.01 s, small splash at ~17.2 s when hat lands, swing creaks in shot 5 each push.
import wave, numpy as np, pathlib, json
root=pathlib.Path.home()/"workspace/cartoon-cowboy-trial"
SR=48000; DUR=894/30.0; N=int(SR*DUR)
rng=np.random.default_rng(7)
def read_wav(path):
    with wave.open(str(path)) as w:
        d=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(np.float32)/32768.0
        assert w.getframerate()==SR
    return d
voice_m=read_wav(root/"voice/voice.wav")
voice=np.zeros(N); voice[:min(N,len(voice_m))]=voice_m[:min(N,len(voice_m))]
t=np.arange(N)/SR
# ---------- music ----------
music=np.zeros(N)
def pluck(freq, start, dur=0.5, amp=0.20):
    i0=int(start*SR); i1=min(N,i0+int(dur*SR)); n=i1-i0
    if n<=0: return
    tt=np.arange(n)/SR
    env=np.exp(-tt*6)
    wave_=(np.sin(2*np.pi*freq*tt)+0.5*np.sin(2*np.pi*2*freq*tt)*np.exp(-tt*9)+0.25*np.sin(2*np.pi*3*freq*tt)*np.exp(-tt*14))
    music[i0:i1]+=amp*env*wave_
def thump(start, amp=0.16):
    i0=int(start*SR); n=int(0.12*SR); i1=min(N,i0+n); tt=np.arange(i1-i0)/SR
    music[i0:i1]+=amp*np.sin(2*np.pi*62*tt)*np.exp(-tt*28)
def brush(start, amp=0.05):
    i0=int(start*SR); n=int(0.07*SR); i1=min(N,i0+n); tt=np.arange(i1-i0)/SR
    noise=rng.standard_normal(i1-i0)
    music[i0:i1]+=amp*noise*np.exp(-tt*40)
# chord roots: D2=73.42, G2=98, A2=110; melody pentatonic D F# A B
chords=[(0.0,73.42),(7.6,98.0),(11.5,73.42),(15.0,110.0),(18.6,98.0),(21.7,73.42),(25.5,110.0)]
roots={73.42:[146.83,185.0,220.0,293.66],98.0:[196.0,246.94,293.66,392.0],110.0:[220.0,277.18,329.63,440.0]}
for ci,(cs,rootf) in enumerate(chords):
    ce=chords[ci+1][0] if ci+1<len(chords) else DUR
    tt_=cs
    k=0
    while tt_<ce-0.1:
        notes=roots[rootf]
        pluck(notes[k%len(notes)], tt_, 0.55, 0.13)
        if k%2==0: pluck(rootf, tt_, 0.8, 0.10)
        tt_+=0.5; k+=1
    tt2=cs
    while tt2<ce-0.05:
        thump(tt2,0.11); brush(tt2+0.25,0.035); tt2+=0.5
# ---------- SFX ----------
sfx=np.zeros(N)
def boot(start, amp):
    i0=int(start*SR); n=int(0.06*SR); i1=min(N,i0+n); tt=np.arange(i1-i0)/SR
    sfx[i0:i1]+=amp*(0.7*np.sin(2*np.pi*180*tt)*np.exp(-tt*70)+0.5*rng.standard_normal(i1-i0)*np.exp(-tt*90))
# footfalls: marchPhase 1 Hz cycle, footfalls at phase 0 and 0.5 => every 0.5 s while marching (t in [0.5,21.4])
tt_=0.35  # footfalls at marchPhase(tau), tau=t+5.65 -> t frac .35/.85
while tt_<21.4:
    amp=0.10 if tt_<11.5 else 0.13 if tt_<15 else 0.16
    boot(tt_,amp); tt_+=0.5
def sing(start=15.01):
    i0=int(start*SR); n=int(0.9*SR); i1=min(N,i0+n); tt=np.arange(i1-i0)/SR
    sfx[i0:i1]+=0.14*np.sin(2*np.pi*(1240+300*np.sin(2*np.pi*9*tt))*tt)*np.exp(-tt*3.5)*(tt>0.02)
    # creak: low saw-ish groan before
    j0=int((start-0.5)*SR); m=int(0.5*SR); uu=np.arange(m)/SR
    sfx[j0:j0+m]+=0.06*np.sin(2*np.pi*(90+40*uu)*uu)*np.exp(-uu*2)
sing()
def splash(start=17.2):
    i0=int(start*SR); n=int(0.7*SR); i1=min(N,i0+n); tt=np.arange(i1-i0)/SR
    noise=rng.standard_normal(i1-i0)
    # crude lowpass
    k=np.ones(24)/24; noise=np.convolve(noise,k,mode='same')
    sfx[i0:i1]+=0.20*noise*np.exp(-tt*5)*np.minimum(1,tt*30)
splash()
# swing creaks at pushes 21.9,23.45,25.0
for ps in [21.9,23.45,25.0]:
    i0=int(ps*SR); n=int(0.4*SR); i1=min(N,i0+n); tt=np.arange(i1-i0)/SR
    sfx[i0:i1]+=0.05*np.sin(2*np.pi*(300+80*np.sin(2*np.pi*3*tt))*tt)*np.exp(-tt*6)
# ---------- ducking + mix ----------
# voice activity envelope (100 ms windows, smoothed)
win=int(0.1*SR); act=np.zeros(N)
a=np.abs(voice)
env=np.convolve(a, np.ones(win)/win, mode='same')
duck=np.clip(1.0-1.6*env, 0.25, 1.0)
# smooth duck
duck=np.convolve(duck, np.ones(int(0.15*SR))/(int(0.15*SR)), mode='same')
music_g=0.55*duck; sfx_g=0.8
mix=np.column_stack([voice + music*music_g + sfx*sfx_g]*2)
# gentle limiter / normalize to -1.5 dBFS peak
peak=np.max(np.abs(mix)); print("peak before norm",peak)
mix*= (10**(-1.5/20))/max(peak,1e-6)
with wave.open(str(root/"audio/mix.wav"),"wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((np.clip(mix,-1,1)*32767).astype(np.int16).tobytes())
print("mix seconds", len(mix)/SR)
