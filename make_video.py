"""
Sleep video voiceover mixer — run this on your own PC.
Usage: python make_video.py
"""

import urllib.request
import urllib.error
import json
import subprocess
import sys
import os

# ── CONFIG ────────────────────────────────────────────────────────────────────
ELEVENLABS_API_KEY = "56b757979927dda09669020cff5fef955972854f10deb73ed6c5809b429fad2b"
VOICE_ID           = "21m00Tcm4TlvDq8ikWAM"   # Rachel — calm, soothing
MODEL_ID           = "eleven_multilingual_v2"

VIDEO_IN  = "input_video.mp4"    # put your Kling video here (rename it)
AUDIO_OUT = "voiceover.mp3"
VIDEO_OUT = "final_video.mp4"

NARRATION = """
The café closed hours ago, but someone left the neon sign glowing and a handheld game charging quietly on the counter.
Rain keeps sliding down the front window, blurring the empty street into soft pink light.

Up here, the city has gone quiet. The espresso machine has long gone cold, but the room still holds its warmth.
Low string lights run along the shelves, a stack of manga left open on a corner table,
everything exactly as it was when the last customer wandered home.

Somewhere down the street, a train passes with a low, distant rumble, gone again before it fully arrives.
The rain simply continues — patient, steady, filling every gap between sounds.

The city outside is mostly asleep now too, its neon still burning out of habit more than need,
painting soft colour across puddles that never quite still.

There is nowhere to go tonight. Nothing to prepare. Nothing to finish.
Only this small warm room, holding its quiet a little longer before morning.

Let your eyes rest on the blurred pink glow through the glass.
Let the rain's soft rhythm replace whatever noise usually fills your head.

You can let this slow neon rain carry you all the way into sleep.
"""

ORIGINAL_AUDIO_VOLUME = 0.12   # 0 = mute original, 1 = keep full
# ─────────────────────────────────────────────────────────────────────────────


def generate_voiceover():
    print("Generating ElevenLabs voiceover...")
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}"
    payload = json.dumps({
        "text": NARRATION.strip(),
        "model_id": MODEL_ID,
        "voice_settings": {"stability": 0.75, "similarity_boost": 0.75},
    }).encode()
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "xi-api-key": ELEVENLABS_API_KEY,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            with open(AUDIO_OUT, "wb") as f:
                f.write(resp.read())
        print(f"  Voiceover saved to {AUDIO_OUT}")
    except urllib.error.HTTPError as e:
        print(f"  ElevenLabs error {e.code}: {e.read().decode()}")
        sys.exit(1)


def mix_video():
    print("Mixing voiceover into video with ffmpeg...")
    if not os.path.exists(VIDEO_IN):
        print(f"  ERROR: {VIDEO_IN} not found. Rename your Kling video to '{VIDEO_IN}'")
        sys.exit(1)

    vol = ORIGINAL_AUDIO_VOLUME
    if vol <= 0:
        filter_complex = "[1:a]apad[aout]"
        map_args = ["-map", "0:v", "-map", "[aout]"]
    else:
        filter_complex = f"[0:a]volume={vol}[orig];[orig][1:a]amix=inputs=2:duration=longest[aout]"
        map_args = ["-map", "0:v", "-map", "[aout]"]

    cmd = [
        "ffmpeg", "-y",
        "-i", VIDEO_IN,
        "-i", AUDIO_OUT,
        "-filter_complex", filter_complex,
        *map_args,
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        VIDEO_OUT,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  ffmpeg error:\n{result.stderr[-500:]}")
        sys.exit(1)
    print(f"  Done! Final video: {VIDEO_OUT}")


if __name__ == "__main__":
    generate_voiceover()
    mix_video()
    print("\nAll done! Upload", VIDEO_OUT, "to YouTube.")
