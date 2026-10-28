"""Development only: freeze Basic Pitch 0.4.0 decoder outputs; never shipped."""
import json
from pathlib import Path
import importlib.metadata
import numpy as np
from basic_pitch.note_creation import output_to_notes_polyphonic, model_frames_to_time
assert importlib.metadata.version("basic-pitch") == "0.4.0"
cases = [
    {"name": "silence", "frames": 32, "bands": [], "onsets": []},
    {"name": "short_and_long", "frames": 80, "bands": [[2,12,39,0.8],[32,52,43,0.7]], "onsets": [[2,39,0.9],[32,43,0.9]]},
    {"name": "chord", "frames": 80, "bands": [[2,42,p,0.8] for p in [27,31,34]], "onsets": [[2,p,0.9] for p in [27,31,34]]},
    {"name": "ties_without_onsets", "frames": 100, "bands": [[4,24,39,0.8],[54,74,43,0.8]], "onsets": []},
    {"name": "window_boundaries", "frames": 550, "bands": [[160,190,39,0.8],[330,365,43,0.75],[510,545,46,0.7]], "onsets": [[160,39,0.9],[330,43,0.9],[510,46,0.9]]},
]
for case in cases:
    note = np.zeros((case["frames"],88),dtype=np.float32)
    onset = np.zeros_like(note)
    for start,end,pitch,value in case["bands"]: note[start:end,pitch]=value
    for frame,pitch,value in case["onsets"]: onset[frame,pitch]=value
    result = output_to_notes_polyphonic(note,onset,0.5,0.3,11,True,None,None)
    times = model_frames_to_time(case["frames"])
    case["expected"] = [{"start":int(a),"end":int(b),"pitch":int(p),"velocity":int(np.round(v*127)),"startTick":int(np.round(times[a]*960)),"endTick":int(np.round(times[b]*960))} for a,b,p,v in sorted(result)]
out=Path(__file__).resolve().parents[1]/"test"/"fixtures"/"basic-pitch-0.4.0.json"
out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps({"reference":"basic-pitch 0.4.0","cases":cases},indent=2)+"\n",encoding="utf-8")
print(out)
