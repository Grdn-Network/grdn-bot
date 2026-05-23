"""
gen_clips.py  —  generate all voice sets for GRDN defect detector alerts.

Usage:
    python gen_clips.py                  # generate guy + christopher
    python gen_clips.py --voice wife     # placeholder: copies david as stand-in

Drops WAV files into audio/clips/<voice>/ ready for the bot.
"""

import asyncio, os, shutil, subprocess, sys
import edge_tts

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CLIPS_BASE  = os.path.join(SCRIPT_DIR, "clips")   # audio/clips/<voice>/
FFMPEG      = (
    r"C:\Users\shoot\AppData\Local\Microsoft\WinGet\Packages"
    r"\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe"
    r"\ffmpeg-8.1.1-full_build\bin\ffmpeg.exe"
)

# ── Clip text map ─────────────────────────────────────────────────────────────
CLIPS = {
    "0":                                    "Zero",
    "1":                                    "One",
    "2":                                    "Two",
    "3":                                    "Three",
    "4":                                    "Four",
    "5":                                    "Five",
    "6":                                    "Six",
    "7":                                    "Seven",
    "8":                                    "Eight",
    "9":                                    "Nine",
    "attention":                            "Attention",
    "emergency":                            "Emergency",
    "train":                                "Train",
    "grdn_detector":                        "Guardian Detector",
    "hotbox_detected":                      "Hot box detected",
    "front_truck":                          "Front truck",
    "rear_truck":                           "Rear truck",
    "wheel_bearing":                        "Wheel bearing",
    "derailment_detected":                  "Derailment detected",
    "air_hose_defect":                      "Air hose defect",
    "dragging_equipment":                   "Dragging equipment",
    "no_defects_detected":                  "No defects detected",
    "reduce_speed_inspect":                 "Reduce speed and inspect",
    "stop_immediately_contact_dispatch":    "Stop immediately and contact dispatch",
    "check_brake_line_reduce_speed":        "Check brake line and reduce speed",
    "stop_train_inspect_consist":           "Stop train and inspect consist",
    "cars":                                 "Cars",
    "speed":                                "Speed",
    "end_of_message":                       "End of message",
    "contact_dispatch":                     "Contact dispatch",
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def mp3_to_wav(mp3, wav):
    """Convert an MP3 to 22050 Hz 16-bit mono WAV using the bundled ffmpeg."""
    result = subprocess.run(
        [FFMPEG, "-y", "-i", mp3,
         "-acodec", "pcm_s16le", "-ar", "22050", "-ac", "1", wav],
        capture_output=True
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode())

async def generate_edge_set(voice_name, edge_voice):
    """Generate a full clip set using an edge-tts neural voice."""
    out_dir = os.path.join(CLIPS_BASE, voice_name)
    os.makedirs(out_dir, exist_ok=True)

    for name, text in CLIPS.items():
        mp3 = os.path.join(out_dir, f"{name}.mp3")
        wav = os.path.join(out_dir, f"{name}.wav")
        comm = edge_tts.Communicate(text, edge_voice)
        await comm.save(mp3)
        mp3_to_wav(mp3, wav)
        os.remove(mp3)
        print(f"  [{voice_name}] {name}.wav")

# ── Main ──────────────────────────────────────────────────────────────────────

async def main():
    # Step 1: move existing flat clips → david/
    david_dir = os.path.join(CLIPS_BASE, "david")
    os.makedirs(david_dir, exist_ok=True)
    moved = 0
    for name in CLIPS:
        src = os.path.join(CLIPS_BASE, f"{name}.wav")
        dst = os.path.join(david_dir, f"{name}.wav")
        if os.path.exists(src):
            shutil.move(src, dst)
            moved += 1
    if moved:
        print(f"Moved {moved} David clips → audio/clips/david/")
    else:
        print("David clips already in place.")

    # Step 2: generate neural voice sets
    voices = [
        ("guy",         "en-US-GuyNeural"),
        ("christopher", "en-US-ChristopherNeural"),
    ]
    for folder, edge_id in voices:
        print(f"\nGenerating {folder} ({edge_id})...")
        await generate_edge_set(folder, edge_id)
        print(f"{folder} done — {len(CLIPS)} clips.")

    # Step 3: create wife placeholder folder
    wife_dir = os.path.join(CLIPS_BASE, "wife")
    os.makedirs(wife_dir, exist_ok=True)
    readme = os.path.join(wife_dir, "README.txt")
    if not os.path.exists(readme):
        needed = "\n".join(f"  {k}.wav  =  \"{v}\"" for k, v in CLIPS.items())
        with open(readme, "w", encoding="utf-8") as f:
            f.write("GRDN Detector — wife voice set\n")
            f.write("================================\n")
            f.write("Record each phrase below as a WAV file (any sample rate, mono or stereo).\n")
            f.write("Drop the files in this folder — the bot picks this voice automatically.\n\n")
            f.write(needed + "\n")
        print("\nCreated audio/clips/wife/ with recording instructions.")

    print("\nAll done.")

asyncio.run(main())
